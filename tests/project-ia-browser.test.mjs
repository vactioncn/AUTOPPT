import test from "node:test";
import { launchBrowser } from "./helpers/browser.mjs";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import { fork } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import sharp from "sharp";
import { silenceMp3 } from "./helpers/speech-audio.mjs";
import { expect } from "@playwright/test";

const reviewScreenshot = (page, options) =>
  process.env.UPDATE_REVIEW_SCREENSHOTS === "1" ? page.screenshot(options) : Promise.resolve();

test(
  "four project areas preserve editing, own rehearsal/delivery, and fit desktop/mobile in local and hosted shells",
  { timeout: 180000 },
  async (t) => {
    const evidence = path.resolve("test-results/ux-hierarchy");
    mkdirSync(evidence, { recursive: true });
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
    const failedRetained = makeProject("failed-retained", 3);
    failedRetained.slides[0].status = "error";
    failedRetained.slides[2].status = "error";
    const failedMissing = makeProject("failed-missing", 2);
    failedMissing.slides[0].status = "error";
    failedMissing.slides[1].status = "error";
    failedMissing.slides[1].image = null;
    const db = new DatabaseSync(path.join(dir, "autoppt.sqlite"));
    db.exec(
      "CREATE TABLE records (kind TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(kind,id))",
    );
    const put = (kind, value) =>
      db
        .prepare("INSERT OR REPLACE INTO records VALUES (?,?,?)")
        .run(kind, value.id, JSON.stringify(value));
    for (const p of [ready, unfinished, empty, complete, failedRetained, failedMissing]) put("project", p);
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
    mkdirSync(path.join(dir, "speech-audio"));
    const audioFile = "11111111-1111-4111-8111-111111111111.mp3";
    writeFileSync(path.join(dir, "speech-audio", audioFile), silenceMp3);
    const narration = {
      id: "complete-narration",
      projectId: complete.id,
      title: complete.title,
      sourceRevision: 7,
      voiceName: "隔离口播",
      status: "ready",
      createdAt: now,
      options: {
        voiceId: "Chinese (Mandarin)_Male_Announcer",
        speed: 1,
        emotion: "auto",
      },
      pages: complete.slides.map((slide, i) => ({
        ...slide,
        number: i + 1,
        spokenText: slide.notes,
        speechTextVersion: 1,
        emotion: "auto",
        clips: [{ file: audioFile, text: slide.notes, duration: 0.25 }],
      })),
    };
    put("narration", narration);
    put("narration", {
      ...narration,
      id: "mismatched-narration",
      sourceRevision: 6,
      createdAt: "2026-01-01T00:00:00Z",
      pages: narration.pages.map((p) => ({ ...p, notes: "不同版本的讲稿。" })),
    });
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
    let startupError = "";
    child.stderr.on("data", (chunk) => {
      startupError += chunk;
    });
    const [message] = await Promise.race([
      once(child, "message", { signal: AbortSignal.timeout(15000) }),
      once(child, "exit").then(([code]) => {
        throw new Error(`Fixture server exited (${code}): ${startupError}`);
      }),
    ]);
    const base = `http://127.0.0.1:${message.port}`;
    browser = await launchBrowser(t);
    if (!browser) return;
    const page = await browser.newPage({
      viewport: { width: 1280, height: 800 },
      hasTouch: true,
    });
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const writes = [];
    await page.route("**/api/**", async (route) => {
      if (!["GET", "HEAD"].includes(route.request().method())) {
        writes.push(route.request().url());
        // Only local draft/script persistence and project import are allowed; never call a model.
        const mutation = `${route.request().method()} ${new URL(route.request().url()).pathname}`;
        if (
          ![
            "PATCH /api/projects/ready",
            "PUT /api/projects/complete/speech-script",
            "POST /api/projects/import",
          ].includes(mutation)
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
    const overflow = async () => {
      const report = await page.evaluate(() => ({
        width: innerWidth,
        scroll: document.documentElement.scrollWidth,
        outside: [...document.querySelectorAll("body *")]
          .filter((el) => el.getBoundingClientRect().right > innerWidth + 1)
          .slice(0, 12)
          .map((el) => ({
            tag: el.tagName,
            class: el.className,
            right: el.getBoundingClientRect().right,
          })),
      }));
      assert(
        report.scroll <= report.width + 1,
        `no horizontal overflow: ${page.url()} ${JSON.stringify(report)}`,
      );
    };
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
    await page.goto(`${base}/#projects`);
    await expect(
      page.getByRole("button", { name: "导入项目包", exact: true }),
    ).toBeVisible();
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
    await expect(page.locator(".workspace .btn.primary:visible")).toHaveText(
      "开始演练",
    );
    await expect(page.locator(".workspace .btn.primary:visible")).toHaveCount(
      1,
    );
    await expect(
      page.locator(".topbar").getByRole("button", { name: "播放演讲" }),
    ).toHaveCount(0);
    await reviewScreenshot(page, {
      path: path.join(evidence, "regression-1280-overview.png"),
    });
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
    await reviewScreenshot(page, {
      path: path.join(evidence, "regression-1280-studio.png"),
    });
    await goArea("演练中心");
    await expect(page.getByRole("heading", { name: "把这场演讲试好，再生成整场" })).toBeVisible();
    await page.getByRole("button", { name: "AI 口播", exact: true }).click();
    await expect(page.getByRole("button", { name:"管理声音 / 服务" })).toBeVisible();
    await expect(page.getByText(/先在设置连接 MiniMax/)).toBeVisible();
    await expect(page.getByRole("button", {name:"普通放映",exact:true})).toBeEnabled();
    await expect(page.getByRole("group", {name:/整场范围/})).toBeVisible();
    await page
      .getByRole("button", { name: "普通放映", exact: true })
      .click();
    await expect(page.getByRole("dialog", { name: "播放演讲" })).toBeVisible();
    await page.getByRole("button", { name: "关闭演讲播放器" }).click();
    await expect(
      nav().getByRole("button", { name: "演练中心", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await page.getByText("已有版本与高级调整",{exact:true}).click();
    await page.getByRole("button", { name:"动态版本 / 图层校准",exact:true}).click();
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
    await reviewScreenshot(page, {
      path: path.join(evidence, "regression-1280-rehearsal.png"),
    });
    await goArea("概览");
    await page
      .locator(".journey-tasks")
      .getByRole("button", { name: "继续未提交草稿", exact: true })
      .click();
    await expect(page.getByLabel("添加逐字稿", { exact: true })).toBeFocused();
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
      page.getByRole("heading", { name: "交付检查", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "PPTX＋完整逐字稿", exact: true }),
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
      .getByLabel("关闭", { exact: true })
      .click();
    await page.reload();
    await expect(
      nav().getByRole("button", { name: "交付中心", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await page.goto(`${base}/#project/unfinished`);
    await expect(page.locator(".workspace .btn.primary:visible")).toHaveText(
      "补齐 1 页画面",
    );
    await expect(page.locator(".journey-stats")).toContainText("已有画面2");
    await expect(page.locator(".journey-stats")).toContainText("待生成1");
    await expect(page.locator(".journey-stats")).toContainText(
      "讲稿已改待核对1",
    );
    for (const [label, number] of [
      ["补齐 1 页画面", 3],
      ["核对 1 页画面", 2],
    ]) {
      await page
        .locator(".journey-tasks")
        .getByRole("button", { name: label, exact: true })
        .click();
      if (label.startsWith("核对")) {
        await expect(page.getByRole("dialog")).toContainText("画面核对");
        await page.getByRole("button", {name:"查看并修改画面",exact:true}).click();
      }
      await expect(
        page.getByRole("dialog").getByLabel("本页逐字稿", { exact: true }),
      ).toHaveValue(`第 ${number} 页完整测试讲稿。`);
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "关闭", exact: true })
        .click();
      await goArea("概览");
    }
    await goArea("交付中心");
    await page
      .getByRole("button", { name: "查看导出检查", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "下载 ZIP 交付包（含 PPTX＋逐字稿）", exact: true }),
    ).toBeDisabled();
    await expect(page.getByRole("dialog")).toContainText("第 3 页");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "关闭", exact: true })
      .click();
    await reviewScreenshot(page, {
      path: path.join(evidence, "regression-1280-delivery.png"),
    });
    await page.goto(`${base}/#project/complete`);
    await expect(page.locator(".workspace .btn.primary:visible")).toHaveText(
      "检查交付",
    );
    await page.locator(".workspace .btn.primary:visible").click();
    await page
      .getByLabel("动态 HTML 交付版本")
      .selectOption("historical-motion");
    await expect(
      page.getByText(/与当前母版不同，请确认是否交付历史版本/),
    ).toBeVisible();
    await expect(page.getByText(/页面范围或顺序与当前项目不同/)).toBeVisible();
    await page.getByLabel("动态 HTML 交付版本").selectOption("complete-motion");
    await expect(
      page.getByRole("button", { name: "导入项目包", exact: true }),
    ).toHaveCount(0);
    await expect(page.getByText(/当前版本未提供项目源文件/)).toHaveCount(0);
    await page.getByLabel("HTML 口播版本").selectOption("mismatched-narration");
    const rejectedHtml = page.waitForResponse(
      (r) =>
        r.url().includes("/api/motion/complete-motion/html?") &&
        r.url().includes("download=1"),
    );
    await page
      .getByRole("button", { name: "下载动态 HTML", exact: true })
      .click();
    assert.equal((await rejectedHtml).ok(), false);
    await expect(page.getByRole("alert")).toContainText(
      "画面或讲稿与所选口播不一致",
    );
    await page.getByLabel("HTML 口播版本").selectOption("complete-narration");
    await page.getByLabel("HTML 包含演讲备注").check();
    const motionRequest = page.waitForRequest(
      (r) =>
        r.url().includes("/api/motion/complete-motion/html?") &&
        r.url().includes("download=1"),
    );
    const htmlDownload = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "下载动态 HTML", exact: true })
      .click();
    const html = await htmlDownload;
    assert.equal(await html.failure(), null);
    const motionQuery = new URL((await motionRequest).url()).searchParams;
    assert.equal(motionQuery.get("narration"), "complete-narration");
    assert.equal(motionQuery.get("notes"), "1");
    assert.match(
      readFileSync(await html.path(), "utf8"),
      /data:audio\/mpeg;base64,/,
    );
    assert.match(
      readFileSync(await html.path(), "utf8"),
      /第 1 页完整测试讲稿/,
    );

    await page
      .getByRole("button", { name: "导出静态 HTML", exact: true })
      .click();
    const exportDialog = page.getByRole("dialog");
    await expect(exportDialog.getByLabel("导出格式")).toHaveValue("html");
    await exportDialog
      .getByLabel("HTML 口播版本")
      .selectOption("complete-narration");
    await exportDialog.getByLabel("HTML 包含演讲备注").check();
    const staticRequest = page.waitForRequest((r) =>
      r.url().includes("/api/projects/complete/html?"),
    );
    const staticDownload = page.waitForEvent("download");
    await exportDialog
      .getByRole("button", { name: "下载静态 HTML", exact: true })
      .click();
    const staticQuery = new URL((await staticRequest).url()).searchParams;
    assert.equal(staticQuery.get("revision"), "7");
    assert.equal(staticQuery.get("narration"), "complete-narration");
    assert.equal(staticQuery.get("notes"), "1");
    assert.match(
      readFileSync(await (await staticDownload).path(), "utf8"),
      /data:audio\/mpeg;base64,/,
    );

    await goArea("演练中心");
    await page.getByText("已有版本与高级调整",{exact:true}).click();
    await page.getByRole("button", { name:"动态版本 / 图层校准",exact:true}).click();
    await exportDialog
      .getByLabel("HTML 口播版本")
      .selectOption("complete-narration");
    await exportDialog.getByLabel("HTML 包含演讲备注").check();
    const editorDownload = page.waitForEvent("download");
    await exportDialog
      .getByRole("button", { name: "下载 HTML", exact: true })
      .click();
    assert.match(
      readFileSync(await (await editorDownload).path(), "utf8"),
      /data:audio\/mpeg;base64,/,
    );
    await exportDialog
      .getByRole("button", { name: "关闭", exact: true })
      .click();

    await page
      .getByRole("button", { name: "普通放映", exact: true })
      .click();
    const playerResponse = page.waitForResponse(
      (r) => r.url().includes("/api/narration/") && r.url().includes("/html?"),
    );
    playerResponse.catch(() => {});
    const playerDownload = page.waitForEvent("download");
    playerDownload.catch(() => {});
    await page
      .getByRole("button", { name: "导出此版本 HTML · 含口播", exact: true })
      .click({ timeout: 5000 });
    const playerResult = await playerResponse;
    assert(playerResult.ok(), await playerResult.text());
    assert.match(
      readFileSync(await (await playerDownload).path(), "utf8"),
      /data:audio\/mpeg;base64,/,
    );
    await page.getByRole("tab", {name:"1 · 口播文本",exact:true}).click();
    await page
      .getByLabel("实际口播文本", { exact: true })
      .fill("保存独立的口播修改。");
    await page
      .getByRole("button", { name: "保存口播文本", exact: true })
      .click();
    await expect(
      page.getByText("口播文本已保存，原稿保持不变。"),
    ).toBeVisible();
    const savedScript = await (
      await page.request.get(`${base}/api/projects/complete/speech-script`)
    ).json();
    assert.equal(savedScript.pages[0].text, "保存独立的口播修改。");
    const sourceProject = await (
      await page.request.get(`${base}/api/projects/complete`)
    ).json();
    assert.equal(sourceProject.slides[0].notes, complete.slides[0].notes);
    await expect(
      page.getByRole("button", { name: "导出此版本 HTML · 含口播", exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "关闭演讲播放器", exact: true })
      .click();
    await goArea("交付中心");
    await page
      .getByRole("button", { name: "导出项目源文件", exact: true })
      .click();
    await expect(exportDialog.getByLabel("导出格式")).toHaveValue("project");
    const packageRequest = page.waitForRequest((r) =>
      r.url().includes("/api/projects/complete/package?"),
    );
    const packageDownload = page.waitForEvent("download");
    await exportDialog
      .getByRole("button", { name: "下载项目迁移包", exact: true })
      .click();
    assert.equal(
      new URL((await packageRequest).url()).searchParams.get("revision"),
      "7",
    );
    const packageFile = await packageDownload;
    assert.match(packageFile.suggestedFilename(), /\.autoppt\.zip$/);
    assert.equal(await packageFile.failure(), null);
    await page.goto(`${base}/#projects`);
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "导入项目包", exact: true }).click();
    await (
      await chooser
    ).setFiles({
      name: packageFile.suggestedFilename(),
      mimeType: "application/zip",
      buffer: readFileSync(await packageFile.path()),
    });
    await expect(page).toHaveURL(/#project\/[^/]+$/);
    const importedId = page.url().split("#project/")[1];
    assert.notEqual(importedId, "complete");
    await expect(
      nav().getByRole("button", { name: "概览", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await expect(page.locator(".workspace-heading h1")).toContainText(
      complete.title,
    );
    await expect(
      page
        .locator(".side-projects")
        .getByRole("button")
        .filter({ hasText: complete.title }),
    ).toHaveCount(2);
    await goArea("制作台");
    await expect(
      page.getByRole("button", { name: "继续添加讲稿", exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(
      nav().getByRole("button", { name: "制作台", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await expect(page.locator(".slide-card")).toHaveCount(2);
    const importedScript = await (
      await page.request.get(`${base}/api/projects/${importedId}/speech-script`)
    ).json();
    assert.equal(importedScript.pages[0].text, "保存独立的口播修改。");
    await page.goto(`${base}/#project/complete/delivery`);
    await page
      .getByRole("button", { name: "下载 ZIP 交付包（含 PPTX＋逐字稿）", exact: true })
      .click();
    const pptDownload = page.waitForEvent("download");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "下载 ZIP 交付包（含 PPTX＋逐字稿）", exact: true })
      .click();
    assert.match((await pptDownload).suggestedFilename(), /\.zip$/);
    // Failed generation may retain valid artwork, but it needs explicit review.
    for (const [id, failureText, missing] of [
      ["failed-retained", "有 2 页生成失败（第 1、3 页）", false],
      ["failed-missing", "有 1 页生成失败（第 1 页）", true],
    ]) {
      await page.goto(`${base}/#project/${id}/delivery`);
      await page.getByRole("button", { name: "查看导出检查", exact: true }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toContainText(failureText);
      await expect(dialog).toContainText("本次将使用这些现有画面");
      const download = dialog.getByRole("button", { name: "下载 ZIP 交付包（含 PPTX＋逐字稿）", exact: true });
      const confirm = dialog.getByRole("checkbox", { name: "我已核对失败页，确认使用现有画面继续导出", exact: true });
      await expect(confirm).not.toBeChecked();
      await expect(download).toBeDisabled();
      await confirm.check();
      if (missing) {
        await expect(dialog).toContainText("还有 1 页未完成（第 2 页）");
        await expect(download).toBeDisabled();
        await dialog.getByRole("button", { name: "返回", exact: true }).click();
      } else {
        await expect(dialog).not.toContainText("页未完成");
        await expect(download).toBeEnabled();
        await confirm.uncheck();
        await expect(download).toBeDisabled();
        await confirm.check();
        const event = page.waitForEvent("download");
        await download.click();
        const file = await event;
        assert.match(file.suggestedFilename(), /\.zip$/);
        assert.equal(await file.failure(), null);
      }
    }
    await page.goto(`${base}/#project/empty`);
    await expect(page.locator(".workspace .btn.primary:visible")).toHaveText(
      "开始写讲稿",
    );
    await goArea("演练中心");
    await expect(
      page.getByRole("button", { name: "普通放映", exact: true }),
    ).toHaveCount(0);
    await expect(page.locator(".workspace .btn.primary:visible")).toHaveText(
      "先写讲稿 / 生成至少一页",
    );
    await expect(
      page.getByRole("button", { name: "打开动态演示", exact: true }),
    ).toHaveCount(0);
    await goArea("交付中心");
    await expect(page.locator(".journey-panel")).toContainText("还没有可交付内容");
    await page.getByRole("button", { name: "返回制作台", exact: true }).click();
    await expect(page.getByLabel("添加逐字稿", { exact: true })).toBeFocused();
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
    let recovering = true;
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
            total: 2,
            pageProgress: {
              total: 2, preserved: 109, succeeded: 0,
              current: { id: "page-1", page: 1 },
              failed: recovering ? [] : [{ id: "page-2", page: 2, error: "模型服务返回 408：stream disconnected before completion" }],
            },
            autoRetry: recovering ? { attempt: 1, maxRetries: 3, seconds: 5, reason: "模型服务繁忙" } : undefined,
          },
        ],
      }),
    );
    await page.goto(`${base}/#project/unfinished`);
    await page
      .locator(".journey-tasks")
      .getByRole("button", { name: "查看 1 项后台任务", exact: true })
      .click();
    await expect(page.locator(".job-banner")).toContainText("隔离后台制作");
    await expect(page.locator(".studio-tasks")).toBeFocused();
    await expect(page.locator(".job-outcomes")).toContainText("本次 2 页");
    await expect(page.locator(".job-outcomes")).toContainText("另有 109 页已保存，本次跳过");
    await expect(page.locator(".job-recovery")).toContainText("自动重试");
    await expect(page.locator(".job-recovery")).toContainText("模型服务繁忙");
    await expect(page.locator(".job-outcomes")).toContainText("失败 0");
    await expect(page.locator(".job-issues")).toHaveCount(0);
    await reviewScreenshot(page, { path: evidence + "/task-auto-recovery.png" });
    recovering = false;
    await page.reload();
    await expect(page.locator(".job-recovery")).toHaveCount(0);
    await page.getByText("1 页未完成 · 查看原因与处理方式", { exact: true }).click();
    await expect(page.locator(".job-issues")).toContainText("原第 2 页 · 模型响应中断或超时");
    await expect(page.locator(".job-issues")).toContainText("可恢复的临时故障会先自动重试");
    await reviewScreenshot(page, { path: evidence + "/task-recovery.png" });
    await goArea("交付中心");
    await expect(page.getByText(/1 项后台制作任务进行中/)).toBeVisible();
    await page
      .getByRole("button", { name: "查看导出检查", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toContainText("页面正在制作中");
    await page
      .getByRole("dialog")
      .getByLabel("导出格式")
      .selectOption("project");
    await expect(
      page.getByRole("dialog").getByText(/讲稿已修改，图片尚未更新/),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "下载项目迁移包", exact: true }),
    ).toBeDisabled();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "关闭", exact: true })
      .click();
    await page.unroute("**/api/jobs?projectId=unfinished");
    await page.route("**/api/projects/unfinished", async (route) => {
      const body = structuredClone(unfinished);
      body.slides[0].status = "error";
      body.slides[0].error = "隔离测试：画面制作失败";
      await route.fulfill({ json: body });
    });
    await page.goto(`${base}/#project/unfinished`);
    await page.reload();
    await page
      .locator(".journey-tasks")
      .getByRole("button", { name: "检查 1 页失败页面", exact: true })
      .click();
    await expect(
      page.getByRole("dialog").getByLabel("本页逐字稿", { exact: true }),
    ).toHaveValue("第 1 页完整测试讲稿。");
    await expect(
      page
        .getByRole("dialog")
        .getByRole("button", { name: "重新设计这页", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "关闭", exact: true })
      .click();
    await page.unroute("**/api/projects/unfinished");
    // Exercise every area and state with actual DOM order and navigation geometry.
    for (const [width, height] of [
      [1280, 800],
      [390, 844],
      [320, 700],
    ]) {
      await page.setViewportSize({ width, height });
      for (const state of ["empty", "unfinished", "complete"]) {
        await page.goto(`${base}/#project/${state}`);
        for (const [area, label] of Object.entries({
          overview: "概览",
          studio: "制作台",
          rehearsal: "演练中心",
          delivery: "交付中心",
        })) {
          await goArea(label);
          await overflow();
          await expect(
            page.locator(".workspace-heading .btn.primary"),
          ).toHaveCount(0);
          const primary = area === "rehearsal" && state !== "empty" ? page.getByRole("button",{name:"普通放映",exact:true}) : page.locator(".workspace .btn.primary:visible");
          await expect(primary).toHaveCount(1);
          if (area === "overview") {
            assert(
              await page
                .locator(".journey-tasks")
                .evaluate(
                  (el) =>
                    !!(
                      el.compareDocumentPosition(
                        document.querySelector(".journey-stats"),
                      ) & Node.DOCUMENT_POSITION_FOLLOWING
                    ),
                ),
            );
          }
          if (area === "studio") {
            if (state === "empty") {
              await expect(
                page.getByLabel("添加逐字稿", { exact: true }),
              ).toBeFocused();
              await visibleInViewport(
                page.getByLabel("添加逐字稿", { exact: true }),
              );
            } else {
              await expect(page.locator(".composer")).toBeHidden();
              if (width === 390) {
                const more = page.getByText("更多操作", { exact: true });
                await expect(page.getByRole("button", { name: "重新设计", exact: true })).toBeHidden();
                await expect(page.getByRole("button", { name: "在第一页前插入", exact: true })).toBeHidden();
                if (state === "unfinished")
                  await visibleInViewport(page.getByRole("button", { name: "补齐未生成页面", exact: true }));
                await more.focus();
                await page.keyboard.press("Enter");
                await page.getByRole("button", { name: "重新设计", exact: true }).click();
                await expect(page.getByRole("dialog").getByRole("heading", { name: "重新设计 PPT 页面", exact: true })).toBeVisible();
                await page.getByRole("dialog").getByRole("button", { name: "关闭", exact: true }).click();
                await more.click();
                await expect(page.getByRole("button", { name: "重新设计", exact: true })).toBeHidden();
                await more.tap();
                await page.getByRole("button", { name: "在第一页前插入", exact: true }).click();
                await expect(page.getByRole("dialog")).toBeVisible();
                await page.getByRole("dialog").getByRole("button", { name: "关闭", exact: true }).click();
                await more.click();
                for (const target of [more, page.locator(".insert-page").first(), page.locator(".slide-checkbox").first()]) {
                  const box = await target.boundingBox();
                  assert(box.width >= 44 && box.height >= 44, "mobile controls are at least 44 × 44");
                }
              }
              assert(
                await page
                  .locator(".slide-grid")
                  .evaluate(
                    (el) =>
                      !!(
                        el.compareDocumentPosition(
                          document.querySelector(".composer"),
                        ) & Node.DOCUMENT_POSITION_FOLLOWING
                      ),
                  ),
              );
              await expect(
                page.locator(".slide-caption h3").first(),
              ).not.toHaveText("");
              await page.locator(".slide-card").last().scrollIntoViewIfNeeded();
              await visibleInViewport(addScript);
              // A compact insertion action remains focusable and touch accessible.
              await page.locator(".insert-page").last().focus();
              await expect(page.locator(".insert-page").last()).toBeFocused();
              await addScript.click();
              await expect(
                page.getByLabel("添加逐字稿", { exact: true }),
              ).toBeFocused();
              await visibleInViewport(
                page.getByLabel("添加逐字稿", { exact: true }),
              );
              if (width === 390) {
                // Approximate a reduced visual viewport without adding any input overlay.
                await page.setViewportSize({ width, height: 460 });
                const submit = page.getByRole("button", { name: "提交讲稿并制作", exact: true });
                await submit.scrollIntoViewIfNeeded();
                const submitBox = await submit.boundingBox();
                const fixedNav = await page.locator(".sidebar").boundingBox();
                assert(submitBox.y >= 0 && submitBox.y + submitBox.height <= fixedNav.y, "submit clears mobile navigation with reduced viewport");
                await overflow();
                await page.setViewportSize({ width, height });
              }
              await page
                .getByRole("button", { name: "收起讲稿输入", exact: true })
                .click();
            }
          }
          if (area === "rehearsal") {
            await expect(primary).toHaveText(
              state === "empty" ? "先写讲稿 / 生成至少一页" : "普通放映",
            );
            if (state === "empty") {
              await expect(page.locator(".journey-empty > .btn:enabled")).toHaveCount(1);
              await page.locator(".journey-empty summary").click();
              await expect(page.getByRole("button", { name: "管理声音 / 服务", exact: true })).toBeEnabled();
              await expect(page.getByText(/打开上方播放器/)).toHaveCount(0);
            }
          }
          if (area === "delivery") {
            assert.deepEqual(
              await page
                .locator("[data-delivery-section]")
                .evaluateAll((els) =>
                  els.map((el) => el.dataset.deliverySection),
                ),
              state === "empty" ? [] : ["checks", "primary", "formats", "backup"],
            );
            await expect(primary).toHaveText(
              state === "complete" ? "下载 ZIP 交付包" : state === "empty" ? "返回制作台" : "查看导出检查",
            );
            if (state !== "complete")
              await expect(
                page.getByRole("button", {
                  name: "下载 ZIP 交付包（含 PPTX＋逐字稿）",
                  exact: true,
                }),
              ).toHaveCount(0);
          }
          await page.evaluate(() => window.scrollTo(0, 0));
          if (area === "rehearsal" || area === "delivery")
            await visibleInViewport(primary);
          if (width !== 320) {
            await reviewScreenshot(page, {
              path: path.join(evidence, `${width}-${state}-${area}-first.png`),
            });
            await reviewScreenshot(page, {
              path: path.join(evidence, `${width}-${state}-${area}-full.png`),
              fullPage: true,
            });
          }
          const lastAction = page.locator(".workspace button:visible").last();
          await lastAction.scrollIntoViewIfNeeded();
          const box = await lastAction.boundingBox();
          const navBox = await page.locator(".sidebar").boundingBox();
          assert(
            box.y >= 0 &&
              box.y + box.height <= (width <= 600 ? navBox.y : height),
            "last action can scroll above navigation",
          );
          if (area === "delivery" && width !== 320 && state !== "empty") {
            const backup = page.getByRole("region", { name: "备份与继续编辑", exact: true });
            const backupButton = backup.getByRole("button", { name: "导出项目源文件", exact: true });
            await backupButton.scrollIntoViewIfNeeded();
            const backupBox = await backup.boundingBox();
            const buttonBox = await backupButton.boundingBox();
            const bottom = width === 390 ? (await page.locator(".sidebar").boundingBox()).y : height;
            assert(backupBox.y >= 0 && backupBox.y + backupBox.height <= bottom, "entire backup card clears navigation");
            assert(buttonBox.y >= 0 && buttonBox.y + buttonBox.height <= bottom, "last delivery button clears navigation");
            await reviewScreenshot(page, { path: path.join(evidence, `${width}-${state}-delivery-end.png`) });
          }
          await overflow();
        }
      }
    }
    // Exercise a nonzero safe area, not only desktop Chrome's default zero inset.
    await page.setViewportSize({ width: 390, height: 844 });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: { bottom: 34 } });
    await page.goto(`${base}/#project/complete/delivery`);
    const safeBackup = page.getByRole("region", { name: "备份与继续编辑", exact: true });
    await safeBackup.getByRole("button", { name: "导出项目源文件", exact: true }).scrollIntoViewIfNeeded();
    const safeNavBox = await page.locator(".sidebar").boundingBox();
    const safeBackupBox = await safeBackup.boundingBox();
    assert.equal(safeNavBox.height, 96, "navigation includes its 62px content and 34px safe area");
    assert.equal(await page.locator(".workspace").evaluate((el) => parseFloat(getComputedStyle(el).paddingBottom)), 124);
    assert(safeBackupBox.y >= 0 && safeBackupBox.y + safeBackupBox.height <= safeNavBox.y, "backup clears navigation with a nonzero safe area");
    await reviewScreenshot(page, { path: path.join(evidence, "390-complete-delivery-safe-area-end.png") });
    await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: {} });
    await cdp.detach();
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
      body.buildInfo.runtimeMode = "hosted";
      body.capabilities.standardPresentation = { enabled: true };
      body.capabilities.aiNarration = {
        enabled: false,
        reason: "邀请制网页版第一版提供普通放映，暂不提供 AI 口播生成。",
      };
      body.capabilities.motionPresentation = {
        enabled: false,
        reason: "当前服务未开放动态演示，请检查服务版本。",
      };
      body.capabilities.localModelSettings = {
        enabled: false,
        reason: "托管版的模型由管理员统一配置。",
      };
      await route.fulfill({ response, json: body });
    });
    await page.goto(`${base}/#project/ready/rehearsal`);
    await page.reload();
    await expect(page.getByRole("heading", { name: "看一遍画面，准备放映" })).toBeVisible();
    const ordinary = page.getByRole("button", { name: "普通放映", exact: true });
    await expect(ordinary).toBeEnabled();
    await ordinary.click();
    await expect(page.getByRole("dialog", { name: "普通放映" })).toBeVisible();
    await page.getByRole("button", { name: "退出放映", exact: true }).click();
    await expect(nav().getByRole("button", { name: "演练中心", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.goto(`${base}/#project/empty/rehearsal`);
    await page.getByRole("button", { name: "先写讲稿 / 生成至少一页", exact: true }).click();
    await expect(nav().getByRole("button", { name: "制作台", exact: true })).toHaveAttribute("aria-current", "page");
    assert.deepEqual(await nav().getByRole("button").allTextContents(), [
      "概览",
      "制作台",
      "演练中心",
      "交付中心",
    ]);
    await page.getByRole("button", { name: "打开工作区导航", exact: true }).click();
    assert.deepEqual(
      (
        await page
          .getByRole("navigation", { name: "创作" })
          .getByRole("button")
          .allTextContents()
      ).map((s) => s.replace(/\d+/g, "")),
      ["我的项目", "风格库"],
    );
    await expect(
      page.getByRole("button", { name: /隔离验收.*账号与额度/ }),
    ).toBeVisible();
    await overflow();
    await page.locator(".account-footer").click();
    await expect(
      page.getByRole("heading", { name: "账号与额度" }),
    ).toBeVisible();
    await overflow();
    assert.deepEqual(errors, []);
    assert(
      writes.every((url) =>
        [
          "/api/projects/ready",
          "/api/projects/complete/speech-script",
          "/api/projects/import",
        ].some((suffix) => url.endsWith(suffix)),
      ),
    );
    assert.equal(
      db.prepare("SELECT count(*) AS n FROM records WHERE kind='job'").get().n,
      0,
      "no model tasks started",
    );
    console.log("UX hierarchy browser evidence:", evidence);
  },
);

// This fixture never reads .local and rejects every unlisted write. Model calls
// are represented only by a counted, intercepted batch endpoint.
test(
  "contextual onboarding with isolated local/hosted workspaces",
  { timeout: 180000 },
  async (t) => {
    const evidence = path.resolve("test-results/onboarding-review");
    mkdirSync(evidence, { recursive: true });
    const dir = mkdtempSync(path.join(tmpdir(), "autoppt-onboarding-"));
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
    let browser, db;
    t.after(async () => {
      await browser?.close();
      child.kill();
      db?.close();
    });
    let startupError = "";
    child.stderr.on("data", (chunk) => {
      startupError += chunk;
    });
    const [message] = await Promise.race([
      once(child, "message", { signal: AbortSignal.timeout(15000) }),
      once(child, "exit").then(([code]) => {
        throw Error(`Fixture exited (${code}): ${startupError}`);
      }),
    ]);
    const base = `http://127.0.0.1:${message.port}`;
    db = new DatabaseSync(path.join(dir, "autoppt.sqlite"));
    mkdirSync(path.join(dir, "assets"), { recursive: true });
    writeFileSync(
      path.join(dir, "assets/onboarding-fixture.png"),
      await sharp(
        Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450"><rect width="800" height="450" fill="#f0f2e6"/><circle cx="660" cy="230" r="90" fill="#cf4d31"/><text x="55" y="190" font-size="44" font-family="sans-serif" fill="#24342a">ONE SMALL STEP</text><text x="55" y="245" font-size="20" font-family="sans-serif" fill="#24342a">Isolated onboarding test fixture</text></svg>',
        ),
      )
        .png()
        .toBuffer(),
    );
    browser = await launchBrowser(t);
    if (!browser) return;
    const page = await browser.newPage({
      viewport: { width: 1280, height: 800 },
      reducedMotion: "reduce",
    });
    const errors = [],
      unexpected = [];
    page.on("pageerror", (e) => errors.push(e.message));
    let modelsReady = false,
      noStyles = false,
      hosted = false,
      incompatible = false,
      batches = 0,
      failBatch = false,
      failDraft = false,
      loseBatchResponse = false,
      accountFailure = null,
      holdNextAccount = false,
      resumeAccount,
      holdNextDraft = false,
      resumeDraft;
    // Speed up the real account polling path without changing production timers.
    await page.addInitScript(() => {
      const interval = window.setInterval;
      window.setInterval = (fn, ms, ...args) => {
        if (ms !== 10000) return interval(fn, ms, ...args);
        window.__refreshAccount = () => fn(...args);
        return interval(() => {
          if (!window.__pauseAccountPolling) fn(...args);
        }, 1000);
      };
    });
    t.after(() => resumeDraft?.());
    t.after(() => resumeAccount?.());
    const readProject = (id) =>
      JSON.parse(
        db
          .prepare("SELECT data FROM records WHERE kind='project' AND id=?")
          .get(id).data,
      );
    const putProject = (p) =>
      db
        .prepare("UPDATE records SET data=? WHERE kind='project' AND id=?")
        .run(JSON.stringify(p), p.id);
    await page.route("**/api/**", async (route) => {
      const request = route.request(),
        url = new URL(request.url()),
        method = request.method();
      if (url.pathname === "/api/account") {
        // Snapshot at request time so a held success can arrive after a newer
        // failure (and vice versa), through real browser fetches and React.
        const failure = accountFailure;
        const response = {
          status: failure && failure !== "network" ? failure : hosted ? 200 : 404,
          json: failure
            ? { error: "account refresh unavailable" }
            : hosted
            ? {
                hosted: true,
                modelReady: modelsReady,
                user: {
                  id: "isolated-onboarding",
                  name: "隔离账号",
                  role: "user",
                  balance: 0,
                  available: 0,
                  held: 0,
                },
              }
            : {},
        };
        if (holdNextAccount) {
          holdNextAccount = false;
          await new Promise((resolve) => (resumeAccount = resolve));
          resumeAccount = undefined;
        }
        return failure === "network" ? route.abort("failed") : route.fulfill(response);
      }
      if (url.pathname === "/api/bootstrap") {
        const response = await route.fetch(),
          body = await response.json();
        body.settings.text.hasKey = hosted || modelsReady;
        body.settings.image.hasKey = hosted || modelsReady;
        if (noStyles) body.styles = [];
        body.buildInfo.runtimeMode = hosted ? "hosted" : "local-browser";
        if (incompatible) body.buildInfo.apiSchemaVersion = 999;
        body.dataRootLabel = hosted ? "hosted 账号工作区" : "本机浏览器工作区";
        body.capabilities.localModelSettings = hosted
          ? { enabled: false, reason: "由管理员统一管理模型。" }
          : { enabled: true };
        return route.fulfill({ json: body });
      }
      if (
        method === "POST" &&
        /\/projects\/[^/]+\/batches$/.test(url.pathname)
      ) {
        batches++;
        if (failBatch)
          return route.fulfill({
            status: 503,
            json: { error: "隔离测试：模型暂时不可用" },
          });
        const id = url.pathname.split("/")[3],
          p = readProject(id),
          { text, requestId } = request.postDataJSON();
        assert.match(requestId, /^[\w-]{16,80}$/);
        const existing = p.batches.find(
          (batch) => batch.requestId === requestId,
        );
        if (existing) {
          assert.equal(existing.text, text);
          return route.fulfill({
            status: 202,
            json: { accepted: true, id: "fixture-only", batchId: existing.id },
          });
        }
        p.draft = "";
        p.revision++;
        p.batches.push({
          id: `b${batches}`,
          requestId,
          text,
          label: "示例段落",
          slideIds: ["onboarding-page"],
          createdAt: new Date().toISOString(),
        });
        if (!p.slides.length)
          p.slides.push({
            id: "onboarding-page",
            notes: text,
            plan: { title: "隔离示例页", displayText: ["从一个小行动开始"] },
            image: "onboarding-fixture.png",
            status: "ready",
            stale: false,
            versions: [],
            batchIds: [`b${batches}`],
            styleId: p.styleId,
          });
        putProject(p);
        if (loseBatchResponse) {
          loseBatchResponse = false;
          return route.abort("failed");
        }
        return route.fulfill({
          status: 202,
          json: {
            accepted: true,
            id: "fixture-only",
            batchId: p.batches.at(-1).id,
          },
        });
      }
      if (holdNextDraft && method === "PATCH" && /^\/api\/projects\/[^/]+$/.test(url.pathname)) {
        holdNextDraft = false;
        await new Promise((resolve) => { resumeDraft = resolve; });
        resumeDraft = undefined;
      }
      if (
        failDraft &&
        method === "PATCH" &&
        /^\/api\/projects\/[^/]+$/.test(url.pathname)
      )
        return route.fulfill({
          status: 503,
          json: { error: "隔离测试：草稿保存失败" },
        });
      if (
        ["GET", "HEAD"].includes(method) ||
        (method === "POST" &&
          ["/api/projects", "/api/styles"].includes(url.pathname)) ||
        (method === "PATCH" &&
          /^\/api\/projects\/[^/]+(?:\/slides\/[^/]+)?$/.test(url.pathname))
      )
        return route.continue();
      unexpected.push(`${method} ${url.pathname}`);
      return route.fulfill({
        status: 409,
        json: { error: "Unexpected write blocked by isolated onboarding test" },
      });
    });
    const button = (name) => page.getByRole("button", { name, exact: true });
    const card = page.getByRole("region", { name: "首次工作区准备" });
    const shot = async (name, locator) => {
      for (const width of [1280, 390]) {
        await page.setViewportSize({ width, height: 844 });
        if (locator) await locator.scrollIntoViewIfNeeded();
        assert(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
          `${name} overflow at ${width}`,
        );
        if (locator)
          assert(
            await locator.evaluate(
              (el) => el.scrollWidth <= el.clientWidth + 1,
            ),
            `${name} inner overflow at ${width}`,
          );
        await reviewScreenshot(page, {
          path: path.join(evidence, `${name}-${width}.png`),
        });
      }
      await page.setViewportSize({ width: 1280, height: 800 });
    };
    const reopen = async () => {
      await button("使用帮助").click();
      await button("重新查看新手引导").click();
      await expect(card).toBeVisible();
    };
    const scenario = async (name, run) => {
      let failure;
      await t.test(name, async () => {
        try {
          await run();
        } catch (error) {
          failure = error;
          throw error;
        }
      });
      if (failure) throw failure;
    };
    let projectId;
    await scenario(
      "local missing models, skip persistence, help replay and compatibility gate",
      async () => {
        await page.goto(base);
        await expect(card).toContainText("内容模型：未就绪");
        await expect(card).toContainText("图片模型：未就绪");
        await expect(card).toContainText("本机浏览器工作区");
        await expect(
          card.getByRole("button", { name: "连接并测试模型" }),
        ).toBeVisible();
        await expect(
          card.getByRole("button", { name: "先写草稿" }),
        ).toBeVisible();
        await shot("local-missing", card);
        await card.getByRole("button", { name: "跳过准备" }).click();
        await page.reload();
        await expect(card).toHaveCount(0);
        await reopen();
        incompatible = true;
        await page.reload();
        await expect(page.locator(".compatibility-gate")).toBeVisible();
        await expect(card).toHaveCount(0);
        incompatible = false;
        modelsReady = true;
        await page.reload();
        await expect(
          card.getByRole("button", { name: "开始第一个演讲" }),
        ).toBeVisible();
        await button("返回刚才的页面").click();
        await shot("local-ready", card);
      },
    );
    await scenario(
      "minimal project form retains advanced choices and focuses composer after real creation",
      async () => {
        await card.getByRole("button", { name: "开始第一个演讲" }).click();
        const dialog = page.getByRole("dialog");
        await expect(
          dialog.getByLabel("演讲主题", { exact: true }),
        ).toBeVisible();
        await expect(dialog.locator(".style-choice-grid")).toBeHidden();
        await expect(dialog.getByLabel("内容倾向（可选）")).toBeHidden();
        await dialog
          .getByLabel("演讲主题", { exact: true })
          .fill("隔离的新手演讲");
        await shot("create-collapsed", dialog);
        await dialog.getByRole("button", { name: "更换", exact: true }).click();
        await expect(dialog.locator(".style-choice-grid")).toBeVisible();
        await expect(dialog.getByLabel("内容倾向（可选）")).toBeVisible();
        await expect(dialog.locator(".palette-grid")).toBeVisible();
        await dialog.locator(".new-project-scroll").evaluate((el) => {
          el.scrollTop = 0;
        });
        await shot("create-expanded", dialog);
        await page.setViewportSize({ width: 390, height: 844 });
        // Exercise the same CSS safe-area variable with a non-zero device inset.
        await dialog.evaluate((el) =>
          el.style.setProperty("--new-project-safe-bottom", "34px"),
        );
        const cta = dialog.getByRole("button", { name: "创建并写第一段" });
        const assertCta = async () => {
          await expect(dialog.locator(".modal-actions")).toHaveCSS(
            "padding-bottom",
            "50px",
          );
          await expect
            .poll(async () => {
              const box = await cta.boundingBox();
              return box.y >= 0 && box.y + box.height <= 844 - 34;
            })
            .toBe(true);
        };
        await assertCta();
        await dialog.locator(".new-project-scroll").evaluate((el) => {
          el.scrollTop = el.scrollHeight;
        });
        await assertCta();
        const lastInput = dialog
          .locator(
            ".new-project-scroll input, .new-project-scroll textarea, .new-project-scroll button",
          )
          .last();
        await lastInput.scrollIntoViewIfNeeded();
        const lastBox = await lastInput.boundingBox(),
          actionsBox = await dialog.locator(".modal-actions").boundingBox();
        assert(lastBox.y + lastBox.height <= actionsBox.y);
        await reviewScreenshot(page, {
          path: path.join(evidence, "390-create-expanded-end.png"),
        });
        await dialog.evaluate((el) =>
          el.style.removeProperty("--new-project-safe-bottom"),
        );
        await page.setViewportSize({ width: 1280, height: 800 });
        await dialog.getByLabel("内容倾向（可选）").fill("面向新同事");
        await dialog.getByText("展开说明（可选）", { exact: true }).click();
        await expect(
          dialog.getByRole("button", { name: "AI 完善说明" }),
        ).toBeVisible();
        await dialog.locator(".palette-grid").scrollIntoViewIfNeeded();
        await shot("create-advanced-settings", dialog);
        await dialog.getByLabel("内容倾向（可选）").fill("");
        await dialog
          .getByText("个性化设置，可稍后修改", { exact: true })
          .click();
        await dialog.getByRole("button", { name: "创建并写第一段" }).click();
        await expect(
          page.getByLabel("添加逐字稿", { exact: true }),
        ).toBeFocused();
        projectId = new URL(page.url()).hash.split("/")[1];
        assert.equal(readProject(projectId).title, "隔离的新手演讲");
        assert.equal(
          await page.evaluate(
            () =>
              JSON.parse(
                localStorage.getItem(
                  "autoppt:onboarding:v1:local-browser%3Alocal",
                ),
              ).workspace,
          ),
          "complete",
        );
        await expect(page.locator(".composer")).toContainText("100–500");
        await expect(page.locator(".composer")).toContainText(
          "已保存不等于已生成",
        );
        await expect(button("继续添加讲稿")).toHaveCount(0);
        await shot("empty-composer", page.locator(".composer"));
        await button("使用示例文字").click();
        assert(
          (await page.getByLabel("添加逐字稿", { exact: true }).inputValue())
            .length >= 100,
        );
        await expect
          .poll(() => readProject(projectId).draft.length)
          .toBeGreaterThan(100);
        assert.equal(batches, 0);
      },
    );
    await scenario(
      "missing models preserve drafts, explain actions and never open generation consent",
      async () => {
        modelsReady = false;
        await page.reload();
        await button("提交讲稿并制作").click();
        await expect(page.getByRole("dialog")).toContainText(
          "生成前需要连接内容和图片模型",
        );
        await expect(button("开始生成")).toHaveCount(0);
        await button("继续保存草稿").click();
        const draft = await page
          .getByLabel("添加逐字稿", { exact: true })
          .inputValue();
        await button("提交讲稿并制作").click();
        await button("连接模型并继续").click();
        await expect(page).toHaveURL(/#settings$/);
        await page.goto(`${base}/#project/${projectId}/studio`);
        await expect(
          page.getByLabel("添加逐字稿", { exact: true }),
        ).toHaveValue(draft);
        assert.equal(batches, 0);
      },
    );
    await scenario(
      "consent cancel, single submit, error recovery and explicit direct-generation preference",
      async () => {
        modelsReady = true;
        await page.reload();
        const input = page.getByLabel("添加逐字稿", { exact: true });
        const draft = await input.inputValue();
        await button("提交讲稿并制作").click();
        await expect(page.getByRole("dialog")).toContainText(
          "具体页数由拆页结果决定",
        );
        await expect(page.getByRole("dialog")).toContainText(
          "服务商按实际调用收取",
        );
        await shot("generation-confirmation", page.getByRole("dialog"));
        await page.setViewportSize({ width: 390, height: 440 });
        await button("开始生成").scrollIntoViewIfNeeded();
        const confirmBox = await button("开始生成").boundingBox();
        assert(
          confirmBox.y >= 0 && confirmBox.y + confirmBox.height <= 440,
          "consent action remains reachable with keyboard viewport",
        );
        await reviewScreenshot(page, {
          path: path.join(evidence, "generation-keyboard-390.png"),
        });
        await page.setViewportSize({ width: 1280, height: 800 });
        await button("返回修改").click();
        assert.equal(batches, 0);
        await expect(input).toHaveValue(draft);
        await button("提交讲稿并制作").click();
        await page.keyboard.press("Escape");
        assert.equal(batches, 0);
        await expect(input).toHaveValue(draft);
        const preference = () =>
          page.evaluate(
            () =>
              JSON.parse(
                localStorage.getItem(
                  "autoppt:onboarding:v1:local-browser%3Alocal",
                ),
              ).generation,
          );
        failDraft = true;
        await button("提交讲稿并制作").click();
        await page.getByLabel("以后直接生成").check();
        await button("开始生成").click();
        await expect(
          page.getByText("隔离测试：草稿保存失败", { exact: true }),
        ).toBeVisible();
        assert.equal(batches, 0);
        assert.equal(await preference(), "pending");
        failDraft = false;
        failBatch = true;
        await button("提交讲稿并制作").click();
        await page.getByLabel("以后直接生成").check();
        await button("开始生成").click();
        await expect(
          page.getByText("隔离测试：模型暂时不可用", { exact: true }),
        ).toBeVisible();
        assert.equal(batches, 1);
        assert.equal(await preference(), "pending");
        await expect(input).toHaveValue(draft);
        await expect.poll(() => readProject(projectId).draft).toBe(draft);
        failBatch = false;
        loseBatchResponse = true;
        await button("提交讲稿并制作").click();
        await page.getByLabel("以后直接生成").check();
        await button("开始生成").click();
        await expect(
          page.getByText("Failed to fetch", { exact: true }),
        ).toBeVisible();
        assert.equal(readProject(projectId).batches.length, 1);
        assert.equal(await preference(), "pending");
        const pendingKey = await page.evaluate(() => Object.keys(localStorage).find((key) => key.startsWith("autoppt-generation-request:v1:")));
        assert.equal(decodeURIComponent(pendingKey.split(":v1:")[1]), JSON.stringify(["local-browser:local", projectId]));
        await page.evaluate(() => sessionStorage.clear());
        await page.reload();
        await button("继续添加讲稿").click();
        await expect(input).toHaveValue(draft);
        await button("提交讲稿并制作").click();
        await page.getByLabel("以后直接生成").check();
        // Duplicate activation cannot enqueue two requests.
        await button("开始生成").evaluate((el) => {
          el.click();
          el.click();
        });
        await expect(input).toHaveValue("");
        assert.equal(batches, 3);
        assert.equal(readProject(projectId).batches.length, 1);
        assert.equal(await preference(), "direct");
        await button("继续添加讲稿").click();
        await input.fill("第二段隔离文字，验证已明确选择的直接生成。");
        await button("提交讲稿并制作").click();
        await expect(input).toHaveValue("");
        assert.equal(batches, 4);
        assert.equal(readProject(projectId).batches.length, 2);
        await expect(page.getByRole("dialog")).toHaveCount(0);
      },
    );
    await scenario(
      "three page concepts persist only after closing or saving, and help can replay",
      async () => {
        const openPage = async () => {
          await page.locator(".slide-card .slide-image").first().click();
        };
        await openPage();
        const teaching = page.getByRole("region", { name: "页面三点提示" });
        await expect(teaching.locator("li")).toHaveCount(3);
        assert.equal(
          await page.evaluate(
            () =>
              JSON.parse(
                localStorage.getItem(
                  "autoppt:onboarding:v1:local-browser%3Alocal",
                ),
              ).page,
          ),
          "pending",
          "visiting a page does not complete teaching",
        );
        await expect(teaching).toContainText("演讲者说的完整内容");
        await expect(teaching).toContainText("观众看到的重点");
        await expect(teaching).toContainText("按当前讲稿和风格重新制作画面");
        await expect(teaching).not.toContainText("费用");
        await shot("page-concepts", teaching);
        await button("知道了").click();
        await button("重新设计这页").click();
        await expect(page.getByRole("dialog").filter({ hasText: "确认重新设计这页" })).toContainText("收取费用");
        await button("返回修改").click();
        assert.equal(unexpected.length, 0, "cancelling redesign sends no model request");
        await button("关闭").click();
        await openPage();
        await expect(teaching).toHaveCount(0);
        await button("关闭").click();
        await reopen();
        await button("返回刚才的页面").click();
        await openPage();
        await expect(teaching).toBeVisible();
        await page
          .getByLabel("本页逐字稿", { exact: true })
          .fill("保存后的隔离逐字稿。");
        await button("保存讲稿").click();
        await expect(teaching).toHaveCount(0);
        await button("关闭").click();
        await page.reload();
        await openPage();
        await expect(teaching).toHaveCount(0);
        await button("关闭").click();
      },
    );
    await scenario(
      "empty rehearsal and delivery give one next step and retain project source export",
      async () => {
        const response = await fetch(`${base}/api/projects`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            title: "空演讲隔离验收",
            styleId: readProject(projectId).styleId,
          }),
        });
        const empty = await response.json();
        for (const area of ["rehearsal", "delivery"]) {
          await page.goto(`${base}/#project/${empty.id}/${area}`);
          await expect(
            page.locator(".journey-panel .btn.primary:visible"),
          ).toHaveCount(1);
          await expect(
            page.getByRole("region", { name: "AI 口播", exact: true }),
          ).toHaveCount(0);
          await expect(page.locator(".journey-primary-delivery")).toHaveCount(
            0,
          );
          await shot(`empty-${area}`, page.locator(".journey-panel"));
        }
        await expect(page.locator(".journey-panel")).toContainText(
          "还没有可交付内容",
        );
        await page.getByText("项目源文件", { exact: true }).click();
        await page
          .locator(".journey-panel")
          .getByRole("button", { name: "导出项目源文件" })
          .click();
        await expect(page.getByRole("dialog")).toContainText("迁移");
        await button("关闭").click();
        await page
          .locator(".journey-panel")
          .getByRole("button", { name: "返回制作台" })
          .click();
        await expect(
          page.getByLabel("添加逐字稿", { exact: true }),
        ).toBeFocused();
        await page.setViewportSize({ width: 390, height: 440 });
        await page
          .getByLabel("添加逐字稿", { exact: true })
          .fill("模拟输入法压缩可视区域。");
        await button("提交讲稿并制作").scrollIntoViewIfNeeded();
        const box = await button("提交讲稿并制作").boundingBox();
        assert(
          box.y >= 0 && box.y + box.height <= 440,
          "composer action remains reachable above keyboard",
        );
        await reviewScreenshot(page, {
          path: path.join(evidence, "keyboard-390.png"),
        });
        await page.setViewportSize({ width: 1280, height: 800 });
      },
    );
    await scenario(
      "no styles routes to an executable creation form, and minimal form survives intro roundtrip",
      async () => {
        noStyles = true;
        await page.goto(base);
        await page.reload();
        await page
          .getByRole("complementary")
          .getByRole("button", { name: "新建演讲项目", exact: true })
          .click();
        await page.getByLabel("演讲主题", { exact: true }).fill("保留中的主题");
        await expect(
          page
            .getByRole("dialog")
            .getByRole("button", { name: "前往风格库创建" }),
        ).toBeVisible();
        await page
          .getByRole("dialog")
          .getByRole("button", { name: "前往风格库创建", exact: true })
          .click();
        await expect(page).toHaveURL(/#styles$/);
        await expect(page.getByRole("dialog")).toBeVisible();
        await expect(button("手动填写")).toHaveAttribute(
          "aria-pressed",
          "true",
        );
        await button("关闭").click();
        await button("返回新建演讲").click();
        await expect(page.getByLabel("演讲主题", { exact: true })).toHaveValue(
          "保留中的主题",
        );
        await button("更换").click();
        await page.getByLabel("内容倾向（可选）").fill("新同事的受众草稿");
        await page.getByRole("dialog").getByRole("button", { name: "前往风格库创建", exact: true }).click();
        await page.getByLabel("风格名称", { exact: true }).fill("隔离手写风格");
        await page
          .getByLabel("风格提示词", { exact: true })
          .fill("留白充足，深绿字色，清晰布局。");
        noStyles = false;
        await button("保存风格").click();
        await expect(page.getByRole("dialog")).toHaveCount(0);
        await button("返回新建演讲").click();
        await expect(page.getByLabel("演讲主题", { exact: true })).toHaveValue(
          "保留中的主题",
        );
        await expect(page.getByLabel("内容倾向（可选）")).toHaveValue(
          "新同事的受众草稿",
        );
        await expect(page.locator(".new-project-style")).toContainText(
          "隔离手写风格",
        );
        await page
          .getByLabel("演讲主题", { exact: true })
          .fill("介绍返回保留主题");
        await page.evaluate(() => {
          location.hash = "intro";
        });
        await page.evaluate(() => {
          location.hash = "styles";
        });
        await expect(page.getByLabel("演讲主题", { exact: true })).toHaveValue(
          "介绍返回保留主题",
        );
        await button("关闭").click();
      },
    );
    await scenario(
      "abandoning style repair clears the new-project draft and never reopens old repair",
      async () => {
        noStyles = true;
        await page.goto(base);
        await page.reload();
        const newProject = () => page.getByRole("complementary").getByRole("button", { name: "新建演讲项目", exact: true }).click();
        await newProject();
        await page.getByLabel("演讲主题", { exact: true }).fill("应当放弃的主题");
        await button("更换").click();
        await page.getByLabel("内容倾向（可选）").fill("应当放弃的高级选项");
        await page.getByRole("dialog").getByRole("button", { name: "前往风格库创建", exact: true }).click();
        await button("关闭").click();
        await button("返回新建演讲").click();
        await expect(page.getByLabel("演讲主题", { exact: true })).toHaveValue("应当放弃的主题");
        await expect(page.getByLabel("内容倾向（可选）")).toHaveValue("应当放弃的高级选项");
        await page.getByRole("dialog").getByRole("button", { name: "前往风格库创建", exact: true }).click();
        await button("关闭").click();
        await page.getByRole("navigation", { name: "主导航" }).getByRole("button", { name: "项目", exact: true }).click();
        await newProject();
        await expect(page.getByLabel("演讲主题", { exact: true })).toHaveValue("");
        await expect(page.getByLabel("内容倾向（可选）")).toBeHidden();
        await button("更换").click();
        await expect(page.getByLabel("内容倾向（可选）")).toHaveValue("");
        await button("关闭").click();
        await page.getByRole("navigation", { name: "主导航" }).getByRole("button", { name: /风格库/ }).click();
        await expect(page.locator(".styles-page")).toBeVisible();
        await expect(page.getByRole("dialog")).toHaveCount(0);
        await expect(button("返回新建演讲")).toHaveCount(0);
        // Ordinary new-project from the repair library also discards the draft.
        await newProject();
        await page.getByLabel("演讲主题", { exact: true }).fill("第二次放弃的主题");
        await page.getByRole("dialog").getByRole("button", { name: "前往风格库创建", exact: true }).click();
        await button("关闭").click();
        await newProject();
        await expect(page.getByLabel("演讲主题", { exact: true })).toHaveValue("");
        await button("关闭").click();
        await expect(button("返回新建演讲")).toHaveCount(0);
        noStyles = false;
      },
    );
    await scenario(
      "hosted uses capability-managed wording and per-account preferences, no key or data path",
      async () => {
        hosted = true;
        modelsReady = false;
        await page.goto(base);
        await page.reload();
        await expect(card).toContainText("由管理员统一管理模型");
        await expect(
          card.getByRole("button", { name: "连接并测试模型" }),
        ).toHaveCount(0);
        assert(
          !/API Key|\/Users\/|autoppt-onboarding-/.test(await card.innerText()),
        );
        await expect(card).toContainText("内容模型：未就绪");
        await expect(card).toContainText("图片模型：未就绪");
        const contract = await page.evaluate(async () => ({
          bootstrap: await (await fetch("/api/bootstrap")).json(),
          account: await (await fetch("/api/account")).json(),
        }));
        assert.equal(contract.bootstrap.settings.text.hasKey, true);
        assert.equal(contract.bootstrap.settings.image.hasKey, true);
        assert.equal(contract.account.modelReady, false);
        await shot("hosted-missing", card);
        const requestsBefore = batches;
        await page.goto(`${base}/#project/${projectId}/studio`);
        await button("继续添加讲稿").click();
        await page
          .getByLabel("添加逐字稿", { exact: true })
          .fill("未配置管理员模型时只保存草稿。");
        await button("提交讲稿并制作").click();
        await expect(page.getByRole("dialog")).toContainText("等待管理员配置");
        await expect(button("开始生成")).toHaveCount(0);
        assert(
          !/余额|API Key|服务商|费用/.test(
            await page.getByRole("dialog").innerText(),
          ),
        );
        assert.equal(batches, requestsBefore);
        await shot("hosted-missing-generation", page.getByRole("dialog"));
        await button("继续保存草稿").click();
        await page.goto(base);
        modelsReady = true;
        await page.reload();
        await expect(card).toContainText("内容模型：已就绪");
        await shot("hosted-ready", card);
        await page.goto(`${base}/#project/${projectId}/studio`);
        await button("继续添加讲稿").click();
        await page
          .getByLabel("添加逐字稿", { exact: true })
          .fill("托管服务隔离讲稿。");
        await button("提交讲稿并制作").click();
        await expect(page.getByRole("dialog")).toContainText(
          "管理员提供的图片额度",
        );
        assert(
          !/余额|API Key|服务商按实际/.test(
            await page.getByRole("dialog").innerText(),
          ),
        );
        modelsReady = false;
        await expect(page.getByRole("dialog")).toContainText("等待管理员配置", { timeout: 15000 });
        await expect(button("开始生成")).toHaveCount(0);
        assert.equal(batches, requestsBefore, "readiness changes also block an already-open confirmation");
        await button("继续保存草稿").click();
      },
    );
    await scenario(
      "hosted refresh failure after readiness blocks preparation, open consent and in-flight draft saves until recovery",
      async () => {
        modelsReady = true;
        const before = batches;
        const input = page.getByLabel("添加逐字稿", { exact: true });
        await expect(page.locator(".composer-model-help")).toHaveCount(0);
        for (const failure of [503, 404, "network"]) {
          await button("提交讲稿并制作").click();
          await expect(button("开始生成")).toBeVisible();
          accountFailure = failure;
          await expect(page.getByRole("dialog")).toContainText("暂时无法确认模型状态");
          await expect(button("开始生成")).toHaveCount(0);
          await expect(page.locator(".account-footer strong")).toHaveText("隔离账号");
          assert(!/API Key|余额|服务商|等待管理员配置/.test(await page.getByRole("dialog").innerText()));
          await button("继续保存草稿").click();
          await input.press("Control+Enter");
          await expect(page.getByRole("dialog")).toContainText("暂时无法确认模型状态");
          assert.equal(batches, before);
          await button("继续保存草稿").click();
          accountFailure = null;
          await expect(page.locator(".composer-model-help")).toHaveCount(0);
        }
        // If readiness changes while submitDraft awaits PATCH, the POST must not run.
        await button("提交讲稿并制作").click();
        holdNextDraft = true;
        await button("开始生成").click();
        await expect.poll(() => !!resumeDraft).toBe(true);
        accountFailure = 503;
        await expect(page.locator(".composer-model-help")).toContainText("暂时无法确认模型状态");
        resumeDraft();
        await expect(page.getByRole("dialog")).toContainText("暂时无法确认模型状态");
        assert.equal(batches, before);
        await button("继续保存草稿").click();
        await button("使用帮助").click();
        await button("重新查看新手引导").click();
        await expect(card).toContainText("内容模型：未就绪");
        await expect(card).toContainText("暂时无法确认模型状态");
        await expect(card.getByRole("button", { name: "开始第一个演讲" })).toHaveCount(0);
        await button("返回刚才的页面").click();
        accountFailure = null;
        await expect(page.locator(".composer-model-help")).toHaveCount(0);
        await button("提交讲稿并制作").click();
        await button("开始生成").click();
        await expect(input).toHaveValue("");
        assert.equal(batches, before + 1, "only a successful readiness refresh permits the paid batch");
      },
    );
    await scenario(
      "hosted account refresh is latest-wins when old successes and failures arrive out of order",
      async () => {
        modelsReady = true;
        accountFailure = null;
        const before = batches;
        const input = page.getByLabel("添加逐字稿", { exact: true });
        await input.fill("乱序账号状态不能重新开放生成。");
        await expect(page.locator(".composer-model-help")).toHaveCount(0);
        await page.evaluate(() => { window.__pauseAccountPolling = true; });
        const refreshAccount = () => page.evaluate(() => { window.__refreshAccount(); });
        const releaseAccount = async (failure) => {
          const finished = page.waitForEvent(failure === "network" ? "requestfailed" : "requestfinished", {
            predicate: (request) => new URL(request.url()).pathname === "/api/account",
          });
          resumeAccount();
          await finished;
          // Let fetch/json and React commit before inspecting the late response.
          await page.evaluate(() => new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ));
        };
        // Hold an older modelReady=true response; a newer failure must close
        // an already-open confirmation and keep the signed-in identity.
        await button("提交讲稿并制作").click();
        await expect(button("开始生成")).toBeVisible();
        holdNextAccount = true;
        await refreshAccount();
        await expect.poll(() => !!resumeAccount).toBe(true);
        accountFailure = 503;
        await refreshAccount();
        await expect(page.getByRole("dialog")).toContainText("暂时无法确认模型状态");
        await releaseAccount();
        await expect(page.getByRole("dialog")).toContainText("暂时无法确认模型状态");
        await expect(button("开始生成")).toHaveCount(0);
        await expect(page.locator(".account-footer strong")).toHaveText("隔离账号");
        await button("继续保存草稿").click();
        await input.press("Control+Enter");
        await expect(page.getByRole("dialog")).toContainText("暂时无法确认模型状态");
        assert.equal(batches, before, "late readiness must not start a paid batch");
        await button("继续保存草稿").click();
        // Hold an old failure too. Only a fresh success may clear unknown;
        // the older failure arriving last must not close generation again.
        for (const failure of [503, 404, "network"]) {
          accountFailure = failure;
          holdNextAccount = true;
          await refreshAccount();
          await expect.poll(() => !!resumeAccount).toBe(true);
          accountFailure = null;
          await refreshAccount();
          await expect(page.locator(".composer-model-help")).toHaveCount(0);
          await releaseAccount(failure);
          await expect(page.locator(".composer-model-help")).toHaveCount(0);
          await expect(page.locator(".account-footer .account-error")).toHaveCount(0);
        }
        await button("提交讲稿并制作").click();
        await button("开始生成").click();
        await expect(input).toHaveValue("");
        assert.equal(batches, before + 1, "only the latest successful refresh restores paid generation");
        await page.evaluate(() => { window.__pauseAccountPolling = false; });
      },
    );
    await scenario(
      "storage denial does not break drafting or skip in the current session",
      async () => {
        await page.addInitScript(() => {
          Storage.prototype.getItem = () => {
            throw Error("storage denied");
          };
          Storage.prototype.setItem = () => {
            throw Error("storage denied");
          };
          Storage.prototype.removeItem = () => {
            throw Error("storage denied");
          };
        });
        hosted = false;
        await page.goto(base);
        await page.reload();
        await card.getByRole("button", { name: "跳过准备" }).click();
        await expect(card).toHaveCount(0);
        await page.goto(`${base}/#project/${projectId}/studio`);
        await button("继续添加讲稿").click();
        await page
          .getByLabel("添加逐字稿", { exact: true })
          .fill("即使浏览器偏好不可用，草稿仍保存到隔离工作区。");
        await expect
          .poll(() => readProject(projectId).draft)
          .toBe("即使浏览器偏好不可用，草稿仍保存到隔离工作区。");
        await expect(page.locator(".composer")).toContainText("重启后无法识别未确认的提交");
        const before = batches;
        failBatch = true;
        for (let attempt = 0; attempt < 2; attempt++) {
          await button("提交讲稿并制作").click();
          await button("开始生成").click();
          await expect(page.getByText("隔离测试：模型暂时不可用", { exact: true })).toBeVisible();
        }
        assert.equal(batches, before + 2);
        failBatch = false;
      },
    );
    assert.deepEqual(
      unexpected,
      [],
      "no unexpected model, write or paid requests",
    );
    assert.deepEqual(errors, [], "no browser exceptions");
  },
);
