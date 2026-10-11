import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import http from "node:http";
import { fork } from "node:child_process";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import sharp from "sharp";
import { silenceMp3 } from "./helpers/speech-audio.mjs";
import { hostedSpeechConfig } from "../server/hosted/speech-config.mjs";
import { Accounts } from "../server/hosted/accounts.mjs";

test("hosted speech config validates native protocol and weighted daily limits are atomic", () => {
  for (const base of [
    "http://remote.example/v1",
    "https://secret:password@api.example/v1",
    "https://api.example/v1?key=secret",
  ])
    assert.throws(() =>
      hostedSpeechConfig({ AUTOPPT_SPEECH_BASE_URL: base }, () => "secret"),
    );
  assert.throws(() =>
    hostedSpeechConfig({ AUTOPPT_SPEECH_MODEL: "gpt-image" }, () => "secret"),
  );
  const dir = mkdtempSync(path.join(tmpdir(), "autoppt-speech-limits-"));
  const a = new Accounts(dir);
  try {
    a.limit("speech:user", 100, 86400000, 90);
    assert.throws(
      () =>
        a.transaction(() => {
          a.limit("speech:global", 200, 86400000, 20);
          a.limit("speech:user", 100, 86400000, 20);
        }),
      /字符上限/,
    );
    assert.equal(
      a.db.prepare("SELECT * FROM limits WHERE key='speech:global'").get(),
      undefined,
    );
  } finally {
    a.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test(
  "hosted MiniMax: personal voice, short trial to whole narration, cache, private audio, export and offline restart",
  { timeout: 90000 },
  async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "autoppt-hosted-speech-"));
    const password = "Speech-fixture-password-12345",
      key = "private-minimax-test-key";
    const secret = path.join(dir, "speech-key");
    writeFileSync(secret, key, { mode: 0o600 });
    const calls = [];
    let failure = false,
      child;
    const provider = http.createServer(async (req, res) => {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      assert.equal(req.url, "/v1/t2a_v2");
      assert.equal(req.headers.authorization, `Bearer ${key}`);
      const body = JSON.parse(Buffer.concat(chunks));
      assert.equal(body.voice_setting.voice_id, "personal-voice");
      assert.equal(body.model, "speech-2.8-hd");
      calls.push(body);
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify(
          failure
            ? { base_resp: { status_code: 1008, status_msg: key } }
            : {
                base_resp: { status_code: 0 },
                data: { status: 2, audio: silenceMp3.toString("hex") },
                extra_info: { audio_length: 1000 },
              },
        ),
      );
    });
    provider.listen(0, "127.0.0.1");
    await once(provider, "listening");
    const socket = http.createServer();
    socket.listen(0, "127.0.0.1");
    await once(socket, "listening");
    const port = socket.address().port;
    await new Promise((r) => socket.close(r));
    const origin = `http://127.0.0.1:${port}`;
    const start = async (ready = true) => {
      child = fork("server/hosted/index.mjs", [], {
        silent: true,
        env: {
          PATH: process.env.PATH,
          NODE_ENV: "production",
          PORT: String(port),
          HOST: "127.0.0.1",
          AUTOPPT_HOSTED_DATA_DIR: dir,
          AUTOPPT_PUBLIC_URL: origin,
          AUTOPPT_ADMIN_PASSWORD: password,
          AUTOPPT_SIGNUP_IMAGE_CREDITS: "0",
          AUTOPPT_USER_DAILY_SPEECH_CHARS: "150",
          AUTOPPT_SPEECH_BASE_URL: `http://127.0.0.1:${provider.address().port}/v1`,
          ...(ready ? { AUTOPPT_SPEECH_API_KEY_FILE: secret } : {}),
          AUTOPPT_SPEECH_VOICE_ID: "personal-voice",
          AUTOPPT_SPEECH_VOICE_NAME: "本人的声音",
        },
      });
      let log = "";
      child.stderr.on("data", (c) => (log += c));
      await Promise.race([
        once(child, "message", { signal: AbortSignal.timeout(15000) }),
        once(child, "exit").then(() => {
          throw new Error(log);
        }),
      ]);
    };
    const stop = async () => {
      if (child?.exitCode === null && !child.signalCode) {
        const done = once(child, "exit");
        child.kill();
        await done;
      }
    };
    const request = async (url, body, cookie = "", status = 200, method) => {
      const res = await fetch(origin + url, {
        method: method || (body ? "POST" : "GET"),
        headers: {
          Cookie: cookie,
          Origin: origin,
          "Content-Type": "application/json",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const data = await res.json();
      assert.equal(res.status, status, JSON.stringify(data));
      assert(!JSON.stringify(data).includes(key));
      return { data, cookie: res.headers.get("set-cookie")?.split(";")[0] };
    };
    try {
      await start();
      const admin = (
        await request("/api/account/login", { name: "admin", password })
      ).cookie;
      const who = (await request("/api/account", undefined, admin)).data;
      assert.equal(who.user.available, 0);
      assert.equal(who.speechReady, true);
      const invite = (await request("/api/admin/invites", {}, admin)).data.code;
      const second = (
        await request("/api/account/register", {
          name: "second",
          password,
          invite,
        })
      ).cookie;
      const boot = (await request("/api/bootstrap", undefined, admin)).data;
      assert.equal(boot.capabilities.aiNarration.enabled, true);
      assert.equal(boot.capabilities.localModelSettings.enabled, false);
      assert.equal(boot.capabilities.motionPresentation.enabled, false);
      const userRoot = path.join(dir, "users", who.user.id);
      const image = randomUUID() + ".png";
      writeFileSync(
        path.join(userRoot, "assets", image),
        await sharp({
          create: { width: 64, height: 36, channels: 3, background: "white" },
        })
          .png()
          .toBuffer(),
      );
      const project = {
        id: randomUUID(),
        revision: 1,
        title: "语音隔离试验",
        draft: "原草稿保留",
        batches: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        slides: ["第一句口播。保留原稿。", "第二页继续讲述。"].map(
          (notes, i) => ({
            id: randomUUID(),
            notes,
            image,
            scene: null,
            status: "ready",
            plan: { title: `页面 ${i + 1}` },
          }),
        ),
      };
      const db = new DatabaseSync(path.join(userRoot, "autoppt.sqlite"));
      db.prepare("INSERT INTO records VALUES('project',?,?)").run(
        project.id,
        JSON.stringify(project),
      );
      db.close();
      const base = `/api/projects/${project.id}/rehearsal`;
      const context = (await request(base, undefined, admin)).data;
      assert.equal(context.plan.voiceId, "personal-voice");
      assert(context.voices.some((v) => v.name === "本人的声音" && v.custom));
      const config = (await request("/api/settings/speech", undefined, admin))
        .data;
      assert.deepEqual(
        Object.keys(config).sort(),
        ["defaultVoiceId", "hasKey", "managed", "model"].sort(),
      );
      await request(
        "/API/SETTINGS/SPEECH",
        { apiKey: "illegal" },
        admin,
        403,
        "PUT",
      );
      await request("/API/SPEECH/VOICES/CLONE", {}, admin, 403);
      await request(
        `/api/projects/${project.id}/speech-performance`,
        {},
        admin,
        403,
      );
      await request(base, { actor: "digital" }, admin, 403, "PUT");
      await request(base, { visual: "motion" }, admin, 403, "PUT");
      await request(
        base,
        { actor: "voice", pageId: project.slides[0].id },
        admin,
        200,
        "PUT",
      );
      const wait = async (id) => {
        for (let n = 0; n < 120; n++) {
          const runs = (await request(base + "/runs", undefined, admin)).data;
          const run = runs.find((r) => r.id === id);
          if (run.status === "ready") return run;
          assert.equal(run.status, "running", JSON.stringify(run));
          await new Promise((r) => setTimeout(r, 100));
        }
        throw new Error("Speech did not complete");
      };
      const generate = async (scope) => {
        const requestId = randomUUID(),
          input = {
            requestId,
            revision: 1,
            scope,
            trialLength: "short",
            confirmed: true,
          };
        await request(base + "/runs", input, admin, 202);
        const run = await wait(requestId);
        await request(base + "/runs", input, admin, 202); // accepted ID does not dispatch twice
        return run;
      };
      const trial = await generate("trial");
      assert.equal(calls.length, 1);
      const preview = (
        await request(
          "/api/speech/preview",
          {
            text: trial.pages[0].text,
            options: { voiceId: "personal-voice", emotion: "auto", speed: 1 },
          },
          admin,
        )
      ).data;
      assert.equal(preview.file, trial.pages[0].clips[0].audioFile);
      assert.equal(calls.length, 1);
      const whole = await generate("all");
      assert.equal(calls.length, 2);
      assert.equal(
        whole.pages[0].clips[0].audioFile,
        trial.pages[0].clips[0].audioFile,
      );
      const narration = (
        await request(`/api/narration/${whole.id}`, undefined, admin)
      ).data;
      assert.equal(narration.status, "ready");
      assert.equal(narration.voiceName, "本人的声音");
      const audioUrl = `/api/speech/audio/${narration.pages[0].clips[0].file}`;
      const audio = await fetch(origin + audioUrl, {
        headers: { Cookie: admin, Range: "bytes=0-99" },
      });
      assert.equal(audio.status, 206);
      assert.equal(
        audio.headers.get("content-range"),
        `bytes 0-99/${silenceMp3.length}`,
      );
      assert.equal((await audio.arrayBuffer()).byteLength, 100);
      await request(audioUrl, undefined, "", 401);
      await request(audioUrl, undefined, second, 404);
      await request(base, undefined, second, 404);
      await request(`/api/narration/${whole.id}`, undefined, second, 400);
      const html = await fetch(origin + `/api/narration/${whole.id}/html`, {
        headers: { Cookie: admin },
      });
      assert.equal(html.status, 200);
      assert.match(await html.text(), /data:audio\/mpeg;base64,/);
      const stored = new DatabaseSync(path.join(userRoot, "autoppt.sqlite"));
      assert.deepEqual(
        JSON.parse(
          stored
            .prepare("SELECT data FROM records WHERE kind='project' AND id=?")
            .get(project.id).data,
        ),
        project,
      );
      stored.close();
      assert.equal(
        (await request("/api/account", undefined, admin)).data.user.available,
        0,
      );
      failure = true;
      const failed = await request(
        "/api/speech/preview",
        { text: "验证余额不足错误。", options: { voiceId: "personal-voice" } },
        admin,
        400,
      );
      assert.match(failed.data.error, /余额不足/);
      const beforeLimit = calls.length;
      const limited = await request(
        "/api/speech/preview",
        { text: "限制".repeat(140), options: { voiceId: "personal-voice" } },
        admin,
        400,
      );
      assert.match(limited.data.error, /字符上限/);
      assert.equal(calls.length, beforeLimit);
      await stop();
      assert(
        !readFileSync(path.join(userRoot, "autoppt.sqlite")).includes(
          Buffer.from(key),
        ),
      );
      writeFileSync(
        path.join(userRoot, "speech-settings.json"),
        JSON.stringify({
          apiKey: "untrusted-workspace-key",
          baseUrl: "https://evil.example/v1",
        }),
      );
      await start(false);
      assert.equal(
        (await request("/api/bootstrap", undefined, admin)).data.capabilities
          .aiNarration.enabled,
        false,
      );
      assert.equal(
        (await request("/api/settings/speech", undefined, admin)).data.hasKey,
        false,
      );
      assert.equal(
        (await fetch(origin + audioUrl, { headers: { Cookie: admin } })).status,
        200,
      );
      const saved = (
        await request(`/api/projects/${project.id}/narration`, undefined, admin)
      ).data;
      assert(saved.some((r) => r.id === whole.id && r.status === "ready"));
      assert.equal(calls.length, beforeLimit);
    } finally {
      await stop();
      await new Promise((r) => provider.close(r));
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
