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
      const output = observing
        ? observationsFixture(count)
        : rejectCreation
          ? { rules: "不完整结果" }
          : creationFixture();
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
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(base + "/#styles");
    await page.getByRole("button", { name: "创建风格", exact: true }).click();
    await page
      .getByPlaceholder("例如：克制的杂志感 / 大字与留白")
      .fill("暖纸风格创作验收");
    await page.getByRole("button", { name: "上传图片", exact: true }).click();
    await expect(
      page.getByText("先逐图分析，再生成完整的风格规范", { exact: false }),
    ).toBeVisible();
    const image = await sharp({
      create: { width: 800, height: 450, channels: 3, background: "#f4ebdd" },
    })
      .png()
      .toBuffer();
    await page
      .locator('input[type="file"]')
      .setInputFiles({
        name: "reference.png",
        mimeType: "image/png",
        buffer: image,
      });
    await page.getByRole("button", { name: "保存并提炼风格" }).click();
    await expect(
      page.getByText("第2步 / 共2步：根据图片特点，设计完整的新风格规范", {
        exact: true,
      }),
    ).toBeVisible({ timeout: 15000 });
    holdCreation = false;
    releaseCreation();
    await expect(page.locator(".rules-text")).toContainText(
      "十二、设计自检与效果标准",
      { timeout: 15000 },
    );
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
    assert.deepEqual(errors, []);
    console.log(`Style creation UI screenshots: ${qa}`);
  },
);
