import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { createServer } from "node:http";
import { once } from "node:events";
import { silenceMp3 } from "./helpers/speech-audio.mjs";

test("MiniMax voice audio drives previews and projects without manual narration; upload bytes, cache, retry, and content are preserved", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "autoppt-studio-"));
  process.env.AUTOPPT_DATA_DIR = dir;
  const store = await import("../server/store.mjs"),
    settings = await import("../server/presenter/settings.mjs"),
    library = await import("../server/presenter/library.mjs"),
    gen = await import("../server/presenter/generation.mjs"),
    setup = await import("../server/presenter/project-setup.mjs"),
    speechSettings = await import("../server/speech/settings.mjs");
  t.after(() => {
    store.db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  settings.savePresenterSettings({ apiKey: "synthetic-key" });
  let speechCalls = 0;
  const speechBodies = [];
  const speechService = createServer(async (req, res) => {
    assert.equal(req.url, "/v1/t2a_v2");
    assert.equal(req.headers.authorization, "Bearer synthetic-voice-key");
    let raw = "";
    for await (const bytes of req) raw += bytes;
    const body = JSON.parse(raw);
    speechBodies.push(body);
    speechCalls++;
    assert.equal(body.voice_setting.voice_id, "voice");
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        base_resp: { status_code: 0 },
        data: { status: 2, audio: silenceMp3.toString("hex") },
        extra_info: { audio_length: 2000 },
      }),
    );
  });
  speechService.listen(0, "127.0.0.1");
  await once(speechService, "listening");
  t.after(() => new Promise((resolve) => speechService.close(resolve)));
  speechSettings.saveSpeechSettings({
    baseUrl: `http://127.0.0.1:${speechService.address().port}/v1`,
    apiKey: "synthetic-voice-key",
  });
  store.put("speaker", {
    id: "voice",
    name: "我的测试声音",
    provider: speechSettings.providerIdentity(speechSettings.speechSettings()),
    createdAt: store.now(),
  });
  const image = await sharp({
    create: { width: 64, height: 64, channels: 3, background: "#ccd5c2" },
  })
    .png()
    .toBuffer();
  const state = await library.addAvatar(
    { name: "职业讲解员", style: "professional", voiceId: "voice" },
    image,
    "image/png",
  );
  const avatar = state.avatars[0];
  assert.equal(avatar.voiceName, "我的测试声音");
  assert.equal(avatar.voiceSource, "minimax");
  const storedAvatar = store.get("avatar", avatar.id);
  store.put("avatar", {
    ...storedAvatar,
    voiceId: "old-heygen-stock-voice",
    voiceName: "旧配音",
  });
  assert.equal(
    library.studioState().avatars[0].voiceId,
    "voice",
    "legacy HeyGen voice must never override MiniMax selection",
  );
  assert.equal(avatar.ready, true);
  assert.equal(state.defaultAvatarId, avatar.id);
  assert.equal(JSON.stringify(state).includes("synthetic-key"), false);
  await assert.rejects(
    () => library.saveAvatar(avatar.id, { voiceId: "unknown" }),
    /刷新声音/,
  );
  const bytes = readFileSync(
    new URL("./fixtures/presenter/presenter.mp4", import.meta.url),
  );
  const payloads = [],
    uploads = [];
  let creates = 0,
    failDownload = false;
  const factory = () => ({
    upload: async (uploaded, name) => {
      uploads.push(name);
      if (name === "narration.mp3") {
        assert.deepEqual(uploaded, silenceMp3);
        return "audio-id";
      }
      return "image-id";
    },
    create: async (payload) => {
      payloads.push(payload);
      creates++;
      return "remote-id";
    },
    status: async () => ({
      status: "completed",
      url: "https://media.example.com/video.mp4",
    }),
    download: async () => {
      if (failDownload) {
        failDownload = false;
        throw new Error("synthetic download interruption");
      }
      return {
        status: 200,
        body: bytes,
        headers: { "content-type": "binary/octet-stream" },
      };
    },
  });
  await assert.rejects(
    () =>
      gen.createPreview(
        { avatarId: avatar.id, text: "你好", requestId: randomUUID() },
        factory,
      ),
    /确认/,
  );
  const input = {
    avatarId: avatar.id,
    text: "你好，数字人试播。",
    confirmed: true,
    requestId: randomUUID(),
  };
  const [one, two] = await Promise.all([
    gen.createPreview(input, factory),
    gen.createPreview(input, factory),
  ]);
  assert.equal(one.id, two.id);
  const preview = await gen.waitForGeneration(one.id);
  assert.equal(preview.status, "ready");
  assert.equal(creates, 1);
  assert.deepEqual(uploads, ["presenter.png", "narration.mp3"]);
  assert.equal(speechCalls, 1);
  assert.equal(speechBodies[0].text, input.text);
  assert.equal(payloads[0].script, undefined);
  assert.equal(payloads[0].voice_id, undefined);
  assert.equal(payloads[0].audio_asset_id, "audio-id");
  assert.equal(preview.mode, "minimax");
  assert.equal(preview.voiceName, "我的测试声音");
  mkdirSync(path.join(dir, "assets"), { recursive: true });
  writeFileSync(path.join(dir, "assets", "slide.png"), image);
  const project = {
    id: "project",
    revision: 7,
    title: "测试演讲",
    slides: [
      {
        id: "page",
        image: "slide.png",
        notes: input.text,
        plan: { title: "开场" },
      },
    ],
    draft: "未保存草稿",
    batches: [],
  };
  store.put("project", project);
  const original = JSON.stringify(project);
  await setup.saveProjectPresenterSetup(project.id, {
    avatarId: avatar.id,
    narrationId: "",
    placement: "bottom-right",
    size: "small",
    sourceMode: "text",
  });
  const job = await gen.createGeneration(
    project.id,
    { scope: "all", mode: "text", confirmed: true, requestId: randomUUID() },
    factory,
  );
  const done = await gen.waitForGeneration(job.id);
  assert.equal(done.status, "ready");
  assert.equal(done.narrationId, "");
  assert.equal(
    creates,
    1,
    "same text/voice/photo reuses the preview, without another paid request",
  );
  assert.equal(done.pages[0].clips[0].duration, 2);
  assert.equal(
    speechCalls,
    1,
    "existing MiniMax audio cache must avoid another TTS call",
  );
  assert.equal((await gen.publicGeneration(done)).compatible, true);
  assert.equal(JSON.stringify(store.get("project", project.id)), original);
  store.put("project", {
    ...project,
    slides: [{ ...project.slides[0], notes: "修改后的讲稿" }],
  });
  assert.equal((await gen.publicGeneration(done)).compatible, false);
  assert.equal(store.all("narration").length, 0);
  assert.equal(store.all("avatar").length, 1);
  const originalAvatar = structuredClone(store.get("avatar", avatar.id));
  let styleCalls = 0;
  const imageService = createServer(async (req, res) => {
    assert.equal(req.url, "/v1/images/edits");
    let body = "";
    for await (const bytes of req) body += bytes.toString("latin1");
    assert.ok(body.includes("image[]"));
    assert.ok(body.includes("portrait.png"));
    styleCalls++;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ data: [{ b64_json: image.toString("base64") }] }));
  });
  imageService.listen(0, "127.0.0.1");
  await once(imageService, "listening");
  t.after(() => new Promise((resolve) => imageService.close(resolve)));
  store.updateSettings({
    image: {
      baseUrl: `http://127.0.0.1:${imageService.address().port}/v1`,
      apiKey: "synthetic-image-key",
      model: "fixture-image",
    },
  });
  for (const style of ["professional", "cartoon", "costume"]) {
    const changed = await library.generateAvatarStyle(avatar.id, {
      style,
      confirmed: true,
    });
    const variant = changed.avatars.at(-1);
    assert.equal(variant.style, style);
    assert.equal(variant.voiceId, "voice");
    assert.notEqual(variant.id, avatar.id);
  }
  assert.equal(styleCalls, 3);
  assert.deepEqual(store.get("avatar", avatar.id), originalAvatar);
  assert.equal(library.activeAvatarCount(), 0);
  // Corrupt cached metadata: it must not hide a new voice/audio operation.
  for (const j of store.all("presenter-generation")) {
    for (const p of j.pages)
      for (const c of p.clips) c.videoHash = "damaged-cache";
    store.put("presenter-generation", j);
  }
  failDownload = true;
  const interrupted = await gen.createPreview(
    { ...input, text: "你好，恢复测试。", requestId: randomUUID() },
    factory,
  );
  const failed = await gen.waitForGeneration(interrupted.id);
  assert.equal(failed.status, "interrupted");
  assert.ok(
    failed.pages[0].clips[0].audioFile,
    "MiniMax audio must be saved before submitting the video",
  );
  assert.equal(speechCalls, 2);
  assert.equal(creates, 2);
  await gen.resumeGeneration(null, failed.id, true, factory);
  const recovered = await gen.waitForGeneration(failed.id);
  assert.equal(recovered.status, "ready");
  assert.equal(
    speechCalls,
    2,
    "download retry must not synthesize another MiniMax clip",
  );
  assert.equal(creates, 2, "download retry must not submit another paid video");
  speechSettings.saveSpeechSettings({ apiKey: "another-speech-account" });
  assert.equal(
    library.studioState().avatars[0].ready,
    false,
    "changing MiniMax accounts must require a new valid voice selection",
  );
  await assert.rejects(
    () => gen.createPreview({ ...input, requestId: randomUUID() }, factory),
    /MiniMax 声音/,
  );
});

