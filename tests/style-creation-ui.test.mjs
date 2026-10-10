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
    await page.getByText("使用场景与补充要求（可选）", { exact: true }).click();
    await page.getByLabel("行业", { exact: true }).fill("文学教学");
    await page.getByLabel("希望避免", { exact: true }).fill("科技 HUD");
    await page
      .getByRole("button", { name: "分析视觉风格", exact: true })
      .click();
    await expect(
      page.getByText("第2步：生成风格 A 的完整提示词（1 / 1）", {
        exact: true,
      }),
    ).toBeVisible({ timeout: 15000 });
    holdCreation = false;
    releaseCreation();
    await expect(page.locator(".rules-text")).toContainText(
      "十九、最终效果标准",
      { timeout: 15000 },
    );
    await expect(page.getByText("核心视觉 DNA", { exact: true })).toBeVisible();
    await page
      .getByRole("button", { name: "复制完整提示词", exact: true })
      .click();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    assert.match(copied, /【风格锁定】/);
    assert.match(copied, /【四级风格规则】/);
    assert.match(copied, /没有数据，不伪造数据图表/);
    await page.getByText("查看参考图分析与创作依据", { exact: true }).click();
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
    assert.equal(style.analysisContext.industry, "文学教学");
    assert.equal(style.analysisContext.avoid, "科技 HUD");
    const versions = await (
      await fetch(base + `/api/styles/${style.id}/versions`)
    ).json();
    rejectCreation = true;
    await page.getByLabel("风格调整要求").fill("保留纸张的真实感");
    await page
      .getByRole("button", { name: "重新提炼风格", exact: true })
      .click();
    await expect(
      page.getByText("新风格的设计规范不完整", { exact: false }).first(),
    ).toBeVisible({ timeout: 15000 });
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
    await page
      .locator('input[type="file"]')
      .setInputFiles({
        name: "second.png",
        mimeType: "image/png",
        buffer: image,
      });
    await expect(page.getByAltText("参考图 2", { exact: true })).toBeVisible();
    await page
      .getByRole("button", { name: "重新提炼风格", exact: true })
      .click();
    const result = page.getByRole("region", { name: "视觉风格提示词生成结果" });
    await expect(result.getByRole("button", { name: /STYLE B/ })).toBeVisible({
      timeout: 15000,
    });
    await result.getByRole("button", { name: /STYLE B/ }).click();
    await expect(
      result.getByRole("heading", { name: "第二组暖纸叙事风", exact: true }),
    ).toBeVisible();
    const mixedBootstrap = await (await fetch(base + "/api/bootstrap")).json();
    const mixedStyle = mixedBootstrap.styles.find((s) => s.id === style.id);
    const candidate = mixedStyle.styleAnalysis.styles[1];
    await result
      .getByRole("button", { name: "复制完整提示词", exact: true })
      .click();
    assert.equal(
      await page.evaluate(() => navigator.clipboard.readText()),
      candidate.rules,
    );
    // Merely previewing B must not change the active prompt.
    assert.equal(mixedStyle.rules, mixedStyle.styleAnalysis.styles[0].rules);
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
      result.getByRole("button", { name: /STYLE B.*当前采用/ }),
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
    await result.getByText("四级风格规则", { exact: true }).click();
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
    await expect(
      result.getByText("当前正式提示词", { exact: true }),
    ).toBeVisible();
    await expect(result.locator(".rules-text")).toHaveText(custom);
    assert.deepEqual(errors, []);
    console.log(`Style creation UI screenshots: ${qa}`);
  },
);
