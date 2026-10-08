import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import { once } from "node:events";
import { contentSignature, rehearsalState } from "../shared/rehearsal.mjs";
const dir = mkdtempSync(path.join(tmpdir(), "autoppt-rehearsal-"));
process.env.AUTOPPT_DATA_DIR = dir;
const { put, get, db } = await import("../server/store.mjs");
const { registerRehearsal } = await import("../server/rehearsal.mjs");
after(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});
const makeProject = () => ({
  id: "talk",
  title: "测试演讲",
  revision: 1,
  styleId: "style",
  batches: [],
  slides: [1, 2, 3].map((i) => ({
    id: `p${i}`,
    notes: `讲稿 ${i}`,
    image: "fixture.png",
    status: "ready",
    manuscriptVersion: 1,
  })),
});
test("rehearsal signature follows saved content, artwork, order and mother deck, excluding drafts and visits", () => {
  const p = makeProject();
  const signature = contentSignature(p);
  p.rehearsal = { signature, completedAt: "2026-10-07T00:00:00Z" };
  assert.equal(rehearsalState(p).status, "complete");
  assert.equal(rehearsalState(p).label, "已完成当前版本演练");
  assert.equal(rehearsalState(makeProject()).label, "尚未开始演练");
  assert.equal(rehearsalState(makeProject()).status, "unstarted");
  for (const change of [
    (p) => (p.title += "更新"),
    (p) => (p.slides[0].notes += "修改"),
    (p) => p.slides.reverse(),
    (p) => (p.slides[0].image = "new.png"),
    (p) => p.slides.pop(),
    (p) => (p.styleId = "other"),
    (p) => (p.slides[0].scene = { content: "new" }),
  ]) {
    const changed = structuredClone(p);
    change(changed);
    assert.equal(rehearsalState(changed).status, "stale");
    assert.equal(
      rehearsalState(changed).label,
      "上次演练基于修改前内容，本次修改尚未演练。",
    );
  }
  p.draft = "未提交草稿";
  p.revision++;
  p.updatedAt = "new";
  assert.equal(contentSignature(p), signature);
  assert.equal(
    rehearsalState(p, { enabled: false, reason: "平台未开放标准放映" }).status,
    "unavailable",
  );
});
test("standard rehearsal requires explicit start and every rendered page, rejects stale runs, and completion is idempotent", async (t) => {
  const app = express();
  app.use(express.json());
  registerRehearsal(app, { available: () => true });
  app.use((e, req, res, next) =>
    res.status(e.status || 400).json({ error: e.message }),
  );
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const call = async (suffix, body = {}) => {
    const r = await fetch(
      `http://127.0.0.1:${server.address().port}/api/projects/talk/rehearsal/${suffix}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    return { status: r.status, data: await r.json() };
  };
  const p = put("project", makeProject());
  assert.equal((await call("complete")).status, 409);
  assert.equal(get("project", p.id).rehearsal, undefined);
  let start = await call("start", { signature: contentSignature(p) });
  const session = start.data.session;
  assert.equal(start.status, 200);
  assert.equal(
    get("project", p.id).rehearsal,
    undefined,
    "opening or starting is not completion",
  );
  assert.equal(
    (await call("page", { session, index: 2 })).status,
    409,
    "cannot skip pages",
  );
  assert.equal((await call("page", { session, index: 0 })).status, 200);
  assert.equal(
    (await call("complete", { session })).status,
    409,
    "closing midway is not completion",
  );
  for (const index of [1, 2])
    assert.equal((await call("page", { session, index })).status, 200);
  const done = await call("complete", { session });
  assert.equal(done.status, 200);
  assert.equal(rehearsalState(get("project", p.id)).status, "complete");
  assert.deepEqual((await call("complete", { session })).data, done.data);
  assert.equal(
    get("project", p.id).revision,
    1,
    "recording does not change mother deck",
  );
  start = await call("start", { signature: contentSignature(p) });
  p.slides.reverse();
  put("project", p);
  assert.equal(
    (await call("page", { session: start.data.session, index: 0 })).status,
    409,
  );
});
test("hosted disabled capability rejects rehearsal without creating a completion or a session", async (t) => {
  const app = express();
  app.use(express.json());
  registerRehearsal(app, { available: () => false });
  app.use((e, req, res, next) =>
    res.status(e.status || 400).json({ error: e.message }),
  );
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const r = await fetch(
    `http://127.0.0.1:${server.address().port}/api/projects/talk/rehearsal/start`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    },
  );
  assert.equal(r.status, 403);
  assert.match((await r.json()).error, /未开放/);
});
