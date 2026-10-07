import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { once } from "node:events";
import express from "express";
import { chromium } from "playwright-core";
import { product } from "../site/intro/content.mjs";

test("product introduction covers real workflows and ships reproducible demo screenshots", () => {
  const html = readFileSync("dist/intro/index.html", "utf8");
  const guide = readFileSync("dist/intro/guide.md", "utf8");
  assert(!html.includes("{{"));
  assert.equal(product.modules.length, 2);
  assert.deepEqual(
    product.modules.flatMap((m) => m.featureIds).sort(),
    product.features.map((f) => f.id).sort(),
  );
  for (const module of product.modules) {
    assert(html.includes(`id="${module.id}"`));
    assert(guide.includes(`## ${module.label}`));
  }
  for (const f of product.features) {
    assert(html.includes(`panel-${f.id}`));
    assert(guide.includes(f.label));
    assert(existsSync(`public/intro/screenshots/${f.shot}.webp`));
  }
  const manifest = JSON.parse(
    readFileSync("public/intro/screenshots/manifest.json", "utf8"),
  );
  assert.equal(manifest.modelCalls, 0);
  assert.equal(manifest.privateData, false);
  assert(guide.includes("PPTX 是整页图片"));
  assert(guide.includes("实际输出取决于服务商"));
});

test(
  "standalone intro: mobile/desktop, continuous feature flow, zoom, guide and local entry",
  { skip: !process.env.INTRO_BROWSER_TEST, timeout: 60000 },
  async () => {
    const app = express();
    app.use(express.static(path.resolve("dist")));
    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const base = `http://127.0.0.1:${server.address().port}`;
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
      const page = await browser.newPage({ reducedMotion: "reduce" });
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      mkdirSync(".local/verification/intro", { recursive: true });
      for (const [label, width, height] of [
        ["desktop", 1440, 1000],
        ["tablet", 820, 1180],
        ["mobile", 390, 844],
        ["small-mobile", 320, 740],
      ]) {
        await page.setViewportSize({ width, height });
        await page.goto(base + "/intro/");
        await page.evaluate(async () => {
          await document.fonts.ready;
          await document.querySelector(".hero img").decode();
        });
        assert(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
        );
        await page.screenshot({
          path: `.local/verification/intro/${label}-top.png`,
        });
        if (width < 760) {
          await page.getByRole("button", { name: "打开导航" }).click();
          assert.equal(
            await page.locator(".menu-toggle").getAttribute("aria-expanded"),
            "true",
          );
          await page
            .locator("#site-navigation")
            .getByRole("link", { name: "风格制作" })
            .click();
          assert.equal(
            await page.locator(".menu-toggle").getAttribute("aria-expanded"),
            "false",
          );
        }
        const choices = page.locator(".style-choice");
        await choices.nth(2).click();
        await page.waitForFunction(
          () =>
            document.getElementById("gallery-title").textContent ===
            "高质感手账",
        );
        assert.equal(await choices.nth(2).getAttribute("aria-pressed"), "true");
        await choices.nth(2).press("ArrowRight");
        await page.waitForFunction(
          () =>
            document.getElementById("gallery-title").textContent ===
            "暗黑参数化数据地形风",
        );
        await page.locator("#gallery-zoom").click();
        assert(
          (await page.locator("#viewer-image").getAttribute("src")).includes(
            "dark-data-terrain.webp",
          ),
        );
        await page.keyboard.press("Escape");
        assert(!(await page.getByRole("dialog").isVisible()));
        await page
          .locator("#style-making")
          .screenshot({
            path: `.local/verification/intro/${label}-styles.png`,
          });
        assert.equal(await page.getByRole("tab").count(), 0);
        assert.equal(
          await page
            .locator(".feature-panel[hidden], .feature-panel details")
            .count(),
          0,
        );
        let previousBottom = 0;
        for (const id of product.modules.flatMap((m) => m.featureIds)) {
          const f = product.features.find((f) => f.id === id);
          const panel = page.locator("#panel-" + f.id);
          assert(await panel.isVisible());
          await panel.evaluate((el) =>
            el.scrollIntoView({ behavior: "instant", block: "start" }),
          );
          await panel.locator("img").evaluate((i) => i.decode());
          const bounds = await panel.evaluate((el) => {
            const r = el.getBoundingClientRect();
            return { top: r.top + scrollY, bottom: r.bottom + scrollY };
          });
          assert(bounds.top >= previousBottom);
          previousBottom = bounds.bottom;
          assert.equal(
            await panel.locator(".how-to li").count(),
            f.steps.length,
          );
          assert(await panel.locator(".how-to li").first().isVisible());
          assert(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth + 1,
            ),
          );
          await page.screenshot({
            path: `.local/verification/intro/${label}-${id}-scroll.png`,
          });
        }
        await page.screenshot({
          path: `.local/verification/intro/${label}-features.png`,
        });
        await page.locator('[data-zoom="screenshots/export.webp"]').click();
        assert(await page.getByRole("dialog").isVisible());
        await page.getByRole("button", { name: "关闭截图" }).click();
        assert(!(await page.getByRole("dialog").isVisible()));
        await page.locator("#faq").scrollIntoViewIfNeeded();
        assert.equal(
          await page.locator(".faq-list article").count(),
          product.faqs.length,
        );
        assert(await page.locator(".faq-list article p").first().isVisible());
        await page.screenshot({
          path: `.local/verification/intro/${label}-full.png`,
          fullPage: true,
        });
      }
      const response = await page.request.get(base + "/intro/guide.md");
      assert(response.ok());
      assert((await response.text()).includes("逐字稿"));
      const markup = await page.content();
      assert(!markup.includes("/api/"));
      assert.equal(
        await page.locator("#open-workspace").getAttribute("href"),
        "../#projects",
      );
      assert.deepEqual(errors, []);
      // The base content remains readable without JavaScript; only the
      // optional gallery controls and zoom need scripting.
      const noScript = await browser.newContext({ javaScriptEnabled: false });
      const fallback = await noScript.newPage();
      await fallback.goto(base + "/intro/");
      assert(await fallback.getByRole("heading", { level: 1 }).isVisible());
      assert.equal(
        await fallback.locator(".feature-panel").count(),
        product.features.length,
      );
      assert.equal(await fallback.locator(".reveal-pending").count(), 0);
      await noScript.close();
    } finally {
      await browser?.close();
      await new Promise((r) => server.close(r));
    }
  },
);

