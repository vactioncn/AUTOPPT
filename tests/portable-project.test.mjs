import test, { after } from "node:test";
import { htmlPayload as payload } from "./helpers/html-payload.mjs";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import sharp from "sharp";
import JSZip from "jszip";
import express from "express";
import { once } from "node:events";
import { silenceMp3 } from "./helpers/speech-audio.mjs";
import {
  compilePerformancePage,
  performanceMatches,
  speechUnits,
} from "../shared/speech-performance.mjs";

const dir = mkdtempSync(path.join(tmpdir(), "autoppt-portable-"));
process.env.AUTOPPT_DATA_DIR = dir;
const { put, get, all, db, assetPath } = await import("../server/store.mjs");
const { exportProjectPackage, importProjectPackage, registerProjectPackages } =
  await import("../server/project-package.mjs");
const { renderStaticHtml } = await import("../server/html-export.mjs");
const { renderMotionHtml } = await import("../server/motion/render.mjs");
const { speechScript, saveSpeechScript } =
  await import("../server/speech/scripts.mjs");
const { narrationForExport } = await import("../server/speech/export.mjs");
const sha = (b) => createHash("sha256").update(b).digest("hex");
after(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});
const image = await sharp({
  create: { width: 800, height: 450, channels: 3, background: "#faf4e6" },
})
  .png()
  .toBuffer();
writeFileSync(assetPath("fixture.png"), image);
mkdirSync(path.join(dir, "speech-audio"));
const file = "11111111-1111-4111-8111-111111111111.mp3";
writeFileSync(path.join(dir, "speech-audio", file), silenceMp3);
writeFileSync(
  path.join(dir, "settings.json"),
  JSON.stringify({ apiKey: "must-not-export" }),
);
put("style", {
  id: "portable-style",
  name: "迁移风格",
  rules: "保留风格提示词。",
  refs: ["fixture.png"],
  colors: ["#faf4e6"],
  status: "ready",
  builtin: false,
  designSystem: { tokens: { background: "#faf4e6" } },
});
put("styleVersion", {
  id: "style-v1",
  styleId: "portable-style",
  sequence: 1,
  rules: "旧风格提示词",
  createdAt: new Date().toISOString(),
});
const options = {
  voiceId: "Chinese (Mandarin)_Male_Announcer",
  speed: 1,
  emotion: "auto",
};
const slide = {
  id: "page-1",
  notes: "大家好。\n〔停顿〕",
  manuscriptVersion: 1,
  image: "fixture.png",
  scene: null,
  styleId: "portable-style",
  batchIds: ["batch-1"],
  versions: [
    {
      id: "old-1",
      notes: "原来的讲稿。",
      image: "fixture.png",
      styleId: "portable-style",
    },
  ],
  status: "ready",
  attachments: [
    {
      id: "attachment-1",
      filename: "fixture.png",
      name: "附件",
      width: 800,
      height: 450,
    },
  ],
  plan: { title: "测试页", imageRequest: { background: "opaque" } },
};
const p = put("project", {
  id: "portable-project",
  title: "可迁移的演讲",
  revision: 8,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  styleId: "portable-style",
  slides: [
    slide,
    {
      ...slide,
      id: "page-2",
      notes: "标题页：结尾",
      versions: [],
      attachments: [],
    },
  ],
  batches: [
    { id: "batch-1", slideIds: ["page-1", "page-2"], text: "保留原始段落。" },
  ],
  draft: "未提交草稿",
  proposal: null,
  undo: { sourceSlides: [slide], replacementIds: ["page-1"] },
});
put("attachment", {
  id: "attachment-1",
  projectId: p.id,
  filename: "fixture.png",
  name: "附件",
  width: 800,
  height: 450,
});
const n = put("narration", {
  id: "portable-narration",
  projectId: p.id,
  title: p.title,
  sourceRevision: 8,
  provider: "test-account",
  model: "speech-2.8-hd",
  options,
  voiceName: "播报男声",
  status: "ready",
  createdAt: new Date().toISOString(),
  pages: p.slides.map((s, i) => ({
    ...s,
    number: i + 1,
    emotion: "auto",
    sourceFingerprint: sha(
      JSON.stringify({ image: s.image, scene: s.scene, notes: s.notes }),
    ),
    spokenText: i ? "" : "大家好。",
    speechTextVersion: 1,
    status: "ready",
    silentDuration: 3,
    clips: i ? [] : [{ file, text: "大家好。", duration: 0.25 }],
  })),
});
const motion = put("motion", {
  id: "portable-motion",
  projectId: p.id,
  title: p.title,
  sourceRevision: 8,
  status: "ready",
  pages: p.slides.map((s, i) => ({
    id: s.id,
    number: i + 1,
    status: "ready",
    source: {
      image: s.image,
      notes: s.notes,
      fingerprint: sha(
        JSON.stringify({ image: s.image, scene: s.scene, notes: s.notes }),
      ),
    },
    background: "fixture.png",
    width: 800,
    height: 450,
    layers: [],
  })),
});

