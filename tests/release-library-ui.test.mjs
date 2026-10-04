import test from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { chromium } from "playwright-core";
import { RELEASE_STYLES } from "../shared/builtin-style-catalog.mjs";

test(
  "fresh desktop library renders all release styles and covers without model configuration",
  { skip: !process.env.BROWSER_TEST, timeout: 60000 },
  async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "autoppt-release-ui-"));
    const child = fork("server/index.mjs", [], {
      silent: true,
      env: {
        ...process.env,
        PORT: "0",
        NODE_ENV: "production",
        AUTOPPT_DATA_DIR: dir,
        AUTOPPT_DESKTOP_TOKEN: "",
        OPENAI_API_KEY: "",
      },
    });
    let browser;
    try {
      const [{ port }] = await once(child, "message");
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
      await page.goto(`http://127.0.0.1:${port}/#styles`);
      await page.getByRole("heading", { name: "全部风格 13" }).waitFor();
      assert.equal(await page.locator(".style-card").count(), 13);
      for (const style of RELEASE_STYLES) {
        const card = page
          .locator(".style-card")
          .filter({
            has: page.getByRole("heading", { name: style.name, exact: true }),
          });
        const cover = card.getByAltText(style.name + "封面");
        assert.equal(await cover.getAttribute("src"), style.cover);
        await cover.evaluate((img) => img.decode());
        assert(await cover.evaluate((img) => img.naturalWidth > 1000));
        await card.getByRole("button", { name: "查看风格" }).click();
        await page
          .getByRole("dialog")
          .getByRole("heading", { name: style.name, exact: true })
          .waitFor();
        await page.getByRole("button", { name: "关闭", exact: true }).click();
      }
      mkdirSync(".local/verification/release-styles", { recursive: true });
      for (const [label, width, height] of [
        ["desktop", 1440, 1000],
        ["mobile", 390, 844],
      ]) {
        await page.setViewportSize({ width, height });
        assert(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
        );
        await page.screenshot({
          path: `.local/verification/release-styles/library-${label}.png`,
          fullPage: true,
        });
      }
      assert.deepEqual(errors, []);
    } finally {
      await browser?.close();
      const done = once(child, "exit");
      child.kill();
      await done;
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
