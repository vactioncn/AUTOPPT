import test from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import os from "node:os";
import path from "node:path";
import express from "express";
import sharp from "sharp";
import { chromium } from "playwright-core";
import { STYLE_COVER, STYLE_COVER_NOTES } from "../shared/style-demo.mjs";

test(
  "unified cover UI keeps draft inputs, detects an old server and auto-publishes one image",
  { skip: !process.env.BROWSER_TEST, timeout: 60000 },
  async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "autoppt-cover-ui-"));
    const provider = express();
    provider.use(express.json());
    const image = await sharp({
      create: { width: 960, height: 540, channels: 3, background: "#d9deca" },
    })
      .png()
      .toBuffer();
    const requests = [];
    provider.post("/v1/images/generations", (req, res) => {
      requests.push(req.body);
      res.json({ data: [{ b64_json: image.toString("base64") }] });
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
    try {
      const [message] = await once(child, "message");
      const base = `http://127.0.0.1:${message.port}`;
      const write = async (p, body, method = "POST") => {
        const r = await fetch(base + "/api" + p, {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        assert(r.ok, await r.clone().text());
        return r.json();
      };
      await write(
        "/settings",
        {
          image: {
            baseUrl: `http://127.0.0.1:${mock.address().port}/v1`,
            apiKey: "test-only",
            model: "mock",
          },
        },
        "PUT",
      );
      const { style } = await write("/styles", {
        name: "统一封面测试",
        rules: "保持自由排版的简洁风格。",
      });
      browser = await chromium.launch({
        headless: true,
        executablePath:
          process.env.CHROMIUM_EXECUTABLE ||
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      });
      const page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
      });
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(base + "/#styles");
      await page
        .locator(".style-card")
        .filter({ hasText: style.name })
        .getByRole("button", { name: "查看风格" })
        .click();
      await page.getByRole("button", { name: "试做一页" }).click();
      const draft = page.getByLabel("试做讲稿", { exact: true });
      await draft.fill("保留这段尚未生成的试做草稿。");
      await page.getByRole("tab", { name: "调整效果", exact: true }).click();
      await page
        .getByLabel("画面调整（可选）")
        .fill("不能混进封面请求的临时要求");
      await page.getByRole("tab", { name: "试做内容", exact: true }).click();
      assert.equal(
        await page
          .getByRole("button", { name: "将这张图设为风格封面" })
          .count(),
        0,
      );
      await page.route("**/api/bootstrap", async (route) => {
        const response = await route.fetch();
        const data = await response.json();
        delete data.features.unifiedStyleCover;
        await route.fulfill({ response, json: data });
      });
      await page.getByText("风格封面", { exact: true }).click();
      await page
        .getByRole("button", { name: "生成统一封面", exact: true })
        .click();
      await page
        .getByRole("alert")
        .filter({ hasText: "当前后台还是旧版本" })
        .waitFor();
      assert.equal(requests.length, 0);
      await page.unroute("**/api/bootstrap");
      await page
        .getByRole("button", { name: "生成统一封面", exact: true })
        .click();
      await page.getByText("已更新为风格封面", { exact: false }).waitFor();
      assert.equal(await draft.inputValue(), "保留这段尚未生成的试做草稿。");
      assert.equal(
        await page.getByLabel("画面调整（可选）").inputValue(),
        "不能混进封面请求的临时要求",
      );
      assert.equal(requests.length, 1);
      assert.equal(requests[0].n, 1);
      assert(requests[0].prompt.includes(STYLE_COVER.title));
      assert(!requests[0].prompt.includes("不能混进"));
      const trials = await (
        await fetch(base + `/api/styles/${style.id}/trials`)
      ).json();
      assert.equal(trials.trials[0].notes, STYLE_COVER_NOTES);
      assert.deepEqual(trials.trials[0].plan.displayText, [
        STYLE_COVER.title,
        STYLE_COVER.subtitle,
      ]);
      const bootstrap = await (await fetch(base + "/api/bootstrap")).json();
      assert.equal(
        bootstrap.styles.find((s) => s.id === style.id).cover,
        trials.trials[0].image,
      );
      // Simulate a previously accepted portrait image. It must remain visible
      // in full, with a warning, without stretching the presentation preview.
      const legacy = trials.trials[0];
      legacy.image = "legacy-portrait.png";
      delete legacy.plan.imageResponse;
      writeFileSync(
        path.join(dir, "assets", legacy.image),
        await sharp({
          create: {
            width: 1024,
            height: 1536,
            channels: 3,
            background: "#d9deca",
          },
        })
          .png()
          .toBuffer(),
      );
      const db = new DatabaseSync(path.join(dir, "autoppt.sqlite"));
      db.prepare("UPDATE records SET data=? WHERE kind='trial' AND id=?").run(
        JSON.stringify(legacy),
        legacy.id,
      );
      db.close();
      await page.getByRole("alert").filter({ hasText: "1024×1536" }).waitFor();
      mkdirSync(".local/verification/unified-cover", { recursive: true });
      for (const [name, width, height] of [
        ["desktop", 1440, 1000],
        ["mobile", 390, 844],
      ]) {
        await page.setViewportSize({ width, height });
        await page.locator(".unified-style-cover").scrollIntoViewIfNeeded();
        const frame = await page.locator(".studio-slide-preview").boundingBox();
        assert(Math.abs(frame.width / frame.height - 16 / 9) < 0.01);
        assert.equal(
          await page
            .getByRole("img", { name: "本次风格试做图片" })
            .evaluate((img) => getComputedStyle(img).objectFit),
          "contain",
        );
        assert(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
        );
        await page.screenshot({
          path: `.local/verification/unified-cover/${name}.png`,
        });
      }
      assert.deepEqual(errors, []);
    } finally {
      await browser?.close();
      child.kill();
      await new Promise((resolve) => mock.close(resolve));
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
