import test from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { chromium } from "playwright-core";
import { expect } from "@playwright/test";

test(
  "style workbench preserves drafts and saved results while keeping generation in view",
  {
    skip: !process.env.BROWSER_TEST,
    timeout: 60000,
  },
  async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "autoppt-studio-ui-"));
    const child = fork("server/index.mjs", [], {
      silent: true,
      env: {
        ...process.env,
        NODE_ENV: "production",
        PORT: "0",
        AUTOPPT_DATA_DIR: dir,
        AUTOPPT_DESKTOP_TOKEN: "",
        OPENAI_API_KEY: "",
      },
    });
    let browser;
    try {
      const [message] = await once(child, "message");
      const base = `http://127.0.0.1:${message.port}`;
      const rules =
        "你是一位编辑设计师。\n完整原文与空行必须保留。\n\n暖纸、墨字、自由构图。";
      const style = (
        await (
          await fetch(base + "/api/styles", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: "集中试做工作区", rules }),
          })
        ).json()
      ).style;
      writeFileSync(
        path.join(dir, "assets", "studio-fixture.png"),
        await sharp({
          create: {
            width: 960,
            height: 540,
            channels: 3,
            background: "#e9dfcc",
          },
        })
          .png()
          .toBuffer(),
      );
      const makeTrial = (id, notes) => ({
        id,
        styleId: style.id,
        engine: "image",
        status: "completed",
        image: "studio-fixture.png",
        notes,
        jobId: `job-${id}`,
        styleSnapshot: { ...style, rules },
        designOptions: { audience: null, palette: null },
        plan: {
          displayText: [notes],
          styleRules: rules,
          contentPrompt: notes,
          imageRequest: { prompt: rules + "\n" + notes },
          imageResponse: { width: 960, height: 540 },
        },
      });
      const original = makeTrial("saved-one", "第一版原稿");
      let trials = [];
      const requests = [];
      browser = await chromium.launch({
        headless: true,
        executablePath:
          process.env.CHROMIUM_EXECUTABLE ||
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      });
      const page = await browser.newPage({
        viewport: { width: 1440, height: 900 },
      });
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      // All trial operations stay in this test. There is no real model endpoint.
      await page.route(`**/api/styles/${style.id}/trials`, async (route) => {
        if (route.request().method() === "POST") {
          const body = route.request().postDataJSON();
          requests.push(body);
          const next = makeTrial(`new-${requests.length}`, body.notes);
          next.styleSnapshot.rules = body.rules;
          next.designOptions = body.designOptions;
          trials = [next, ...trials];
          await route.fulfill({ json: next });
        } else await route.fulfill({ json: { trials } });
      });
      await page.goto(base + "/#styles");
      await page
        .locator(".style-card")
        .filter({ hasText: style.name })
        .getByRole("button", { name: "查看风格" })
        .click();
      await page.getByRole("button", { name: "试做一页", exact: true }).click();
      const contentTab = page.getByRole("tab", {
        name: "试做内容",
        exact: true,
      });
      const refineTab = page.getByRole("tab", {
        name: "调整效果",
        exact: true,
      });
      const openRules = async () => {
        await contentTab.click();
        if (
          (await page.locator(".studio-advanced").getAttribute("open")) === null
        )
          await page.locator(".studio-advanced > summary").click();
      };
      await expect(
        page.getByRole("tab", { name: "风格提示词", exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByLabel("试做设计规范", { exact: true }),
      ).toBeHidden();
      const generate = page.getByRole("button", {
        name: "生成图片试做",
        exact: true,
      });
      await expect(generate).toBeEnabled();
      await expect(contentTab).toHaveAttribute("aria-selected", "true");
      assert.equal(
        await page.locator(".studio-cover-tools").getAttribute("open"),
        null,
      );
      await expect(page.getByLabel("画面调整（可选）")).toBeHidden();
      const draft = page.getByLabel("试做讲稿", { exact: true });
      await draft.fill("还没生成的讲稿草稿");
      await contentTab.press("ArrowRight");
      await expect(refineTab).toBeFocused();
      await page.getByLabel("画面调整（可选）").fill("标题更轻");
      await expect(
        page.getByRole("button", { name: "只调整这一页", exact: true }),
      ).toBeDisabled();
      await refineTab.press("ArrowRight");
      await expect(contentTab).toBeFocused();
      await openRules();
      await expect(
        page.getByLabel("试做设计规范", { exact: true }),
      ).toHaveValue(rules);
      const modified = rules + "\n这是尚未正式保存的修改。";
      await page.getByLabel("试做设计规范", { exact: true }).fill(modified);
      await contentTab.click();
      await page.getByText("内容倾向与配色（可选）", { exact: true }).click();
      await page
        .getByLabel("内容倾向（可选）", { exact: true })
        .fill("面向老师");
      await openRules();
      await contentTab.click();
      await expect(draft).toHaveValue("还没生成的讲稿草稿");
      await expect(
        page.getByLabel("内容倾向（可选）", { exact: true }),
      ).toHaveValue("面向老师");
      await page.getByText("内容倾向与配色（可选）", { exact: true }).click();
      assert.equal(
        requests.length,
        0,
        "Opening controls or switching tabs cannot generate",
      );
      await page.locator(".studio-advanced > summary").click();
      mkdirSync("test-results/style-studio-layout", { recursive: true });
      for (const [label, width, height] of [
        ["desktop-empty", 1440, 900],
        ["laptop-empty", 1280, 800],
        ["mobile-empty", 390, 844],
      ]) {
        await page.setViewportSize({ width, height });
        await page.evaluate(() => window.scrollTo(0, 0));
        if (width > 960) {
          const bounds = await generate.boundingBox();
          assert(
            bounds.y >= 0 && bounds.y + bounds.height <= height,
            `${label}: generation stays in the first viewport`,
          );
          const editor = await page
            .locator(".studio-editor-body")
            .boundingBox();
          await page
            .locator(".studio-editor-body")
            .evaluate((e) => (e.scrollTop = e.scrollHeight));
          const after = await generate.boundingBox();
          assert.equal(
            bounds.y,
            after.y,
            "Editor scrolling must not move the generation action",
          );
          assert(editor.width > 250);
        } else {
          const editor = await page.locator(".studio-editor").boundingBox();
          const preview = await page
            .locator(".studio-preview-column")
            .boundingBox();
          assert(
            editor.y < preview.y,
            "On narrow screens enter content before viewing results",
          );
          await generate.scrollIntoViewIfNeeded();
          const bounds = await generate.boundingBox();
          assert(
            bounds.y + bounds.height <= height - 62,
            "The mobile navigation must not cover generation",
          );
        }
        await page.screenshot({
          path: `test-results/style-studio-layout/${label}.png`,
        });
        assert(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
          JSON.stringify(
            await page.evaluate(() =>
              [...document.querySelectorAll(".style-studio *")]
                .map((e) => ({
                  tag: e.tagName,
                  class: e.className,
                  right: e.getBoundingClientRect().right,
                  width: e.getBoundingClientRect().width,
                }))
                .filter((e) => e.right > innerWidth + 1 && e.width > 0),
            ),
          ),
        );
      }
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.reload();
      await page
        .locator(".style-card")
        .filter({ hasText: style.name })
        .getByRole("button", { name: "查看风格" })
        .click();
      await page.getByRole("button", { name: "试做一页", exact: true }).click();
      await expect(draft).toHaveValue("还没生成的讲稿草稿");
      await openRules();
      await expect(
        page.getByLabel("试做设计规范", { exact: true }),
      ).toHaveValue(modified);
      await refineTab.click();
      await expect(page.getByLabel("画面调整（可选）")).toHaveValue("标题更轻");
      // Poll in a saved result. Selecting it explicitly restores its original inputs.
      trials = [original];
      await page
        .locator(".studio-history")
        .getByRole("button", { name: "试做 1 · 图片" })
        .click();
      await expect(
        page.getByRole("button", { name: "保存这版为正式风格", exact: true }),
      ).toBeEnabled();
      await page.getByText("查看上屏文案与生成依据", { exact: true }).click();
      await expect(
        page.getByLabel("本次上屏文案", { exact: true }),
      ).toHaveValue(original.notes);
      await contentTab.click();
      await draft.fill("只改草稿，旧图仍保留");
      await expect(
        page.getByLabel("本次上屏文案", { exact: true }),
      ).toHaveValue(original.notes);
      await expect(
        page.getByRole("button", { name: "保存这版为正式风格", exact: true }),
      ).toBeDisabled();
      await page.getByText("查看上屏文案与生成依据", { exact: true }).click();
      await page
        .getByRole("button", { name: "调整这一页", exact: true })
        .click();
      await page.getByLabel("画面调整（可选）").fill("更突出标题");
      await page
        .getByRole("button", { name: "只调整这一页", exact: true })
        .click();
      assert.equal(requests.length, 1);
      assert.equal(requests[0].mode, "redesign");
      assert.equal(requests[0].parentId, original.id);
      assert.equal(requests[0].rules, rules);
      assert.equal(requests[0].notes, "只改草稿，旧图仍保留");
      assert.equal(trials.length, 2);
      assert.equal(
        trials[1],
        original,
        "Generating an iteration must preserve the saved result",
      );
      await contentTab.click();
      await expect(generate).toBeEnabled();
      for (const [label, width, height] of [
        ["desktop-result", 1440, 900],
        ["mobile-result", 390, 844],
      ]) {
        await page.setViewportSize({ width, height });
        if (width < 960)
          await page
            .getByRole("img", { name: "本次风格试做图片", exact: true })
            .scrollIntoViewIfNeeded();
        else await page.evaluate(() => window.scrollTo(0, 0));
        assert(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
        );
        await page.screenshot({
          path: `test-results/style-studio-layout/${label}.png`,
        });
      }
      const saved = (
        await (await fetch(base + "/api/bootstrap")).json()
      ).styles.find((s) => s.id === style.id);
      assert.equal(
        saved.rules,
        rules,
        "Trial edits must not implicitly update the formal style",
      );
      assert.deepEqual(errors, []);
    } finally {
      await browser?.close();
      child.kill();
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
