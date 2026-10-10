import test from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import sharp from "sharp";
import { expect } from "@playwright/test";
import { launchBrowser } from "./helpers/browser.mjs";

test(
  "settings manage avatars and text previews; projects generate from notes without existing audio and play synchronized video",
  { timeout: 90000 },
  async (t) => {
    const dir = mkdtempSync(
      path.join(tmpdir(), "autoppt-presenter-studio-browser-"),
    );
    mkdirSync(path.join(dir, "assets"));
    const image = await sharp({
      create: { width: 160, height: 90, channels: 3, background: "#d4ddcb" },
    })
      .png()
      .toBuffer();
    writeFileSync(path.join(dir, "assets", "slide.png"), image);
    writeFileSync(
      path.join(dir, "presenter-settings.json"),
      JSON.stringify({ apiKey: "synthetic-browser-secret" }),
    );
    const db = new DatabaseSync(path.join(dir, "autoppt.sqlite"));
    db.exec(
      "CREATE TABLE records(kind TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(kind,id))",
    );
    const put = (kind, value) =>
      db
        .prepare("INSERT INTO records VALUES(?,?,?)")
        .run(kind, value.id, JSON.stringify(value));
    const now = new Date().toISOString();
    const project = {
      id: "presenter-project",
      title: "项目数字人验收",
      revision: 1,
      styleId: "restrained-minimal",
      createdAt: now,
      updatedAt: now,
      draft: "原草稿",
      batches: [],
      proposal: null,
      undo: null,
      slides: [
        {
          id: "page",
          plan: { title: "测试页面" },
          notes: "你好，欢迎来到今天的演讲。",
          image: "slide.png",
          scene: null,
          status: "ready",
          stale: false,
          versions: [],
          batchIds: [],
          styleId: "restrained-minimal",
          manuscriptVersion: 1,
        },
      ],
    };
    put("project", project);
    const speechConfig = {
      baseUrl: "https://api.minimax.cn/v1",
      model: "speech-2.8-hd",
      apiKey: "synthetic-speech-key",
    };
    writeFileSync(
      path.join(dir, "speech-settings.json"),
      JSON.stringify(speechConfig),
    );
    put("speaker", {
      id: "chinese-voice",
      name: "我的演讲声音",
      provider: createHash("sha256")
        .update(speechConfig.baseUrl + "\n" + speechConfig.apiKey)
        .digest("hex"),
      createdAt: now,
    });
    const child = fork("server/index.mjs", [], {
      silent: true,
      env: {
        ...process.env,
        NODE_ENV: "production",
        PORT: "0",
        AUTOPPT_DATA_DIR: dir,
      },
    });
    let browser;
    t.after(async () => {
      if (browser) await browser.close();
      if (child.exitCode === null) {
        const exited = once(child, "exit");
        child.kill();
        await exited;
      }
      db.close();
      rmSync(dir, { recursive: true, force: true });
    });
    const [ready] = await once(child, "message", {
      signal: AbortSignal.timeout(15000),
    });
    const base = `http://127.0.0.1:${ready.port}`;
    browser = await launchBrowser(t);
    if (!browser) return;
    const page = await browser.newPage({
      viewport: { width: 1280, height: 900 },
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const jobs = [],
      previews = [],
      bodies = [],
      rehearsalRuns = [];
    let completed = false;
    const videoBytes = readFileSync(
      new URL("./fixtures/presenter/presenter.mp4", import.meta.url),
    );
    await page.route("**/*", async (route) => {
      const req = route.request(),
        u = new URL(req.url());
      if (u.origin !== base) return route.abort();
      if (u.pathname.endsWith("/rehearsal/runs")) {
        if (req.method() === "POST") {
          const body = req.postDataJSON();
          bodies.push(body);
          assert.equal(body.confirmed, true);
          const plan = JSON.parse(
            db
              .prepare("SELECT data FROM records WHERE kind='rehearsal-plan'")
              .get().data,
          );
          const run = {
            id: body.requestId,
            scope: body.scope,
            trialLength: body.trialLength,
            plan,
            status: "running",
            message: "正在生成",
            compatible: true,
            voiceName: "我的演讲声音",
            createdAt: now,
            pages: [
              {
                id: "page",
                number: 1,
                title: "测试页面",
                text: project.slides[0].notes,
                clips: [],
              },
            ],
            presenter: null,
            motion: null,
          };
          rehearsalRuns.unshift(run);
          return route.fulfill({ status: 202, json: run });
        }
        if (completed && rehearsalRuns[0]) {
          const run = rehearsalRuns[0];
          run.status = "ready";
          run.message = "已完成";
          run.pages[0].clips = [
            {
              file: "fixture.mp4",
              text: project.slides[0].notes,
              duration: 2,
              status: "ready",
            },
          ];
        }
        return route.fulfill({ json: rehearsalRuns });
      }

      if (
        u.pathname.endsWith("/presenter/previews") ||
        u.pathname.endsWith("/presenter/generations")
      ) {
        const isPreview = u.pathname.endsWith("/previews"),
          list = isPreview ? previews : jobs;
        if (req.method() === "POST") {
          const body = req.postDataJSON();
          bodies.push(body);
          assert.equal(body.confirmed, true);
          const avatar = JSON.parse(
            db.prepare("SELECT data FROM records WHERE kind='avatar'").get()
              .data,
          );
          const job = {
            id: isPreview ? "preview" : "generation",
            avatarId: avatar.id,
            avatarName: avatar.name,
            voiceName: avatar.speechVoiceName,
            mode: "minimax",
            preview: isPreview,
            scope: "page",
            status: isPreview ? "ready" : "running",
            message: "正在生成讲解",
            compatible: true,
            placement: "bottom-right",
            size: "small",
            createdAt: now,
            pages: [
              {
                id: isPreview ? "preview" : "page",
                title: "测试页面",
                clips: [
                  {
                    index: 0,
                    duration: 2,
                    status: isPreview ? "ready" : "processing",
                    ...(isPreview
                      ? { file: "fixture.mp4", text: body.text }
                      : {}),
                  },
                ],
              },
            ],
          };
          list.push(job);
          return route.fulfill({ status: 202, json: job });
        }
        if (completed && jobs[0]) {
          jobs[0].status = "ready";
          jobs[0].pages[0].clips[0] = {
            index: 0,
            status: "ready",
            duration: 2,
            file: "fixture.mp4",
            text: project.slides[0].notes,
          };
        }
        return route.fulfill({ json: list });
      }
      if (u.pathname.startsWith("/api/presenter/video/"))
        return route.fulfill({ body: videoBytes, contentType: "video/mp4" });
      return route.continue();
    });
    await page.goto(base + "/#project/presenter-project/rehearsal");
    await expect(
      page.getByRole("button", { name: "管理 / 创建头像" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "管理 / 创建头像" }).click();
    await expect(
      page.getByRole("heading", { name: "数字人工作室", exact: true }),
    ).toBeVisible();
    const studio = page.locator("#presenter-settings");
    await studio.getByLabel("数字人名称", { exact: true }).fill("中文讲解员");
    await studio.getByLabel("上传头像").setInputFiles({
      name: "portrait.png",
      mimeType: "image/png",
      buffer: image,
    });
    await studio
      .getByLabel("头像风格", { exact: true })
      .selectOption("cartoon");
    await studio
      .getByLabel("MiniMax 声音", { exact: true })
      .selectOption("chinese-voice");
    await studio
      .getByRole("button", { name: "保存数字人", exact: true })
      .click();
    await expect(
      studio.getByRole("button", { name: "生成试播视频" }),
    ).toBeEnabled();
    await studio.getByLabel("试播文字").fill("你好，数字人试播。");
    await studio.getByRole("button", { name: "生成试播视频" }).click();
    await expect(page.getByRole("dialog").last()).toContainText(
      "文字先发送到 MiniMax",
    );
    await expect(page.getByRole("dialog").last()).toContainText(
      "头像和音频再发送到 HeyGen",
    );
    await page.getByRole("button", { name: "确认生成", exact: true }).click();
    await expect(studio.getByLabel("数字人试播视频")).toBeVisible();
    if (process.env.PRESENTER_REVIEW_DIR) {
      mkdirSync(process.env.PRESENTER_REVIEW_DIR, { recursive: true });
      await expect(
        page.getByText("试播已开始，完成后视频会显示在这里。"),
      ).toHaveCount(0);
      await studio
        .getByRole("heading", { name: "你的数字人", exact: true })
        .scrollIntoViewIfNeeded();
      await page.screenshot({
        path: path.join(process.env.PRESENTER_REVIEW_DIR, "studio-desktop.png"),
      });
      await page.setViewportSize({ width: 390, height: 844 });
      await studio
        .getByRole("heading", { name: "文字试播", exact: true })
        .scrollIntoViewIfNeeded();
      await page.screenshot({
        path: path.join(process.env.PRESENTER_REVIEW_DIR, "studio-mobile.png"),
      });
      await page.setViewportSize({ width: 1280, height: 900 });
      await studio.locator(".presenter-editor > summary").click();
      await studio
        .getByLabel("MiniMax 声音", { exact: true })
        .scrollIntoViewIfNeeded();
      await page.screenshot({
        path: path.join(process.env.PRESENTER_REVIEW_DIR, "voice-desktop.png"),
      });
      await page.setViewportSize({ width: 390, height: 844 });
      await studio
        .getByLabel("MiniMax 声音", { exact: true })
        .scrollIntoViewIfNeeded();
      await page.screenshot({
        path: path.join(process.env.PRESENTER_REVIEW_DIR, "voice-mobile.png"),
      });
      await page.setViewportSize({ width: 1280, height: 900 });
    }
    await page
      .getByRole("button", { name: "完成设置，返回演练", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "先试当前页", exact: true }),
    ).toBeEnabled();
    await expect(page.getByLabel("选择本场声音")).toHaveValue("chinese-voice");
    await page.getByLabel("当前页口播正文").fill(project.slides[0].notes);
    assert.equal(await page.getByLabel("上传头像").count(), 0);
    await page.getByRole("button", { name: "先试当前页", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText("MiniMax");
    await expect(page.getByRole("dialog")).toContainText("HeyGen");
    await page
      .getByRole("button", { name: "确认并开始生成", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    assert.equal(bodies.at(-1).scope, "trial");
    completed = true;
    await page
      .getByRole("button", { name: "播放数字人效果", exact: true })
      .click();
    await expect(page.getByLabel("数字人试播", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "连续播放", exact: true }).click();
    await expect
      .poll(() =>
        page
          .getByLabel("数字人试播", { exact: true })
          .evaluate((v) => v.currentTime),
      )
      .toBeGreaterThan(0);
    await page.getByRole("button", { name: "关闭", exact: true }).click();
    assert.deepEqual(
      JSON.parse(
        db
          .prepare("SELECT data FROM records WHERE kind='project' AND id=?")
          .get(project.id).data,
      ),
      project,
    );
    assert.equal(
      db.prepare("SELECT count(*) n FROM records WHERE kind='narration'").get()
        .n,
      0,
    );
    assert.equal(errors.length, 0, errors.join("\n"));
    if (process.env.PRESENTER_REVIEW_DIR) {
      await page
        .getByRole("heading", {
          name: "把这场演讲试好，再生成整场",
          exact: true,
        })
        .scrollIntoViewIfNeeded();
      await page.screenshot({
        path: path.join(
          process.env.PRESENTER_REVIEW_DIR,
          "project-desktop.png",
        ),
      });
      await page.setViewportSize({ width: 390, height: 844 });
      await page
        .getByRole("heading", {
          name: "把这场演讲试好，再生成整场",
          exact: true,
        })
        .scrollIntoViewIfNeeded();
      await page.screenshot({
        path: path.join(process.env.PRESENTER_REVIEW_DIR, "project-mobile.png"),
      });
    }
  },
);