test(
  "workspace introduction stays in the right pane and preserves unsaved forms",
  { skip: !process.env.INTRO_BROWSER_TEST, timeout: 60000 },
  async () => {
    const app = express();
    const connection = {
      baseUrl: "https://example.com/v1",
      model: "fixture",
      hasKey: false,
    };
    app.get("/api/account", (_req, res) =>
      res.json({ hosted: false, user: null }),
    );
    app.get("/api/bootstrap", (_req, res) =>
      res.json({
        projects: [],
        styles: [],
        jobs: [],
        settings: { text: connection, image: connection },
      }),
    );
    app.use(express.static(path.resolve("dist")));
    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const base = `http://127.0.0.1:${server.address().port}`;
    let browser;
    try {
      browser = await chromium.launch({
        headless: true,
        executablePath:
          process.env.CHROMIUM_EXECUTABLE ||
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      });
      const context = await browser.newContext();
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.goto(base + "/#settings");
      const model = page.getByLabel("模型名称", { exact: true }).first();
      await model.fill("unsaved-model-draft");
      await page
        .getByRole("button", { name: "帮助与介绍", exact: true })
        .click();
      const frame = page.frameLocator('iframe[title="AutoPPT 产品介绍"]');
      await frame.getByRole("heading", { level: 1 }).waitFor();
      assert.equal(context.pages().length, 1);
      assert.equal(new URL(page.url()).hash, "#intro");
      assert(
        await page.getByRole("navigation", { name: "主导航" }).isVisible(),
      );
      assert(!(await model.isVisible()));
      await page.screenshot({
        path: ".local/verification/intro/embedded-desktop.png",
      });
      await page.getByRole("button", { name: "返回刚才的页面" }).click();
      assert.equal(await model.inputValue(), "unsaved-model-draft");
      await page
        .getByRole("button", { name: "帮助与介绍", exact: true })
        .click();
      await frame.locator("#open-workspace").click();
      await model.waitFor({ state: "visible" });
      assert.equal(new URL(page.url()).hash, "#settings");
      assert.equal(await model.inputValue(), "unsaved-model-draft");
      await page
        .getByRole("button", { name: "帮助与介绍", exact: true })
        .click();
      await page.getByRole("button", { name: /^风格库/ }).click();
      await page
        .getByRole("heading", { name: "把喜欢的，变成你的风格。" })
        .waitFor();
      await page.goto(base + "/#intro");
      await page.reload();
      await page.getByRole("button", { name: "返回刚才的页面" }).click();
      await page.getByRole("heading", { name: /让讲述.*自然成页/ }).waitFor();
      await page.setViewportSize({ width: 390, height: 844 });
      await page
        .getByRole("button", { name: "帮助与介绍", exact: true })
        .click();
      await frame.getByRole("heading", { level: 1 }).waitFor();
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      );
      await page.screenshot({
        path: ".local/verification/intro/embedded-mobile.png",
      });
      assert.deepEqual(errors, []);
    } finally {
      await browser?.close();
      await new Promise((resolve) => server.close(resolve));
    }
  },
);
