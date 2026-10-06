import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import sharp from "sharp";

test(
  "redesign dialog submits exactly the selected scope and protects active pages",
  { skip: process.env.REDESIGN_BROWSER_TEST !== "1", timeout: 60000 },
  async (t) => {
    const dir = mkdtempSync(path.join(tmpdir(), "autoppt-redesign-"));
    mkdirSync(path.join(dir, "assets"));
    writeFileSync(
      path.join(dir, "assets/sample.png"),
      await sharp({
        create: { width: 800, height: 450, channels: 3, background: "#e2e6db" },
      })
        .png()
        .toBuffer(),
    );
    const project = {
      id: "redesign-fixture",
      title: "批量重新设计验收",
      revision: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      draft: "",
      styleId: "restrained-minimal",
      batches: [
        { id: "batch-1", text: "第一段", slideIds: ["page-1", "page-2"] },
        { id: "batch-2", text: "第二段", slideIds: ["page-3", "page-4"] },
      ],
      slides: [1, 2, 3, 4].map((i) => ({
        id: "page-" + i,
        notes: "第 " + i + " 页讲稿",
        plan: { title: "演讲第 " + i + " 页" },
        image: "sample.png",
        status: "ready",
        versions: [],
        batchIds: [i < 3 ? "batch-1" : "batch-2"],
        styleId: "restrained-minimal",
        manuscriptVersion: 1,
      })),
    };
    const db = new DatabaseSync(path.join(dir, "autoppt.sqlite"));
    db.exec(
      "CREATE TABLE records (kind TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(kind,id))",
    );
    db.prepare("INSERT INTO records VALUES (?,?,?)").run(
      "project",
      project.id,
      JSON.stringify(project),
    );
    t.after(() => db.close());
    const proc = spawn(process.execPath, ["server/index.mjs"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: "0",
        AUTOPPT_DATA_DIR: dir,
        NODE_ENV: "production",
        AUTOPPT_WORKER_TOKEN: "",
        AUTOPPT_DESKTOP_TOKEN: "",
        OPENAI_API_KEY: "",
      },
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    });
    proc.stderr.on("data", () => {});
    t.after(() => proc.kill("SIGTERM"));
    const [message] = await once(proc, "message");
    const base = `http://127.0.0.1:${message.port}`;
    const { chromium, expect } = await import("@playwright/test");
    const browser = await chromium.launch({
      executablePath:
        process.env.CHROMIUM_EXECUTABLE ||
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      headless: true,
    });
    t.after(() => browser.close());
    const p = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    });
    const errors = [];
    p.on("pageerror", (e) => errors.push(e.message));
    let busy = false,
      rejected = false;
    const requests = [];
    // Scope is checked at the HTTP boundary; no model request is allowed in this UI test.
    await p.route(`**/api/projects/${project.id}/render`, async (route) => {
      requests.push(route.request().postDataJSON());
      await route.fulfill({
        status: rejected ? 409 : 202,
        contentType: "application/json",
        body: JSON.stringify(
          rejected
            ? { error: "页面正在制作，请稍后重试" }
            : { id: "mock-redesign", status: "queued" },
        ),
      });
    });
    await p.route(
      (url) => url.pathname === "/api/jobs",
      (route) =>
        route.fulfill({
          contentType: "application/json",
          body: JSON.stringify(
            busy
              ? [
                  {
                    id: "busy-page",
                    projectId: project.id,
                    type: "render",
                    status: "running",
                    slideIds: ["page-1"],
                    progress: { total: 1, done: 0 },
                    createdAt: new Date().toISOString(),
                  },
                ]
              : [],
          ),
        }),
    );
    const open = async () => {
      await p.goto(`${base}/#project/${project.id}`);
      await p.getByRole("button", { name: "重新设计", exact: true }).click();
    };
    await open();
    const dialog = p.getByRole("dialog");
    await expect(
      dialog.getByRole("button", { name: "开始重新设计 4 页", exact: true }),
    ).toBeEnabled();
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    assert.equal(
      requests.length,
      0,
      "opening or cancelling never starts paid work",
    );
    await p.getByRole("button", { name: "全部页面 4", exact: true }).click();
    const checkbox = p.getByRole("button", {
      name: "选择第 1 页",
      exact: true,
    });
    assert.equal(
      await checkbox.evaluate((el) => getComputedStyle(el).opacity),
      "1",
      "selection stays visible without hover",
    );
    await checkbox.click();
    await p.getByRole("button", { name: "选择第 4 页", exact: true }).click();
    await p
      .getByRole("button", { name: "重新设计所选 2 页", exact: true })
      .click();
    await expect(
      dialog.getByLabel("重新设计第 1 页", { exact: true }),
    ).toBeChecked();
    await expect(
      dialog.getByLabel("重新设计第 4 页", { exact: true }),
    ).toBeChecked();
    rejected = true;
    await dialog
      .getByRole("button", { name: "开始重新设计 2 页", exact: true })
      .click();
    await expect(dialog.getByRole("alert")).toContainText("页面正在制作");
    await expect(
      dialog.getByLabel("重新设计第 4 页", { exact: true }),
    ).toBeChecked();
    rejected = false;
    await dialog
      .getByRole("button", { name: "开始重新设计 2 页", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    assert.deepEqual(requests.at(-1), {
      slideIds: ["page-1", "page-4"],
      redesign: true,
    });
    await open();
    await dialog
      .getByRole("button", { name: "开始重新设计 4 页", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    assert.deepEqual(
      requests.at(-1).slideIds,
      project.slides.map((p) => p.id),
      "all means the whole project, not the visible batch",
    );
    busy = true;
    await open();
    await expect(
      dialog.getByRole("button", { name: "开始重新设计 4 页", exact: true }),
    ).toBeDisabled();
    await dialog.getByRole("button", { name: /选择几页重新设计/ }).click();
    await expect(
      dialog.getByLabel("重新设计第 1 页", { exact: true }),
    ).toBeDisabled();
    await expect(
      dialog.getByRole("button", { name: "开始重新设计 0 页", exact: true }),
    ).toBeDisabled();
    await dialog
      .getByRole("button", { name: "全选可重做页面", exact: true })
      .click();
    await expect(
      dialog.getByRole("button", { name: "开始重新设计 3 页", exact: true }),
    ).toBeEnabled();
    await p.screenshot({ path: path.join(dir, "desktop.png") });
    await p.setViewportSize({ width: 390, height: 844 });
    assert(
      await p.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    const rect = await dialog.boundingBox();
    assert(rect.x >= 0 && rect.x + rect.width <= 391);
    await p.screenshot({ path: path.join(dir, "mobile.png") });
    await dialog
      .getByRole("button", { name: "开始重新设计 3 页", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    assert.deepEqual(requests.at(-1).slideIds, ["page-2", "page-3", "page-4"]);
    assert.deepEqual(errors, []);
    assert.equal(
      db.prepare("SELECT count(*) as n FROM records WHERE kind='job'").get().n,
      0,
      "browser test never generates images",
    );
    console.log("Redesign browser evidence:", dir);
  },
);
