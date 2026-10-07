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
import { silenceMp3 } from "./helpers/speech-audio.mjs";
import { chromium, expect } from "@playwright/test";

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
    await page.screenshot({
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
    await page.screenshot({
      path: path.join(evidence, "regression-1280-studio.png"),
    });
    await goArea("演练中心");
    await expect(page.getByRole("heading", { name: "标准放映" })).toBeVisible();
    await expect(
      page.locator('[aria-label="AI 口播"]').getByText(/尚未配置语音服务/),
    ).toBeVisible();
    await expect(page.locator('[aria-label="AI 口播"]')).toContainText(
      "普通放映仍可使用",
    );
    await expect(page.locator(".workspace .btn.primary:visible")).toHaveText(
      "打开演讲播放器",
    );
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
    await page.screenshot({
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
      .getByRole("button", { name: "关闭", exact: true })
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
      "内容已改待更新1",
    );
    for (const [label, number] of [
      ["补齐 1 页画面", 3],
      ["更新 1 页画面", 2],
    ]) {
      await page
        .locator(".journey-tasks")
        .getByRole("button", { name: label, exact: true })
        .click();
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
    await page.screenshot({
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
    await page
      .getByRole("button", { name: "打开动态演示", exact: true })
      .click();
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
      .getByRole("button", { name: "打开演讲播放器", exact: true })
      .click();
    const playerResponse = page.waitForResponse(
      (r) => r.url().includes("/api/narration/") && r.url().includes("/html?"),
    );
    playerResponse.catch(() => {});
    const playerDownload = page.waitForEvent("download");
    playerDownload.catch(() => {});
    await page
      .getByRole("button", { name: "导出静态 HTML · 含口播", exact: true })
      .click({ timeout: 5000 });
    const playerResult = await playerResponse;
    assert(playerResult.ok(), await playerResult.text());
    assert.match(
      readFileSync(await (await playerDownload).path(), "utf8"),
      /data:audio\/mpeg;base64,/,
    );
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
      page.getByRole("button", { name: "导出静态 HTML · 含口播", exact: true }),
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
      page.getByRole("button", { name: "打开演讲播放器", exact: true }),
    ).toHaveCount(0);
    await expect(page.locator(".workspace .btn.primary:visible")).toHaveText(
      "返回制作台",
    );
    await expect(
      page.getByRole("button", { name: "打开动态演示", exact: true }),
    ).toBeDisabled();
    await goArea("交付中心");
    await page.getByRole("button", { name: "查看导出检查", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText("还没有页面");
    await page.getByRole("dialog").getByRole("button", { name: "前往制作台处理", exact: true }).click();
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
    await page.goto(`${base}/#project/unfinished`);
    await page
      .locator(".journey-tasks")
      .getByRole("button", { name: "查看 1 项后台任务", exact: true })
      .click();
    await expect(page.locator(".job-banner")).toContainText("隔离后台制作");
    await expect(page.locator(".studio-tasks")).toBeFocused();
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
          const primary = page.locator(".workspace .btn.primary:visible");
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
              state === "empty" ? "返回制作台" : "打开演讲播放器",
            );
            if (state === "empty") {
              await expect(page.locator(".journey-panel .btn:enabled")).toHaveCount(1);
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
              ["checks", "primary", "formats", "backup"],
            );
            await expect(primary).toHaveText(
              state === "complete" ? "下载 ZIP 交付包" : "查看导出检查",
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
            await page.screenshot({
              path: path.join(evidence, `${width}-${state}-${area}-first.png`),
            });
            await page.screenshot({
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
          if (area === "delivery" && width !== 320) {
            const backup = page.getByRole("region", { name: "备份与继续编辑", exact: true });
            const backupButton = backup.getByRole("button", { name: "导出项目源文件", exact: true });
            await backupButton.scrollIntoViewIfNeeded();
            const backupBox = await backup.boundingBox();
            const buttonBox = await backupButton.boundingBox();
            const bottom = width === 390 ? (await page.locator(".sidebar").boundingBox()).y : height;
            assert(backupBox.y >= 0 && backupBox.y + backupBox.height <= bottom, "entire backup card clears navigation");
            assert(buttonBox.y >= 0 && buttonBox.y + buttonBox.height <= bottom, "last delivery button clears navigation");
            await page.screenshot({ path: path.join(evidence, `${width}-${state}-delivery-end.png`) });
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
    await page.screenshot({ path: path.join(evidence, "390-complete-delivery-safe-area-end.png") });
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
      body.capabilities.standardPresentation = {
        enabled: false,
        reason:
          "当前托管服务未开放演讲播放器与语音功能；模型与服务由管理员管理。",
      };
      body.capabilities.aiNarration = body.capabilities.standardPresentation;
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
    await expect(
      page.getByText(/当前托管服务未开放演讲播放器与语音功能/),
    ).toBeVisible();
    const unavailable = page.getByRole("button", { name: "标准放映不可用", exact: true });
    await expect(unavailable).toBeDisabled();
    await expect(unavailable).toHaveAccessibleDescription(/当前托管服务未开放演讲播放器与语音功能/);
    await expect(page.getByRole("button", { name: "返回制作台", exact: true })).toHaveCount(0);
    await expect(page.getByText("画面已齐备，可从头演练。", { exact: true })).toHaveCount(0);
    // A physical click on the disabled primary action cannot route back to the studio.
    await unavailable.scrollIntoViewIfNeeded();
    const unavailableBox = await unavailable.boundingBox();
    await page.mouse.click(unavailableBox.x + unavailableBox.width / 2, unavailableBox.y + unavailableBox.height / 2);
    await expect(nav().getByRole("button", { name: "演练中心", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.goto(`${base}/#project/empty/rehearsal`);
    await page.getByRole("button", { name: "返回制作台", exact: true }).click();
    await expect(nav().getByRole("button", { name: "制作台", exact: true })).toHaveAttribute("aria-current", "page");
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
