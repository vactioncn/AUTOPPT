import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import sharp from "sharp";
import express from "express";

test("HeyGen generation uses durable idempotency, preserves content, reuses completed clips, and serves bounded local video", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "autoppt-presenter-generation-"));
  process.env.AUTOPPT_DATA_DIR = dir;
  const store = await import("../server/store.mjs");
  const setup = await import("../server/presenter/project-setup.mjs");
  const settings = await import("../server/presenter/settings.mjs");
  const gen = await import("../server/presenter/generation.mjs");
  const { createHeyGenProvider } =
    await import("../server/presenter/heygen.mjs");
  const { validateVideo } = await import("../server/presenter/media.mjs");
  t.after(() => {
    store.db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const video = readFileSync(
    new URL("./fixtures/presenter/presenter.mp4", import.meta.url),
  );
  assert.equal(
    validateVideo({ bytes: video, status: 200, contentType: "video/mp4" })
      .duration,
    2,
  );
  assert.throws(() =>
    validateVideo({
      bytes: video,
      status: 200,
      contentType: "video/mp4",
      expectedDuration: 9,
    }),
  );
  assert.throws(() =>
    validateVideo({
      bytes: video.subarray(0, 300),
      status: 200,
      contentType: "video/mp4",
    }),
  );
  const project = {
    id: "project",
    title: "私人讲稿不得发送",
    revision: 3,
    slides: [{ id: "page", image: "slide.png", notes: "私人原文" }],
    draft: "未保存稿",
    batches: [],
  };
  store.put("project", project);
  const original = JSON.stringify(project);
  mkdirSync(path.join(dir, "speech-audio"), { recursive: true });
  const audioFile = randomUUID() + ".mp3";
  writeFileSync(path.join(dir, "speech-audio", audioFile), "synthetic-audio");
  store.put("narration", {
    id: "narration",
    projectId: project.id,
    status: "ready",
    createdAt: store.now(),
    pages: [
      {
        ...project.slides[0],
        status: "ready",
        clips: [{ file: audioFile, duration: 2 }],
      },
    ],
  });
  const image = await sharp({
    create: { width: 64, height: 64, channels: 3, background: "#406650" },
  })
    .png()
    .toBuffer();
  const avatar = await setup.createProjectAvatar(
    project.id,
    "测试头像",
    image,
    "image/png",
  );
  await setup.saveProjectPresenterSetup(project.id, {
    avatarId: avatar.id,
    narrationId: "narration",
    placement: "bottom-right",
    size: "small",
  });
  settings.savePresenterSettings({ apiKey: "synthetic-private-key" });
  let creates = 0,
    downloads = 0,
    throwOnce = true;
  const requests = [],
    accepted = new Map();
  const factory = ({ apiKey }) =>
    createHeyGenProvider({
      apiKey,
      fetchApi: async (url, options) => {
        assert.equal(new URL(url).origin, "https://api.heygen.com");
        assert.equal(options.headers["X-Api-Key"], "synthetic-private-key");
        assert.equal(options.redirect, "error");
        requests.push({
          url,
          method: options.method,
          key: options.headers["Idempotency-Key"],
        });
        if (url.endsWith("/assets")) {
          const file = options.body.get("file");
          assert.ok(["presenter.png", "narration.mp3"].includes(file.name));
          assert.ok(options.headers["Idempotency-Key"]);
          return Response.json({
            data: {
              asset_id: file.type === "image/png" ? "image-id" : "audio-id",
            },
          });
        }
        if (options.method === "POST") {
          const job = store.all("presenter-generation").at(-1);
          assert.ok(
            job.pages[0].clips[0].videoRequest,
            "checkpoint must exist before the paid POST",
          );
          const key = options.headers["Idempotency-Key"];
          const payload = JSON.parse(options.body);
          assert.deepEqual(payload.image, {
            type: "asset_id",
            asset_id: "image-id",
          });
          assert.equal(payload.audio_asset_id, "audio-id");
          assert.equal(payload.script, undefined);
          assert.equal(payload.voice_id, undefined);
          assert.ok(!options.body.includes("私人"));
          if (!accepted.has(key)) {
            accepted.set(key, "video-id");
            creates++;
          }
          if (throwOnce) {
            throwOnce = false;
            throw new Error("private provider error must never appear");
          }
          return Response.json({
            data: { video_id: accepted.get(key), status: "waiting" },
          });
        }
        return Response.json({
          data: {
            status: "completed",
            video_url: "https://media.example.invalid/private-signed-url",
          },
        });
      },
      fetchMedia: async (url, options) => {
        downloads++;
        assert.equal(options.headers, undefined);
        assert.equal(options.followRedirects, false);
        return {
          body: video,
          status: 200,
          headers: { "content-type": "video/mp4" },
        };
      },
    });
  const input = {
    requestId: randomUUID(),
    scope: "page",
    pageId: "page",
    confirmed: true,
  };
  await assert.rejects(
    gen.createGeneration(project.id, { ...input, confirmed: false }, factory),
  );
  const job = await gen.createGeneration(project.id, input, factory, {
    pollMs: 0,
  });
  assert.equal(
    (await gen.createGeneration(project.id, input, factory)).id,
    job.id,
  );
  let result = await gen.waitForGeneration(job.id);
  assert.equal(result.status, "interrupted");
  assert.equal(creates, 1);
  assert.ok(result.pages[0].clips[0].videoRequest.key);
  assert.equal(result.pages[0].clips[0].providerVideoId, undefined);
  assert.doesNotMatch(
    JSON.stringify(await gen.publicGeneration(result)),
    /synthetic|private-signed|providerVideoId|audioHash|accountHash|videoRequest/,
  );
  await assert.rejects(
    gen.createGeneration(
      project.id,
      { ...input, requestId: randomUUID() },
      factory,
    ),
    /避免重复计费/,
  );
  await gen.resumeGeneration(project.id, job.id, true, factory, { pollMs: 0 });
  result = await gen.waitForGeneration(job.id);
  assert.equal(result.status, "ready", result.message);
  assert.equal(creates, 1);
  assert.equal(downloads, 1);
  const paidPosts = requests.filter(
    (r) => r.method === "POST" && r.url.endsWith("/videos"),
  );
  assert.equal(paidPosts[0].key, paidPosts[1].key);
  const filename = result.pages[0].clips[0].videoFile;
  assert.equal(
    statSync(path.join(dir, "presenter-video", filename)).mode & 0o777,
    0o600,
  );
  const whole = await gen.createGeneration(
    project.id,
    { requestId: randomUUID(), scope: "all", confirmed: true },
    factory,
  );
  assert.equal((await gen.waitForGeneration(whole.id)).status, "ready");
  assert.equal(creates, 1);
  assert.equal(downloads, 1);
  assert.equal(JSON.stringify(store.get("project", project.id)), original);
  store.put("project", {
    ...project,
    slides: [{ ...project.slides[0], notes: "修改后的稿件" }],
  });
  assert.equal((await gen.publicGeneration(result)).compatible, false);
  await assert.rejects(
    gen.createGeneration(
      project.id,
      { ...input, requestId: randomUUID() },
      factory,
    ),
    /不一致/,
  );
  store.put("project", project);
  const app = express();
  app.use(express.json());
  gen.registerPresenterGeneration(app);
  app.use((e, _req, res, _next) =>
    res.status(e.status || 400).json({ error: e.message }),
  );
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(base + "/api/presenter/video/" + filename, {
    headers: { Range: "bytes=0-99" },
  });
  assert.equal(response.status, 206);
  assert.equal((await response.arrayBuffer()).byteLength, 100);
  assert.equal(
    (
      await fetch(base + "/api/presenter/video/" + filename, {
        headers: { Range: "bytes=999999-" },
      })
    ).status,
    416,
  );
  process.env.AUTOPPT_WORKER_TOKEN = "test-worker";
  assert.equal(
    (
      await fetch(
        base +
          `/api/projects/${project.id}/presenter/generations/${job.id}/resume`,
        { method: "POST" },
      )
    ).status,
    403,
  );
  assert.equal(
    (await fetch(base + "/api/presenter/video/" + filename)).status,
    403,
  );
  delete process.env.AUTOPPT_WORKER_TOKEN;
  // A lost response older than the provider's 24 h dedupe window must never be re-posted.
  const expired = structuredClone(result);
  expired.id = store.id();
  expired.status = "interrupted";
  const c = expired.pages[0].clips[0];
  c.status = "processing";
  delete c.videoFile;
  delete c.providerVideoId;
  c.videoRequest.at = "2020-01-01T00:00:00Z";
  store.put("presenter-generation", expired);
  // Avoid cache reuse for this isolated interrupted-attempt test by changing its fingerprint in both source and job.
  writeFileSync(path.join(dir, "speech-audio", audioFile), "changed-audio");
  const crypto = await import("node:crypto");
  c.audioHash = crypto
    .createHash("sha256")
    .update("changed-audio")
    .digest("hex");
  c.fingerprint = crypto
    .createHash("sha256")
    .update(JSON.stringify([expired.imageHash, c.audioHash, 2]))
    .digest("hex");
  store.put("presenter-generation", expired);
  await gen.resumeGeneration(project.id, expired.id, true, factory);
  assert.match(
    (await gen.waitForGeneration(expired.id)).message,
    /安全重试时限/,
  );
  assert.equal(creates, 1);
  settings.savePresenterSettings({ apiKey: "different-account-key" });
  await assert.rejects(
    gen.resumeGeneration(project.id, expired.id, true, factory),
    /跨账号/,
  );
  expired.status = "running";
  store.put("presenter-generation", expired);
  gen.recoverPresenters();
  assert.equal(
    store.get("presenter-generation", expired.id).status,
    "interrupted",
  );
  settings.savePresenterSettings({ apiKey: "synthetic-private-key" });
  const known = structuredClone(expired);
  known.id = store.id();
  known.status = "interrupted";
  known.pages[0].clips[0].providerVideoId = "already-accepted";
  store.put("presenter-generation", known);
  let releaseStatus;
  let startedStatus;
  const statusStarted = new Promise((resolve) => {
    startedStatus = resolve;
  });
  const blockedStatus = new Promise((resolve) => {
    releaseStatus = resolve;
  });
  const queryingOnly = () => ({
    upload: () => {
      throw new Error("Known videos must never upload again");
    },
    create: () => {
      throw new Error("Known videos must never be created again");
    },
    status: async () => {
      startedStatus();
      await blockedStatus;
      return { status: "processing" };
    },
  });
  await gen.resumeGeneration(project.id, known.id, true, queryingOnly, {
    pollMs: 0,
  });
  await statusStarted;
  assert.equal(gen.activePresenterCount(project.id), 1);
  gen.stopGeneration(project.id, known.id);
  releaseStatus();
  assert.equal((await gen.waitForGeneration(known.id)).status, "stopped");
  assert.equal(gen.activePresenterCount(project.id), 0);
  assert.equal(
    store.get("presenter-generation", known.id).pages[0].clips[0]
      .providerVideoId,
    "already-accepted",
  );
  // A known provider ID is queryable after the dedupe window; only unknown POSTs expire.
  await gen.resumeGeneration(project.id, known.id, true, factory, {
    pollMs: 0,
  });
  assert.equal((await gen.waitForGeneration(known.id)).status, "ready");
  assert.equal(creates, 1);
  assert.equal(downloads, 2);

  // A completed HTTP request can still report a failed video and exhausted wallet.
  const creditJob = structuredClone(known);
  creditJob.id = store.id();
  creditJob.status = "interrupted";
  const creditClip = creditJob.pages[0].clips[0];
  creditClip.status = "processing";
  writeFileSync(path.join(dir, "speech-audio", audioFile), "credit-test-audio");
  creditClip.audioHash = crypto
    .createHash("sha256")
    .update("credit-test-audio")
    .digest("hex");
  creditClip.fingerprint = crypto
    .createHash("sha256")
    .update(JSON.stringify([creditJob.imageHash, creditClip.audioHash, 2]))
    .digest("hex");
  delete creditClip.videoFile;
  delete creditClip.videoHash;
  store.put("presenter-generation", creditJob);
  let creditQueries = 0;
  const creditProvider = () => ({
    upload: () => assert.fail("No new upload for a known video"),
    create: () => assert.fail("No new paid submission for a known video"),
    download: () => assert.fail("A failed video cannot be downloaded"),
    status: async () => {
      creditQueries++;
      return {
        status: "failed",
        failureCode: "MOVIO_PAYMENT_INSUFFICIENT_CREDIT",
      };
    },
  });
  await gen.resumeGeneration(project.id, creditJob.id, true, creditProvider);
  const creditResult = await gen.waitForGeneration(creditJob.id);
  assert.equal(creditResult.status, "interrupted");
  assert.match(creditResult.message, /HeyGen API 额度不足/);
  assert.equal(
    creditResult.pages[0].clips[0].failureCode,
    "MOVIO_PAYMENT_INSUFFICIENT_CREDIT",
  );
  assert.equal(creditResult.pages[0].clips[0].audioFile, audioFile);
  await assert.rejects(
    gen.resumeGeneration(project.id, creditJob.id, true, creditProvider),
    /额度不足.*新任务计费/,
  );
  assert.equal(creditQueries, 1);
  assert.equal(JSON.stringify(store.get("project", project.id)), original);
});

