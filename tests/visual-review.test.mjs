import test from "node:test";
import assert from "node:assert/strict";
import { visualReviewReason } from "../shared/visual-review.mjs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fork } from "node:child_process";
import { once } from "node:events";
import { DatabaseSync } from "node:sqlite";
const slide = {
  id: "page",
  image: "fixture.png",
  notes: "正文更新。",
  stale: true,
  versions: [{ notes: "旧正文。", image: "fixture.png", stale: false }],
  status: "ready",
  batchIds: [],
  plan: null,
};
test("visual review reports formatting, content and missing history without claiming image correctness", () => {
  assert.equal(visualReviewReason(slide).kind, "content");
  assert.equal(
    visualReviewReason({ ...slide, notes: " **旧正文。**\n" }).kind,
    "formatting",
  );
  assert.equal(visualReviewReason({ ...slide, versions: [] }).kind, "unknown");
  assert.equal(
    visualReviewReason({
      ...slide,
      versions: [{ ...slide.versions[0], image: "other.png" }],
    }).before,
    null,
  );
  assert.equal(
    visualReviewReason({
      ...slide,
      versions: [
        ...slide.versions,
        { notes: "intermediate", image: slide.image, stale: true },
      ],
    }).before,
    "旧正文。",
  );
});
test(
  "keep visual is revision checked, preserves notes and artwork, persists, and later edits need review again",
  { timeout: 15000 },
  async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "autoppt-review-test-"));
    const child = fork("server/index.mjs", [], {
      silent: true,
      env: {
        ...process.env,
        NODE_ENV: "production",
        AUTOPPT_DATA_DIR: dir,
        PORT: "0",
      },
    });
    let db;
    try {
      const [ready] = await once(child, "message");
      const base = `http://127.0.0.1:${ready.port}`;
      db = new DatabaseSync(path.join(dir, "autoppt.sqlite"));
      const project = {
        id: "review-project",
        title: "核对测试",
        revision: 1,
        slides: [slide],
        batches: [],
        styleId: "restrained-minimal",
        createdAt: new Date().toISOString(),
      };
      const put = (kind, value) =>
        db
          .prepare("INSERT OR REPLACE INTO records VALUES(?,?,?)")
          .run(kind, value.id, JSON.stringify(value));
      put("project", project);
      const call = (url, data, method = "POST") =>
        fetch(base + url, {
          method,
          headers: { "content-type": "application/json" },
          body: JSON.stringify(data),
        });
      const route = "/api/projects/review-project/slides/page/keep-visual";
      assert.equal((await call(route, { revision: 0 })).status, 409);
      let res = await call(route, { revision: 1 });
      assert.equal(res.status, 200);
      let p = await res.json();
      assert.equal(p.slides[0].stale, false);
      assert.equal(p.slides[0].notes, slide.notes);
      assert.equal(p.slides[0].image, slide.image);
      assert.equal(p.slides[0].versions.length, 2);
      const saved = JSON.parse(
        db
          .prepare("SELECT data FROM records WHERE kind='project' AND id=?")
          .get(p.id).data,
      );
      assert.equal(saved.slides[0].stale, false);
      res = await call(
        "/api/projects/review-project/slides/page",
        { notes: "又修改了正文。" },
        "PATCH",
      );
      p = await res.json();
      assert.equal(p.slides[0].stale, true);
      put("job", {
        id: "busy",
        projectId: p.id,
        status: "running",
        slideIds: ["page"],
        type: "render",
      });
      res = await call(route, { revision: p.revision });
      assert(!res.ok);
      assert.equal(
        JSON.parse(
          db
            .prepare("SELECT data FROM records WHERE kind='project' AND id=?")
            .get(p.id).data,
        ).slides[0].stale,
        true,
      );
    } finally {
      db?.close();
      child.kill();
      await once(child, "exit");
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