test("MP4 download accepts binary MIME and bounded AAC priming while rejecting truncated or inconsistent media", async () => {
  const { validateVideo } = await import("../server/presenter/media.mjs");
  const original = readFileSync(
    new URL("./fixtures/presenter/presenter.mp4", import.meta.url),
  );
  assert.equal(
    validateVideo({
      bytes: original,
      status: 200,
      contentType: "binary/octet-stream",
    }).mime,
    "video/mp4",
  );
  assert.throws(() =>
    validateVideo({
      bytes: original.subarray(0, 300),
      status: 200,
      contentType: "binary/octet-stream",
    }),
  );
  const b = Buffer.from(original);
  function boxes(s, e) {
    let list = [];
    while (s < e) {
      const n = b.readUInt32BE(s);
      list.push({
        type: b.toString("ascii", s + 4, s + 8),
        begin: s + 8,
        end: s + n,
      });
      s += n;
    }
    return list;
  }
  const moov = boxes(0, b.length).find((x) => x.type === "moov");
  const audio = boxes(moov.begin, moov.end)
    .filter((x) => x.type === "trak")
    .map((tr) => {
      const md = boxes(tr.begin, tr.end).find((x) => x.type === "mdia"),
        children = boxes(md.begin, md.end),
        h = children.find((x) => x.type === "hdlr");
      return b.toString("ascii", h.begin + 8, h.begin + 12) === "soun"
        ? children.find((x) => x.type === "mdhd")
        : null;
    })
    .find(Boolean);
  const ticks = b.readUInt32BE(audio.begin + 16);
  b.writeUInt32BE(ticks - 1024, audio.begin + 16);
  assert.equal(
    validateVideo({
      bytes: b,
      status: 200,
      contentType: "application/octet-stream",
    }).duration,
    2,
  );
  b.writeUInt32BE(ticks - 10000, audio.begin + 16);
  assert.throws(() =>
    validateVideo({
      bytes: b,
      status: 200,
      contentType: "binary/octet-stream",
    }),
  );
});
