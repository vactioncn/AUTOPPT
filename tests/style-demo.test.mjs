import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import sharp from "sharp";
import {
  STYLE_DEMOS,
  STYLE_COVER,
  STYLE_COVER_NOTES,
} from "../shared/style-demo.mjs";

test("unified covers lock copy, use saved style, publish only on success and keep ordinary trials separate", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "autoppt-cover-"));
  process.env.AUTOPPT_DATA_DIR = dir;
  const { db, put, get, all, assetPath, updateSettings } =
    await import("../server/store.mjs");
  const { registerTrials, runTrial } = await import("../server/trials.mjs");
  const { directImagePrompt } = await import("../server/direct-image.mjs");
  const app = express();
  app.use(express.json());
  let jobs = 0,
    calls = [],
    responseMode = "success",
    controller;
  const png = (
    await sharp({
      create: { width: 16, height: 9, channels: 3, background: "#eee" },
    })
      .png()
      .toBuffer()
  ).toString("base64");
  const malformed = Object.fromEntries(
    await Promise.all(
      [
        ["portrait", 1024, 1536],
        ["square", 1024, 1024],
        ["landscape", 1536, 1024],
      ].map(async ([key, width, height]) => [
        key,
        (
          await sharp({
            create: { width, height, channels: 3, background: "#eee" },
          })
            .png()
            .toBuffer()
        ).toString("base64"),
      ]),
    ),
  );
  app.post("/v1/images/generations", (req, res) => {
    calls.push(req.body);
    if (responseMode === "failure")
      return res.status(500).json({ error: "test provider failure" });
    if (responseMode === "changed")
      put("style", { ...get("style", "demo"), rules: "新的风格原文" });
    if (responseMode === "cancelled") controller.abort();
    if (responseMode === "deleted")
      put("style", { ...get("style", "demo"), deletedAt: "now" });
    // A claimed landscape size must never override the returned pixels.
    res.json({
      size: "2560x1440",
      data: [{ b64_json: malformed[responseMode] || png }],
    });
  });
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
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (p, body = {}) => {
    const r = await fetch(base + "/api/styles" + p, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: r.status, body: await r.json() };
  };
  const finish = async (trial) => {
    const job = get("job", trial.jobId);
    controller = new AbortController();
    try {
      await runTrial(job, controller.signal, () => {});
      put("job", { ...job, status: "completed" });
    } catch (error) {
      put("job", { ...job, status: "failed" });
      throw error;
    }
  };
  try {
    updateSettings({
      image: {
        baseUrl: base + "/v1",
        apiKey: "test-only",
        model: "mock-image",
      },
    });
    const original = {
      id: "demo",
      name: "示例风格",
      rules: "原文风格\n不改写",
      refs: [],
      colors: ["#fff"],
      compositionMode: "content-led",
      cover: "old.png",
    };
    put("style", original);
    const ordinary = await post("/demo/trials", {
      notes: STYLE_DEMOS[0].notes,
      rules: original.rules,
    });
    assert.equal(ordinary.status, 202);
    assert.equal(
      (await post(`/demo/trials/${ordinary.body.id}/cover`)).status,
      400,
    );
    put("job", { ...get("job", ordinary.body.jobId), status: "cancelled" });
    const cover = await post("/demo/trials", {
      purpose: "cover",
      notes: "不能混入讲稿",
      rules: "不能混入未保存风格",
      feedback: "不能混入反馈",
      copyFeedback: "不要改文案",
      parentId: "invalid",
      designOptions: { palette: { mode: "custom" } },
    });
    assert.equal(cover.status, 202);
    assert.equal(cover.body.notes, STYLE_COVER_NOTES);
    assert.equal(cover.body.styleSnapshot.rules, original.rules);
    assert.equal(cover.body.parentId, null);
    assert.deepEqual(cover.body.designOptions, {
      audience: null,
      palette: null,
    });
    assert.equal(
      (await post("/demo/trials", { purpose: "cover" })).status,
      409,
    );
    assert.equal(get("style", "demo").cover, "old.png");
    await finish(cover.body);
    const generated = get("trial", cover.body.id);
    assert.equal(
      (await post(`/demo/trials/${generated.id}/apply`)).status,
      400,
    );
    assert.deepEqual(generated.plan.displayText, [
      STYLE_COVER.title,
      STYLE_COVER.subtitle,
    ]);
    assert.equal(generated.coverApplied, true);
    assert(existsSync(assetPath(generated.image)));
    assert.equal(calls.length, 1); // No text-model stage and exactly one image.
    assert.equal(calls[0].n, 1);
    assert.equal(calls[0].size, "2560x1440");
    assert.match(calls[0].prompt, /横向 16:9/);
    assert.equal(calls[0].prompt, directImagePrompt(generated.plan));
    assert(calls[0].prompt.startsWith(original.rules + "\n\n"));
    assert(!calls[0].prompt.includes("不能混入"));
    assert.equal(get("style", "demo").cover, generated.image);
    assert.equal(get("style", "demo").compositionMode, "content-led");
    assert.equal(get("style", "demo").rules, original.rules);
    assert.deepEqual(get("style", "demo").refs, []);
    assert.equal(all("project").length, 0);
    assert.equal(all("styleVersion").length, 0);
    assert.equal(
      (await post(`/demo/trials/${generated.id}/cover`)).status,
      200,
    );
    put("style", { ...original, id: "other" });
    assert.equal(
      (await post(`/other/trials/${generated.id}/cover`)).status,
      400,
    );
    const oldPortrait = {
      ...generated,
      id: "old-portrait",
      image: "old-portrait.png",
    };
    put("trial", oldPortrait);
    writeFileSync(
      assetPath(oldPortrait.image),
      Buffer.from(malformed.portrait, "base64"),
    );
    assert.equal((await post("/demo/trials/old-portrait/cover")).status, 400);
    assert.equal(get("style", "demo").cover, generated.image);
    for (const mode of [
      "portrait",
      "square",
      "landscape",
      "failure",
      "cancelled",
      "changed",
      "deleted",
    ]) {
      put("style", { ...original, cover: generated.image });
      const next = (await post("/demo/trials", { purpose: "cover" })).body;
      responseMode = mode;
      if (malformed[mode]) {
        const beforeCalls = calls.length;
        await assert.rejects(finish(next), /不符合横向 16:9/);
        assert.equal(
          calls.length,
          beforeCalls + 1,
          "invalid outputs must not trigger paid automatic retries",
        );
        const failed = get("trial", next.id);
        assert.equal(failed.image, null);
        assert.equal(failed.status, "failed");
        assert(failed.plan.imageResponse.width);
        assert.equal(failed.plan.imageResponse.reportedSize, "2560x1440");
      } else if (["failure", "cancelled"].includes(mode))
        await assert.rejects(finish(next));
      else await finish(next);
      assert.equal(get("style", "demo").cover, generated.image, mode);
      assert.notEqual(get("trial", next.id).coverApplied, true, mode);
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
