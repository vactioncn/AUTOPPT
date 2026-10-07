import test from "node:test";
import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { diagnostics } from "../server/diagnostics.mjs";
import { readBuildInfo } from "../server/build-info.mjs";

test(
  "local and mocked hosted diagnostics, production gates and refresh recovery in real browser",
  { timeout: 90000 },
  async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "autoppt-diagnostics-ui-"));
    const out = path.resolve("test-results/diagnostics");
    mkdirSync(out, { recursive: true });
    const child = fork("server/index.mjs", [], {
      silent: true,
      env: {
        PATH: process.env.PATH,
        NODE_ENV: "production",
        PORT: "0",
        AUTOPPT_DATA_DIR: dir,
      },
    });
    let browser;
    const errors = [],
      writes = [],
      workspaceRequests = [];
    try {
      const [ready] = await once(child, "message", {
        signal: AbortSignal.timeout(15000),
      });
      const base = `http://127.0.0.1:${ready.port}`;
      browser = await chromium.launch({
        executablePath:
          process.env.CHROMIUM_EXECUTABLE ||
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        headless: true,
      });
      const page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
      });
      page.on("pageerror", (e) => errors.push(e.message));
      await page.route("**/api/**", (route) => {
        const req = route.request();
        if (!["GET", "HEAD"].includes(req.method())) {
          writes.push(req.url());
          return route.abort();
        }
        if (req.url().includes("/projects/unavailable"))
          workspaceRequests.push(req.url());
        return route.continue();
      });
      const panel = page.getByRole("region", { name: "版本与工作区" });
      const openPanel = async () => {
        await page
          .getByRole("button", { name: "帮助与介绍", exact: true })
          .click();
        await page
          .getByRole("button", { name: "版本与工作区", exact: true })
          .click();
        await expect(panel).toBeVisible();
      };
      await page.goto(base);
      await openPanel();
      await expect(
        panel.getByText("本机浏览器工作区", { exact: true }),
      ).toBeVisible();
      await expect(panel.getByText(/前后端提交一致/)).toBeVisible();
      await expect(panel.getByText(/尚未配置语音服务/)).toBeVisible();
      await page.screenshot({
        path: path.join(out, "local.png"),
        fullPage: true,
      });
      const localText = await panel.innerText();
      await panel
        .getByRole("cell", { name: "管理员模型设置", exact: true })
        .scrollIntoViewIfNeeded();
      await page.screenshot({
        path: path.join(out, "local-capabilities.png"),
        fullPage: true,
      });
      await page.route("**/api/account", (route) =>
        route.fulfill({
          json: {
            hosted: true,
            modelReady: true,
            user: {
              id: "fixture",
              name: "验收账号",
              role: "user",
              available: 10,
              held: 0,
            },
          },
        }),
      );
      await page.route("**/api/bootstrap", async (route) => {
        const response = await route.fetch();
        const body = await response.json();
        Object.assign(body, diagnostics(body.buildInfo, { mode: "hosted" }));
        await route.fulfill({ response, json: body });
      });
      await page.goto(base);
      await openPanel();
      await expect(
        panel.getByText("hosted 账号工作区", { exact: true }),
      ).toBeVisible();
      await expect(panel.getByText(/当前托管服务未开放/).first()).toBeVisible();
      const hostedText = await panel.innerText();
      assert.doesNotMatch(
        hostedText,
        /\/Users\/|\/private\/|apiKey|cookie|token=/i,
      );
      await page.screenshot({
        path: path.join(out, "hosted.png"),
        fullPage: true,
      });
      await page.setViewportSize({ width: 1000, height: 720 });
      await panel
        .getByRole("cell", { name: "管理员模型设置", exact: true })
        .scrollIntoViewIfNeeded();
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      await page.screenshot({
        path: path.join(out, "hosted-small.png"),
        fullPage: true,
      });
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page
        .getByRole("button", { name: "模型与服务", exact: true })
        .click();
      await expect(
        page.getByText(/托管版的模型由管理员统一配置/),
      ).toBeVisible();
      await expect(page.getByText(/当前托管服务未开放/)).toBeVisible();

      await page.unroute("**/api/bootstrap");
      let fault = "schema";
      await page.route("**/api/bootstrap", async (route) => {
        const response = await route.fetch();
        const body = await response.json();
        if (fault === "schema") {
          body.buildInfo.apiSchemaVersion++;
          // An incompatible API may no longer return the old workspace shape.
          delete body.projects;
          delete body.styles;
          delete body.settings;
        }
        if (fault === "sha")
          body.buildInfo.gitSha =
            body.buildInfo.gitSha === "b".repeat(40)
              ? "a".repeat(40)
              : "b".repeat(40);
        if (fault === "unknown") body.buildInfo.gitSha = "unknown";
        if (fault === "missing") delete body.buildInfo;
        await route.fulfill({ response, json: body });
      });
      for (fault of ["schema", "sha", "missing"]) {
        await page.goto(`${base}/?case=${fault}#project/unavailable/studio`);
        await expect(page.getByRole("alert")).toContainText(
          fault === "sha" ? "来自不同发布" : "接口版本不兼容",
        );
        assert.equal(
          await page.getByRole("navigation", { name: "项目区域" }).count(),
          0,
        );
        assert.equal(
          await page.getByRole("button", { name: "新建演讲项目" }).count(),
          0,
        );
        await page.screenshot({
          path: path.join(out, `blocked-${fault}.png`),
          fullPage: true,
        });
      }
      assert.deepEqual(workspaceRequests, []);
      fault = "unknown";
      await page.goto(base);
      await openPanel();
      await expect(panel.getByText(/无法核对前后端发布/)).toBeVisible();
      assert.equal(await page.getByRole("alert").count(), 0);
      fault = "ok";
      await panel
        .getByRole("button", { name: "刷新页面", exact: true })
        .click();
      await page
        .getByRole("button", { name: "版本与工作区", exact: true })
        .click();
      await expect(panel.getByText(/前后端提交一致/)).toBeVisible();
      assert.deepEqual(errors, []);
      assert.deepEqual(writes, []);
      writeFileSync(
        path.join(out, "report.json"),
        JSON.stringify(
          {
            buildInfo: readBuildInfo(),
            localText,
            hostedText,
            checks: [
              "local panel",
              "mocked hosted panel",
              "1000px layout",
              "capability reasons reused in settings",
              "schema/sha/missing gate prevents workspace requests",
              "unknown is nonblocking",
              "refresh recovery",
            ],
            errors,
            writes,
          },
          null,
          2,
        ),
      );
    } finally {
      await browser?.close();
      if (child.exitCode === null && child.signalCode === null) {
        const ended = once(child, "exit");
        child.kill();
        await ended;
      }
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
