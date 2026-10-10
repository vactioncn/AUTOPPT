import test from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import sharp from "sharp";
import { chromium } from "playwright-core";
import { expect } from "@playwright/test";
import {
  observationsFixture,
  creationFixture,
} from "./fixtures/style-creation.mjs";

test(
  "reference upload exposes two-stage creation, detailed evidence and retains saved rules after failed refinement",
  {
    skip: !process.env.BROWSER_TEST,
    timeout: 60000,
  },
  async (t) => {
    const dir = mkdtempSync(
      path.join(os.tmpdir(), "autoppt-style-creation-ui-"),
    );
    const qa = mkdtempSync(
      path.join(os.tmpdir(), "autoppt-style-creation-qa-"),
    );
    const provider = express();
    provider.use(express.json({ limit: "20mb" }));
    const requests = [];
    let rejectCreation = false,
      releaseCreation;
    let holdCreation = true;
    let mixed = false;
    provider.post("/v1/chat/completions", async (req, res) => {
      const system = req.body.messages[0].content;
      const content = req.body.messages[1].content;
      const count = content.filter((c) => c.type === "image_url").length;
      requests.push({ system, count });
      const observing = system.includes("本阶段只做参考图视觉观察");
      if (!observing && holdCreation)
        await new Promise((resolve) => {
          releaseCreation = resolve;
        });
      const observation = observationsFixture(count);
      if (mixed && observing) {
        observation.relation = "mixed";
        observation.groups = [1, 2].map((n) => ({
          references: [n],
          rationale: "两组的视觉系统相互独立，分别提炼而不平均混合。",
        }));
        observation.sharedTraits = observation.groups.map((group) => ({
          trait: "本组材料和排版形成独立系统，应保留设计逻辑与使用边界。",
          references: group.references,
        }));
      }
      const creation = creationFixture();
      const input = JSON.parse(content[0].text);
      if (mixed && !observing && input.group.references.includes(2)) {
        creation.nameCn = "第二组暖纸叙事风";
        creation.nameEn = "Second Independent Editorial";
      }
      const output = observing
        ? observation
        : rejectCreation
          ? { rules: "不完整结果" }
          : creation;
      res.json({ choices: [{ message: { content: JSON.stringify(output) } }] });
    });
    const mock = provider.listen(0, "127.0.0.1");
    await once(mock, "listening");
    const child = fork("server/index.mjs", [], {
      silent: true,
      env: {
        ...process.env,
        NODE_ENV: "production",
        PORT: "0",
        AUTOPPT_DATA_DIR: dir,
        AUTOPPT_DESKTOP_TOKEN: "",
      },
    });
    let browser;
    t.after(async () => {
      releaseCreation?.();
      await browser?.close();
      child.kill();
      await new Promise((resolve) => mock.close(resolve));
      rmSync(dir, { recursive: true, force: true });
    });
    const [message] = await once(child, "message");
    const base = `http://127.0.0.1:${message.port}`;
    const settings = await fetch(base + "/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: {
          baseUrl: `http://127.0.0.1:${mock.address().port}/v1`,
          apiKey: "test-only",
          model: "mock",
        },
      }),
    });
    assert(settings.ok);
    browser = await chromium.launch({
      headless: true,
      executablePath:
        process.env.CHROMIUM_EXECUTABLE ||
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    });
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1050 },
    });
    await page
      .context()
      .grantPermissions(["clipboard-read", "clipboard-write"], {
        origin: base,
      });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const actionsStayVisible = async (width, height) => {
      await page.setViewportSize({ width, height });
      const dialog = page.locator(".style-detail-modal");
      const before = await dialog.locator(".style-detail-footer").boundingBox();
      assert(
        before && before.y >= 0 && before.y + before.height <= height + 1,
        "footer stays inside the visible window",
      );
      for (const button of await dialog
        .locator(".style-detail-footer button")
        .all()) {
        const box = await button.boundingBox();
        assert(
          box &&
            box.x >= 0 &&
            box.y >= 0 &&
            box.x + box.width <= width + 1 &&
            box.y + box.height <= height + 1,
          "every action is visible without scrolling",
        );
      }
      const body = await dialog.locator(".style-detail-content").boundingBox();
      assert(
        body.height >= 128,
        "content remains usable with persistent actions",
      );
      await dialog
        .getByRole("region", { name: "风格概览与高级设置", exact: true })
        .press("End");
      const after = await dialog.locator(".style-detail-footer").boundingBox();
      assert.equal(
        after.y,
        before.y,
        "browsing long results never moves the actions",
      );
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        "no horizontal window overflow",
      );
      assert.equal(
        await dialog
          .locator(".style-preview img")
          .evaluate((img) => getComputedStyle(img).objectFit),
        "contain",
        "the complete reference image remains visible",
      );
    };
    await page.goto(base + "/#styles");
    await page.getByRole("button", { name: "创建风格", exact: true }).click();
    await page
      .getByPlaceholder("例如：克制的杂志感 / 大字与留白")
      .fill("暖纸风格创作验收");
    await page.getByRole("button", { name: "上传图片", exact: true }).click();
    await expect(
      page.getByText("先逐图分析，再判断共同视觉 DNA", { exact: false }),
    ).toBeVisible();
    const image = await sharp({
      create: { width: 800, height: 450, channels: 3, background: "#f4ebdd" },
    })
      .png()
      .toBuffer();
    await page.locator('input[type="file"]').setInputFiles({
      name: "reference.png",
      mimeType: "image/png",
      buffer: image,
    });
    await page.getByText("视觉补充要求（可选）", { exact: true }).click();
    await page.getByLabel("希望强化", { exact: true }).fill("纸张质感");
    await expect(page.getByLabel("行业", { exact: true })).toHaveCount(0);
    await expect(page.getByLabel("受众", { exact: true })).toHaveCount(0);
    await expect(page.getByLabel("内容主题", { exact: true })).toHaveCount(0);
    await page.getByLabel("希望避免", { exact: true }).fill("科技 HUD");
    await page
      .getByRole("button", { name: "分析视觉风格", exact: true })
      .click();
    await expect(
      page.getByText("第2步：生成风格 A 的完整提示词（1 / 1）", {
        exact: true,
      }),
    ).toBeVisible({ timeout: 15000 });
    for (const [width, height] of [
      [1360, 900],
      [960, 680],
      [390, 844],
      [640, 480],
    ])
      await actionsStayVisible(width, height);
    holdCreation = false;
    releaseCreation();
    await expect(
      page.getByRole("heading", { name: "已保存到风格库", exact: true }),
    ).toBeVisible({ timeout: 15000 });
    await expect(page.locator(".rules-text")).toBeHidden();
    await page.getByText("高级设置", { exact: true }).click();
    await expect(page.locator(".rules-text")).toContainText(
      "十九、最终效果标准",
      { timeout: 15000 },
    );
    await expect(page.getByText("核心视觉 DNA", { exact: true })).toHaveCount(
      0,
    );
    await expect(
      page.getByRole("tab", { name: "提示词", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    for (const [width, height] of [
      [1360, 900],
      [960, 680],
      [390, 844],
      [640, 480],
    ])
      await actionsStayVisible(width, height);
    await page.setViewportSize({ width: 1360, height: 900 });
    await page
      .getByRole("button", { name: "复制完整提示词", exact: true })
      .click();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    assert.match(copied, /【风格锁定】/);
    assert.match(copied, /【四级风格规则】/);
    assert.match(copied, /没有数据，不伪造数据图表/);
    await page.getByRole("tab", { name: "分析记录", exact: true }).click();
    await page.getByText("查看风格判断与提炼要点", { exact: true }).click();
    await expect(page.getByText("核心视觉 DNA", { exact: true })).toBeVisible();
    await expect(
      page.getByText("新风格的设计取舍", { exact: true }),
    ).toBeVisible();
    await page.getByText("参考图 1 · 暖纸手绘 1", { exact: true }).click();
    await expect(page.getByText("材质与光影", { exact: true })).toBeVisible();
    await expect(
      page.getByText(observationsFixture().referenceProfiles[0].texture, {
        exact: true,
      }),
    ).toBeVisible();
    assert.deepEqual(
      requests.map((r) => r.count),
      [1, 0],
    );
    for (const [name, width, height] of [
      ["desktop", 1440, 1050],
      ["mobile", 390, 844],
    ]) {
      await page.setViewportSize({ width, height });
      await page
        .getByText("参考图 1 · 暖纸手绘 1", { exact: true })
        .scrollIntoViewIfNeeded();
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      );
      await page.screenshot({ path: path.join(qa, `${name}.png`) });
    }
    const bootstrap = await (await fetch(base + "/api/bootstrap")).json();
    const style = bootstrap.styles.find((s) => s.name === "暖纸风格创作验收");
    assert.equal(style.analysisContext.industry, "");
    assert.equal(style.analysisContext.strengthen, "纸张质感");
    assert.equal(style.analysisContext.avoid, "科技 HUD");
    const versions = await (
      await fetch(base + `/api/styles/${style.id}/versions`)
    ).json();
    rejectCreation = true;
    await page.getByText("调整视觉风格（可选）", { exact: true }).click();
    await page.getByLabel("风格调整要求").fill("保留纸张的真实感");
    const countBeforeDraft = requests.length;
    await expect(
      page.getByRole("status").filter({ hasText: "调整草稿已自动保存在本机" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "关闭", exact: true }).click();
    await page
      .locator(".style-card")
      .filter({ hasText: style.name })
      .getByRole("button", { name: "查看风格", exact: true })
      .click();
    await expect(page.locator(".rules-text")).toBeHidden();
    await page.getByText("调整视觉风格（可选）", { exact: true }).click();
    await expect(page.getByLabel("风格调整要求")).toHaveValue(
      "保留纸张的真实感",
    );
    assert.equal(
      requests.length,
      countBeforeDraft,
      "Saving a visual draft must not call a model",
    );
    await page.getByText("高级设置", { exact: true }).click();
    await page
      .getByRole("button", { name: "重新提炼风格", exact: true })
      .click();
    await expect(
      page.getByText("新风格的设计规范不完整", { exact: false }).first(),
    ).toBeVisible({ timeout: 15000 });
    await page.getByRole("tab", { name: "提示词", exact: true }).click();
    await expect(page.locator(".rules-text")).toHaveText(style.rules);
    const after = await (await fetch(base + "/api/bootstrap")).json();
    const saved = after.styles.find((s) => s.id === style.id);
    assert.equal(saved.status, "ready");
    assert.equal(saved.rules, style.rules);
    assert.deepEqual(saved.styleAnalysis, style.styleAnalysis);
    assert.deepEqual(
      await (await fetch(base + `/api/styles/${style.id}/versions`)).json(),
      versions,
    );
    rejectCreation = false;
    mixed = true;
    await page.locator('input[type="file"]').setInputFiles({
      name: "second.png",
      mimeType: "image/png",
      buffer: image,
    });
    await expect(page.getByAltText("参考图 2", { exact: true })).toBeVisible();
    await page
      .getByRole("button", { name: "重新提炼风格", exact: true })
      .click();
    await page.getByRole("tab", { name: "分析记录", exact: true }).click();
    const result = page.getByRole("region", { name: "视觉风格提示词生成结果" });
    await expect(result.getByRole("button", { name: /风格 B/ })).toBeVisible({
      timeout: 15000,
    });
    await result.getByRole("button", { name: /风格 B/ }).click();
    await expect(
      result.getByRole("heading", { name: "第二组暖纸叙事风", exact: true }),
    ).toBeVisible();
    const mixedBootstrap = await (await fetch(base + "/api/bootstrap")).json();
    const mixedStyle = mixedBootstrap.styles.find((s) => s.id === style.id);
    const candidate = mixedStyle.styleAnalysis.styles[1];
    await result
      .getByRole("button", { name: "复制这组分析提示词", exact: true })
      .click();
    assert.equal(
      await page.evaluate(() => navigator.clipboard.readText()),
      candidate.rules,
    );
    // Merely previewing B must not change the active prompt.
    assert.equal(mixedStyle.rules, mixedStyle.styleAnalysis.styles[0].rules);
    await page.getByRole("tab", { name: "提示词", exact: true }).click();
    await page
      .getByRole("button", { name: "复制完整提示词", exact: true })
      .click();
    assert.equal(
      await page.evaluate(() => navigator.clipboard.readText()),
      mixedStyle.rules,
    );
    await page.getByRole("tab", { name: "分析记录", exact: true }).click();
    await result.getByRole("button", { name: /风格 B/ }).click();
    const selectRequest = (body) =>
      fetch(base + `/api/styles/${style.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    assert.equal(
      (
        await selectRequest({
          analysisStyleId: candidate.id,
          analysisId: "stale",
          expectedVersion: mixedStyle.versionToken,
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await selectRequest({
          analysisStyleId: candidate.id,
          analysisId: mixedStyle.styleAnalysis.id,
          expectedVersion: "stale",
        })
      ).status,
      409,
    );
    await result
      .getByRole("button", { name: "采用这组风格", exact: true })
      .click();
    await expect(
      result.getByRole("button", { name: /风格 B.*当前采用/ }),
    ).toBeVisible();
    const adopted = (
      await (await fetch(base + "/api/bootstrap")).json()
    ).styles.find((s) => s.id === style.id);
    assert.equal(adopted.rules, candidate.rules);
    assert.deepEqual(adopted.colors, candidate.colors);
    assert.equal(adopted.name, "暖纸风格创作验收");
    const newVersions = await (
      await fetch(base + `/api/styles/${style.id}/versions`)
    ).json();
    assert(newVersions.versions.some((v) => v.rules === mixedStyle.rules));
    assert.equal(newVersions.versions[0].rules, candidate.rules);
    await result.getByText("查看风格判断与提炼要点", { exact: true }).click();
    for (const [name, width, height] of [
      ["results-desktop", 1440, 1050],
      ["results-mobile", 390, 844],
    ]) {
      await page.setViewportSize({ width, height });
      await result.scrollIntoViewIfNeeded();
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      );
      await page.screenshot({ path: path.join(qa, `${name}.png`) });
    }
    // Auto naming is optional for references, while manual prompts still need a name.
    const unnamed = new FormData();
    unnamed.append(
      "images",
      new Blob([image], { type: "image/png" }),
      "unnamed.png",
    );
    mixed = false;
    const unnamedResponse = await fetch(base + "/api/styles", {
      method: "POST",
      body: unnamed,
    });
    assert.equal(unnamedResponse.status, 201);
    const unnamedStyle = (await unnamedResponse.json()).style;
    await expect
      .poll(
        async () =>
          (await (await fetch(base + "/api/bootstrap")).json()).styles.find(
            (s) => s.id === unnamedStyle.id,
          )?.name,
      )
      .toBe("暖纸水彩叙事编辑风");
    // A hand-edited prompt remains the production source, with analysis marked as a record.
    const custom = candidate.rules + "\n用户自行调整的正文";
    assert.equal(
      (
        await selectRequest({
          rules: custom,
          expectedVersion: adopted.versionToken,
        })
      ).status,
      200,
    );
    await page.getByRole("tab", { name: "提示词", exact: true }).click();
    await expect(page.locator(".rules-text")).toHaveText(custom);
    await page
      .getByRole("button", { name: "复制完整提示词", exact: true })
      .click();
    assert.equal(
      await page.evaluate(() => navigator.clipboard.readText()),
      custom,
    );
    const modelRequestsBeforeEditing = requests.length;
    await page.getByRole("button", { name: "手动调整", exact: true }).click();
    const draft = custom + "\n尚未保存的草稿  ";
    await page.getByRole("textbox", { name: "风格设计规则" }).fill(draft);
    await page.getByRole("tab", { name: "分析记录", exact: true }).click();
    await expect(
      result.getByRole("button", { name: "采用这组风格", exact: true }),
    ).toBeDisabled();
    await page.getByRole("tab", { name: "提示词", exact: true }).click();
    await expect(
      page.getByRole("textbox", { name: "风格设计规则" }),
    ).toHaveValue(draft);
    await page.getByRole("button", { name: "取消编辑", exact: true }).click();
    await expect(page.locator(".rules-text")).toHaveText(custom);
    await page
      .getByRole("tab", { name: "提示词", exact: true })
      .press("ArrowRight");
    await expect(
      page.getByRole("tab", { name: "分析记录", exact: true }),
    ).toBeFocused();
    await expect(
      result.getByText("当前提示词已手动调整或恢复版本。", { exact: false }),
    ).toBeVisible();
    await page.getByRole("tab", { name: "历史版本", exact: true }).click();
    await expect(page.getByLabel("选择提示词版本")).toBeVisible();
    const latestVersions = await (
      await fetch(base + `/api/styles/${style.id}/versions`)
    ).json();
    const originalVersion = latestVersions.versions.find(
      (v) => v.rules === mixedStyle.rules,
    );
    await page.getByLabel("选择提示词版本").selectOption(originalVersion.id);
    await page.getByRole("button", { name: "恢复此版本", exact: true }).click();
    await expect
      .poll(
        async () =>
          (await (await fetch(base + "/api/bootstrap")).json()).styles.find(
            (s) => s.id === style.id,
          ).rules,
      )
      .toBe(mixedStyle.rules);
    await page.getByRole("tab", { name: "提示词", exact: true }).click();
    await expect(page.locator(".rules-text")).toHaveText(mixedStyle.rules);
    await page
      .getByRole("button", { name: "复制完整提示词", exact: true })
      .click();
    assert.equal(
      await page.evaluate(() => navigator.clipboard.readText()),
      mixedStyle.rules,
    );
    assert.equal(
      requests.length,
      modelRequestsBeforeEditing,
      "browsing, copying, editing drafts and restoring never calls a model",
    );
    assert.deepEqual(errors, []);
    console.log(`Style creation UI screenshots: ${qa}`);
  },
);