test("HeyGen v3 top-level credit failure is recognized without exposing private failure messages", async () => {
  const { createHeyGenProvider, heygenFailureMessage } =
    await import("../server/presenter/heygen.mjs");
  for (const fields of [
    {
      failure_code: "MOVIO_PAYMENT_INSUFFICIENT_CREDIT",
      failure_message: "PRIVATE_ACCOUNT_AND_URL",
    },
    {
      error: {
        code: "insufficient_credits",
        message: "PRIVATE_ACCOUNT_AND_URL",
      },
    },
  ]) {
    const provider = createHeyGenProvider({
      apiKey: "synthetic",
      fetchApi: async () =>
        Response.json({ data: { status: "failed", ...fields } }),
    });
    const result = await provider.status("known-video");
    assert.match(
      heygenFailureMessage(result.failureCode),
      /HeyGen API 额度不足/,
    );
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE/);
  }
  const provider = createHeyGenProvider({
    apiKey: "synthetic",
    fetchApi: async () =>
      Response.json({
        data: {
          status: "failed",
          failure_code: "https://private.example/token",
        },
      }),
  });
  assert.equal((await provider.status("known-video")).failureCode, undefined);
  assert.match(heygenFailureMessage(undefined), /检查照片、音频及账号额度/);
  assert.match(heygenFailureMessage("constructor"), /检查照片、音频及账号额度/);
});
