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
  copyFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { expect } from "@playwright/test";
import { launchBrowser } from "./helpers/browser.mjs";

test(
  "settings isolate categories, preserve drafts and credentials, and keep digital presenters opt-in with legacy access",
  { skip: !process.env.BROWSER_TEST, timeout: 60000 },
  async (t) => {
    const dir = mkdtempSync(path.join(tmpdir(), "autoppt-settings-ui-"));
    mkdirSync(path.join(dir, "assets"));
    copyFileSync(
      "public/style-covers/acid-editorial.png",
      path.join(dir, "assets", "avatar.png"),
    );
    const modelSettings = {
      text: {
        baseUrl: "https://content.example/v1",
        model: "content-model",
        apiKey: "synthetic-text-secret",
      },
      image: {
        baseUrl: "https://image.example/v1",
        model: "image-model",
        apiKey: "synthetic-image-secret",
      },
    };
    const speechSettings = {
      baseUrl: "https://api.minimax.cn/v1",
      model: "speech-2.8-hd",
      apiKey: "synthetic-minimax-secret",
      defaultVoiceId: "mine",
    };
    const provider = createHash("sha256")
      .update(speechSettings.baseUrl + "\n" + speechSettings.apiKey)
      .digest("hex");
    for (const [name, value] of Object.entries({
      "settings.json": modelSettings,
      "speech-settings.json": speechSettings,
      "presenter-settings.json": { apiKey: "synthetic-heygen-secret" },
    }))
      writeFileSync(path.join(dir, name), JSON.stringify(value));
    const db = new DatabaseSync(path.join(dir, "autoppt.sqlite"));
    db.exec(
      "CREATE TABLE records(kind TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(kind,id))",
    );
    const put = (kind, value) =>
      db
        .prepare("INSERT INTO records VALUES(?,?,?)")
        .run(kind, value.id, JSON.stringify(value));
    const now = new Date().toISOString();
    for (const id of ["fresh", "existing"])
      put("project", {
        id,
        title: id,
        styleId: "restrained-minimal",
        createdAt: now,
        updatedAt: now,
        revision: 1,
        draft: "保留原稿草稿",
        batches: [],
        slides: [
          {
            id: "page",
            notes: "保留这段逐字稿。",
            image: "avatar.png",
            status: "ready",
            manuscriptVersion: 1,
            versions: [],
          },
        ],
      });
    put("speaker", { id: "mine", name: "我的声音", provider, createdAt: now });
    put("avatar", {
      id: "avatar",
      name: "原来的数字人",
      previewAsset: "avatar.png",
      speechVoiceId: "mine",
      speechVoiceName: "我的声音",
      speechProvider: provider,
      createdAt: now,
    });
    put("rehearsal-plan", {
      id: "existing",
      actor: "digital",
      voiceId: "mine",
      avatarId: "avatar",
      visual: "original",
      pageId: "page",
    });
    const originalRecords = db
      .prepare("SELECT kind,id,data FROM records ORDER BY kind,id")
      .all();
    const originalAvatar = readFileSync(path.join(dir, "assets", "avatar.png"));
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
    t.after(async () => {
      await browser?.close();
      child.kill("SIGTERM");
      if (child.exitCode === null) await once(child, "exit");
      db.close();
      rmSync(dir, { recursive: true, force: true });
    });
    const [ready] = await once(child, "message");
    browser = await launchBrowser(t);
    if (!browser) return;
    const base = `http://127.0.0.1:${ready.port}`;
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    });
    await page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = async () => {
        const context = new AudioContext();
        const output = context.createMediaStreamDestination();
        const tone = context.createOscillator();
        tone.connect(output);
        tone.start();
        window.settingsMicrophoneTracks = output.stream.getTracks();
        let closing = false;
        for (const track of window.settingsMicrophoneTracks) {
          const stop = track.stop.bind(track);
          track.stop = () => {
            stop();
            if (!closing) {
              closing = true;
              void context.close();
            }
          };
        }
        return output.stream;
      };
    });
    const errors = [],
      mutations = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/*", (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== base) return route.abort();
      if (request.method() !== "GET" && url.pathname.startsWith("/api/"))
        mutations.push(url.pathname);
      if (url.pathname === "/api/settings/test")
        return route.fulfill({
          status: 400,
          json: { error: "模拟连接失败；已保存配置仍保留。" },
        });
      return route.continue();
    });
    const screenshot = async (name) => {
      if (!process.env.SETTINGS_REVIEW_DIR) return;
      mkdirSync(process.env.SETTINGS_REVIEW_DIR, { recursive: true });
      await page.screenshot({
        path: path.join(process.env.SETTINGS_REVIEW_DIR, name + ".png"),
        fullPage: true,
        animations: "disabled",
      });
    };
    await page.goto(base + "/#settings");
    await expect(page.getByRole("tab", { name: "模型服务" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(
      page.getByRole("heading", { name: "数字人工作室" }),
    ).toHaveCount(0);
    const text = page.getByRole("region", { name: "内容理解与风格分析" });
    await expect(text.getByLabel("接口地址")).toBeHidden();
    await screenshot("models-desktop");
    await text.getByText("修改连接配置", { exact: true }).click();
    await text.getByLabel("模型名称").fill("draft-model");
    await page.getByRole("tab", { name: "语音与声音" }).click();
    await expect(page.locator("#speech-settings")).toBeVisible();
    await expect(page.getByLabel("新项目默认声音")).toHaveValue("mine");
    await expect(page.getByLabel("语音 API Key")).toBeHidden();
    await screenshot("speech-desktop");
    await page.getByText("修改 MiniMax 连接", { exact: true }).click();
    await page.getByLabel("语音模型", { exact: true }).fill("speech-2.8-turbo");
    await page.getByRole("tab", { name: "实验室" }).click();
    await expect(
      page.getByRole("heading", { name: "数字人工作室" }),
    ).toBeVisible();
    await expect(page.locator("#presenter-settings")).toContainText("实验功能");
    await expect(
      page.getByRole("button", { name: /原来的数字人/ }),
    ).toBeVisible();
    await screenshot("labs-desktop");
    assert.deepEqual(
      mutations,
      [],
      "category navigation must never save settings or generate media",
    );
    for (const name of [
      "settings.json",
      "speech-settings.json",
      "presenter-settings.json",
    ])
      assert(
        !(await page
          .locator("body")
          .innerText()
          .then((v) =>
            v.includes(
              JSON.parse(readFileSync(path.join(dir, name))).apiKey ||
                "synthetic-text-secret",
            ),
          )),
      );
    await page.getByRole("tab", { name: "语音与声音" }).click();
    await expect(page.getByLabel("语音模型", { exact: true })).toHaveValue(
      "speech-2.8-turbo",
    );
    await page.getByRole("tab", { name: "模型服务" }).click();
    await expect(text.getByLabel("模型名称")).toHaveValue("draft-model");
    await text.getByRole("button", { name: "保存设置", exact: true }).click();
    await expect(text.getByLabel("接口地址")).toBeHidden();
    assert.equal(
      JSON.parse(readFileSync(path.join(dir, "settings.json"))).text.apiKey,
      modelSettings.text.apiKey,
    );
    assert.equal(
      JSON.parse(readFileSync(path.join(dir, "settings.json"))).image.apiKey,
      modelSettings.image.apiKey,
    );
    assert.deepEqual(
      JSON.parse(readFileSync(path.join(dir, "speech-settings.json"))),
      speechSettings,
    );
    await text.getByText("修改连接配置", { exact: true }).click();
    await text.getByRole("button", { name: /保存并测试连接/ }).click();
    await expect(text.getByRole("alert")).toContainText("模拟连接失败");
    await page.getByRole("tab", { name: "模型服务" }).focus();
    await page.keyboard.press("End");
    await expect(page.getByRole("tab", { name: "实验室" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByRole("tab", { name: "语音与声音" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await page.reload();
    await expect(page.getByRole("tab", { name: "语音与声音" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await page.evaluate(() =>
      sessionStorage.setItem("autoppt-settings-focus", "presenter-settings"),
    );
    await page.goto(base + "/#settings");
    await expect(page.getByRole("tab", { name: "实验室" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await page.setViewportSize({ width: 390, height: 844 });
    for (const name of ["模型服务", "语音与声音", "实验室"]) {
      await page.getByRole("tab", { name, exact: true }).click();
      await expect(
        page.getByRole("tabpanel", { name, exact: true }),
      ).toBeVisible();
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        name + " must fit mobile",
      );
      await screenshot(
        name === "模型服务"
          ? "models-mobile"
          : name === "语音与声音"
            ? "speech-mobile"
            : "labs-mobile",
      );
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(base + "/#project/fresh/rehearsal");
    await expect(
      page.getByRole("button", { name: "自己讲", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.getByRole("button", { name: "数字人讲解", exact: true }),
    ).toBeHidden();
    await screenshot("rehearsal-default");
    await page.goto(base + "/#project/existing/rehearsal");
    await expect(
      page.getByRole("button", { name: "数字人讲解", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "数字人讲解", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.goto(base + "/#settings/speech");
    await page.getByText("采集演讲者的声音", { exact: true }).click();
    await page.getByRole("button", { name: "开始录音", exact: true }).click();
    await expect(page.getByRole("button", { name: /结束录音/ })).toBeVisible();
    await page.getByRole("tab", { name: "模型服务" }).click();
    assert(
      await page.evaluate(() =>
        window.settingsMicrophoneTracks.every(
          (track) => track.readyState === "ended",
        ),
      ),
      "a hidden settings panel must never keep recording",
    );
    await page.getByRole("tab", { name: "语音与声音" }).click();
    await expect(page.getByRole("button", { name: /结束录音/ })).toHaveCount(0);
    for (const row of originalRecords)
      assert.equal(
        db
          .prepare("SELECT data FROM records WHERE kind=? AND id=?")
          .get(row.kind, row.id).data,
        row.data,
      );
    assert.deepEqual(
      readFileSync(path.join(dir, "assets", "avatar.png")),
      originalAvatar,
    );
    assert.deepEqual(errors, []);
  },
);
