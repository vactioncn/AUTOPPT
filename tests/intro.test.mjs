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
  "standalone intro: mobile/desktop, feature navigation, zoom, guide and local entry",
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
      const page = await browser.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      mkdirSync(".local/verification/intro", { recursive: true });
      for (const [label, width, height] of [
        ["desktop", 1440, 1000],
        ["mobile", 390, 844],
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
        for (const f of product.features) {
          const tab = page.getByRole("tab", { name: f.label, exact: true });
          await tab.click();
          assert.equal(await tab.getAttribute("aria-selected"), "true");
          const panel = page.locator("#panel-" + f.id);
          await panel.locator("img").evaluate((i) => i.decode());
          await panel.locator("summary").click();
          assert((await panel.locator("li").count()) >= f.steps.length);
          assert(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth + 1,
            ),
          );
        }
        await page.screenshot({
          path: `.local/verification/intro/${label}-features.png`,
        });
        await page.locator('[data-zoom="screenshots/export.webp"]').click();
        assert(await page.getByRole("dialog").isVisible());
        await page.getByRole("button", { name: "关闭截图" }).click();
        assert(!(await page.getByRole("dialog").isVisible()));
        await page.locator("#faq").scrollIntoViewIfNeeded();
        await page.locator(".faq-list summary").first().click();
        assert(
          (await page
            .locator(".faq-list details")
            .first()
            .getAttribute("open")) !== null,
        );
        await page.screenshot({
          path: `.local/verification/intro/${label}-full.png`,
          fullPage: true,
        });
      }
      await page
        .getByRole("tab", { name: "拆稿与自动生成", exact: true })
        .focus();
      await page.keyboard.press("End");
      assert.equal(
        await page
          .getByRole("tab", { name: "导出与保存", exact: true })
          .getAttribute("aria-selected"),
        "true",
      );
      await page.keyboard.press("Home");
      assert.equal(
        await page
          .getByRole("tab", { name: "拆稿与自动生成", exact: true })
          .getAttribute("aria-selected"),
        "true",
      );
      assert.equal(
        await page.locator('[role="tab"][aria-selected="true"]').count(),
        2,
      );
      await page
        .getByRole("tab", { name: "提取、设置与调试", exact: true })
        .focus();
      await page.keyboard.press("End");
      assert.equal(
        await page
          .getByRole("tab", { name: "内容倾向与配色", exact: true })
          .getAttribute("aria-selected"),
        "true",
      );
      assert.equal(
        await page
          .getByRole("tab", { name: "拆稿与自动生成", exact: true })
          .getAttribute("aria-selected"),
        "true",
      );
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
    } finally {
      await browser?.close();
      await new Promise((r) => server.close(r));
    }
  },
);
