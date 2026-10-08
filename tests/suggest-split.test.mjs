import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import express from "express";
import { once } from "node:events";
const dir = mkdtempSync(path.join(tmpdir(), "autoppt-suggest-"));
process.env.AUTOPPT_DATA_DIR = dir;
const { put, get, all, db } = await import("../server/store.mjs");
const { registerSuggestSplit } = await import("../server/suggest-split.mjs");
after(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});
const make = (id) =>
  put("project", {
    id,
    slides: ["a", "b"].map((id) => ({ id, notes: "第一句话。第二句话。" })),
  });
async function serve(t, model) {
  const app = express();
  app.use(express.json());
  registerSuggestSplit(app, { model });
  app.use((e, req, res, next) =>
    res.status(e.status || 400).json({ error: e.message }),
  );
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  return async (project, body, signal) => {
    const r = await fetch(
      `http://127.0.0.1:${server.address().port}/api/projects/${project}/suggest-split`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal,
      },
    );
    return { status: r.status, data: await r.json() };
  };
}
test("suggestion replay survives a lost HTTP response and a fresh route instance without repeating model calls", async (t) => {
  make("replay");
  let calls = 0,
    enter,
    release;
  const started = new Promise((r) => (enter = r)),
    gate = new Promise((r) => (release = r));
  const model = async () => {
    calls++;
    enter();
    await gate;
    return { ends: [1, 2] };
  };
  const call = await serve(t, model),
    body = { slideId: "a", requestId: randomUUID() };
  const controller = new AbortController();
  const lost = call("replay", body, controller.signal);
  const rejected = assert.rejects(lost, /abort/i);
  await started;
  controller.abort();
  await rejected;
  const duplicate = call("replay", body);
  release();
  const result = await duplicate;
  assert.deepEqual(result, { status: 200, data: { cuts: [5] } });
  assert.deepEqual(await call("replay", body), result);
  const restarted = await serve(t, async () => {
    calls++;
    throw new Error("must never run");
  });
  assert.deepEqual(await restarted("replay", body), result);
  assert.equal(calls, 1);
  const record = all("split-suggestion").find((r) =>
    r.id.includes(body.requestId),
  );
  assert.deepEqual(Object.keys(record).sort(), [
    "digest",
    "id",
    "result",
    "status",
  ]);
  assert(!JSON.stringify(record).includes("第一句话"));
  const p = get("project", "replay");
  p.slides[0].notes += "修改。";
  put("project", p);
  assert.equal((await restarted("replay", body)).status, 409);
  assert.equal(calls, 1);
});
test("suggestion scope includes project, slide and request; invalid identifiers never invoke model", async (t) => {
  make("scope1");
  make("scope2");
  let calls = 0;
  const call = await serve(t, async () => {
    calls++;
    return { ends: [1, 2] };
  });
  const body = { slideId: "a", requestId: randomUUID() };
  for (const [project, slideId] of [
    ["scope1", "a"],
    ["scope1", "b"],
    ["scope2", "a"],
  ])
    assert.equal((await call(project, { ...body, slideId })).status, 200);
  for (const requestId of [undefined, "bad", {}])
    assert.equal((await call("scope1", { ...body, requestId })).status, 400);
  assert.equal(calls, 3);
});
test("uncertain failed or interrupted suggestion never silently invokes the model again", async (t) => {
  make("uncertain");
  let calls = 0;
  const call = await serve(t, async () => {
    calls++;
    throw new Error("fixture lost result");
  });
  const body = { slideId: "a", requestId: randomUUID() };
  assert.equal((await call("uncertain", body)).status, 400);
  assert.equal((await call("uncertain", body)).status, 409);
  const restarted = await serve(t, async () => {
    calls++;
    return { ends: [1, 2] };
  });
  assert.equal((await restarted("uncertain", body)).status, 409);
  assert.equal(calls, 1);
});
