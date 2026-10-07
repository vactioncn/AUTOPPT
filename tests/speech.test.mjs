import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import http from "node:http";
import { once } from "node:events";
import { fork } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import sharp from "sharp";
import {
  SPEECH_DEFAULTS,
  speechOptions,
  splitSpeech,
} from "../shared/speech.mjs";
import { validateSample } from "../server/speech/provider.mjs";
import permissions from "../desktop/media-permissions.cjs";
import { silenceMp3 } from "./helpers/speech-audio.mjs";

function wav(seconds = 12) {
  const b = Buffer.alloc(44 + 32000 * seconds);
  b.write("RIFF", 0);
  b.writeUInt32LE(b.length - 8, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(16000, 24);
  b.writeUInt32LE(32000, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(b.length - 44, 40);
  return b;
}
test("speech preserves every character while splitting long multilingual manuscripts", () => {
  const text = "先讲一个故事。\n" + "汉字🙂ABC，".repeat(1400) + "\n最后一段！";
  const chunks = splitSpeech(text);
  assert.equal(chunks.join(""), text);
  assert(chunks.every((c) => Array.from(c).length <= 2500));
  assert.throws(() => speechOptions({ speed: Infinity }));
  assert.throws(() => speechOptions({ emotion: "made-up" }));
  assert.throws(() => splitSpeech(text, 0));
});
test("voice samples validate content and real WAV duration before provider upload", () => {
  assert.equal(validateSample({ buffer: wav() }), "wav");
  assert.throws(() => validateSample({ buffer: wav(2) }), /10 秒/);
  assert.throws(() => validateSample({ buffer: wav(301) }), /5 分钟/);
  assert.throws(
    () => validateSample({ buffer: Buffer.from("<script>bad</script>") }),
    /格式/,
  );
  assert.throws(
    () => validateSample({ buffer: wav().subarray(0, 100) }),
    /不完整/,
  );
});
test("desktop permits only its own main-frame microphone and fullscreen requests", () => {
  const origin = "http://127.0.0.1:1234",
    web = { getURL: () => origin, isDestroyed: () => false };
  const details = {
    requestingUrl: origin,
    securityOrigin: origin,
    isMainFrame: true,
    mediaTypes: ["audio"],
  };
  assert(permissions.allowRequest(origin, web, "media", details));
  assert(permissions.allowRequest(origin, web, "fullscreen", details));
  assert(
    !permissions.allowRequest(origin, web, "media", {
      ...details,
      mediaTypes: ["video", "audio"],
    }),
  );
  assert(
    !permissions.allowRequest(origin, web, "media", {
      ...details,
      isMainFrame: false,
    }),
  );
  assert(
    !permissions.allowRequest(origin, web, "media", {
      ...details,
      securityOrigin: "https://example.com",
    }),
  );
  assert(!permissions.allowRequest(origin, null, "media", details));
  assert(!permissions.allowRequest(origin, web, "notifications", details));
});

test(
  "narration API preserves snapshots, caches clips, retries failures, clones voices and recovers safely",
  { timeout: 360000 },
  async (t) => {
    const temp = mkdtempSync(path.join(tmpdir(), "autoppt-speech-"));
    // Match the default workspace, including its hidden parent directory.
    const dir = path.join(temp, ".local");
    mkdirSync(dir);
    mkdirSync(path.join(dir, "assets"));
    writeFileSync(
      path.join(dir, "assets/sample.png"),
      await sharp(
        Buffer.from(
          '<svg width="1600" height="900"><rect width="1600" height="900" fill="#f4f1e7"/><text x="120" y="390" font-family="Arial" font-size="100" fill="#202620">A story worth telling.</text><text x="125" y="490" font-family="Arial" font-size="32" fill="#6c735f">AUTOPPT  /  VOICE PRESENTATION</text></svg>',
        ),
      )
        .png()
        .toBuffer(),
    );
    const db = new DatabaseSync(path.join(dir, "autoppt.sqlite"));
    db.exec(
      "PRAGMA journal_mode=WAL; CREATE TABLE records (kind TEXT,id TEXT,data TEXT, PRIMARY KEY(kind,id))",
    );
    const project = {
      id: "speech-project",
      title: "让故事被听见",
      revision: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      styleId: "restrained-minimal",
      draft: "",
      batches: [],
      slides: [
        "今天我想和大家分享一个故事。".repeat(220),
        "谢谢大家。愿每一个好的想法，都能被听见。",
      ].map((notes, i) => ({
        id: `page-${i}`,
        notes,
        image: "sample.png",
        scene: null,
        styleId: "restrained-minimal",
        plan: { title: i ? "让好想法被听见" : "从一个故事开始" },
        batchIds: [],
        versions: [],
        status: "ready",
        stale: false,
        manuscriptVersion: 1,
      })),
    };
    db.prepare("INSERT INTO records VALUES (?,?,?)").run(
      "project",
      project.id,
      JSON.stringify(project),
    );
    let calls = [],
      uploads = 0,
      clones = 0,
      failAt = 2,
      failCode = 1008,
      hold = false,
      gates = [];
    const provider = http.createServer(async (req, res) => {
      const buffers = [];
      for await (const chunk of req) buffers.push(chunk);
      const raw = Buffer.concat(buffers).toString();
      res.setHeader("Content-Type", "application/json");
      if (req.url === "/v1/files/upload") {
        uploads++;
        assert(raw.includes('name="purpose"'));
        assert(raw.includes("voice_clone"));
        return res.end(
          '{"file":{"file_id":9007199254740993},"base_resp":{"status_code":0}}',
        );
      }
      if (req.url === "/v1/voice_clone") {
        clones++;
        assert(raw.includes('"file_id":9007199254740993'));
        return res.end('{"base_resp":{"status_code":0}}');
      }
      assert.equal(req.url, "/v1/t2a_v2");
      const payload = JSON.parse(raw);
      calls.push(payload);
      assert.equal(payload.output_format, "hex");
      assert.equal(payload.stream, false);
      if (hold) await new Promise((resolve) => gates.push(resolve));
      if (calls.length === failAt)
        return res.end(
          JSON.stringify({
            base_resp: {
              status_code: failCode,
              status_msg: "must not expose sk-secret-provider",
            },
          }),
        );
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
    const config = {
      baseUrl: `http://127.0.0.1:${provider.address().port}/v1`,
      model: "speech-2.8-hd",
      apiKey: "test-secret",
    };
    let proc, base;
    async function start(extra = {}) {
      proc = fork("server/index.mjs", [], {
        silent: true,
        env: {
          ...process.env,
          AUTOPPT_DATA_DIR: dir,
          PORT: "0",
          NODE_ENV: "production",
          AUTOPPT_WORKER_TOKEN: "",
          AUTOPPT_DESKTOP_TOKEN: "",
          ...extra,
        },
      });
      proc.stdout.on("data", () => {});
      proc.stderr.on("data", () => {});
      const [ready] = await Promise.race([
        once(proc, "message"),
        once(proc, "exit").then(() => {
          throw new Error("server exited");
        }),
      ]);
      base = `http://127.0.0.1:${ready.port}`;
    }
    async function stop() {
      if (proc?.exitCode === null) {
        const exited = once(proc, "exit");
        proc.kill();
        await exited;
      }
    }
    t.after(async () => {
      await stop();
      gates.forEach((r) => r());
      provider.closeAllConnections();
      await new Promise((r) => provider.close(r));
      db.close();
      rmSync(temp, { recursive: true, force: true });
    });
    await start();
    const get = async (url) => (await fetch(base + url)).json();
    const request = async (url, body, method = "POST", status = 200) => {
      const res = await fetch(base + url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      assert.equal(res.status, status, JSON.stringify(data));
      return data;
    };
    const until = async (fn) => {
      for (let n = 0; n < 2000; n++) {
        const value = await fn();
        if (value) return value;
        await new Promise((r) => setTimeout(r, 20));
      }
      throw new Error("timed out");
    };
    const complete = (id) =>
      until(async () => {
        const d = await get(`/api/narration/${id}`);
        return !["queued", "running"].includes(d.status) && d;
      });
    const create = (
      revision = 1,
      options = SPEECH_DEFAULTS,
      pageEmotions = {},
    ) =>
      request(
        `/api/projects/${project.id}/narration`,
        { revision, options, pageEmotions },
        "POST",
        202,
      );
    await request(
      `/api/projects/${project.id}/narration`,
      { revision: 1 },
      "POST",
      400,
    );
    const saved = await request("/api/settings/speech", config, "PUT");
    assert(saved.hasKey);
    assert(!JSON.stringify(saved).includes(config.apiKey));
    assert.equal((await get("/api/speech/voices")).length, 4);
    await request(
      `/api/projects/${project.id}/narration`,
      { revision: 0 },
      "POST",
      409,
    );
    let d = await complete((await create()).id);
    assert.equal(d.status, "partial");
    assert.equal(calls.length, 2);
    assert(!JSON.stringify(d).includes("sk-secret"));
    assert(!("provider" in d));
    assert(d.pages[0].clips[0].file);
    failAt = -1;
    await request(`/api/narration/${d.id}/retry`, {}, "POST", 202);
    d = await complete(d.id);
    assert.equal(d.status, "ready");
    assert.equal(calls.length, 4);
    assert.equal(calls[0].text + calls[2].text, project.slides[0].notes);
    assert.equal(calls[0].voice_setting.emotion, undefined);
    assert.deepEqual(await get(`/api/projects/${project.id}`), project);
    let count = calls.length;
    const reused = await complete((await create()).id);
    assert.equal(reused.status, "ready");
    assert.equal(calls.length, count);
    const audio = await fetch(
      base + `/api/speech/audio/${d.pages[0].clips[0].file}`,
      { headers: { Range: "bytes=0-20" } },
    );
    assert.equal(audio.status, 206);
    assert.equal(audio.headers.get("content-type"), "audio/mpeg");
    assert.deepEqual(
      Buffer.from(await audio.arrayBuffer()),
      silenceMp3.subarray(0, 21),
    );
    const fullAudio = await fetch(
      base + `/api/speech/audio/${d.pages[0].clips[0].file}`,
    );
    assert.equal(fullAudio.status, 200);
    assert.deepEqual(Buffer.from(await fullAudio.arrayBuffer()), silenceMp3);
    const missing = await fetch(
      base + "/api/speech/audio/00000000-0000-0000-0000-000000000000.mp3",
    );
    assert.equal(missing.status, 404);
    assert.equal(missing.headers.get("cache-control"), "no-store");
    for (const invalid of [
      "speech-settings.json",
      "%2e%2e%2fspeech-settings.json",
      ".private.mp3",
    ]) {
      const response = await fetch(base + `/api/speech/audio/${invalid}`);
      assert.equal(response.status, 400);
      assert(!(await response.text()).includes(config.apiKey));
    }
    await request(
      `/api/projects/${project.id}/slides/page-1`,
      { notes: "新的结尾，仍然完整保留。" },
      "PATCH",
    );
    const newer = await complete(
      (await create(2, SPEECH_DEFAULTS, { "page-1": "happy" })).id,
    );
    assert.equal(calls.length, count + 1);
    assert.equal(calls.at(-1).voice_setting.emotion, "happy");
    assert.equal(d.pages[1].notes, project.slides[1].notes);
    await request("/api/speech/preview", {
      text: "平稳讲述这一段",
      options: { ...SPEECH_DEFAULTS, emotion: "neutral" },
    });
    assert.equal(calls.at(-1).voice_setting.emotion, "calm");
    const preview = await request("/api/speech/preview", {
      text: "试看这一段",
      options: SPEECH_DEFAULTS,
    });
    assert(preview.file);
    count = calls.length;
    await request("/api/speech/preview", {
      text: "试看这一段",
      options: SPEECH_DEFAULTS,
    });
    assert.equal(calls.length, count);
    const sample = wav();
    const clone = async (consent, status) => {
      const form = new FormData();
      form.set("name", "测试演讲者");
      form.set("consent", consent);
      form.set("audio", new Blob([sample]), "sample.wav");
      const res = await fetch(base + "/api/speech/voices/clone", {
        method: "POST",
        body: form,
      });
      assert.equal(res.status, status);
      return res.json();
    };
    await clone("false", 400);
    assert.equal(uploads, 0);
    const v = await clone("true", 201);
    assert.equal(uploads, 1);
    assert.equal(clones, 1);
    assert(v.at(-1).custom);
    const speaker = v.at(-1).id;
    await request("/api/speech/preview", {
      text: "自己的声音",
      options: { ...SPEECH_DEFAULTS, voiceId: speaker },
    });
    assert.equal(calls.at(-1).voice_setting.voice_id, speaker);
    assert(
      !readFileSync(path.join(dir, "speech-settings.json"), "utf8").includes(
        "speaker.wav",
      ),
    );
    failAt = calls.length + 2;
    failCode = 1002;
    const limited = await create(2, { ...SPEECH_DEFAULTS, speed: 1.15 });
    const waiting = await until(async () => {
      const current = await get(`/api/narration/${limited.id}`);
      return current.progress.includes("遇到 MiniMax 限流") && current;
    });
    assert.equal(waiting.status, "running");
    assert(waiting.pages[0].clips[0].file);
    assert(waiting.progress.includes("60 秒"));
    assert((await get("/api/activity")).activeJobs > 0);
    const limitCalls = calls.length;
    await request(`/api/narration/${limited.id}/cancel`, {});
    const cancelledLimit = await complete(limited.id);
    assert.equal(cancelledLimit.status, "cancelled");
    assert.equal(
      cancelledLimit.pages[0].clips[0].file,
      waiting.pages[0].clips[0].file,
    );
    assert.equal(calls.length, limitCalls);
    failAt = -1;
    failCode = 1008;
    // The cooldown is shared by this account. Restarting the isolated test
    // service lets the unrelated cancellation/recovery checks start fresh.
    await stop();
    await start();
    hold = true;
    let stopped = await create(2, { ...SPEECH_DEFAULTS, speed: 1.3 });
    await until(() => gates.length);
    assert((await get("/api/activity")).activeJobs > 0);
    await request(`/api/projects/${project.id}`, {}, "DELETE", 400);
    await request("/api/settings/speech", config, "PUT", 409);
    await request(`/api/narration/${stopped.id}/cancel`, {});
    stopped = await complete(stopped.id);
    assert.equal(stopped.status, "cancelled");
    hold = false;
    gates.splice(0).forEach((r) => r());
    await stop();
    const stored = JSON.parse(
      db
        .prepare("SELECT data FROM records WHERE kind='narration' AND id=?")
        .get(stopped.id).data,
    );
    stored.status = "running";
    db.prepare("UPDATE records SET data=? WHERE kind='narration' AND id=?").run(
      JSON.stringify(stored),
      stored.id,
    );
    count = calls.length;
    await start();
    assert.equal(
      (await get(`/api/narration/${stored.id}`)).status,
      "interrupted",
    );
    assert.equal(calls.length, count);
    await request(`/api/narration/${stored.id}/retry`, {}, "POST", 202);
    assert.equal((await complete(stored.id)).status, "ready");
    await request(
      "/api/settings/speech",
      { ...config, apiKey: "other-account" },
      "PUT",
    );
    assert.equal((await get("/api/speech/voices")).length, 4);
    await request(
      "/api/speech/preview",
      {
        text: "不允许错用账号",
        options: { ...SPEECH_DEFAULTS, voiceId: speaker },
      },
      "POST",
      400,
    );
    await request("/api/settings/speech", config, "PUT");

    if (process.env.SPEECH_BROWSER_TEST === "1") {
      // Consecutive pages may reuse the exact same cached URL; both must play.
      for (const sid of ["page-0", "page-1"])
        await request(
          `/api/projects/${project.id}/slides/${sid}`,
          { notes: "这一句会在两页分别讲述。" },
          "PATCH",
        );
      const repeated = await complete((await create(4)).id);
      assert.equal(
        repeated.pages[0].clips[0].file,
        repeated.pages[1].clips[0].file,
      );
      const { chromium } = await import("playwright-core");
      const browser = await chromium.launch({
        headless: true,
        executablePath:
          process.env.CHROMIUM_EXECUTABLE ||
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        args: [
          "--autoplay-policy=no-user-gesture-required",
          "--use-fake-device-for-media-stream",
          "--use-fake-ui-for-media-stream",
        ],
      });
      try {
        const context = await browser.newContext({
          viewport: { width: 1440, height: 1000 },
        });
        const page = await context.newPage(),
          errors = [];
        await page.addInitScript(() => {
          const original = navigator.mediaDevices.getUserMedia.bind(
            navigator.mediaDevices,
          );
          navigator.mediaDevices.getUserMedia = async (...args) => {
            const stream = await original(...args);
            window.testMicrophoneTracks = stream.getTracks();
            return stream;
          };
        });
        page.on("pageerror", (e) => errors.push(e.message));
        let failAudio = true;
        await page.route("**/api/speech/audio/**", (route) =>
          failAudio
            ? route.fulfill({
                status: 404,
                contentType: "application/json",
                body: '{"error":"Not Found"}',
              })
            : route.continue(),
        );
        await page.goto(base + "/#project/" + project.id + "/rehearsal");
        await page
          .getByRole("button", { name: "打开演讲播放器", exact: true })
          .click();
        await page
          .getByRole("heading", { name: "让演讲，开始讲述。" })
          .waitFor();
        await page
          .getByRole("button", { name: "开始口播", exact: true })
          .waitFor();
        const callsBeforePlayback = calls.length;
        await page.getByText(/音频已生成 2\/2 页/).waitFor();
        await page
          .getByRole("button", { name: "重新读取音频", exact: true })
          .waitFor();
        await page
          .getByRole("button", { name: "开始口播", exact: true })
          .click();
        await page.getByText(/本页音频已生成，但读取失败/).waitFor();
        assert.equal(
          await page.getByText(/请重新生成口播|检查音频设备/).count(),
          0,
        );
        failAudio = false;
        await page
          .getByRole("button", { name: "重新读取音频", exact: true })
          .click();
        await page.waitForFunction(() => {
          const audio = document.querySelector(".speech-shell > audio");
          return audio?.readyState >= 2 && audio.duration > 0;
        });
        assert.equal(
          await page.getByText(/本页音频已生成，但读取失败/).count(),
          0,
        );
        assert.equal(calls.length, callsBeforePlayback);
        assert(
          (
            await page.locator(".speech-shell > audio").getAttribute("src")
          ).includes("retry=1"),
        );
        await page
          .getByRole("button", { name: "开始口播", exact: true })
          .click();
        await page
          .getByText("演讲已结束", { exact: true })
          .waitFor({ timeout: 15000 });
        assert.equal(await page.locator(".speech-count").innerText(), "2 / 2");
        assert.equal(calls.length, callsBeforePlayback);
        await page.getByRole("button", { name: "上一页", exact: true }).click();
        await page
          .getByRole("button", { name: "开始口播", exact: true })
          .click();
        await page
          .getByRole("button", { name: "暂停口播", exact: true })
          .click();
        assert(
          await page
            .locator(".speech-shell > audio")
            .evaluate((el) => el.paused),
        );
        await page
          .getByRole("button", { name: "口播设置", exact: true })
          .click();
        await page.getByLabel("整体情绪", { exact: true }).selectOption("sad");
        assert.equal(
          await page
            .getByRole("button", { name: "开始口播", exact: true })
            .count(),
          0,
        );
        await page
          .getByLabel("整体情绪", { exact: true })
          .selectOption(SPEECH_DEFAULTS.emotion);
        const out = process.env.SPEECH_SCREENSHOT_DIR;
        if (out) {
          mkdirSync(out, { recursive: true });
          await page.screenshot({
            path: path.join(out, "speech-desktop.png"),
            animations: "disabled",
          });
        }
        await page
          .getByRole("button", { name: "仅放映 PPT", exact: true })
          .click();
        await page
          .getByRole("button", { name: "全屏放映", exact: true })
          .click();
        await page.waitForFunction(() => !!document.fullscreenElement);
        if (out)
          await page.screenshot({
            path: path.join(out, "speech-fullscreen.png"),
            animations: "disabled",
          });
        await page.evaluate(() => document.exitFullscreen());
        await page
          .getByRole("button", { name: "口播设置", exact: true })
          .click();
        await page.getByText("采集演讲者的声音", { exact: true }).click();
        await page.getByLabel("上传演讲者录音").setInputFiles({
          name: "test.wav",
          mimeType: "audio/wav",
          buffer: sample,
        });
        await page.getByLabel("原始录音试听").waitFor();
        assert(
          await page
            .getByRole("button", { name: "创建我的声音", exact: true })
            .isDisabled(),
        );
        await page.getByLabel(/这是本人声音/).check();
        await page
          .getByRole("button", { name: "创建我的声音", exact: true })
          .click();
        await page.getByText(/声音已创建/).waitFor();
        await page.setViewportSize({ width: 390, height: 844 });
        assert(
          await page
            .locator(".speech-shell")
            .evaluate((el) => el.scrollWidth <= innerWidth),
        );
        if (out)
          await page.screenshot({
            path: path.join(out, "speech-mobile.png"),
            animations: "disabled",
          });
        await page
          .getByRole("button", { name: "开始录音", exact: true })
          .click();
        await page.getByRole("button", { name: /结束录音/ }).waitFor();
        assert(
          await page.evaluate(() =>
            window.testMicrophoneTracks.every(
              (track) => track.readyState === "live",
            ),
          ),
        );
        await page
          .getByRole("button", { name: "关闭演讲播放器", exact: true })
          .click();
        assert.equal(await page.locator(".speech-shell").count(), 0);
        assert(
          await page.evaluate(() =>
            window.testMicrophoneTracks.every(
              (track) => track.readyState === "ended",
            ),
          ),
        );
        assert.deepEqual(errors, []);
      } finally {
        await browser.close();
      }
    }
    await stop();
    await start({
      AUTOPPT_WORKER_TOKEN: "hosted-test",
      AUTOPPT_GATEWAY: "http://127.0.0.1:1",
    });
    const hosted = await fetch(base + "/api/speech/voices", {
      headers: { "X-AutoPPT-Worker": "hosted-test" },
    });
    assert.equal(hosted.status, 403);
    const bootstrap = await (
      await fetch(base + "/api/bootstrap", {
        headers: { "X-AutoPPT-Worker": "hosted-test" },
      })
    ).json();
    assert.equal(bootstrap.features.speechPresentation, false);
  },
);