test("speech drafts preserve original notes and expire when their source text changes", () => {
  const first = speechScript(p);
  assert.equal(first.pages[0].text, "大家好。");
  assert.equal(first.pages[1].text, "");
  saveSpeechScript(p, {
    revision: 8,
    pageTexts: { "page-1": "各位朋友，大家好。", "page-2": "" },
  });
  assert.equal(speechScript(p).pages[0].text, "各位朋友，大家好。");
  assert.equal(p.slides[0].notes, slide.notes);
  assert.equal(
    speechScript({
      ...p,
      slides: [{ ...slide, notes: "更新正文" }, p.slides[1]],
    }).pages[0].text,
    "更新正文",
  );
  assert.throws(
    () => saveSpeechScript(p, { revision: 7, pageTexts: {} }),
    /更新/,
  );
});
test("static and motion HTML carry offline audio with silent pages and omit private manuscript by default", async () => {
  const html = await renderStaticHtml(p, { narration: n });
  const data = payload(html);
  assert(data.staticMode);
  assert.equal(data.pages.length, 2);
  assert.equal(data.pages[0].notes, "");
  assert.equal(data.pages[0].spokenText, undefined);
  assert.equal(data.pages[1].clips.length, 0);
  assert.equal(Object.keys(data.audio).length, 1);
  assert.equal(
    sha(Buffer.from(data.audio[file].split(",")[1], "base64")),
    sha(silenceMp3),
  );
  assert(html.includes("media-src data: blob:"));
  assert(!html.includes("/api/speech/audio"));
  assert(!html.includes("〔停顿〕"));
  assert(!html.includes("must-not-export"));
  const dynamic = payload(await renderMotionHtml(motion, { narration: n }));
  assert(!dynamic.staticMode);
  assert.equal(dynamic.audio[file], data.audio[file]);
  await assert.rejects(
    renderStaticHtml(
      { ...p, slides: [{ ...slide, notes: "新讲稿" }] },
      { narration: n },
    ),
    /不一致/,
  );
  assert.throws(() => narrationForExport(n.id, "someone-else"), /不属于/);
  const wrong = {
    ...n,
    pages: [
      {
        ...n.pages[0],
        clips: [
          { file: "22222222-2222-4222-8222-222222222222.mp3", text: "x" },
        ],
      },
    ],
  };
  await assert.rejects(
    renderStaticHtml({ ...p, slides: [slide] }, { narration: wrong }),
    /音频文件缺失/,
  );
});
let archive;
test("project packages round-trip editable history, assets, narration and drafts into independent projects", async () => {
  const script = get("speech-script", p.id);
  const performance = {
    id: "performance-1",
    version: 1,
    model: "mock",
    settings: { style: "natural", sounds: false },
    pages: script.pages.map((page) => ({
      ...page,
      units: speechUnits(page.text).map((u) => ({
        ...u,
        emotion: "calm",
        pace: 1,
        pauseAfter: 0.4,
        sound: "",
        emphasis: false,
        reason: "从容讲述",
      })),
    })),
  };
  put("speech-script", {
    ...script,
    performance,
    performanceTask: { id: "performance-1", status: "running" },
  });
  const source = JSON.stringify(get("project", p.id));
  archive = await (
    await exportProjectPackage(p)
  ).generateAsync({ type: "nodebuffer" });
  const zip = await JSZip.loadAsync(archive),
    manifest = JSON.parse(await zip.file("manifest.json").async("string"));
  assert(!JSON.stringify(manifest).includes("must-not-export"));
  assert(!zip.file("settings.json"));
  const { project: copy } = await importProjectPackage(archive);
  assert.notEqual(copy.id, p.id);
  assert.notEqual(copy.styleId, p.styleId);
  assert.notEqual(copy.slides[0].id, slide.id);
  assert.equal(copy.slides[0].notes, slide.notes);
  assert.equal(copy.slides[0].versions[0].notes, "原来的讲稿。");
  assert.equal(copy.slides[0].attachments[0].filename, copy.slides[0].image);
  assert.deepEqual(
    copy.batches[0].slideIds,
    copy.slides.map((s) => s.id),
  );
  assert.equal(copy.undo.sourceSlides[0].id, copy.slides[0].id);
  assert.equal(copy.draft, p.draft);
  assert.deepEqual(readFileSync(assetPath(copy.slides[0].image)), image);
  const imported = all("narration").find((d) => d.projectId === copy.id);
  assert(imported);
  assert.deepEqual(
    readFileSync(
      path.join(dir, "speech-audio", imported.pages[0].clips[0].file),
    ),
    silenceMp3,
  );
  assert.equal(speechScript(copy).pages[0].text, "各位朋友，大家好。");
  const importedScript = speechScript(copy);
  assert(performanceMatches(importedScript.performance, importedScript.pages));
  assert.equal(importedScript.performanceTask.status, "interrupted");
  assert.equal(
    compilePerformancePage(
      importedScript.performance.pages[0],
      "speech-2.8-hd",
      { speed: 1 },
    )[0].pauseAfter,
    0.4,
  );
  await renderStaticHtml(copy, { narration: imported });
  const importedMotion = all("motion").find((d) => d.projectId === copy.id);
  assert.equal(
    importedMotion.pages[0].source.fingerprint,
    sha(
      JSON.stringify({
        image: copy.slides[0].image,
        scene: copy.slides[0].scene,
        notes: copy.slides[0].notes,
      }),
    ),
  );
  assert.equal(
    imported.pages[0].sourceFingerprint,
    importedMotion.pages[0].source.fingerprint,
  );
  await renderMotionHtml(importedMotion, { narration: imported });
  const second = (await importProjectPackage(archive)).project;
  assert.notEqual(second.id, copy.id);
  assert.equal(JSON.stringify(get("project", p.id)), source);
  assert.equal(
    JSON.parse(readFileSync(path.join(dir, "settings.json"))).apiKey,
    "must-not-export",
  );
  const again = await (
    await exportProjectPackage(copy)
  ).generateAsync({ type: "nodebuffer" });
  assert((await importProjectPackage(again)).project.slides.length === 2);
});
test("corrupt, missing, foreign and unsupported package content is rejected without partial records or files", async () => {
  const before = all("project").length,
    files = readdirSync(path.join(dir, "assets")).length;
  for (const mutate of [
    async (z, m) => {
      m.version = 99;
    },
    async (z, m) => {
      m.files[0].sha256 = "0".repeat(64);
    },
    async (z, m) => {
      z.remove(m.files[0].path);
    },
    async (z, m) => {
      m.records.find((r) => r.kind === "narration").value.projectId = "foreign";
    },
    async (z, m) => {
      m.records.push({ kind: "job", value: { id: "bad", status: "queued" } });
    },
    async (z, m) => {
      z.file("../escape.txt", "unsafe");
    },
    async (z, m) => {
      m.records[0].value.apiKey = "secret";
    },
  ]) {
    const z = await JSZip.loadAsync(archive),
      m = JSON.parse(await z.file("manifest.json").async("string"));
    await mutate(z, m);
    z.file("manifest.json", JSON.stringify(m));
    await assert.rejects(
      importProjectPackage(await z.generateAsync({ type: "nodebuffer" })),
    );
    assert.equal(all("project").length, before);
    assert.equal(readdirSync(path.join(dir, "assets")).length, files);
  }
});

