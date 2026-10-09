import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  statSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import sharp from "sharp";
import express from "express";

test("project presenter configuration stays local, keeps projects unchanged, and rejects stale or foreign audio", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "autoppt-presenter-setup-"));
  process.env.AUTOPPT_DATA_DIR = dir;
  const store = await import("../server/store.mjs");
  const setup = await import("../server/presenter/project-setup.mjs");
  const settings = await import("../server/presenter/settings.mjs");
  t.after(() => {
    store.db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const project = {
    id: "test-project",
    title: "隔离测试",
    revision: 3,
    slides: [{ id: "page", image: "slide.png", notes: "完整讲稿" }],
    draft: "未提交原文",
    batches: [],
  };
  store.put("project", project);
  store.put("project", { ...project, id: "second-project", slides: [] });
  const original = JSON.stringify(store.get("project", project.id));
  const empty = await setup.projectPresenterSetup(project.id);
  assert.equal(empty.generationAvailable, false);
  assert.equal(empty.setup.placement, "bottom-right");
  assert.equal(empty.savedAt, null);
  settings.savePresenterSettings({
    apiKey: "synthetic-key-not-for-transmission",
  });

  const image = await sharp({
    create: { width: 64, height: 64, channels: 3, background: "#406650" },
  })
    .jpeg()
    .withMetadata({ exif: { IFD0: { Artist: "private-metadata" } } })
    .toBuffer();
  const avatar = await setup.createProjectAvatar(
    project.id,
    "测试头像",
    image,
    "image/jpeg",
  );
  const local = path.join(dir, "assets", avatar.previewAsset);
  assert.equal(statSync(local).mode & 0o777, 0o600);
  const meta = await sharp(readFileSync(local)).metadata();
  assert.equal(meta.format, "png");
  assert.equal(meta.exif, undefined);
  assert.equal(store.get("avatar", avatar.id).sourceAsset, avatar.previewAsset);
  for (const [bytes, mime] of [
    [Buffer.from("invalid"), "image/png"],
    [image, "image/png"],
    [image, "text/plain"],
  ])
    await assert.rejects(
      setup.createProjectAvatar(project.id, "bad", bytes, mime),
    );
  await assert.rejects(
    setup.createProjectAvatar(project.id, " ", image, "image/jpeg"),
  );

  mkdirSync(path.join(dir, "speech-audio"));
  const audio = "11111111-1111-4111-8111-111111111111.mp3";
  writeFileSync(path.join(dir, "speech-audio", audio), "local-test-audio");
  const narration = {
    id: "ready-narration",
    projectId: project.id,
    title: project.title,
    voiceName: "已有声音",
    status: "ready",
    sourceRevision: 3,
    createdAt: store.now(),
    pages: [
      {
        ...project.slides[0],
        status: "ready",
        clips: [{ file: audio, duration: 1 }],
      },
    ],
  };
  store.put("narration", narration);
  store.put("narration", {
    ...narration,
    id: "old-narration",
    pages: [{ ...narration.pages[0], notes: "旧讲稿" }],
  });
  store.put("narration", {
    ...narration,
    id: "foreign-narration",
    projectId: "second-project",
  });
  store.put("narration", {
    ...narration,
    id: "running-narration",
    status: "running",
  });
  const state = await setup.projectPresenterSetup(project.id);
  assert.equal(state.hasKey, true);
  assert.equal(state.generationAvailable, false);
  assert.equal(JSON.stringify(state).includes("synthetic-key"), false);
  assert.equal(state.narrations.length, 2);
  assert.equal(
    state.narrations.find((n) => n.id === "ready-narration").available,
    true,
  );
  assert.equal(
    state.narrations.find((n) => n.id === "old-narration").available,
    false,
  );
  const input = {
    avatarId: avatar.id,
    narrationId: narration.id,
    placement: "top-left",
    size: "large",
    apiKey: "must-not-be-saved",
    generationAvailable: true,
  };
  await setup.saveProjectPresenterSetup(project.id, input);
  const saved = store.get("presenter-setup", project.id);
  assert.equal(saved.placement, "top-left");
  assert.equal(saved.size, "large");
  assert.equal(saved.apiKey, undefined);
  assert.equal(saved.generationAvailable, undefined);
  for (const wrong of [
    { ...input, narrationId: "foreign-narration" },
    { ...input, narrationId: "old-narration" },
    { ...input, placement: "unsafe" },
    { ...input, avatarId: "missing-avatar" },
    [],
    null,
  ])
    await assert.rejects(setup.saveProjectPresenterSetup(project.id, wrong));
  assert.equal(
    JSON.stringify(store.get("presenter-setup", project.id)),
    JSON.stringify(saved),
  );
  assert.equal(JSON.stringify(store.get("project", project.id)), original);
  assert.equal(
    (await setup.projectPresenterSetup("second-project")).setup.avatarId,
    "",
  );
  const missing = "22222222-2222-4222-8222-222222222222.mp3";
  symlinkSync(
    path.join(dir, "speech-audio", audio),
    path.join(dir, "speech-audio", missing),
  );
  store.put("narration", {
    ...narration,
    id: "symlink-audio",
    pages: [{ ...narration.pages[0], clips: [{ file: missing }] }],
  });
  assert.equal(
    (await setup.projectPresenterSetup(project.id)).narrations.find(
      (n) => n.id === "symlink-audio",
    ).available,
    false,
  );
  store.put("project", {
    ...project,
    slides: [{ ...project.slides[0], notes: "讲稿修改之后" }],
  });
  assert.equal(
    (await setup.projectPresenterSetup(project.id)).narrations.find(
      (n) => n.id === narration.id,
    ).available,
    false,
  );
  assert.equal(
    store.get("presenter-setup", project.id).narrationId,
    narration.id,
  );

  const app = express();
  app.use(express.json());
  setup.registerProjectPresenterSetup(app);
  app.use((err, _req, res, _next) =>
    res.status(err.status || 400).json({ error: err.message }),
  );
  const server = app.listen(0, "127.0.0.1");
  t.after(() => server.close());
  await once(server, "listening");
  const url = `http://127.0.0.1:${server.address().port}/api/projects/${project.id}/presenter`;
  const body = new FormData();
  body.set("name", "接口头像");
  body.set("image", new Blob([image], { type: "image/jpeg" }), "face.jpg");
  const response = await fetch(url + "/avatars", { method: "POST", body });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).name, "接口头像");
  assert.equal((await fetch(url + "/setup")).status, 200);
  process.env.AUTOPPT_WORKER_TOKEN = "synthetic-worker-token";
  try {
    for (const [route, method] of [
      ["setup", "GET"],
      ["setup", "PUT"],
      ["avatars", "POST"],
    ])
      assert.equal((await fetch(url + "/" + route, { method })).status, 403);
  } finally {
    delete process.env.AUTOPPT_WORKER_TOKEN;
  }
  store.put("project", { ...project, deletedAt: store.now() });
  assert.equal((await fetch(url + "/setup")).status, 404);
});
