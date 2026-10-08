import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fork } from "node:child_process";
import { once } from "node:events";
import { DatabaseSync } from "node:sqlite";
import sharp from "sharp";
import JSZip from "jszip";
import { expect } from "@playwright/test";
import { SPEECH_DEFAULTS } from "../shared/speech.mjs";
import { launchBrowser } from "./helpers/browser.mjs";
import { modelRouteContract } from "./model-route-contract.mjs";

test(
  "feedback governance: real rehearsal/download, priority, paid cancellation and responsive evidence",
  { timeout: 180000 },
  async (t) => {
    const dir = mkdtempSync(path.join(tmpdir(), "autoppt-feedback-"));
    const evidence = path.resolve("test-results/feedback-governance");
    mkdirSync(evidence, { recursive: true });
    mkdirSync(path.join(dir, "assets"));
    const png = await sharp({
      create: { width: 800, height: 450, channels: 3, background: "#e9eadf" },
    })
      .png()
      .toBuffer();
    writeFileSync(path.join(dir, "assets/fixture.png"), png);
    const now = new Date().toISOString();
    const make = (id, count) => ({
      id,
      title: "候选 · 最终整合反馈验收",
      revision: 1,
      styleId: "restrained-minimal",
      createdAt: now,
      updatedAt: now,
      draft: "",
      proposal: null,
      undo: null,
      batches: count
        ? [
            {
              id: "batch",
              text: "讲稿",
              slideIds: Array.from({ length: count }, (_, i) => `p${i}`),
            },
          ]
        : [],
      slides: Array.from({ length: count }, (_, i) => ({
        id: `p${i}`,
        notes: `第 ${i + 1} 页的完整讲稿。`,
        image: "fixture.png",
        plan: { title: `页面 ${i + 1}` },
        status: "ready",
        stale: false,
        versions: [],
        batchIds: ["batch"],
        styleId: "restrained-minimal",
        manuscriptVersion: 1,
      })),
    });
    const db = new DatabaseSync(path.join(dir, "autoppt.sqlite"));
    db.exec(
      "CREATE TABLE records (kind TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(kind,id))",
    );
    const put = (kind, p) =>
      db
        .prepare("INSERT OR REPLACE INTO records VALUES (?,?,?)")
        .run(kind, p.id, JSON.stringify(p));
    const read = (id) =>
      JSON.parse(
        db
          .prepare("SELECT data FROM records WHERE kind='project' AND id=?")
          .get(id).data,
      );
    put("style", {
      id: "feedback-style",
      name: "验收参考风格",
      rules: "保持留白和清晰文字。",
      refs: ["fixture.png"],
      colors: ["#e9eadf"],
      status: "ready",
      createdAt: now,
      updatedAt: now,
    });
    put("project", make("ready", 3));
    put("project", make("empty", 0));
    const broken = make("broken", 3);
    broken.slides[0].image = null;
    broken.slides[0].status = "error";
    broken.slides[1].stale = true;
    broken.slides[2].image = null;
    broken.slides[2].status = "queued";
    put("project", broken);
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
    const [message] = await once(child, "message", {
      signal: AbortSignal.timeout(15000),
    });
    const base = `http://127.0.0.1:${message.port}`;
    browser = await launchBrowser(t);
    if (!browser) return;
    const page = await browser.newPage({
      viewport: { width: 1280, height: 800 },
      hasTouch: true,
    });
    page.setDefaultTimeout(7000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    let hosted = false;
    let presenterFixture = null;
    const paid = [];
    let suggestAttempts = 0;
    await page.route("**/api/**", async (route) => {
      const req = route.request(),
        url = new URL(req.url());
      if (
        presenterFixture &&
        req.method() === "GET" &&
        url.pathname.endsWith("/presenter")
      )
        return route.fulfill({ json: presenterFixture });
      if (url.pathname === "/api/account" && hosted)
        return route.fulfill({
          json: {
            hosted: true,
            modelReady: true,
            user: {
              id: "isolated-feedback",
              name: "验收账号",
              role: "user",
              balance: 100,
              available: 100,
              held: 0,
            },
          },
        });
      if (url.pathname === "/api/bootstrap") {
        const r = await route.fetch();
        const data = await r.json();
        data.settings.text.hasKey = true;
        data.settings.image.hasKey = true;
        if (hosted) {
          data.capabilities.standardPresentation = {
            enabled: false,
            reason: "当前平台未开放标准放映",
          };
          data.capabilities.aiNarration = {
            enabled: false,
            reason: "当前平台未开放口播",
          };
          data.capabilities.localModelSettings = {
            enabled: false,
            reason: "模型由管理员管理",
          };
        }
        return route.fulfill({ json: data });
      }
      if (url.pathname === "/api/settings/speech" && req.method() === "GET")
        return route.fulfill({ json: { hasKey: true } });
      if (url.pathname === "/api/style-imports" && req.method() === "POST")
        return route.fulfill({
          json: {
            id: "url-fixture",
            title: "隔离作品",
            url: "https://example.com/reference",
            images: [
              {
                id: "image1",
                preview: "/assets/fixture.png",
                width: 800,
                height: 450,
              },
            ],
            skipped: 0,
          },
        });
      const paidEntry =
        req.method() === "POST" &&
        modelRouteContract.find(
          (entry) =>
            entry.path.test(url.pathname) && (!entry.when || entry.when(req)),
        );
      if (paidEntry) {
        paid.push({
          entry: paidEntry.name,
          path: url.pathname,
          body: req.postData(),
        });
        if (paidEntry.name === "suggest-split") {
          suggestAttempts++;
          if (suggestAttempts === 1) return route.abort("failed"); // lost response: same request ID must be retried
          return route.fulfill({ json: { cuts: [3, 5] } });
        }
        if (url.pathname.endsWith("/batches")) {
          const p = read("empty");
          const text = req.postDataJSON().text;
          p.draft = "";
          p.batches.push({ id: "accepted-" + paid.length, text, slideIds: [] });
          p.revision++;
          put("project", p);
          return route.fulfill({
            status: 202,
            json: { id: "accepted", batchId: "accepted", accepted: true },
          });
        }
        return route.fulfill({
          status: 409,
          json: { error: "隔离验收：未调用付费模型。" },
        });
      }
      await route.continue();
    });
    const area = (name) =>
      page
        .getByRole("navigation", { name: "项目区域" })
        .getByRole("button", { name, exact: true })
        .click();
    const shot = async (width, state, region) => {
      const text = await page.locator("body").innerText();
      assert(
        !/requestId|worker|provider|\/Users\/|\/private\/|任务 ID/.test(text),
      );
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        "no horizontal overflow",
      );
      await page.screenshot({
        path: path.join(evidence, `${width}-${state}-${region}.png`),
      });
    };
    for (const width of [1280, 390, 320]) {
      await page.setViewportSize({ width, height: width === 1280 ? 800 : 844 });
      await page.goto(base + "/#project/broken");
      await expect(page.locator(".workspace .btn.primary:visible")).toHaveText(
        "检查 1 页失败页面",
      );
      await expect(
        page.getByRole("button", { name: "检查 1 页失败页面", exact: true }),
      ).toHaveCount(1);
      await shot(width, "priority", "overview");
      await page
        .getByRole("button", { name: "检查 1 页失败页面", exact: true })
        .click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "关闭", exact: true })
        .click();
      await area("概览");
      await page
        .getByRole("button", { name: "补齐 1 页画面", exact: true })
        .click();
      await expect(
        page.getByRole("dialog").getByLabel("本页逐字稿", { exact: true }),
      ).toHaveValue("第 3 页的完整讲稿。");
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "关闭", exact: true })
        .click();
      await page.goto(base + "/#project/broken/delivery");
      await page
        .getByRole("button", { name: "查看导出检查", exact: true })
        .click();
      await expect(page.locator('[data-feedback="blocking"]')).toContainText(
        "缺少画面",
      );
      await expect(
        page.getByRole("button", { name: "前往制作台处理", exact: true }),
      ).toHaveCount(1);
      await shot(width, "blocking", "delivery");
      await page.goto(base + "/#project/ready/rehearsal");
      await expect(
        page.getByText("尚未开始演练", { exact: true }),
      ).toBeVisible();
      await shot(width, "unstarted", "rehearsal");
      await page.getByRole("button", { name: "开始演练", exact: true }).click();
      assert.equal(read("ready").rehearsal, undefined);
      await page.getByRole("button", { name: "从头开始演练" }).click();
      await page.getByRole("button", { name: "下一页", exact: true }).click();
      await page.getByRole("button", { name: "中途关闭" }).click();
      assert.equal(read("ready").rehearsal, undefined);
      await expect(
        page.getByText("本次演练未完成，完成记录未更新；再次演练需从头开始。", {
          exact: true,
        }),
      ).toBeVisible();
      await expect(page.getByText("尚未开始演练", { exact: true })).toHaveCount(
        0,
      );
      await expect(page.getByText(/进度已保存|继续演练/)).toHaveCount(0);
      await shot(width, "closed-midway", "rehearsal");
      await page.getByRole("button", { name: "开始演练", exact: true }).click();
      await page.getByRole("button", { name: "从头开始演练" }).click();
      await page.getByRole("button", { name: "下一页", exact: true }).click();
      await page.getByRole("button", { name: "下一页", exact: true }).click();
      await page.getByRole("button", { name: "完成演练", exact: true }).click();
      await expect(
        page
          .getByRole("dialog", { name: "标准演练", exact: true })
          .getByText("已完成当前版本演练", { exact: true }),
      ).toBeVisible();
      assert(read("ready").rehearsal?.completedAt);
      await shot(width, "success", "rehearsal");
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "关闭", exact: true })
        .click();
      await expect(
        page.getByText("已完成当前版本演练", { exact: true }),
      ).toBeVisible();
      await shot(width, "completed", "rehearsal");
      await area("概览");
      await expect(
        page.getByText("已完成当前版本演练", { exact: true }),
      ).toBeVisible();
      await expect(page.locator(".workspace .btn.primary:visible")).toHaveText(
        "检查交付",
      );
      await area("演练中心");
      const updated = read("ready");
      updated.slides[0].notes += "已更新";
      updated.revision++;
      put("project", updated);
      await expect(
        page.getByText("上次演练基于修改前内容，本次修改尚未演练。", {
          exact: true,
        }),
      ).toBeVisible();
      await shot(width, "content-updated", "rehearsal");
      // Real HTTP export, real downloaded archive, including rehearsal metadata.
      await area("交付中心");
      await page
        .getByRole("button", { name: "导出项目源文件", exact: true })
        .click();
      const downloadEvent = page.waitForEvent("download");
      const responseEvent = page.waitForResponse(
        (r) => new URL(r.url()).pathname === "/api/projects/ready/package",
      );
      await page
        .getByRole("button", { name: "下载项目迁移包", exact: true })
        .click();
      const download = await downloadEvent;
      const disposition = (await responseEvent).headers()[
        "content-disposition"
      ];
      assert.equal(
        download.suggestedFilename(),
        decodeURIComponent(disposition.match(/filename\*=UTF-8''([^;]+)/i)[1]),
      );
      const file = await download.path();
      assert(file);
      const zip = await JSZip.loadAsync(readFileSync(file));
      const manifest = JSON.parse(
        await zip.file("manifest.json").async("string"),
      );
      assert(
        manifest.records.some((r) => r.kind === "project" && r.value.rehearsal),
      );
      assert(
        !/apiKey|accessKey|password|authorization/.test(
          JSON.stringify(manifest),
        ),
      );
      await expect(
        page.getByRole("status").filter({
          hasText: `已生成并发起下载：${download.suggestedFilename()}`,
        }),
      ).toBeVisible();
      await expect(
        page
          .getByRole("status")
          .filter({ hasText: download.suggestedFilename() }),
      ).toContainText(
        "请在浏览器下载列表查看；保存位置以浏览器设置或所选文件夹为准。",
      );
      await shot(width, "download-success", "delivery");
      // Reset only isolated fixture data for the next viewport.
      delete updated.rehearsal;
      put("project", updated);
    }
    await page.setViewportSize({ width: 320, height: 700 });
    await page.goto(base + "/#project/empty/studio");
    await page
      .getByLabel("添加逐字稿", { exact: true })
      .fill("窄屏确认保留草稿。");
    await page.getByRole("button", { name: "提交讲稿并制作" }).click();
    await expect(page.locator('[data-feedback="risk"]')).toBeVisible();
    await shot(320, "risk", "studio");
    await page.getByRole("button", { name: "返回修改", exact: true }).click();
    assert.equal(paid.length, 0);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(base + "/#project/ready/delivery");
    await page.addStyleTag({ content: ":root { --safe-area-bottom: 34px; }" });
    const lastDelivery = page.getByRole("button", {
      name: "导出项目源文件",
      exact: true,
    });
    await lastDelivery.scrollIntoViewIfNeeded();
    const lastBox = await lastDelivery.boundingBox();
    const bottomNav = await page.locator(".sidebar").boundingBox();
    assert(
      lastBox.height >= 44 &&
        lastBox.width >= 44 &&
        lastBox.y >= 0 &&
        lastBox.y + lastBox.height <= bottomNav.y,
      "last delivery control remains reachable above the safe area",
    );
    assert(bottomNav.height >= 96);
    await shot(390, "safe-area-last", "delivery");
    await page.setViewportSize({ width: 390, height: 520 });
    await page.goto(base + "/#project/empty/studio");
    await page.addStyleTag({ content: ":root { --safe-area-bottom: 34px; }" });
    const draft = page.getByLabel("添加逐字稿", { exact: true });
    await draft.fill("第一段保留的讲稿。");
    await expect.poll(() => read("empty").draft).toBe("第一段保留的讲稿。");
    await page.getByRole("button", { name: "提交讲稿并制作" }).click();
    await expect(page.locator('[data-feedback="risk"]')).toBeVisible();
    await shot(390, "risk", "studio");
    await page.getByRole("button", { name: "返回修改", exact: true }).click();
    assert.equal(paid.length, 0);
    await expect(draft).toHaveValue("第一段保留的讲稿。");
    await page
      .getByRole("button", { name: "提交讲稿并制作" })
      .scrollIntoViewIfNeeded();
    const actionBox = await page
      .getByRole("button", { name: "提交讲稿并制作" })
      .boundingBox();
    const navBox = await page.locator(".sidebar").boundingBox();
    assert(
      actionBox.height >= 44 &&
        actionBox.width >= 44 &&
        actionBox.y >= 0 &&
        actionBox.y + actionBox.height <= navBox.y,
      "main action clears 34px safe area and compressed viewport",
    );
    assert(navBox.height >= 96, "nonzero 34px safe area is actually applied");
    await shot(390, "safe-area-keyboard", "studio");
    await page.getByRole("button", { name: "提交讲稿并制作" }).click();
    await page.getByRole("button", { name: "开始生成", exact: true }).click();
    await expect(
      page.getByText("第一段讲稿已提交，可以查看制作进度。", { exact: true }),
    ).toBeVisible();
    assert.equal(paid.length, 1);
    await page
      .getByText("第一段讲稿已提交，可以查看制作进度。", { exact: true })
      .scrollIntoViewIfNeeded();
    await shot(390, "submission-success", "studio");

    // Subsequent submissions still confirm until this precisely scoped preference is saved.
    await page.setViewportSize({ width: 1280, height: 800 });
    await draft.fill("第二段保留的讲稿。");
    await page.getByRole("button", { name: "提交讲稿并制作" }).click();
    await shot(1280, "risk", "studio");
    await page.getByRole("button", { name: "返回修改", exact: true }).click();
    assert.equal(paid.length, 1);
    await expect(draft).toHaveValue("第二段保留的讲稿。");
    await page.getByRole("button", { name: "提交讲稿并制作" }).click();
    await page.getByLabel("以后提交新讲稿时直接生成").check();
    await page
      .getByRole("button", { name: "开始生成", exact: true })
      .evaluate((el) => {
        el.click();
        el.click();
      });
    await expect.poll(() => paid.length).toBe(2);
    await expect(draft).toHaveValue("");
    await draft.fill("第三段直接提交。");
    await page.getByRole("button", { name: "提交讲稿并制作" }).click();
    await expect.poll(() => paid.length).toBe(3);
    await expect(draft).toHaveValue("");
    // Simulate the isolated model worker's final saved result; success requires the
    // actual refreshed project to transition from unfinished to all ready.
    const allReady = make("empty", 2);
    allReady.revision = read("empty").revision + 1;
    put("project", allReady);
    await expect(
      page.getByText("全部页面已生成，可以前往演练中心从头演练。", {
        exact: true,
      }),
    ).toBeVisible();
    await shot(1280, "all-pages-success", "studio");
    const count = () => paid.length;
    const gate = async (entry, title, verify = async () => {}) => {
      const before = count();
      await entry.click();
      const dialog = page.getByRole("dialog", { name: title, exact: true });
      await expect(dialog.locator('[data-feedback="risk"]')).toBeVisible();
      await dialog.getByRole("button", { name: "取消", exact: true }).click();
      assert.equal(count(), before);
      await verify();
      await entry.click();
      await dialog
        .getByRole("button", { name: title, exact: true })
        .evaluate((el) => {
          el.click();
          el.click();
        });
      await expect.poll(count).toBe(before + 1);
      await expect(dialog).toHaveCount(0);
    };
    // New paid-entry regressions: cancel preserves the complete editing context;
    // synchronously clicking confirmation twice issues exactly one request.
    await page.goto(base + "/#project/ready/studio");
    await page.getByLabel("选择第 1 页", { exact: true }).click();
    await page.getByLabel("选择第 2 页", { exact: true }).click();
    await gate(
      page.getByRole("button", { name: "合并所选页面", exact: true }),
      "确认合并页面方案",
      async () => {
        await expect(
          page.getByLabel("选择第 1 页", { exact: true }),
        ).toHaveAttribute("aria-pressed", "true");
        await expect(
          page.getByLabel("选择第 2 页", { exact: true }),
        ).toHaveAttribute("aria-pressed", "true");
      },
    );
    assert.equal(JSON.parse(paid.at(-1).body).type, "merge");
    assert.deepEqual(JSON.parse(paid.at(-1).body).slideIds, ["p0", "p1"]);
    await page.getByLabel("取消选择", { exact: true }).click();
    const proposalProject = read("ready");
    proposalProject.proposal = {
      id: "proposal-fixture",
      type: "merge",
      sourceIds: ["p0", "p1"],
      notes: ["合并稿"],
      plans: [
        { title: "合并方案", displayText: ["合并后的画面"], visual: "留白" },
      ],
    };
    proposalProject.revision++;
    put("project", proposalProject);
    await page.getByRole("button", { name: "查看新方案", exact: true }).click();
    await gate(
      page.getByRole("button", { name: "确认并生成页面", exact: true }),
      "确认生成方案页面",
      async () =>
        await expect(
          page.getByText("合并后的画面", { exact: true }),
        ).toBeVisible(),
    );
    await page
      .getByRole("dialog", { name: "预览合并方案", exact: true })
      .getByRole("button", { name: "关闭", exact: true })
      .click();
    proposalProject.proposal = null;
    proposalProject.revision++;
    put("project", proposalProject);
    put("job", {
      id: "job-fixture",
      projectId: "ready",
      type: "render",
      status: "failed",
      stage: "验收未完成任务",
      slideIds: ["p0"],
      payload: { slideIds: ["p0"] },
      createdAt: now,
    });
    await gate(
      page.getByRole("button", { name: "继续未完成任务", exact: true }),
      "确认继续制作",
    );
    db.prepare(
      "DELETE FROM records WHERE kind='job' AND id='job-fixture'",
    ).run();
    await page
      .getByRole("button", { name: "在第一页前插入", exact: true })
      .click();
    await page
      .getByLabel("新页面逐字稿", { exact: true })
      .fill("仅插入一页的保留稿。");
    await gate(
      page.getByRole("button", { name: "插入并生成", exact: true }),
      "确认插入并生成",
      async () =>
        await expect(
          page.getByLabel("新页面逐字稿", { exact: true }),
        ).toHaveValue("仅插入一页的保留稿。"),
    );
    await page
      .getByRole("dialog", { name: "插入一页", exact: true })
      .getByRole("button", { name: "取消", exact: true })
      .click();
    await page.getByLabel("打开第 1 页：页面 1", { exact: true }).click();
    await page.getByRole("button", { name: "拆分这一页", exact: true }).click();
    const splitDialog = page.getByRole("dialog", {
      name: "你来决定，在哪里翻页",
      exact: true,
    });
    const source = page.getByLabel("选择逐字稿分界位置");
    await source.click();
    await source.evaluate((el) => {
      el.setSelectionRange(3, 3);
      el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    await expect(page.locator(".split-cursor")).toContainText(
      "第 3 个字符之后",
    );
    await page
      .getByRole("button", { name: "在这里插入分界", exact: true })
      .click();
    const splitState = async () => {
      await expect(
        page.getByRole("heading", { name: "将拆成 2 页", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByLabel("拆分后在后台生成图片（关闭后可先改稿）"),
      ).toBeChecked();
      await expect(source).toHaveValue(read("ready").slides[0].notes);
    };
    await page.setViewportSize({ width: 390, height: 844 });
    const suggestButton = page.getByRole("button", {
      name: "建议分界",
      exact: true,
    });
    await suggestButton.click();
    await shot(390, "suggest-split-risk", "studio");
    await page
      .getByRole("dialog", { name: "确认建议分界", exact: true })
      .getByRole("button", { name: "取消", exact: true })
      .click();
    await gate(suggestButton, "确认建议分界", splitState);
    const savedSuggestion = await page.evaluate(() =>
      Object.entries(sessionStorage)
        .filter(([key]) => key.includes("suggest-split"))
        .map(([, value]) => JSON.parse(value)),
    );
    assert.equal(savedSuggestion.length, 1);
    assert.deepEqual(Object.keys(savedSuggestion[0]).sort(), [
      "digest",
      "requestId",
    ]);
    // Reload after the lost response: request identity survives, no manuscript is persisted.
    await page.reload();
    await page.getByLabel("打开第 1 页：页面 1", { exact: true }).click();
    await page.getByRole("button", { name: "拆分这一页", exact: true }).click();
    await source.click();
    await source.evaluate((el) => {
      el.setSelectionRange(3, 3);
      el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    await expect(page.locator(".split-cursor")).toContainText(
      "第 3 个字符之后",
    );
    await page
      .getByRole("button", { name: "在这里插入分界", exact: true })
      .click();
    await gate(suggestButton, "确认建议分界", splitState);
    assert.equal(
      await page.evaluate(
        () =>
          Object.keys(sessionStorage).filter((key) =>
            key.includes("suggest-split"),
          ).length,
      ),
      0,
    );
    const suggestionCalls = paid.filter((x) => x.entry === "suggest-split");
    assert.equal(suggestionCalls.length, 2);
    const lostId = JSON.parse(suggestionCalls[0].body).requestId;
    assert.match(lostId, /^[\w-]{16,80}$/);
    assert.equal(JSON.parse(suggestionCalls[1].body).requestId, lostId);
    await expect(page.locator(".split-suggestions button")).toHaveCount(2);
    await gate(
      page.getByRole("button", { name: "拆分为 2 页", exact: true }),
      "确认拆分并生成图片",
      async () => {
        await splitState();
        await expect(page.locator(".split-suggestions button")).toHaveCount(2);
      },
    );
    assert.deepEqual(JSON.parse(paid.at(-1).body).cuts, [3]);
    assert.equal(JSON.parse(paid.at(-1).body).generate, true);
    // A successful result retires its request ID; a new suggestion gets a new one.
    await gate(suggestButton, "确认建议分界", splitState);
    assert.notEqual(JSON.parse(paid.at(-1).body).requestId, lostId);
    const beforeFreeSplit = count();
    await page.getByLabel("拆分后在后台生成图片（关闭后可先改稿）").uncheck();
    const freeSplitResponse = page.waitForResponse((r) =>
      new URL(r.url()).pathname.endsWith("/slides/p0/split"),
    );
    await page
      .getByRole("button", { name: "拆分为 2 页", exact: true })
      .click();
    assert.equal((await freeSplitResponse).status(), 200);
    await expect(splitDialog).toHaveCount(0);
    assert.equal(count(), beforeFreeSplit);
    put("project", make("ready", 3));
    await page.goto(base + "/#project/ready/rehearsal");
    await page.reload();
    await page
      .getByRole("button", { name: "打开动态演示", exact: true })
      .click();
    await gate(
      page.getByRole("button", { name: "转换 3 页", exact: true }),
      "确认转换动态演示",
      async () =>
        await expect(
          page.getByRole("button", {
            name: "整个项目 3 页 · 按原页序",
            exact: true,
          }),
        ).toHaveClass(/chosen/),
    );
    assert.deepEqual(JSON.parse(paid.at(-1).body).slideIds, ["p0", "p1", "p2"]);
    await page
      .getByRole("dialog", { name: "动态 HTML 演示", exact: true })
      .getByRole("button", { name: "关闭", exact: true })
      .click();
    const motionDeck = {
      id: "motion-feedback",
      projectId: "ready",
      title: "验收动态演示",
      sourceRevision: read("ready").revision,
      revision: 1,
      createdAt: now,
      status: "partial",
      progress: "还有两页未完成",
      pages: read("ready").slides.map((s, i) => ({
        id: `mp${i}`,
        number: i + 1,
        title: `动态页面 ${i + 1}`,
        source: { image: s.image, notes: s.notes, stale: false },
        status: i === 2 ? "ready" : "failed",
        width: 800,
        height: 450,
        layers: [],
        error: i === 2 ? null : "隔离验收失败画面",
      })),
      customFont: null,
    };
    put("motion", motionDeck);
    await page
      .getByRole("button", { name: "打开动态演示", exact: true })
      .click();
    await page
      .getByRole("navigation", { name: "动态演示页面" })
      .getByRole("button", { name: "第 2 页 失败", exact: true })
      .click();
    const motionState = async () => {
      await expect(
        page.getByRole("combobox", { name: "已保存的演示", exact: true }),
      ).toHaveValue(motionDeck.id);
      await expect(
        page.getByRole("button", { name: "只重试这一页", exact: true }),
      ).toBeVisible();
    };
    const retry = page.getByRole("button", {
      name: "继续未完成页面",
      exact: true,
    });
    await retry.click();
    await expect(
      page.getByRole("dialog", { name: "确认继续转换未完成页面", exact: true }),
    ).toContainText("未完成的 2 页");
    await shot(390, "motion-retry-risk", "rehearsal");
    await page
      .getByRole("dialog", { name: "确认继续转换未完成页面", exact: true })
      .getByRole("button", { name: "取消", exact: true })
      .click();
    await gate(retry, "确认继续转换未完成页面", motionState);
    await gate(
      page.getByRole("button", { name: "只重试这一页", exact: true }),
      "确认重试这一页",
      motionState,
    );
    assert.equal(paid.at(-1).path, "/api/motion/motion-feedback/retry");
    assert.deepEqual(JSON.parse(paid.at(-1).body), { pageIds: ["mp1"] });
    await page
      .getByRole("dialog", { name: "动态 HTML 演示", exact: true })
      .getByRole("button", { name: "关闭", exact: true })
      .click();
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(base + "/#project/ready/studio");
    await page.locator(".slide-card").first().locator(".slide-image").click();
    const notes = page.getByLabel("本页逐字稿", { exact: true });
    const beforeNotes = await notes.inputValue();
    const single = page.getByRole("button", {
      name: "重新设计这页",
      exact: true,
    });
    const beforeSingle = count();
    await single.click();
    await page.getByRole("button", { name: "返回修改", exact: true }).click();
    assert.equal(count(), beforeSingle);
    await expect(notes).toHaveValue(beforeNotes);
    await single.click();
    await page
      .getByRole("button", { name: "确认重新设计", exact: true })
      .evaluate((el) => {
        el.click();
        el.click();
      });
    await expect.poll(count).toBe(beforeSingle + 1);
    await page.getByRole("button", { name: "返回修改", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "关闭", exact: true })
      .click();
    const batch = page.getByRole("button", { name: "重新设计", exact: true });
    const beforeBatch = count();
    await batch.click();
    await page.getByRole("button", { name: "取消", exact: true }).click();
    assert.equal(count(), beforeBatch);
    await batch.click();
    await page
      .getByRole("button", { name: "开始重新设计 3 页", exact: true })
      .evaluate((el) => {
        el.click();
        el.click();
      });
    await expect.poll(count).toBe(beforeBatch + 1);
    await page.getByRole("button", { name: "取消", exact: true }).click();
    // Style generation keeps source images and name on cancellation.
    await page.goto(base + "/#styles");
    await page.getByRole("button", { name: "创建风格", exact: true }).click();
    await page.getByRole("button", { name: "从网址获取", exact: true }).click();
    await page.getByLabel("风格名称", { exact: true }).fill("网址参考风格");
    await page
      .getByRole("textbox", { name: "作品网址", exact: true })
      .fill("https://example.com/reference");
    await page.getByRole("button", { name: "获取图片", exact: true }).click();
    await page.getByLabel("选择第 1 张参考图", { exact: true }).check();
    await gate(
      page.getByRole("button", { name: "保存并提炼风格", exact: true }),
      "确认生成视觉风格",
      async () => {
        await expect(
          page.getByLabel("选择第 1 张参考图", { exact: true }),
        ).toBeChecked();
        await expect(
          page.getByRole("textbox", { name: "作品网址", exact: true }),
        ).toHaveValue("https://example.com/reference");
      },
    );
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "关闭", exact: true })
      .click();
    await page.getByRole("button", { name: "创建风格", exact: true }).click();
    await page.getByRole("button", { name: "上传图片", exact: true }).click();
    await page.getByLabel("风格名称", { exact: true }).fill("取消后保留的风格");
    await page.getByRole("dialog").locator("input[type=file]").setInputFiles({
      name: "reference.png",
      mimeType: "image/png",
      buffer: png,
    });
    await gate(
      page.getByRole("button", { name: "保存并提炼风格", exact: true }),
      "确认生成视觉风格",
      async () => {
        await expect(page.getByLabel("风格名称", { exact: true })).toHaveValue(
          "取消后保留的风格",
        );
        await expect(page.locator(".upload-previews img")).toHaveCount(1);
      },
    );
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "关闭", exact: true })
      .click();
    await page
      .getByRole("article")
      .filter({
        has: page.getByRole("heading", { name: "验收参考风格", exact: true }),
      })
      .getByRole("button", { name: "查看风格", exact: true })
      .click();
    const refinement = page.getByLabel("风格调整要求");
    await refinement.fill("增加留白");
    await gate(
      page.getByRole("button", { name: "重新提炼风格", exact: true }),
      "确认重新提炼风格",
      async () => await expect(refinement).toHaveValue("增加留白"),
    );
    put("trial", {
      id: "trial-fixture",
      styleId: "feedback-style",
      status: "failed",
      engine: "image",
      notes: "保留的试做原稿",
      styleSnapshot: { rules: "保持留白和清晰文字。" },
      jobId: "trial-job",
      createdAt: now,
    });
    await page
      .getByRole("button", { name: "生成一页 demo / 调试风格", exact: true })
      .click();
    await gate(
      page.getByRole("button", { name: "继续这版试做", exact: true }),
      "确认继续风格试做",
    );
    await gate(
      page.getByRole("button", { name: "生成统一封面", exact: true }),
      "确认生成风格封面",
    );
    await gate(
      page.getByRole("button", { name: "生成图片试做", exact: true }),
      "确认生成风格试做",
    );
    await page.getByLabel("内容倾向（可选）", { exact: true }).fill("内部分享");
    await page.locator(".audience-details summary").click();
    await gate(
      page.getByRole("button", { name: "AI 完善说明", exact: true }),
      "确认细化内容倾向",
      async () =>
        await expect(
          page.getByLabel("内容倾向（可选）", { exact: true }),
        ).toHaveValue("内部分享"),
    );
    // Speech resources use their own confirmation even after direct manuscript submission.
    await page.goto(base + "/#project/ready/rehearsal");
    await page
      .getByRole("button", { name: "打开演讲播放器", exact: true })
      .click();
    await page.getByRole("tab", { name: "2 · 演讲表达", exact: true }).click();
    await gate(
      page.getByRole("button", { name: "AI 编排整场演讲", exact: true }),
      "确认编排整场演讲",
    );
    await page.getByRole("tab", { name: "3 · 声音制作", exact: true }).click();
    await gate(
      page.getByRole("button", { name: "试听本页开头", exact: true }),
      "确认试听本页开头",
    );
    await gate(
      page.getByRole("button", { name: "生成整场口播 · 3 页", exact: true }),
      "确认生成整场口播",
    );
    await page.getByRole("button", { name: "关闭演讲播放器" }).click();
    await page.goto(base + "/#settings");
    await page.locator(".voice-capture summary").click();
    const wav = Buffer.alloc(44 + 16000 * 12 * 2);
    wav.write("RIFF");
    wav.writeUInt32LE(wav.length - 8, 4);
    wav.write("WAVEfmt ", 8);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(16000, 24);
    wav.writeUInt32LE(32000, 28);
    wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34);
    wav.write("data", 36);
    wav.writeUInt32LE(wav.length - 44, 40);
    await page.getByLabel("上传演讲者录音").setInputFiles({
      name: "sample.wav",
      mimeType: "audio/wav",
      buffer: wav,
    });
    await page.locator(".voice-capture input[type=checkbox]").check();
    await gate(
      page.getByRole("button", { name: "创建我的声音", exact: true }),
      "确认创建我的声音",
      async () => await expect(page.getByLabel("原始录音试听")).toBeVisible(),
    );
    await page.goto(base + "/#project/ready/rehearsal");
    put("narration", {
      id: "narration-fixture",
      projectId: "ready",
      title: "保留的口播",
      sourceRevision: read("ready").revision,
      status: "failed",
      progress: "隔离口播未完成",
      voiceName: "测试音色",
      options: SPEECH_DEFAULTS,
      createdAt: now,
      pages: read("ready").slides.map((s, i) => ({
        ...s,
        number: i + 1,
        title: s.plan.title,
        emotion: "auto",
        clips: [],
        status: "failed",
      })),
    });
    await page
      .getByRole("button", { name: "打开演讲播放器", exact: true })
      .click();
    await gate(
      page.getByRole("button", { name: "继续未完成的页面", exact: true }),
      "确认继续生成口播",
    );
    await page.getByRole("button", { name: "关闭演讲播放器" }).click();
    // New presenter adapter remains explicitly unavailable in production.
    const presenterRegion = page.getByRole("region", {
      name: "数字人讲解员",
      exact: true,
    });
    await expect(
      presenterRegion.locator('[data-feedback="blocking"]'),
    ).toContainText("尚未接入");
    await expect(
      presenterRegion.getByRole("button", { name: "生成数字人", exact: true }),
    ).toBeDisabled();
    put("avatar", {
      id: "integration-avatar",
      name: "整合头像",
      sourceAsset: "fixture.png",
      previewAsset: "fixture.png",
      kind: "photo",
      provider: "unconfigured",
      createdAt: now,
      updatedAt: now,
    });
    put("narration", {
      id: "integration-voice",
      projectId: "ready",
      voiceName: "隔离口播",
      sourceRevision: read("ready").revision,
      status: "ready",
      pages: [],
      createdAt: now,
    });
    presenterFixture = { configured: true, testOnly: true, versions: [] };
    await page.reload();
    await presenterRegion
      .getByLabel("数字人头像", { exact: true })
      .selectOption("integration-avatar");
    await presenterRegion
      .getByLabel("数字人口播版本", { exact: true })
      .selectOption("integration-voice");
    const presenterGate = async (label, path) => {
      const before = paid.length;
      const entry = presenterRegion.getByRole("button", {
        name: label,
        exact: true,
      });
      await entry.click();
      const dialog = page.getByRole("dialog", {
        name: "确认生成数字人",
        exact: true,
      });
      await expect(dialog.locator('[data-feedback="risk"]')).toContainText(
        "所选头像",
      );
      await dialog.getByRole("button", { name: "取消", exact: true }).click();
      assert.equal(paid.length, before);
      await expect(
        presenterRegion.getByLabel("数字人头像", { exact: true }),
      ).toHaveValue("integration-avatar");
      await entry.click();
      await dialog
        .getByRole("button", { name: "确认并生成", exact: true })
        .evaluate((el) => {
          el.click();
          el.click();
        });
      await expect.poll(() => paid.length).toBe(before + 1);
      assert.equal(paid.at(-1).path, path);
      await expect(dialog.getByRole("alert")).toContainText("未调用付费模型");
      await dialog.getByRole("button", { name: "取消", exact: true }).click();
    };
    await presenterGate("生成数字人", "/api/projects/ready/presenter");
    const pendingId = JSON.parse(paid.at(-1).body).requestId;
    await page.reload();
    await presenterGate("生成数字人", "/api/projects/ready/presenter");
    assert.equal(
      JSON.parse(paid.at(-1).body).requestId,
      pendingId,
      "lost result retains request identity across remount",
    );
    presenterFixture.versions = [
      {
        id: "integration-presenter",
        narrationId: "integration-voice",
        avatarId: "integration-avatar",
        status: "partial",
        progress: "失败页待重试",
        current: false,
        provider: "mock",
        placement: "bottom-right",
        size: "small",
        createdAt: now,
        pages: [{ pageId: "p0", status: "failed", stale: false }],
      },
    ];
    await page.reload();
    await presenterGate(
      "确认继续 / 重试失败页",
      "/api/presenter/integration-presenter/retry",
    );
    presenterFixture = null;
    assert.equal(paid.filter((x) => x.path.endsWith("/render")).length, 2);
    assert.equal(paid.filter((x) => x.path.endsWith("/trials")).length, 2);
    hosted = true;
    await page.goto(base + "/#project/ready");
    await page.reload();
    await expect(page.locator(".workspace .btn.primary:visible")).toHaveText(
      "检查交付",
    );
    await area("演练中心");
    await expect(
      page.getByText("当前平台未开放标准放映", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "开始演练", exact: true }),
    ).toHaveCount(0);
    await area("制作台");
    await page.getByRole("button", { name: "重新设计", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText(
      "管理员提供的图片额度",
    );
    assert(
      !/API Key|服务商|费用|本机|\/Users\//.test(
        await page.getByRole("dialog").innerText(),
      ),
    );
    await page.getByRole("button", { name: "取消", exact: true }).click();
    await area("交付中心");
    await page
      .getByRole("button", { name: "导出项目源文件", exact: true })
      .click();
    assert(
      !/API Key|服务商|\/Users\/|\.local/.test(
        await page.getByRole("dialog").innerText(),
      ),
    );
    for (const { name: entry } of modelRouteContract.filter(
      (route) => route.requiredUi !== false,
    ))
      assert(
        paid.some((x) => x.entry === entry),
        `missing paid-entry coverage: ${entry}`,
      );
    assert.equal(
      paid.filter((x) => x.entry === "palette-server-helper").length,
      0,
      "the server-only palette helper must not become an unconfirmed UI action",
    );
    writeFileSync(
      path.join(evidence, "paid-requests.json"),
      JSON.stringify(
        paid.map(({ entry, path }) => ({ entry, path })),
        null,
        2,
      ),
    );
    assert.deepEqual(errors, []);
  },
);
