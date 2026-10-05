import test from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";

test(
  "style dialogs distinguish supported page-number slots from ambiguous numbering",
  { skip: !process.env.BROWSER_TEST, timeout: 30000 },
  async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "autoppt-page-number-ui-"));
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
        viewport: { width: 1400, height: 1000 },
      });
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(`http://127.0.0.1:${port}/#styles`);
      for (const [name, supported] of [
        ["克制儿童摄影杂志风", false],
        ["日系现代建筑提案风", true],
      ]) {
        const card = page
          .locator(".style-card")
          .filter({ has: page.getByRole("heading", { name, exact: true }) });
        await card.getByRole("button", { name: "查看风格" }).click();
        const help = page
          .getByRole("dialog")
          .getByText(
            supported
              ? "动态页码：只在原有页码描述处"
              : "未识别到明确的动态页码位置",
            { exact: false },
          );
        await help.scrollIntoViewIfNeeded();
        assert(await help.isVisible());
        mkdirSync(".local/verification/page-number-ui", { recursive: true });
        await page.screenshot({
          path: `.local/verification/page-number-ui/${supported ? "supported" : "unchanged"}.png`,
        });
        await page.getByRole("button", { name: "关闭", exact: true }).click();
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
