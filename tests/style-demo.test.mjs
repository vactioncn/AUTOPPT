import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { STYLE_DEMOS } from "../shared/style-demo.mjs";

test("standalone demo needs no project; cover changes only preview metadata", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "autoppt-demo-"));
  process.env.AUTOPPT_DATA_DIR = dir;
  const { db, put, get, all, assetPath } = await import("../server/store.mjs");
  const { registerTrials } = await import("../server/trials.mjs");
  const app = express();
  app.use(express.json());
  let jobs = 0;
  registerTrials(app, {
    enqueue(type, projectId, payload) {
      return put("job", {
        id: `job-${++jobs}`,
        type,
        projectId,
        payload,
        status: "queued",
      });
    },
  });
  app.use((error, _req, res, _next) =>
    res.status(error.status || 400).json({ error: error.message }),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/styles`;
  const post = async (p, body = {}) => {
    const r = await fetch(url + p, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: r.status, body: await r.json() };
  };
  try {
    const style = put("style", {
      id: "demo-style",
      rules: "原文风格\n不改写",
      refs: [],
      colors: ["#fff"],
      compositionMode: "direct",
    });
    const trial = await post("/demo-style/trials", {
      notes: STYLE_DEMOS[0].notes,
      rules: style.rules,
    });
    assert.equal(trial.status, 202);
    assert.equal(all("project").length, 0);
    assert.equal(jobs, 1);
    const coverURL = `/demo-style/trials/${trial.body.id}/cover`;
    assert.equal((await post(coverURL)).status, 400);
    const t = get("trial", trial.body.id);
    t.image = "demo.png";
    t.status = "completed";
    put("trial", t);
    put("job", { ...get("job", t.jobId), status: "completed" });
    assert.equal((await post(coverURL)).status, 400); // Missing file is not a cover.
    writeFileSync(
      assetPath("demo.png"),
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jM1sAAAAASUVORK5CYII=",
        "base64",
      ),
    );
    assert.equal((await post(coverURL)).status, 200);
    const saved = get("style", style.id);
    assert.equal(saved.cover, "demo.png");
    assert.equal(saved.rules, style.rules);
    assert.deepEqual(saved.refs, []);
    assert.equal(all("styleVersion").length, 0);
    put("style", { ...style, id: "other" });
    assert.equal((await post(`/other/trials/${t.id}/cover`)).status, 400);
    assert.equal(get("style", "other").cover, undefined);
    assert.equal((await post(coverURL)).status, 200); // Idempotent selection.
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
