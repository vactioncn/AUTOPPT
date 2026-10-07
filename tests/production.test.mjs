import test from "node:test";
import assert from "node:assert/strict";
import {
  currentProduction,
  productionTargetIds,
} from "../shared/production.mjs";

const project = {
  id: "p",
  slides: Array.from({ length: 90 }, (_, i) => ({ id: `s${i + 1}` })),
  batches: [{ id: "insert77", slideIds: ["s77"] }],
};
const job = (
  id,
  ids,
  status = "completed",
  createdAt = "2026-10-03T01:00:00Z",
) => ({
  id,
  projectId: "p",
  type: "render",
  status,
  createdAt,
  targetSlideIds: ids,
  slideIds: [],
});

test("recent production follows page 84 instead of the last inserted page 77, including after completion", () => {
  for (const status of [
    "queued",
    "running",
    "completed",
    "failed",
    "cancelled",
  ]) {
    const result = currentProduction(project, [job("a", ["s84"], status)]);
    assert.deepEqual(
      result.slides.map((s) => s.id),
      ["s84"],
    );
    assert.equal(project.slides.indexOf(result.slides[0]) + 1, 84);
    assert.equal(result.label, "本次制作");
    assert.deepEqual(result.batchIds, []);
  }
});

test("concurrent jobs use the union in project order; unrelated work does not steal the view", () => {
  const jobs = [
    job("a", ["s84", "s83"], "running"),
    job("b", ["s75", "s84"], "queued"),
    job("done", ["s77"]),
    { ...job("proposal", ["s77"], "running"), type: "proposal" },
    { ...job("foreign", ["s77"], "running"), projectId: "other" },
  ];
  assert.deepEqual(
    currentProduction(project, jobs).slides.map((s) => s.id),
    ["s75", "s83", "s84"],
  );
  assert.deepEqual(
    currentProduction(project, [
      job("old", ["s77"]),
      job("new", ["s84"], "completed", "2026-10-03T02:00:00Z"),
    ]).slides.map((s) => s.id),
    ["s84"],
  );
});

test("retrying an older job remains the latest production after it finishes", () => {
  const retried = { ...job("old", ["s84"]), updatedAt: "2026-10-03T03:00:00Z" };
  const newer = job("new", ["s77"], "completed", "2026-10-03T02:00:00Z");
  assert.deepEqual(
    currentProduction(project, [newer, retried]).slides.map((s) => s.id),
    ["s84"],
  );
});

test("stable IDs survive insertion/reordering and omit removed pages without falling back to stale batches", () => {
  const changed = {
    ...project,
    slides: [{ id: "new" }, project.slides[83], project.slides[76]],
  };
  const result = currentProduction(changed, [job("a", ["s84", "deleted"])]);
  assert.deepEqual(
    result.slides.map((s) => s.id),
    ["s84"],
  );
  assert.equal(changed.slides.indexOf(result.slides[0]) + 1, 2);
  assert.equal(
    currentProduction(project, [job("gone", ["deleted"])]).slides.length,
    0,
  );
});

test("full target IDs do not shrink with finished IDs, and new append tasks start empty", () => {
  assert.deepEqual(
    productionTargetIds(
      {
        type: "render",
        payload: { slideIds: ["s83", "s84"], finishedIds: ["s83", "s84"] },
      },
      project,
    ),
    ["s83", "s84"],
  );
  assert.deepEqual(
    productionTargetIds(
      {
        type: "append",
        payload: { batchId: "insert77", finishedIds: ["s77"] },
      },
      project,
    ),
    ["s77"],
  );
  assert.deepEqual(
    currentProduction(project, [
      { ...job("a", [], "running"), type: "append", batchId: "new" },
    ]).slides,
    [],
  );
  assert.equal(currentProduction(project, []).label, "最近添加");
  assert.equal(
    currentProduction(project, [
      { ...job("legacy", []), targetSlideIds: undefined },
    ]).label,
    "最近添加",
  );
});

test(
  "browser keeps actual page numbers when switching production/all/batches and polling completion",
  { skip: !process.env.PRODUCTION_BROWSER_TEST, timeout: 30000 },
  async () => {
    const { default: express } = await import("express");
    const { once } = await import("node:events");
    const { chromium } = await import("playwright-core");
    const app = express();
    app.use(express.static("dist"));
    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    let browser;
    try {
      browser = await chromium.launch({
        executablePath:
          process.env.CHROMIUM_EXECUTABLE ||
          (process.platform === "darwin"
            ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
            : undefined),
        headless: true,
      });
      const page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
      });
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const p = {
        ...structuredClone(project),
        title: "制作页码回归验证",
        revision: 1,
        draft: "",
        styleId: "style",
        proposal: null,
        undo: null,
        batches: [
          {
            id: "original",
            label: "第 1 段",
            text: "原始讲稿",
            slideIds: project.slides
              .filter((s) => s.id !== "s77")
              .map((s) => s.id),
          },
          {
            id: "insert77",
            label: "插入页面",
            text: "插页讲稿",
            slideIds: ["s77"],
          },
        ],
        slides: project.slides.map((s) => ({
          ...s,
          batchIds: [s.id === "s77" ? "insert77" : "original"],
          notes: "回归验证讲稿",
          status: "ready",
          plan: { title: s.id },
          image: null,
          versions: [],
          styleId: "style",
        })),
      };
      let jobs = [
        {
          ...job("render84", ["s84"], "running"),
          slideIds: ["s84"],
          stage: "正在制作",
          done: 0,
          total: 1,
        },
      ];
      const bootstrap = {
        projects: [{ id: p.id, title: p.title }],
        styles: [
          {
            id: "style",
            name: "测试风格",
            rules: "清晰",
            colors: [],
            refs: [],
          },
        ],
        settings: { text: { hasKey: false }, image: { hasKey: false } },
        jobs: [],
      };
      await page.route("**/api/**", (route) => {
        const url = new URL(route.request().url());
        const body =
          url.pathname === "/api/bootstrap"
            ? bootstrap
            : url.pathname === "/api/projects/p"
              ? p
              : url.pathname === "/api/jobs"
                ? jobs
                : {};
        return route.fulfill({
          contentType: "application/json",
          body: JSON.stringify(body),
        });
      });
      await page.goto(
        `http://127.0.0.1:${server.address().port}/#project/p/studio`,
      );
      await page
        .getByRole("button", { name: "打开第 84 页：s84", exact: true })
        .waitFor();
      assert.equal(await page.locator(".slide-card").count(), 1);
      await page.getByRole("button", { name: /^全部页面/ }).click();
      assert.equal(await page.locator(".slide-card").count(), 90);
      await page.getByLabel("查看段落").selectOption("insert77");
      await page
        .getByRole("button", { name: "打开第 77 页：s77", exact: true })
        .waitFor();
      await page.getByRole("button", { name: /^最近制作/ }).click();
      await page
        .getByRole("button", { name: "打开第 84 页：s84", exact: true })
        .waitFor();
      jobs = [{ ...jobs[0], status: "completed", slideIds: [], done: 1 }];
      await page.waitForFunction(() => !document.querySelector(".job-banner"));
      assert.equal(await page.locator(".slide-card").count(), 1);
      await page
        .getByRole("button", { name: "打开第 84 页：s84", exact: true })
        .waitFor();
      p.slides.unshift({ ...p.slides[0], id: "new" });
      p.revision++;
      await page
        .getByRole("button", { name: "打开第 85 页：s84", exact: true })
        .waitFor();
      assert.deepEqual(errors, []);
    } finally {
      await browser?.close();
      await new Promise((r) => server.close(r));
    }
  },
);
