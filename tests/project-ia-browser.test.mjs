import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import { fork } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import sharp from "sharp";
import { chromium, expect } from "@playwright/test";

test(
  "four project areas preserve editing, own rehearsal/delivery, and fit desktop/mobile in local and hosted shells",
  { timeout: 90000 },
  async (t) => {
    const dir = mkdtempSync(path.join(tmpdir(), "autoppt-p0-ia-"));
    mkdirSync(path.join(dir, "assets"));
    const image = await sharp({
      create: { width: 800, height: 450, channels: 3, background: "#e9eadf" },
    })
      .png()
      .toBuffer();
    writeFileSync(path.join(dir, "assets/fixture.png"), image);
    const now = new Date().toISOString();
    const makeProject = (id, count) => ({
      id,
      title: `信息架构验收 · ${id}`,
      revision: 7,
      draft: "",
      styleId: "restrained-minimal",
      createdAt: now,
      updatedAt: now,
      proposal: null,
      undo: null,
      batches: count
        ? [
            {
              id: "batch",
              label: "第一段",
              text: "隔离测试逐字稿。",
              slideIds: Array.from(
                { length: count },
                (_, i) => `page-${i + 1}`,
              ),
              createdAt: now,
            },
          ]
        : [],
      slides: Array.from({ length: count }, (_, i) => ({
        id: `page-${i + 1}`,
        notes: `第 ${i + 1} 页完整测试讲稿。`,
        plan: { title: `页面 ${i + 1}` },
        image: "fixture.png",
        status: "ready",
        stale: false,
        versions: [],
        batchIds: ["batch"],
        styleId: "restrained-minimal",
        manuscriptVersion: 1,
      })),
    });
    const ready = makeProject("ready", 12);
    const unfinished = makeProject("unfinished", 3);
    unfinished.slides[1].stale = true;
    unfinished.slides[2].image = null;
    unfinished.slides[2].status = "pending";
    const empty = makeProject("empty", 0);
    const complete = makeProject("complete", 2);
    const db = new DatabaseSync(path.join(dir, "autoppt.sqlite"));
    db.exec(
      "CREATE TABLE records (kind TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(kind,id))",
    );
    const put = (kind, value) =>
      db
        .prepare("INSERT OR REPLACE INTO records VALUES (?,?,?)")
        .run(kind, value.id, JSON.stringify(value));
    for (const p of [ready, unfinished, empty, complete]) put("project", p);
    const motion = {
      id: "complete-motion",
      projectId: complete.id,
      title: complete.title,
      sourceRevision: 7,
      revision: 1,
      status: "ready",
      progress: "完成",
      createdAt: now,
      customFont: null,
      pages: complete.slides.map((s, i) => ({
        id: s.id,
        number: i + 1,
        title: s.plan.title,
        status: "ready",
        reviewed: true,
        source: { image: s.image, notes: s.notes, stale: false },
        width: 800,
        height: 450,
        background: s.image,
        layers: [],
        warnings: [],
      })),
    };
    put("motion", motion);
    put("motion", {
      ...motion,
      id: "historical-motion",
      sourceRevision: 6,
      createdAt: "2026-01-01T00:00:00Z",
      pages: [motion.pages[0]],
    });
    const child = fork("server/index.mjs", [], {
      silent: true,
      env: {
        ...process.env,
        NODE_ENV: "production",
        PORT: "0",
        AUTOPPT_DATA_DIR: dir,
        AUTOPPT_DESKTOP_TOKEN: "",
        AUTOPPT_WORKER_TOKEN: "",
        OPENAI_API_KEY: "",
      },
    });
    let browser;
    t.after(async () => {
      await browser?.close();
      child.kill();
      db.close();
    });
    const [message] = await once(child, "message");
    const base = `http://127.0.0.1:${message.port}`;
    const chrome =
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    browser = await chromium.launch({
      headless: true,
      executablePath:
        process.env.CHROMIUM_EXECUTABLE ||
        (existsSync(chrome) ? chrome : undefined),
    });
    const page = await browser.newPage({
      viewport: { width: 1280, height: 800 },
    });
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const writes = [];
    await page.route("**/api/**", async (route) => {
      if (!["GET", "HEAD"].includes(route.request().method())) {
        writes.push(route.request().url());
        // Only draft persistence is expected. Never allow this acceptance to invoke a model.
        if (
          route.request().method() !== "PATCH" ||
          new URL(route.request().url()).pathname !== "/api/projects/ready"
        ) {
          return route.fulfill({
            status: 409,
            json: { error: "Unexpected mutation in IA acceptance" },
          });
        }
      }
      await route.continue();
    });
    const nav = () => page.getByRole("navigation", { name: "项目区域" });
    const goArea = (name) =>
      nav().getByRole("button", { name, exact: true }).click();
    const overflow = async () =>
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        "no horizontal overflow",
      );
    const visibleInViewport = async (locator) => {
      await expect(locator).toBeVisible();
      const box = await locator.boundingBox();
      const size = page.viewportSize();
      assert(
        box &&
          box.x >= 0 &&
          box.y >= 0 &&
          box.x + box.width <= size.width + 1 &&
          box.y + box.height <= size.height - 62,
        "entry fits in usable viewport",
      );
    };
    await page.goto(`${base}/#project/ready`);
    await expect(
      nav().getByRole("button", { name: "概览", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    assert.deepEqual(await nav().getByRole("button").allTextContents(), [
      "概览",
      "制作台",
      "演练中心",
      "交付中心",
    ]);
    await expect(page.locator(".workspace-heading .btn.primary")).toHaveText(
      "开始演练",
    );
    await expect(page.locator(".workspace-heading .btn.primary")).toHaveCount(
      1,
    );
    await expect(
      page.locator(".topbar").getByRole("button", { name: "播放演讲" }),
    ).toHaveCount(0);
    await page.screenshot({ path: path.join(dir, "1280-overview.png") });
    await goArea("制作台");
    const addScript = page.getByRole("button", {
      name: "继续添加讲稿",
      exact: true,
    });
    await visibleInViewport(addScript);
    await page
      .getByRole("button", { name: "全部页面 12", exact: true })
      .click();
    await page
      .getByRole("button", { name: "选择第 1 页", exact: true })
      .click();
    await page.locator(".slide-card").last().scrollIntoViewIfNeeded();
    await visibleInViewport(addScript);
    await addScript.click();
    await expect(page.getByLabel("添加逐字稿", { exact: true })).toBeFocused();
    await page
      .getByLabel("添加逐字稿", { exact: true })
      .fill("保留这个未提交草稿。");
    await expect(page.getByRole("group", { name: "内容视图" })).toBeVisible();
    await expect(page.getByRole("group", { name: "范围筛选" })).toBeVisible();
    await page.screenshot({ path: path.join(dir, "1280-studio.png") });
    await goArea("演练中心");
    await expect(
      page.getByRole("heading", { name: "标准放映 / AI 口播" }),
    ).toBeVisible();
    await expect(page.getByText(/尚未配置语音服务/)).toBeVisible();
    await expect(page.getByText(/制作台已选 1 页/)).toBeVisible();
    await page
      .getByRole("button", { name: "打开演讲播放器", exact: true })
      .click();
    await expect(page.getByRole("dialog", { name: "播放演讲" })).toBeVisible();
    await page.getByRole("button", { name: "关闭演讲播放器" }).click();
    await expect(
      nav().getByRole("button", { name: "演练中心", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await page
      .getByRole("button", { name: "打开动态演示", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(
      page.getByRole("button", { name: /选中的页面/ }),
    ).toBeEnabled();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "关闭", exact: true })
      .click();
    await expect(
      nav().getByRole("button", { name: "演练中心", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await page.screenshot({ path: path.join(dir, "1280-rehearsal.png") });
    await goArea("制作台");
    await expect(page.getByLabel("添加逐字稿", { exact: true })).toHaveValue(
      "保留这个未提交草稿。",
    );
    await expect(
      page.getByRole("button", { name: "选择第 1 页", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "演说稿", exact: true }).click();
    await expect(page.locator(".manuscript-row")).toHaveCount(12);
    await goArea("交付中心");
    await expect(
      page.getByRole("heading", { name: "制作报告", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "PPTX + 逐字稿", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "单独逐字稿", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "下载动态 HTML", exact: true }),
    ).toBeDisabled();
    const manuscript = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "导出演说稿（Markdown）", exact: true })
      .click();
    const file = await manuscript;
    assert.match(
      readFileSync(await file.path(), "utf8"),
      /第 12 页完整测试讲稿/,
    );
    await page
      .getByRole("button", { name: "查看制作报告", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "关闭", exact: true })
      .click();
    await page.reload();
    await expect(
      nav().getByRole("button", { name: "交付中心", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await page.goto(`${base}/#project/unfinished`);
    await expect(page.locator(".workspace-heading .btn.primary")).toHaveText(
      "继续制作",
    );
    await expect(page.locator(".journey-stats")).toContainText("已有画面2");
    await expect(page.locator(".journey-stats")).toContainText("待生成1");
    await expect(page.locator(".journey-stats")).toContainText(
      "内容已改待更新1",
    );
    await goArea("交付中心");
    await page.getByRole("button", { name: "导出 PPT", exact: true }).click();
    await expect(
      page.getByRole("button", { name: /使用当前图片与最新备注下载/ }),
    ).toBeDisabled();
    await expect(page.getByRole("dialog")).toContainText("第 3 页");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "关闭", exact: true })
      .click();
    await page.screenshot({ path: path.join(dir, "1280-delivery.png") });
    await page.goto(`${base}/#project/complete`);
    await expect(page.locator(".workspace-heading .btn.primary")).toHaveText(
      "检查交付",
    );
    await page.locator(".workspace-heading .btn.primary").click();
    await page
      .getByLabel("动态 HTML 交付版本")
      .selectOption("historical-motion");
    await expect(
      page.getByText(/与当前母版不同，请确认是否交付历史版本/),
    ).toBeVisible();
    await expect(page.getByText(/页面范围或顺序与当前项目不同/)).toBeVisible();
    await page.getByLabel("动态 HTML 交付版本").selectOption("complete-motion");
    const htmlDownload = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "下载动态 HTML", exact: true })
      .click();
    const html = await htmlDownload;
    assert.equal(await html.failure(), null);
    assert.match(readFileSync(await html.path(), "utf8"), /deck-data/);
    await page.getByRole("button", { name: "导出 PPT", exact: true }).click();
    const pptDownload = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "下载 PPT 与逐字稿", exact: true })
      .click();
    assert.match((await pptDownload).suggestedFilename(), /\.zip$/);
    await page.goto(`${base}/#project/empty`);
    await expect(page.locator(".workspace-heading .btn.primary")).toHaveText(
      "开始写讲稿",
    );
    await goArea("演练中心");
    await expect(
      page.getByRole("button", { name: "打开演讲播放器", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "打开动态演示", exact: true }),
    ).toBeDisabled();
    // A failed metadata read must never be presented as an empty history or ready delivery.
    await page.route("**/api/projects/complete/motion", (route) =>
      route.fulfill({ status: 503, json: { error: "fixture outage" } }),
    );
    await page.goto(`${base}/#project/complete/delivery`);
    await expect(page.getByText(/动态演示记录暂时无法读取/)).toBeVisible();
    await expect(
      page.getByRole("button", { name: "下载动态 HTML", exact: true }),
    ).toBeDisabled();
    await page.unroute("**/api/projects/complete/motion");
    await page.route("**/api/projects/complete/motion", (route) =>
      route.fulfill({
        json: [
          {
            ...motion,
            status: "partial",
            pages: [motion.pages[0], { ...motion.pages[1], status: "failed" }],
          },
        ],
      }),
    );
    await page.reload();
    await expect(page.getByText(/所选动态演示尚未全部完成/)).toBeVisible();
    await expect(
      page.getByRole("button", { name: "下载动态 HTML", exact: true }),
    ).toBeDisabled();
    await page.unroute("**/api/projects/complete/motion");
    await page.route("**/api/jobs?projectId=unfinished", (route) =>
      route.fulfill({
        json: [
          {
            id: "fixture-job",
            projectId: "unfinished",
            type: "render",
            status: "running",
            slideIds: ["page-1"],
            stage: "隔离后台制作",
            done: 0,
            total: 1,
          },
        ],
      }),
    );
    await page.goto(`${base}/#project/unfinished/delivery`);
    await expect(page.getByText(/1 项后台制作任务进行中/)).toBeVisible();
    await page.getByRole("button", { name: "导出 PPT", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText("页面正在制作中");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "关闭", exact: true })
      .click();
    await page.unroute("**/api/jobs?projectId=unfinished");
    for (const [width, height] of [
      [1280, 800],
      [390, 844],
      [320, 700],
    ]) {
      await page.setViewportSize({ width, height });
      await page.goto(`${base}/#project/unfinished`);
      for (const area of ["概览", "制作台", "演练中心", "交付中心"]) {
        await goArea(area);
        await overflow();
        if (area === "制作台") {
          await visibleInViewport(addScript);
          await page.locator(".slide-card").last().scrollIntoViewIfNeeded();
          await visibleInViewport(addScript);
          await addScript.click();
          await expect(
            page.getByLabel("添加逐字稿", { exact: true }),
          ).toBeFocused();
          await visibleInViewport(
            page.getByLabel("添加逐字稿", { exact: true }),
          );
          await page.evaluate(() => window.scrollTo(0, 0));
        }
        await page.screenshot({
          path: path.join(dir, `${width}-${area}.png`),
          fullPage: true,
        });
      }
    }
    // Same navigation under hosted feature restrictions; preserve the hosted account entry.
    await page.route("**/api/account", (route) =>
      route.fulfill({
        json: {
          hosted: true,
          user: { id: "fixture", name: "隔离验收", available: 10, held: 0 },
          modelReady: true,
        },
      }),
    );
    await page.route("**/api/bootstrap", async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      body.features.speechPresentation = false;
      body.features.motionPresentation = false;
      await route.fulfill({ response, json: body });
    });
    await page.goto(`${base}/#project/ready/rehearsal`);
    await page.reload();
    await expect(
      page.getByText(/当前托管服务未开放演讲播放器与语音功能/),
    ).toBeVisible();
    assert.deepEqual(await nav().getByRole("button").allTextContents(), [
      "概览",
      "制作台",
      "演练中心",
      "交付中心",
    ]);
    assert.deepEqual(
      (
        await page
          .getByRole("navigation", { name: "主导航" })
          .getByRole("button")
          .allTextContents()
      ).map((s) => s.replace(/\d+/g, "")),
      ["项目", "风格库", "帮助与介绍", "模型与服务"],
    );
    await expect(
      page.getByRole("button", { name: /隔离验收.*账号与额度/ }),
    ).toBeVisible();
    await overflow();
    await page.getByRole("button", { name: "模型与服务", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "模型与服务" }),
    ).toBeVisible();
    await overflow();
    assert.deepEqual(errors, []);
    assert(writes.every((url) => url.endsWith("/api/projects/ready")));
    assert.equal(
      db.prepare("SELECT count(*) AS n FROM records WHERE kind='job'").get().n,
      0,
      "no model tasks started",
    );
    console.log("P0 IA browser evidence:", dir);
  },
);
