import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import { textDiff } from "../shared/text-diff.mjs";

const dir = mkdtempSync(path.join(tmpdir(), "autoppt-versions-"));
process.env.AUTOPPT_DATA_DIR = dir;
const { all, get, put, db } = await import("../server/store.mjs");
const {
  saveStyleVersion,
  styleVersions,
  styleVersionToken,
  assertStyleVersion,
  registerStyleVersions,
} = await import("../server/style-versions.mjs");
test.after(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});
const make = (id, extra = {}) =>
  put("style", {
    id,
    rules: "第一行  \n\n末行\n",
    compositionMode: "direct",
    updatedAt: "2026-10-01",
    refs: ["ref.png"],
    colors: ["#fff"],
    ...extra,
  });

test("checkpoints preserve exact prompts, reject stale writes and roll back atomically", () => {
  const a = make("atomic");
  const beforeCount = all("styleVersion").length;
  assert.equal(styleVersions(a).versions.length, 1);
  assert.equal(all("styleVersion").length, beforeCount); // reads do not migrate
  const b = { ...a, rules: "第二版\n", updatedAt: "2026-10-02" };
  saveStyleVersion(a, b, "manual");
  let versions = styleVersions(b).versions;
  assert.equal(versions.length, 2);
  assert.equal(versions[1].rules, a.rules);
  assert.equal(versions[0].source, "manual");
  assert.throws(() => assertStyleVersion(b, styleVersionToken(a)), {
    status: 409,
  });
  assert.throws(() => saveStyleVersion(a, b, "manual"), { status: 409 });
  assert.equal(saveStyleVersion(b, b, "manual").changed, false);
  assert.equal(styleVersions(b).versions.length, 2);
  const c = { ...b, rules: "不会保存" };
  assert.throws(
    () =>
      saveStyleVersion(b, c, "trial", null, () => {
        throw new Error("rollback");
      }),
    /rollback/,
  );
  assert.deepEqual(get("style", a.id), b);
  assert.equal(styleVersions(b).versions.length, 2);
  const restored = saveStyleVersion(
    b,
    { ...b, rules: a.rules },
    "restore",
    versions[1].id,
  ).style;
  versions = styleVersions(restored).versions;
  assert.equal(versions.length, 3);
  assert.equal(versions[0].restoredFrom, versions[2].id);
  assert.equal(versions[1].rules, b.rules);
  assert.deepEqual(restored.refs, a.refs);
  assert.deepEqual(restored.colors, a.colors);
  const mode = { ...get("style", a.id), compositionMode: "content-led" };
  saveStyleVersion(get("style", a.id), mode, "manual");
  assert.equal(styleVersions(mode).versions.length, 4);
});

test("restore API scopes versions, keeps legacy metadata honest and blocks active jobs", async (t) => {
  const style = make("restore-api", {
    compositionMode: "content-led",
    history: [{ rules: "旧提示词" }],
  });
  make("other");
  const app = express();
  app.use(express.json());
  registerStyleVersions(app);
  app.use((e, _req, res, _next) =>
    res.status(e.status || 400).json({ error: e.message }),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}/api/styles`;
  const history = await (await fetch(`${base}/${style.id}/versions`)).json();
  const legacy = history.versions.find((v) => v.source === "legacy");
  assert.equal(legacy.compositionMode, null);
  assert.equal(legacy.createdAt, null);
  const restore = (
    id = style.id,
    vid = legacy.id,
    token = history.currentToken,
  ) =>
    fetch(`${base}/${id}/versions/${vid}/restore`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedVersion: token }),
    });
  assert.equal((await restore(style.id, legacy.id, "stale")).status, 409);
  assert.equal(
    (
      await restore(
        "other",
        legacy.id,
        styleVersionToken(get("style", "other")),
      )
    ).status,
    404,
  );
  for (const type of ["trial", "style"]) {
    put("job", {
      id: "active",
      type,
      status: "running",
      payload: { styleId: style.id },
    });
    assert.equal((await restore()).status, 409);
  }
  put("job", { id: "active", status: "completed" });
  const response = await restore();
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.style.rules, legacy.rules);
  assert.equal(result.style.compositionMode, "content-led");
  assert.deepEqual(result.style.refs, style.refs);
  assert.equal(styleVersions(get("style", style.id)).versions.length, 3);
  assert.equal((await restore()).status, 409); // a stale browser cannot restore again
  put("style", { ...get("style", style.id), deletedAt: "today" });
  assert.equal((await fetch(`${base}/${style.id}/versions`)).status, 404);
  assert.equal((await restore()).status, 404);
});

test("line comparison reconstructs both exact inputs, including large fallback", () => {
  const pairs = [
    ["", ""],
    ["a\n\nb \n", "a\nx\nb \n"],
    ["same\none\ntwo\nend", "same\ntwo\nthree\nend"],
    [
      Array.from({ length: 1100 }, (_, i) => `old ${i}`).join("\n"),
      Array.from({ length: 1100 }, (_, i) => `new ${i}`).join("\n"),
    ],
  ];
  for (const [before, after] of pairs) {
    const lines = textDiff(before, after);
    assert.equal(
      lines
        .filter((l) => l.kind !== "added")
        .map((l) => l.text)
        .join("\n"),
      before,
    );
    assert.equal(
      lines
        .filter((l) => l.kind !== "removed")
        .map((l) => l.text)
        .join("\n"),
      after,
    );
  }
});
