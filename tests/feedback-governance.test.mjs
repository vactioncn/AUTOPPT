// Integration seams between feedback governance, JPEG portability and presenters.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { once } from "node:events";
import express from "express";
import sharp from "sharp";
import JSZip from "jszip";
import { contentSignature, rehearsalState } from "../shared/rehearsal.mjs";
import { silenceMp3 } from "./helpers/speech-audio.mjs";
import { htmlPayload } from "./helpers/html-payload.mjs";
const dir = await mkdtemp(path.join(tmpdir(), "autoppt-integration-"));
process.env.AUTOPPT_DATA_DIR = dir;
const store = await import("../server/store.mjs");
const presenter = await import("../server/presenter/index.mjs");
const { mockProvider } = await import("../server/presenter/mock.mjs");
const { exportProjectPackage, importProjectPackage } =
  await import("../server/project-package.mjs");
const { registerHtmlExport, renderStaticHtml } =
  await import("../server/html-export.mjs");
const { renderMotionHtml } = await import("../server/motion/render.mjs");
const { registerMotion } = await import("../server/motion/index.mjs");
const { narrationForExport } = await import("../server/speech/export.mjs");
const hash = (b) => createHash("sha256").update(b).digest("hex");
after(async () => {
  store.db.close();
  await rm(dir, { recursive: true, force: true });
});
async function seed() {
  const image = randomUUID() + ".png";
  const bytes = await sharp({
    create: { width: 1600, height: 900, channels: 3, background: "#387568" },
  })
    .png()
    .toBuffer();
  await writeFile(store.assetPath(image), bytes);
  await mkdir(path.join(dir, "speech-audio"), { recursive: true });
  const audio = randomUUID() + ".mp3";
  await writeFile(path.join(dir, "speech-audio", audio), silenceMp3);
  const p = {
    id: randomUUID(),
    title: "候选 · JPEG 数字人整合",
    revision: 1,
    styleId: "integration-style",
    batches: [],
    slides: [0, 1, 2].map((i) => ({
      id: randomUUID(),
      image,
      notes: "整合讲稿 " + i,
      status: "ready",
      versions: [],
      batchIds: [],
      manuscriptVersion: 1,
    })),
  };
  p.rehearsal = {
    signature: contentSignature(p),
    completedAt: new Date().toISOString(),
  };
  store.put("style", {
    id: p.styleId,
    name: "隔离风格",
    rules: "保持可读",
    refs: [],
  });
  store.put("project", p);
  const n = {
    id: randomUUID(),
    projectId: p.id,
    title: p.title,
    status: "ready",
    sourceRevision: 1,
    voiceName: "本地测试声音",
    options: { voiceId: "test" },
    createdAt: new Date().toISOString(),
    pages: p.slides.map((s, i) => ({
      ...s,
      number: i + 1,
      clips: i === 2 ? [] : [{ file: audio, text: s.notes, duration: 2 }],
      silentDuration: 0.2,
    })),
  };
  store.put("narration", n);
  const motion = {
    id: randomUUID(),
    projectId: p.id,
    title: p.title,
    status: "ready",
    sourceRevision: 1,
    createdAt: new Date().toISOString(),
    pages: p.slides.map((s, i) => ({
      id: s.id,
      number: i + 1,
      title: s.notes,
      status: "ready",
      reviewed: true,
      width: 1600,
      height: 900,
      background: image,
      layers: [],
      source: { image: s.image, notes: s.notes },
    })),
  };
  store.put("motion", motion);
  const avatar = await presenter.createAvatar({
    name: "本地头像",
    bytes: await readFile(
      new URL("./fixtures/presenter/avatar.png", import.meta.url),
    ),
    mime: "image/png",
  });
  const input = {
    avatarId: avatar.id,
    narrationId: n.id,
    placement: "bottom-right",
    size: "small",
    requestId: randomUUID(),
    confirmed: true,
  };
  const v = await presenter.createPresenter(p.id, input, mockProvider);
  await presenter.runPresenter(v.id, mockProvider);
  return {
    p,
    n,
    motion,
    avatar,
    input,
    v: store.get("presenter", v.id),
    bytes,
  };
}

