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

test("centralized avatars and text preview generate without narration, deduplicate concurrent submissions, and preserve project content", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "autoppt-studio-"));
  process.env.AUTOPPT_DATA_DIR = dir;
  const store = await import("../server/store.mjs"),
    settings = await import("../server/presenter/settings.mjs"),
    library = await import("../server/presenter/library.mjs"),
    gen = await import("../server/presenter/generation.mjs"),
    setup = await import("../server/presenter/project-setup.mjs");
  t.after(() => {
    store.db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  settings.savePresenterSettings({ apiKey: "synthetic-key" });
  store.put("presenter-voices", {
    id: createHash("sha256").update("synthetic-key").digest("hex"),
    createdAt: store.now(),
    voices: [
      {
        id: "voice",
        name: "测试中文男声",
        language: "Chinese",
        gender: "male",
      },
    ],
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
  assert.equal(avatar.voiceName, "测试中文男声");
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
  let creates = 0;
  const factory = () => ({
    upload: async (_bytes, name) => {
      uploads.push(name);
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
    download: async () => ({
      status: 200,
      body: bytes,
      headers: { "content-type": "binary/octet-stream" },
    }),
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
  assert.deepEqual(uploads, ["presenter.png"]);
  assert.equal(payloads[0].script, input.text);
  assert.equal(payloads[0].voice_id, "voice");
  assert.equal(payloads[0].audio_asset_id, undefined);
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