test("package HTTP routes stream downloads and accept multipart imports without overwriting existing projects", async () => {
  const app = express();
  registerProjectPackages(app, { assertIdle: () => {} });
  app.use((error, req, res, next) =>
    res.status(error.status || 400).json({ error: error.message }),
  );
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    const response = await fetch(
      `${url}/api/projects/${p.id}/package?revision=${p.revision}`,
    );
    assert.equal(response.status, 200);
    assert(
      response.headers.get("content-disposition").includes(".autoppt.zip"),
    );
    const bytes = await response.arrayBuffer();
    const form = new FormData();
    form.append("project", new Blob([bytes]), "project.autoppt.zip");
    const uploaded = await fetch(url + "/api/projects/import", {
      method: "POST",
      body: form,
    });
    const result = await uploaded.json();
    assert.equal(uploaded.status, 201, result.error);
    assert.notEqual(result.project.id, p.id);
    assert.equal(result.project.slides.length, 2);
    const malformed = new FormData();
    malformed.append("project", new Blob(["broken"]), "broken.zip");
    assert.equal(
      (
        await fetch(url + "/api/projects/import", {
          method: "POST",
          body: malformed,
        })
      ).status,
      400,
    );
    assert.equal(
      (await fetch(`${url}/api/projects/${p.id}/package?revision=0`)).status,
      409,
    );
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
