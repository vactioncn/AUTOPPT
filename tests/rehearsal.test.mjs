import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  readFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import sharp from "sharp";

test("rehearsal separates resource settings, preserves projects, pins voice, scopes trials and reuses full-page audio/video", async (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "autoppt-rehearsal-"));
  process.env.AUTOPPT_DATA_DIR = dir;
  const store = await import("../server/store.mjs");
  const plans = await import("../server/rehearsal-plan.mjs");
  const runs = await import("../server/rehearsal.mjs");
  const gen = await import("../server/presenter/generation.mjs");
  const speech = await import("../server/speech/settings.mjs");
  const presenter = await import("../server/presenter/settings.mjs");
  const library = await import("../server/presenter/library.mjs");
  const scripts = await import("../server/speech/scripts.mjs");
  const hash = (b) => createHash("sha256").update(b).digest("hex");
  t.after(() => {
    store.db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const project = {
    id: "project",
    title: "保留内容",
    revision: 8,
    draft: "未完成草稿",
    batches: [],
    slides: [
      {
        id: "one",
        notes:
          "第一句用于短试播。" + "正文还有完整的一页内容，必须保留。".repeat(9),
        image: "slide.png",
        scene: null,
      },
      {
        id: "two",
        notes: "第二页使用同一个本人声音。",
        image: "slide.png",
        scene: null,
      },
    ],
  };
  store.put("project", project);
  const original = JSON.stringify(project);
  writeFileSync(
    path.join(dir, "assets", "slide.png"),
    await sharp({
      create: { width: 32, height: 32, channels: 3, background: "green" },
    })
      .png()
      .toBuffer(),
  );
  speech.saveSpeechSettings({ apiKey: "synthetic-minimax" });
  store.put("speaker", {
    id: "personal",
    name: "我的声音",
    provider: speech.providerIdentity(speech.speechSettings()),
  });
  presenter.savePresenterSettings({ apiKey: "synthetic-heygen" });
  const image = readFileSync(path.join(dir, "assets", "slide.png"));
  await library.addAvatar(
    { name: "本人", style: "original", voiceId: "personal" },
    image,
    "image/png",
  );
  const context = plans.rehearsalContext(project.id);
  assert.equal(context.plan.actor, "self", "new projects do not opt into the digital-presenter experiment");
  store.put("project", { ...project, id: "legacy-presenter" });
  store.put("presenter-setup", { id: "legacy-presenter", avatarId: context.plan.avatarId });
  assert.equal(plans.rehearsalPlan("legacy-presenter").actor, "digital", "existing avatar setups keep their digital actor");
  assert.equal(
    context.plan.voiceId,
    "personal",
    "never fall back to stock announcer",
  );
  assert.throws(
    () => plans.saveRehearsalPlan(project.id, { apiKey: "must-not-be-stored" }),
    /密钥/,
  );
  const configBefore = readFileSync(
    path.join(dir, "speech-settings.json"),
    "utf8",
  );
  plans.saveRehearsalPlan(project.id, {
    actor: "digital",
    voiceId: "personal",
    pageId: "one",
  });
  assert.equal(plans.rehearsalContext(project.id).plan.actor, "digital", "saved experimental choices remain usable");
  speech.saveSpeechSettings({
    defaultVoiceId: "Chinese (Mandarin)_News_Anchor",
  });
  assert.equal(
    plans.rehearsalContext(project.id).plan.voiceId,
    "personal",
    "changing global default must not rewrite saved project choice",
  );
  const planBefore = JSON.stringify(store.get("rehearsal-plan", project.id));
  assert.equal(JSON.stringify(store.get("project", project.id)), original);
  assert.ok(!planBefore.includes("synthetic-"));
  assert.ok(configBefore.includes("synthetic-minimax"));
  scripts.saveSpeechScript(project, {
    revision: 8,
    pageTexts: {
      one: project.slides[0].notes + "口播编辑",
      two: project.slides[1].notes,
    },
  });
  mkdirSync(path.join(dir, "speech-audio"), { recursive: true });
  const audioCache = new Map();
  let synthesis = 0,
    videoCalls = 0;
  const audioFactory = async (config, text, options) => {
    assert.equal(options.voiceId, "personal");
    const k = JSON.stringify([text, options]);
    if (!audioCache.has(k)) {
      synthesis++;
      const file = randomUUID() + ".mp3";
      writeFileSync(path.join(dir, "speech-audio", file), "audio:" + text);
      audioCache.set(k, { file, duration: 2 });
    }
    return audioCache.get(k);
  };
  const video = readFileSync(
    new URL("./fixtures/presenter/presenter.mp4", import.meta.url),
  );
  const provider = () => ({
    upload: async (_bytes, name) =>
      name === "presenter.png" ? "photo" : "audio",
    create: async (payload) => {
      assert.equal(payload.audio_asset_id, "audio");
      assert.equal(payload.script, undefined);
      videoCalls++;
      return "video-" + videoCalls;
    },
    status: async () => ({
      status: "completed",
      url: "https://example.com/video",
    }),
    download: async () => ({
      body: video,
      status: 200,
      headers: { "content-type": "video/mp4" },
    }),
  });
  const deps = {
    presenterFactory: (pid, input) =>
      gen.createGeneration(pid, input, provider, { pollMs: 1, audioFactory }),
  };
  const create = async (scope, trialLength = "page") => {
    const r = await runs.createRun(
      project.id,
      {
        confirmed: true,
        requestId: randomUUID(),
        revision: 8,
        scope,
        trialLength,
      },
      deps,
    );
    const saved = await runs.waitForRun(r.id);
    if (saved.presenterId) await gen.waitForGeneration(saved.presenterId);
    return runs.publicRun(store.get("rehearsal-run", r.id));
  };
  const short = await create("trial", "short");
  assert.equal(short.pages.length, 1);
  assert.equal(short.status, "ready");
  assert.ok(short.pages[0].text.length < project.slides[0].notes.length);
  assert.equal(store.get("narration", short.id), null);
  const page = await create("trial");
  assert.ok(page.pages[0].text.endsWith("口播编辑"));
  assert.equal(videoCalls, 2);
  const full = await create("all");
  assert.equal(full.pages.length, 2);
  assert.equal(full.status, "ready");
  assert.equal(
    videoCalls,
    3,
    "whole generation reuses complete page trial, not short trial",
  );
  assert.equal(synthesis, 3);
  const narration = store.get("narration", full.id);
  assert.equal(narration.status, "ready");
  assert.equal(narration.voiceName, "我的声音");
  assert.equal(narration.pages.length, 2);
  const again = await create("all");
  assert.equal(again.status, "ready");
  assert.equal(synthesis, 3);
  assert.equal(videoCalls, 3);
  const idempotent = await runs.createRun(
    project.id,
    {
      confirmed: true,
      requestId: full.id,
      revision: 8,
      scope: "all",
      trialLength: "page",
    },
    deps,
  );
  assert.equal(idempotent.id, full.id);
  assert.equal(videoCalls, 3);
  plans.saveRehearsalPlan(project.id, { narrationId: full.id });
  const reuse = await create("all");
  assert.equal(reuse.voiceName, "我的声音");
  assert.equal(synthesis, 3);
  assert.equal(videoCalls, 3);
  assert.equal(
    JSON.stringify(store.get("project", project.id)),
    original,
    "all generation and oral edits preserve source project",
  );
  assert.equal(store.all("avatar").length, 1);
  plans.saveRehearsalPlan(project.id, { narrationId: "", voiceId: "personal" });
  const failedProvider = () => ({
    ...provider(),
    create: async () => "failed-video",
    status: async () => ({
      status: "failed",
      failureCode: "INSUFFICIENT_CREDIT",
    }),
  });
  scripts.saveSpeechScript(project, {
    revision: 8,
    pageTexts: {
      one: "修改后的短试播，确认失败保留音频。",
      two: project.slides[1].notes,
    },
  });
  const r = await runs.createRun(
    project.id,
    {
      confirmed: true,
      requestId: randomUUID(),
      revision: 8,
      scope: "trial",
      trialLength: "short",
    },
    {
      presenterFactory: (pid, input) =>
        gen.createGeneration(pid, input, failedProvider, {
          pollMs: 1,
          audioFactory,
        }),
    },
  );
  const pending = await runs.waitForRun(r.id);
  await gen.waitForGeneration(pending.presenterId);
  const failed = await runs.publicRun(store.get("rehearsal-run", r.id));
  assert.equal(failed.presenter.recovery, "new-task");
  assert.ok(
    failed.pages[0].clips[0].audioFile,
    "failed lips preserve MiniMax audio",
  );
  await assert.rejects(
    gen.resumeGeneration(project.id, pending.presenterId, true, failedProvider),
    /失败|额度/,
  );
  const changed = {
    ...project,
    slides: [{ ...project.slides[0], image: "other.png" }, project.slides[1]],
  };
  store.put("project", changed);
  assert.equal(
    (await runs.publicRun(store.get("rehearsal-run", full.id))).compatible,
    false,
  );
  assert.equal(
    store.get("narration", full.id).pages[0].image,
    "slide.png",
    "history keeps its original picture",
  );
  assert.notEqual(hash(JSON.stringify(changed)), hash(original));
});
