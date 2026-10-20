import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { spawn } from "node:child_process";
import { once } from "node:events";
import sharp from "sharp";

test("layered API saves, rejects stale revisions and undoes without touching project/history/assets or calling models", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "jianghao-layered-api-"));
  await mkdir(path.join(dir, "assets"));
  await sharp({
    create: { width: 1600, height: 900, channels: 3, background: "white" },
  })
    .jpeg()
    .toFile(path.join(dir, "assets/bg.jpg"));
  const db = new DatabaseSync(path.join(dir, "autoppt.sqlite"));
  db.exec(
    "CREATE TABLE records(kind TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(kind,id))",
  );
  const layer = {
    id: "body",
    type: "text",
    text: "先讲故事",
    x: 100,
    y: 100,
    w: 500,
    h: 100,
    fontSize: 48,
    font: "serif",
    fontWeight: 400,
    color: "#222222",
    fit: false,
  };
  const project = {
    id: "project",
    title: "原始项目",
    revision: 3,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    draft: "",
    batches: [],
    slides: [],
    styleId: "restrained-minimal",
  };
  const deck = {
    id: "deck",
    projectId: project.id,
    sourceMode: "layered",
    revision: 1,
    status: "ready",
    createdAt: new Date().toISOString(),
    title: "分层演示",
    pages: [
      {
        id: "page",
        status: "ready",
        width: 1600,
        height: 900,
        background: "bg.jpg",
        source: { notes: "原讲稿", image: null },
        layers: [layer],
      },
    ],
  };
  const put = (kind, value) =>
    db
      .prepare("INSERT INTO records VALUES(?,?,?)")
      .run(kind, value.id, JSON.stringify(value));
  put("project", project);
  put("motion", deck);
  const proc = spawn(process.execPath, ["server/index.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: "0",
      NODE_ENV: "production",
      AUTOPPT_WORKER_TOKEN: "",
      AUTOPPT_DESKTOP_TOKEN: "",
      AUTOPPT_DATA_DIR: dir,
      AUTOPPT_PPTX_FONT_DIR: "",
    },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  proc.stdout.resume();
  proc.stderr.resume();
  t.after(() => {
    proc.kill();
    db.close();
  });
  const info = await Promise.race([
    once(proc, "message").then((x) => x[0]),
    once(proc, "exit").then(() => {
      throw Error("server exited");
    }),
  ]);
  const base = `http://127.0.0.1:${info.port}`;
  const initial = db
    .prepare("SELECT data FROM records WHERE kind='project' AND id='project'")
    .get().data;
  async function request(url, method, body, status = 200) {
    const r = await fetch(base + url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = await r.json();
    assert.equal(r.status, status, JSON.stringify(j));
    return j;
  }
  const saved = await request("/api/motion/deck/pages/page", "PATCH", {
    revision: 1,
    layers: [{ ...layer, text: "每讲完一个故事" }],
    playbackMode: "steps",
    reviewed: true,
  });
  assert.equal(saved.pages[0].layers[0].text, "每讲完一个故事");
  assert.equal(saved.pages[0].history.length, 1);
  await request(
    "/api/motion/deck/pages/page",
    "PATCH",
    { revision: 1, layers: [layer] },
    409,
  );
  await request(
    "/api/motion/deck/pages/page",
    "PATCH",
    { revision: saved.revision, layers: [{ ...layer, fit: true }] },
    400,
  );
  await request(
    "/api/motion/deck/pages/page",
    "PATCH",
    { revision: saved.revision, layers: [layer], playbackMode: "bad" },
    400,
  );
  const undone = await request("/api/motion/deck/pages/page/undo", "POST", {
    revision: saved.revision,
  });
  assert.equal(undone.pages[0].layers[0].text, "先讲故事");
  assert.equal(undone.pages[0].source.notes, "原讲稿");
  assert.equal(undone.pages[0].history.length, 0);
  const html = await fetch(base + "/api/motion/deck/html").then((r) =>
    r.text(),
  );
  assert(html.includes('"playbackMode":"natural"'));
  assert(html.includes('"managed":false'));
  assert.equal(
    db
      .prepare("SELECT data FROM records WHERE kind='project' AND id='project'")
      .get().data,
    initial,
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) AS n FROM records WHERE kind='usage'").get().n,
    0,
  );
  const download = await request("/api/motion/deck/pptx", "GET", null, 400);
  assert.match(download.error, /字体包/);
});