test("JPEG project package retains current rehearsal, avatar identity, video, narration and both HTML formats over two migrations", async () => {
  let { p, n, v, avatar, bytes } = await seed();
  const avatarHash = hash(await readFile(store.assetPath(avatar.sourceAsset)));
  const videoHash = v.pages[0].videoFingerprint;
  const original = JSON.stringify(store.get("project", p.id));
  for (let pass = 0; pass < 2; pass++) {
    const zip = await exportProjectPackage(p);
    const buffer = await zip.generateAsync({ type: "nodebuffer" });
    const archive = await JSZip.loadAsync(buffer);
    const manifest = JSON.parse(
      await archive.file("manifest.json").async("string"),
    );
    const packedProject = manifest.records.find(
      (r) => r.kind === "project",
    ).value;
    const packedAvatar = manifest.records.find(
      (r) => r.kind === "avatar",
    ).value;
    assert.match(packedProject.slides[0].image, /\.jpg$/);
    assert.equal(
      (
        await sharp(
          await archive
            .file("assets/" + packedProject.slides[0].image)
            .async("nodebuffer"),
        ).metadata()
      ).format,
      "jpeg",
    );
    assert.match(packedAvatar.sourceAsset, /\.png$/);
    assert.equal(
      hash(
        await archive
          .file("assets/" + packedAvatar.sourceAsset)
          .async("nodebuffer"),
      ),
      avatarHash,
    );
    assert.equal(rehearsalState(packedProject).status, "complete");
    const imported = await importProjectPackage(buffer);
    p = imported.project;
    n = store.all("narration").find((x) => x.projectId === p.id);
    v = store.all("presenter").find((x) => x.projectId === p.id);
    assert.equal(rehearsalState(p).status, "complete");
    assert.equal((await presenter.inspectPresenter(v)).current, true);
    assert.equal(v.pages[0].videoFingerprint, videoHash);
    assert.equal(v.imported, true);
    assert.equal(v.requestFingerprint, "imported");
    assert.equal(
      hash(await presenter.readPresenterVideo(v.pages[0])),
      videoHash,
    );
    const selected = await presenter.presenterForExport(v.id, p.id, n.id);
    const motion = store.all("motion").find((x) => x.projectId === p.id);
    for (const html of [
      await renderStaticHtml(p, {
        narration: narrationForExport(n.id, p.id),
        presenter: selected,
      }),
      await renderMotionHtml(motion, {
        narration: narrationForExport(n.id, p.id),
        presenter: selected,
      }),
    ]) {
      const data = htmlPayload(html);
      assert.equal(data.pages.length, 3);
      assert.match(data.pages[0].background, /^data:image\/jpeg;/);
      assert(data.pages[0].presenter);
      assert.equal(data.pages[2].presenter, null);
      assert.match(html, /connect-src 'none'/);
      assert.match(html, /data:video\/mp4;base64/);
      assert.match(html, /data:audio\/mpeg;base64/);
    }
  }
  assert.equal(
    JSON.stringify(store.get("project", JSON.parse(original).id)),
    original,
  );
  assert.deepEqual(
    await readFile(store.assetPath(JSON.parse(original).slides[0].image)),
    bytes,
  );
});

test("migration never upgrades stale rehearsal or presenter evidence to current", async () => {
  const { p, v } = await seed();
  p.slides[0].notes += " 已修改";
  p.revision++;
  store.put("project", p);
  const zip = await exportProjectPackage(p);
  const imported = (
    await importProjectPackage(await zip.generateAsync({ type: "nodebuffer" }))
  ).project;
  const version = store
    .all("presenter")
    .find((x) => x.projectId === imported.id);
  assert.equal(rehearsalState(imported).status, "stale");
  assert.equal((await presenter.inspectPresenter(version)).current, false);
  assert.equal(
    version.pages[0].sourceFingerprint,
    v.pages[0].sourceFingerprint,
  );
  await assert.rejects(
    presenter.presenterForExport(version.id, imported.id, version.narrationId),
    /不匹配/,
  );
});

test("static and dynamic HTML enforce explicit matching narration/presenter choice while an unconfigured provider blocks paid generation only", async (t) => {
  const { p, n, v, input, motion } = await seed();
  const app = express();
  app.use(express.json());
  presenter.registerPresenter(app);
  registerHtmlExport(app);
  registerMotion(app);
  app.use((e, req, res, next) =>
    res.status(e.status || 400).json({ error: e.message }),
  );
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const route of [
    `/api/projects/${p.id}/html?revision=1`,
    `/api/motion/${motion.id}/html?`,
  ]) {
    for (const [query, code, hasVoice, hasPresenter] of [
      ["", 200, false, false],
      [`&narration=${n.id}`, 200, true, false],
      [`&narration=${n.id}&presenter=${v.id}`, 200, true, true],
      [`&presenter=${v.id}`, 409, false, false],
      [`&narration=${n.id}&presenter=missing`, 409, false, false],
    ]) {
      const response = await fetch(base + route + query + "&download=1");
      assert.equal(response.status, code);
      if (code !== 200) {
        assert.equal(response.headers.get("content-disposition"), null);
        continue;
      }
      assert.match(
        decodeURIComponent(response.headers.get("content-disposition")),
        /候选.*\.html/,
      );
      const data = htmlPayload(await response.text());
      assert.equal(!!data.narration, hasVoice);
      assert.equal(!!data.presenter, hasPresenter);
    }
  }
  const env = {
    NODE_ENV: process.env.NODE_ENV,
    AUTOPPT_PRESENTER_TEST: process.env.AUTOPPT_PRESENTER_TEST,
  };
  process.env.NODE_ENV = "production";
  process.env.AUTOPPT_PRESENTER_TEST = "1";
  try {
    const state = await (
      await fetch(base + `/api/projects/${p.id}/presenter`)
    ).json();
    assert.equal(state.configured, false);
    assert.equal(state.versions[0].current, true);
    const count = store.all("presenter").length;
    for (const confirmed of [false, true]) {
      const response = await fetch(base + `/api/projects/${p.id}/presenter`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...input, confirmed, requestId: randomUUID() }),
      });
      assert.equal(response.status, 409);
      assert.match(
        (await response.json()).error,
        confirmed ? /稍后接入/ : /请先确认/,
      );
    }
    assert.equal(store.all("presenter").length, count);
  } finally {
    for (const [key, value] of Object.entries(env))
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
  }
});
