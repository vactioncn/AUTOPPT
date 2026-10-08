import test from "node:test";
import { mockGlobalPlan } from "./helpers/performance-model.mjs";
import sharp from "sharp";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fork } from "node:child_process";
import { once } from "node:events";
import http from "node:http";
import { DatabaseSync } from "node:sqlite";
import { silenceMp3 } from "./helpers/speech-audio.mjs";
import { verifySpeechPreview } from "./helpers/speech-preview-browser.mjs";
import { SPEECH_DEFAULTS } from "../shared/speech.mjs";

test(
  "performance API composes, previews, synthesizes and preserves originals; stale plans and failures never replace saved audio",
  { timeout: 120000 },
  async (t) => {
    const dir = mkdtempSync(path.join(tmpdir(), "autoppt-performance-"));
    mkdirSync(path.join(dir, "assets"));
    writeFileSync(
      path.join(dir, "assets/sample.png"),
      await sharp({
        create: {
          width: 1280,
          height: 720,
          channels: 3,
          background: "#e7eddf",
        },
      })
        .png()
        .toBuffer(),
    );
    const db = new DatabaseSync(path.join(dir, "autoppt.sqlite"));
    db.exec(
      "PRAGMA journal_mode=WAL; CREATE TABLE records(kind TEXT,id TEXT,data TEXT,PRIMARY KEY(kind,id))",
    );
    const project = {
      id: "performance-project",
      title: "一个转折",
      draft: "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      revision: 1,
      styleId: "restrained-minimal",
      batches: [],
      slides: [
        {
          id: "first",
          image: "sample.png",
          notes: "主标题：转折\n当时我们很难。后来大家都笑了！",
          manuscriptVersion: 1,
          plan: { title: "转折" },
          status: "ready",
          stale: false,
          versions: [],
          batchIds: [],
        },
        {
          id: "silent",
          image: "sample.png",
          notes: "主标题：谢谢",
          manuscriptVersion: 1,
          plan: { title: "结束" },
          status: "ready",
          versions: [],
          batchIds: [],
        },
      ],
    };
    db.prepare("INSERT INTO records VALUES (?,?,?)").run(
      "project",
      project.id,
      JSON.stringify(project),
    );
    let fail = false,
      hold = false,
      release = null;
    const requests = [],
      speech = [];
    const provider = http.createServer(async (req, res) => {
      let raw = "";
      for await (const b of req) raw += b;
      const body = JSON.parse(raw);
      res.setHeader("content-type", "application/json");
      if (req.url.endsWith("/chat/completions")) {
        const input = JSON.parse(body.messages[1].content[0].text);
        requests.push(input);
        if (hold)
          await new Promise((r) => {
            release = r;
          });
        if (fail) {
          res.statusCode = 503;
          return res.end(JSON.stringify({ error: { message: "test outage" } }));
        }
        return res.end(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify(
                    mockGlobalPlan(input) || {
                      units: input.units.map((u, i) => ({
                        id: u.id,
                        emotion: i ? "happy" : "calm",
                        pace: 1,
                        pauseAfter: 0.6,
                        emphasis: !i,
                        sound: i ? "chuckle" : "",
                        reason: i ? "故事转向轻松" : "回顾困难，语气沉稳",
                      })),
                    },
                  ),
                },
              },
            ],
          }),
        );
      }
      speech.push(body);
      res.end(
        JSON.stringify({
          data: { audio: silenceMp3.toString("hex"), status: 2 },
          extra_info: { audio_length: 1000 },
          base_resp: { status_code: 0 },
        }),
      );
    });
    provider.listen(0, "127.0.0.1");
    await once(provider, "listening");
    const baseUrl = `http://127.0.0.1:${provider.address().port}/v1`;
    writeFileSync(
      path.join(dir, "settings.json"),
      JSON.stringify({
        text: { baseUrl, model: "director-mock", apiKey: "test" },
      }),
    );
    writeFileSync(
      path.join(dir, "speech-settings.json"),
      JSON.stringify({ baseUrl, model: "speech-2.8-hd", apiKey: "test" }),
    );
    let proc, base;
    async function start() {
      proc = fork("server/index.mjs", [], {
        silent: true,
        env: {
          ...process.env,
          AUTOPPT_DATA_DIR: dir,
          PORT: "0",
          NODE_ENV: "production",
          AUTOPPT_WORKER_TOKEN: "",
          AUTOPPT_DESKTOP_TOKEN: "",
        },
      });
      proc.stdout.on("data", () => {});
      proc.stderr.on("data", () => {});
      const [ready] = await once(proc, "message");
      base = `http://127.0.0.1:${ready.port}`;
    }
    async function stop() {
      const done = once(proc, "exit");
      proc.kill();
      await done;
    }
    t.after(async () => {
      release?.();
      await stop();
      provider.closeAllConnections();
      await new Promise((r) => provider.close(r));
      db.close();
      rmSync(dir, { recursive: true, force: true });
    });
    await start();
    async function api(route, body, expected = 200, method = "POST") {
      const response = await fetch(
        base + "/api" + route,
        body
          ? {
              method,
              headers: { "content-type": "application/json" },
              body: JSON.stringify(body),
            }
          : {},
      );
      const result = await response.json();
      assert.equal(response.status, expected, JSON.stringify(result));
      return result;
    }
    async function wait(get) {
      for (let i = 0; i < 1600; i++) {
        const value = await get();
        if (value) return value;
        await new Promise((r) => setTimeout(r, 20));
      }
      throw new Error("timeout");
    }
    const route = `/projects/${project.id}`,
      pageTexts = {
        first: project.slides[0].notes,
        silent: project.slides[1].notes,
      };
    await api(route + "/speech-performance", { revision: 0, pageTexts }, 409);
    const begun = await api(
      route + "/speech-performance",
      { revision: 1, pageTexts, settings: { sounds: true } },
      202,
    );
    assert.equal(begun.pages[0].text, "当时我们很难。后来大家都笑了！");
    const done = await wait(async () => {
      const s = await api(route + "/speech-script");
      return s.performanceTask.status === "ready" && s;
    });
    const plan = done.performance;
    assert.equal(requests.length, 2);
    assert.equal(speech.length, 0);
    assert.equal(plan.pages[1].units.length, 0);
    assert.equal(
      plan.pages[0].units.map((u) => u.text).join(""),
      done.pages[0].text,
    );
    const cleanTexts = Object.fromEntries(
      done.pages.map((p) => [p.id, p.text]),
    );
    const create = (extra) =>
      api(
        route + "/narration",
        {
          revision: 1,
          options: SPEECH_DEFAULTS,
          pageTexts: cleanTexts,
          performanceId: plan.id,
          ...extra,
        },
        202,
      );
    await api("/speech/preview", {
      options: SPEECH_DEFAULTS,
      text: cleanTexts.first,
      projectId: project.id,
      pageId: "first",
      performanceId: plan.id,
    });
    assert.equal(speech[0].voice_setting.emotion, "calm");
    assert.equal(speech[0].voice_setting.vol, 1.12);
    const deck = await create();
    const ready = await wait(async () => {
      const d = await api("/narration/" + deck.id);
      return d.status === "ready" && d;
    });
    assert.equal(
      speech.length,
      2,
      "preview first segment reused by full synthesis",
    );
    assert.match(speech[1].text, /\(chuckle\)/);
    assert.equal(speech[1].voice_setting.emotion, "happy");
    assert.equal(ready.pages[0].clips[0].pauseAfter, 0.6);
    assert.equal(ready.pages[1].clips.length, 0);
    assert.equal(ready.performance.id, plan.id);
    assert.deepEqual(
      (await api(route)).slides.map((p) => p.notes),
      project.slides.map((p) => p.notes),
    );
    const retry = await create();
    await wait(
      async () => (await api("/narration/" + retry.id)).status === "ready",
    );
    assert.equal(
      speech.length,
      2,
      "compiled controls participate in cache identity",
    );
    await api(
      route + "/narration",
      {
        revision: 1,
        options: SPEECH_DEFAULTS,
        performanceId: plan.id,
        pageTexts: { ...cleanTexts, first: "新正文。" },
      },
      409,
    );
    await api("/settings/speech", { model: "speech-2.6-hd" }, 200, "PUT");
    await api(
      route + "/narration",
      {
        revision: 1,
        options: SPEECH_DEFAULTS,
        pageTexts: cleanTexts,
        performanceId: plan.id,
      },
      400,
    );
    assert.equal(speech.length, 2);
    fail = true;
    await api(
      route + "/speech-performance",
      { revision: 1, pageTexts: cleanTexts },
      202,
    );
    await wait(
      async () =>
        (await api(route + "/speech-script")).performanceTask.status ===
        "failed",
    );
    assert.equal((await api(route + "/speech-script")).performance.id, plan.id);
    assert.equal((await api("/narration/" + deck.id)).status, "ready");
    fail = false;
    hold = true;
    await api(
      route + "/speech-performance",
      { revision: 1, pageTexts: cleanTexts },
      202,
    );
    await wait(async () => release);
    assert.equal((await api("/activity")).activeJobs, 1);
    await api(route + "/speech-performance/cancel", {});
    await wait(
      async () =>
        (await api(route + "/speech-script")).performanceTask.status ===
        "cancelled",
    );
    release();
    hold = false;
    const stored = JSON.parse(
      db
        .prepare("SELECT data FROM records WHERE kind='speech-script' AND id=?")
        .get(project.id).data,
    );
    stored.performanceTask.status = "running";
    db.prepare(
      "UPDATE records SET data=? WHERE kind='speech-script' AND id=?",
    ).run(JSON.stringify(stored), project.id);
    await stop();
    await start();
    assert.equal(
      (await api(route + "/speech-script")).performanceTask.status,
      "interrupted",
    );
    assert.equal((await api(route + "/speech-script")).performance.id, plan.id);
    const exported = await fetch(base + "/api/narration/" + deck.id + "/html");
    assert.equal(exported.status, 200);
    const html = await exported.text();
    assert.match(html, /"pauseAfter":0.6/);
    assert.match(html, /data:audio\/mpeg;base64/);
    if (process.env.PERFORMANCE_BROWSER_TEST === "1") {
      await api("/settings/speech", { model: "speech-2.8-hd" }, 200, "PUT");
      const { chromium } = await import("playwright-core");
      const browser = await chromium.launch({
        headless: true,
        executablePath:
          process.env.CHROMIUM_EXECUTABLE ||
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        args: ["--autoplay-policy=no-user-gesture-required"],
      });
      try {
        const page = await browser.newPage({
          viewport: { width: 1440, height: 1000 },
        });
        const errors = [];
        page.on("pageerror", (e) => errors.push(e.message));
        await page.goto(base + "/#project/" + project.id + "/rehearsal");
        await page
          .getByRole("button", { name: "打开演讲播放器", exact: true })
          .waitFor({ timeout: 5000 })
          .catch(async (e) => {
            writeFileSync(
              "/tmp/autoppt-performance-failure.txt",
              (await page.locator("body").innerText()) +
                "\nERRORS\n" +
                errors.join("\n"),
            );
            throw e;
          });
        await page
          .getByRole("button", { name: "制作 AI 口播", exact: true })
          .click();
        assert.equal(
          await page
            .getByRole("tab", { name: "1 · 口播文本", exact: true })
            .getAttribute("aria-selected"),
          "true",
        );
        const out = process.env.PERFORMANCE_SCREENSHOT_DIR;
        if (out) {
          mkdirSync(out, { recursive: true });
          await page.screenshot({ path: path.join(out, "speech-text.png") });
        }
        await page
          .getByRole("tab", { name: "2 · 演讲表达", exact: true })
          .click();
        await page
          .getByRole("button", { name: "重新编排演讲", exact: true })
          .click();
        await page
          .getByRole("dialog", { name: "确认编排整场演讲", exact: true })
          .getByRole("button", { name: "确认编排整场演讲", exact: true })
          .click();
        await page
          .getByText("演绎编排已完成，请逐页检查后生成口播", { exact: true })
          .waitFor();
        assert(
          await page
            .getByRole("button", { name: "开始口播", exact: true })
            .isEnabled(),
        );
        await page
          .getByRole("tab", { name: "1 · 口播文本", exact: true })
          .click();
        assert.equal(
          await page.getByLabel("实际口播文本", { exact: true }).inputValue(),
          cleanTexts.first,
        );
        await page
          .getByRole("button", {
            name: "保存并继续 · 选择演讲表达",
            exact: true,
          })
          .click();
        await page
          .getByText("重点句 · 稍慢、略增强", { exact: true })
          .waitFor();

        if (out) {
          mkdirSync(out, { recursive: true });
          await page.screenshot({
            path: path.join(out, "performance-review.png"),
            fullPage: true,
          });
        }
        await page
          .getByRole("button", { name: "使用方案 · 选择声音", exact: true })
          .click();
        assert(await page.getByLabel("整体情绪", { exact: true }).isDisabled());
        if (out) {
          await page.screenshot({ path: path.join(out, "speech-voice.png") });
          await page.setViewportSize({ width: 800, height: 900 });
          await page.locator(".speech-setup").scrollIntoViewIfNeeded();
          await page.screenshot({ path: path.join(out, "speech-narrow.png") });
          assert.equal(
            await page.evaluate(
              () => document.documentElement.scrollWidth > innerWidth,
            ),
            false,
          );
          await page.setViewportSize({ width: 1280, height: 820 });
        }
        await verifySpeechPreview(page, ready.pages[0].clips[0].file, out);
        await page
          .getByRole("button", { name: "生成整场口播 · 2 页", exact: true })
          .click();
        await page
          .getByRole("dialog", { name: "确认生成整场口播", exact: true })
          .getByRole("button", { name: "确认生成整场口播", exact: true })
          .click();
        await page
          .getByRole("button", { name: "使用新口播版本", exact: true })
          .click({ timeout: 15000 });
        await page
          .getByRole("button", { name: "开始口播", exact: true })
          .click();
        await page.getByText(/表达停顿中/).waitFor();
        await page
          .getByRole("button", { name: "暂停口播", exact: true })
          .click();
        const source = await page
          .locator(".speech-shell > audio")
          .getAttribute("src");
        await page.waitForTimeout(850);
        assert.equal(
          await page.locator(".speech-shell > audio").getAttribute("src"),
          source,
          "paused delivery gap must not advance",
        );
        await page
          .getByLabel("实时播放倍速", { exact: true })
          .selectOption("1.5");
        await page
          .getByRole("button", { name: "开始口播", exact: true })
          .click();
        await page
          .getByText("演讲已结束", { exact: true })
          .waitFor({ timeout: 15000 });
        assert.equal(
          speech.length,
          2,
          JSON.stringify(
            speech.map((r) => ({ text: r.text, voice: r.voice_setting })),
          ),
        );
        await page
          .getByRole("button", { name: "返回演播台", exact: true })
          .click();
        await page
          .getByRole("tab", { name: "1 · 口播文本", exact: true })
          .click();
        await page
          .getByLabel("查看口播页", { exact: true })
          .selectOption("first");
        await page
          .getByLabel("实际口播文本", { exact: true })
          .fill("临时改稿。");
        await page
          .getByRole("button", {
            name: "保存并继续 · 选择演讲表达",
            exact: true,
          })
          .click();
        await page.getByText(/正文已修改，编排需要更新/).waitFor();
        await page
          .getByRole("tab", { name: "3 · 声音制作", exact: true })
          .click();
        assert(
          await page
            .getByRole("button", { name: "生成整场口播 · 2 页", exact: true })
            .isDisabled(),
        );
        const requestsBeforeSkip = requests.length;
        await page
          .getByRole("tab", { name: "2 · 演讲表达", exact: true })
          .click();
        await page
          .getByRole("button", {
            name: "跳过 AI 编排 · 使用普通口播",
            exact: true,
          })
          .click();
        assert(await page.getByLabel("整体情绪", { exact: true }).isEnabled());
        assert(
          await page
            .getByRole("button", { name: "生成整场口播 · 2 页", exact: true })
            .isEnabled(),
        );
        assert.equal(
          requests.length,
          requestsBeforeSkip,
          "ordinary branch must not invoke AI arrangement",
        );
        await page.getByRole("tab", { name: "放映", exact: true }).click();
        assert(
          await page
            .getByRole("button", { name: "开始口播", exact: true })
            .isEnabled(),
          "saved audio survives all preparation steps",
        );
        // A failed AI step must expose a recovery path, while the existing recording stays playable.
        fail = true;
        await page
          .getByRole("tab", { name: "2 · 演讲表达", exact: true })
          .click();
        await page
          .getByRole("button", { name: "重新编排演讲", exact: true })
          .click();
        await page
          .getByRole("dialog", { name: "确认编排整场演讲", exact: true })
          .getByRole("button", { name: "确认编排整场演讲", exact: true })
          .click();
        await page
          .getByRole("alert")
          .filter({ hasText: "编排已停止，不会自动重试" })
          .waitFor();
        assert(
          await page
            .getByRole("button", {
              name: "跳过 AI 编排 · 使用普通口播",
              exact: true,
            })
            .isEnabled(),
        );
        assert(
          await page
            .getByRole("button", { name: "开始口播", exact: true })
            .isEnabled(),
        );
        if (out)
          await page.screenshot({
            path: path.join(out, "speech-arrange-failed.png"),
          });
        await page
          .getByRole("button", {
            name: "跳过 AI 编排 · 使用普通口播",
            exact: true,
          })
          .click();
        fail = false;
        const offline = await browser.newPage();
        await offline.setContent(html);
        await offline
          .getByText("演讲已结束 · 点击开始口播可从头重播", { exact: true })
          .waitFor({ timeout: 15000 });
        assert.equal(errors.length, 0, errors.join("\n"));
      } finally {
        await browser.close();
      }
    }
  },
);
