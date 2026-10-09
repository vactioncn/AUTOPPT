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
import { DatabaseSync } from "node:sqlite";
import sharp from "sharp";
import { expect } from "@playwright/test";
import { launchBrowser } from "./helpers/browser.mjs";

test(
  "projects expose a usable presenter setup, persist local avatar choices, and show explicit generation controls",
  { timeout: 90000 },
  async (t) => {
    const dir = mkdtempSync(
      path.join(tmpdir(), "autoppt-presenter-project-browser-"),
    );
    mkdirSync(path.join(dir, "assets"));
    mkdirSync(path.join(dir, "speech-audio"));
    const image = await sharp({
      create: { width: 160, height: 90, channels: 3, background: "#e6ebdb" },
    })
      .png()
      .toBuffer();
    writeFileSync(path.join(dir, "assets/slide.png"), image);
    const audio = "11111111-1111-4111-8111-111111111111.mp3";
    writeFileSync(path.join(dir, "speech-audio", audio), "local-fixture-audio");
    writeFileSync(
      path.join(dir, "presenter-settings.json"),
      JSON.stringify({ apiKey: "synthetic-browser-only-secret" }),
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
      draft: "",
      batches: [],
      proposal: null,
      undo: null,
      slides: [
        {
          id: "page",
          plan: { title: "测试页面" },
          notes: "测试讲稿",
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
    put("project", {
      ...project,
      id: "empty-project",
      title: "另一项目",
      slides: [],
    });
    put("narration", {
      id: "ready-narration",
      projectId: project.id,
      title: project.title,
      voiceName: "已完成测试口播",
      options: {
        voiceId: "Chinese (Mandarin)_Male_Announcer",
        emotion: "auto",
        speed: 1,
      },
      sourceRevision: 1,
      status: "ready",
      createdAt: now,
      pages: [
        {
          ...project.slides[0],
          number: 1,
          title: "测试页面",
          status: "ready",
          clips: [{ file: audio, text: "测试讲稿", duration: 2 }],
        },
      ],
    });
    const child = fork("server/index.mjs", [], {
      silent: true,
      env: {
        ...process.env,
        NODE_ENV: "production",
        AUTOPPT_DATA_DIR: dir,
        PORT: "0",
      },
    });
    let browser;
    t.after(async () => {
      await browser?.close();
      if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, "exit");
        child.kill();
        await exited;
      }
      db.close();
      rmSync(dir, { recursive: true, force: true });
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    const [ready] = await Promise.race([
      once(child, "message", { signal: AbortSignal.timeout(15000) }),
      once(child, "exit").then(([code]) => {
        throw new Error(`Server exited ${code}: ${stderr}`);
      }),
    ]);
    const base = `http://127.0.0.1:${ready.port}`;
    browser = await launchBrowser(t);
    if (!browser) return;
    const page = await browser.newPage({
      viewport: { width: 1280, height: 900 },
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const mutations = [];
    const remote = [];
    const mockJobs = [];
    let generated = false;
    const videoBytes = readFileSync(
      new URL("./fixtures/presenter/presenter.mp4", import.meta.url),
    );
    await page.route("**/*", async (route) => {
      const request = route.request(),
        url = new URL(request.url());
      if (url.origin !== base) {
        remote.push(url.origin);
        return route.abort();
      }
      if (url.pathname.endsWith("/presenter/generations")) {
        if (request.method() === "POST") {
          const body = request.postDataJSON();
          assert.equal(body.confirmed, true);
          assert.equal(body.scope, "page");
          assert.equal(body.pageId, "page");
          assert.match(body.requestId, /^[a-f0-9-]{36}$/);
          const selected = JSON.parse(
            db
              .prepare(
                "SELECT data FROM records WHERE kind='presenter-setup' AND id=?",
              )
              .get(project.id).data,
          );
          const job = {
            id: "mock-generation",
            ...selected,
            scope: "page",
            status: "running",
            compatible: true,
            createdAt: now,
            message: "HeyGen 正在生成数字人口型，请稍候",
            pages: [
              {
                id: "page",
                title: "测试页面",
                clips: [{ index: 0, status: "processing", duration: 2 }],
              },
            ],
          };
          mockJobs.push(job);
          return route.fulfill({ status: 202, json: job });
        }
        if (generated && mockJobs[0]) {
          mockJobs[0].status = "ready";
          mockJobs[0].message = "数字人口型已完成，可以预览并打开演讲播放器。";
          mockJobs[0].pages[0].clips[0] = {
            index: 0,
            status: "ready",
            file: "11111111-1111-4111-8111-111111111111.mp4",
            duration: 2,
          };
        }
        return route.fulfill({ json: mockJobs });
      }
      if (
        url.pathname.startsWith("/api/presenter/video/") ||
        url.pathname.startsWith("/api/speech/audio/")
      ) {
        const contentType = url.pathname.includes("/speech/")
          ? "audio/mp4"
          : "video/mp4";
        const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers().range || "");
        if (range) {
          const start = Number(range[1]),
            end = range[2] ? Number(range[2]) : videoBytes.length - 1;
          return route.fulfill({
            status: 206,
            body: videoBytes.subarray(start, end + 1),
            contentType,
            headers: {
              "Accept-Ranges": "bytes",
              "Content-Range": `bytes ${start}-${end}/${videoBytes.length}`,
            },
          });
        }
        return route.fulfill({
          body: videoBytes,
          contentType,
          headers: { "Accept-Ranges": "bytes" },
        });
      }
      if (!["GET", "HEAD"].includes(request.method())) {
        const action = request.method() + " " + url.pathname;
        mutations.push(action);
        assert.ok(
          [
            "POST /api/projects/presenter-project/presenter/avatars",
            "PUT /api/projects/presenter-project/presenter/setup",
          ].includes(action),
          "No paid request or unrelated write",
        );
      }
      await route.continue();
    });
    const panel = () =>
      page.getByRole("region", { name: "数字人讲解员", exact: true });
    const go = (id) => page.goto(base + "/#project/" + id + "/rehearsal");
    await go(project.id);
    await expect(panel()).toBeVisible();
    await expect(panel()).toContainText("可以生成数字人口型");
    await panel()
      .getByRole("button", { name: "配置数字人讲解员", exact: true })
      .click();
    await expect(
      panel().getByLabel("数字人头像", { exact: true }),
    ).toBeVisible();
    await expect(panel()).toContainText("HeyGen 密钥已保存");
    await panel()
      .getByLabel("新头像名称", { exact: true })
      .fill("本机测试头像");
    await panel().getByLabel("头像图片", { exact: true }).setInputFiles({
      name: "avatar.png",
      mimeType: "image/png",
      buffer: image,
    });
    await panel()
      .getByRole("button", { name: "保存头像", exact: true })
      .click();
    await expect(
      panel().getByLabel("数字人头像", { exact: true }),
    ).not.toHaveValue("");
    await panel()
      .getByLabel("数字人口播版本", { exact: true })
      .selectOption("ready-narration");
    await panel()
      .getByLabel("数字人位置", { exact: true })
      .selectOption("top-left");
    await panel()
      .getByLabel("数字人大小", { exact: true })
      .selectOption("large");
    await panel()
      .getByRole("button", { name: "保存本项目数字人配置", exact: true })
      .click();
    await expect(panel()).toContainText("本项目的数字人配置已保存");
    const row = JSON.parse(
      db
        .prepare(
          "SELECT data FROM records WHERE kind='presenter-setup' AND id=?",
        )
        .get(project.id).data,
    );
    assert.equal(row.narrationId, "ready-narration");
    assert.equal(row.placement, "top-left");
    assert.equal(row.size, "large");
    await expect(
      panel().getByRole("button", { name: "生成本页数字人口型", exact: true }),
    ).toBeEnabled();
    await panel()
      .getByRole("button", { name: "生成本页数字人口型", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toContainText(
      "HeyGen 按音频时长计费",
    );
    assert.equal(
      mockJobs.length,
      0,
      "Opening confirmation cannot create a paid video",
    );
    await page
      .getByRole("button", { name: "确认并开始生成", exact: true })
      .click();
    await expect(panel()).toContainText("HeyGen 正在生成");
    generated = true;
    await expect(panel()).toContainText("1/1 片段已完成");
    await panel()
      .getByRole("button", { name: "打开演讲播放器", exact: true })
      .click();
    const player = page.getByRole("dialog", { name: "播放演讲", exact: true });
    await expect(
      player.getByLabel("显示数字人", { exact: true }),
    ).toBeChecked();
    const synced = player.getByLabel("同步数字人讲解", { exact: true });
    await expect(synced).toBeVisible();
    await player
      .locator("audio")
      .first()
      .evaluate((el) => {
        el.loop = true;
      });
    await player.getByRole("button", { name: "开始口播", exact: true }).click();
    await expect
      .poll(() =>
        synced.evaluate((v) => !v.paused && v.muted && v.currentTime > 0),
      )
      .toBe(true);
    await player.getByLabel("实时播放倍速").selectOption("1.5");
    await expect.poll(() => synced.evaluate((v) => v.playbackRate)).toBe(1.5);
    await player.getByRole("button", { name: "暂停口播", exact: true }).click();
    await expect.poll(() => synced.evaluate((v) => v.paused)).toBe(true);
    await player
      .locator("audio")
      .first()
      .evaluate((el) => {
        el.currentTime = 1;
      });
    await expect
      .poll(() => synced.evaluate((v) => Math.abs(v.currentTime - 1) < 0.2))
      .toBe(true);
    await player.getByLabel("显示数字人", { exact: true }).uncheck();
    await expect(synced).toHaveCount(0);
    await player
      .getByRole("button", { name: "关闭演讲播放器", exact: true })
      .click();
    assert.equal(
      db
        .prepare("SELECT data FROM records WHERE kind='project' AND id=?")
        .get(project.id).data,
      JSON.stringify(project),
    );
    await page.reload();
    await panel()
      .getByRole("button", { name: "配置数字人讲解员", exact: true })
      .click();
    await expect(panel().getByLabel("数字人位置", { exact: true })).toHaveValue(
      "top-left",
    );
    await expect(
      panel().getByRole("img", {
        name: "本机测试头像 · 头像位置示意",
        exact: true,
      }),
    ).toBeVisible();
    const newerNarration = JSON.parse(
      db
        .prepare(
          "SELECT data FROM records WHERE kind='narration' AND id='ready-narration'",
        )
        .get().data,
    );
    put("narration", {
      ...newerNarration,
      id: "newly-ready-narration",
      voiceName: "刚完成的另一份口播",
    });
    await expect(
      panel().getByLabel("数字人口播版本", { exact: true }),
    ).toContainText("刚完成的另一份口播");
    await expect(
      panel().getByLabel("数字人口播版本", { exact: true }),
    ).toHaveValue("ready-narration");
    await panel()
      .getByLabel("数字人位置", { exact: true })
      .selectOption("bottom-right");
    await go("empty-project");
    await panel()
      .getByRole("button", { name: "配置数字人讲解员", exact: true })
      .click();
    await expect(panel().getByLabel("数字人头像", { exact: true })).toHaveValue(
      "",
    );
    await expect(panel()).toContainText("请先在 AI 口播中完成");
    await go(project.id);
    await panel()
      .getByRole("button", { name: "配置数字人讲解员", exact: true })
      .click();
    await expect(panel().getByLabel("数字人位置", { exact: true })).toHaveValue(
      "bottom-right",
    );
    await expect(panel()).toContainText("有未保存的项目选择");
    await panel()
      .getByRole("button", { name: "保存本项目数字人配置", exact: true })
      .click();
    await expect(panel()).toContainText("本项目的数字人配置已保存");
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        "No horizontal overflow",
      );
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await panel().scrollIntoViewIfNeeded();
    const evidence = path.resolve("test-results/presenter-project");
    mkdirSync(evidence, { recursive: true });
    await page.screenshot({
      path: path.join(evidence, "project-setup.png"),
      fullPage: true,
    });
    assert.deepEqual(errors, []);
    assert.deepEqual(remote, []);
    assert.equal(mutations.filter((v) => v.includes("/avatars")).length, 1);
    assert.equal(mutations.filter((v) => v.includes("/setup")).length, 2);
    await expect(page.locator("body")).not.toContainText(
      "synthetic-browser-only-secret",
    );
    assert.equal(
      (
        await (
          await fetch(base + "/api/projects/" + project.id + "/presenter/setup")
        ).json()
      ).generationAvailable,
      true,
    );
  },
);
