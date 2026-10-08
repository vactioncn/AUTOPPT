import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fork } from "node:child_process";
import { once } from "node:events";
import { DatabaseSync } from "node:sqlite";
import sharp from "sharp";
import { expect } from "@playwright/test";
import { launchBrowser } from "./helpers/browser.mjs";
import { SPEECH_DEFAULTS } from "../shared/speech.mjs";
test(
  "malicious bootstrap/job/narration/performance diagnostics never reach the rendered UI",
  { skip: process.env.BROWSER_TEST !== "1", timeout: 60000 },
  async (t) => {
    const dir = mkdtempSync(path.join(tmpdir(), "autoppt-error-ui-"));
    mkdirSync(path.join(dir, "assets"));
    writeFileSync(
      path.join(dir, "assets/fixture.jpg"),
      await sharp({
        create: { width: 640, height: 360, channels: 3, background: "#dddddd" },
      })
        .jpeg()
        .toBuffer(),
    );
    const db = new DatabaseSync(path.join(dir, "autoppt.sqlite"));
    db.exec(
      "CREATE TABLE records(kind TEXT,id TEXT,data TEXT,PRIMARY KEY(kind,id))",
    );
    const project = {
      id: "error-ui",
      title: "合成错误验收",
      revision: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      styleId: "restrained-minimal",
      draft: "",
      batches: [],
      slides: [
        {
          id: "p1",
          title: "合成页面",
          notes: "合成讲稿",
          image: "fixture.jpg",
          status: "ready",
          versions: [],
          batchIds: [],
          manuscriptVersion: 1,
        },
      ],
    };
    db.prepare("INSERT INTO records VALUES(?,?,?)").run(
      "project",
      project.id,
      JSON.stringify(project),
    );
    db.close();
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
    t.after(async () => {
      await browser?.close();
      const ended = once(child, "exit");
      child.kill();
      await ended;
      rmSync(dir, { recursive: true, force: true });
    });
    const [ready] = await once(child, "message", {
      signal: AbortSignal.timeout(15000),
    });
    const base = `http://127.0.0.1:${ready.port}`;
    browser = await launchBrowser(t);
    if (!browser) return;
    const page = await browser.newPage();
    const raw =
      "Provider SYNTHETIC_DIAGNOSTIC Authorization: Basic U1lOVEhFVElD Bearer SYNTHETIC_BEARER token=SYNTHETIC_TOKEN https://synthetic.invalid/?signature=SYNTHETIC_SIGNATURE synthetic@example.invalid /opt/synthetic/input C:\\synthetic\\input";
    let bootFailure = false,
      posts = 0;
    await page.route("**/api/**", async (route) => {
      const req = route.request(),
        url = new URL(req.url());
      if (req.method() === "POST") {
        posts++;
        return route.abort();
      }
      const r = await route.fetch();
      const data = await r.json();
      if (url.pathname === "/api/bootstrap") {
        if (bootFailure)
          return route.fulfill({ status: 500, json: { error: raw } });
        data.jobs = [
          {
            id: "job-error",
            projectId: project.id,
            type: "render",
            status: "failed",
            stage: "制作未完成",
            error: raw,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            slideIds: ["p1"],
            targetSlideIds: ["p1"],
            pageProgress: {
              total: 1,
              succeeded: 0,
              failed: [{ id: "p1", page: 1, error: raw }],
            },
          },
        ];
      }
      if (url.pathname === "/api/jobs")
        return route.fulfill({
          json: [
            {
              id: "job-error",
              projectId: project.id,
              type: "render",
              status: "failed",
              stage: "制作未完成",
              error: raw,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              slideIds: ["p1"],
              targetSlideIds: ["p1"],
              pageProgress: {
                total: 1,
                succeeded: 0,
                failed: [{ id: "p1", page: 1, error: raw }],
              },
            },
          ],
        });
      if (url.pathname.endsWith("/narration"))
        return route.fulfill({
          json: [
            {
              id: "n-error",
              projectId: project.id,
              status: "partial",
              progress: raw,
              sourceRevision: 1,
              voiceName: "合成声音",
              options: SPEECH_DEFAULTS,
              pages: project.slides.map((p, i) => ({
                ...p,
                number: i + 1,
                status: "failed",
                error: raw,
                clips: [],
              })),
            },
          ],
        });
      if (url.pathname.endsWith("/speech-script"))
        data.performanceTask = {
          id: "performance-error",
          status: "failed",
          progress: raw,
          total: 1,
          completed: 0,
          canResume: false,
        };
      return route.fulfill({ response: r, json: data });
    });
    const clean = async () =>
      assert.doesNotMatch(
        await page.locator("body").innerText(),
        /SYNTHETIC|synthetic|Authorization|Bearer|Basic|Provider/,
      );
    await page.goto(base + "/#project/error-ui/studio");
    await page
      .getByText("1 页未完成 · 查看原因与处理方式", { exact: true })
      .click();
    await page.getByText("具体错误", { exact: true }).click();
    await expect(page.locator(".job-raw-error")).toContainText("操作没有完成");
    await clean();
    await page
      .getByRole("navigation", { name: "项目区域" })
      .getByRole("button", { name: "演练中心", exact: true })
      .click();
    await page
      .getByRole("button", { name: "制作 AI 口播", exact: true })
      .click();
    await page.getByRole("tab", { name: "3 · 声音制作", exact: true }).click();
    await page.getByText("查看未完成页的原因", { exact: true }).click();
    await expect(
      page.getByRole("dialog").locator(".job-raw-error").first(),
    ).toContainText("操作没有完成");
    await clean();
    await page.getByRole("tab", { name: "2 · 演讲表达", exact: true }).click();
    await expect(page.getByText(/表达编排未完成/)).toBeVisible();
    await page
      .getByRole("dialog")
      .getByText("具体错误", { exact: true })
      .click();
    await clean();
    bootFailure = true;
    await page.reload();
    await expect(
      page.getByRole("button", { name: "重新连接", exact: true }),
    ).toBeVisible();
    await clean();
    assert.equal(posts, 0);
  },
);
