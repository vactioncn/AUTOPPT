import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after } from "node:test";
const usageDir = mkdtempSync(path.join(tmpdir(), "autoppt-speech-meter-"));
process.env.AUTOPPT_DATA_DIR = usageDir;
after(async () => {
  const { db } = await import("../server/store.mjs");
  db.close();
  rmSync(usageDir, { recursive: true, force: true });
});
import test from "node:test";
import assert from "node:assert/strict";
import { createSpeechRequestPolicy } from "../server/speech/request-policy.mjs";
import { synthesize, cloneVoice } from "../server/speech/provider.mjs";
import { SPEECH_DEFAULTS } from "../shared/speech.mjs";
import { silenceMp3 } from "./helpers/speech-audio.mjs";

function clockPolicy() {
  let time = 0;
  const waits = [];
  const run = createSpeechRequestPolicy({
    now: () => time,
    wait: async (ms, signal) => {
      signal?.throwIfAborted();
      waits.push(ms);
      time += ms;
    },
  });
  return { run, waits, now: () => time };
}
const limited = (retryAfterMs = 0) =>
  Object.assign(new Error("rate limited"), { rateLimited: true, retryAfterMs });

test("speech requests share account pacing and serialize concurrent callers", async () => {
  const { run, now, waits } = clockPolicy();
  const starts = [];
  await Promise.all(
    Array.from({ length: 4 }, (_, i) =>
      run("account", async () => {
        starts.push([i, now()]);
      }),
    ),
  );
  assert.deepEqual(starts, [
    [0, 0],
    [1, 6100],
    [2, 12200],
    [3, 18300],
  ]);
  assert.deepEqual(waits, [6100, 6100, 6100]);
  await run("another-account", async () => assert.equal(now(), 18300));
});

test("explicit limits back off before retrying the same operation", async () => {
  const { run, waits } = clockPolicy();
  let calls = 0;
  const states = [];
  const result = await run(
    "account",
    async () => {
      if (++calls < 3) throw limited();
      return "saved audio";
    },
    { onWait: (state) => states.push(state) },
  );
  assert.equal(result, "saved audio");
  assert.equal(calls, 3);
  assert.deepEqual(waits, [60000, 120000]);
  assert.deepEqual(
    states.filter(Boolean).map((s) => [s.reason, s.attempt, s.maxRetries]),
    [
      ["rate-limit", 1, 3],
      ["rate-limit", 2, 3],
    ],
  );
});

test("rate-limit retries are bounded and honor Retry-After", async () => {
  const { run, waits } = clockPolicy();
  let calls = 0;
  await assert.rejects(
    run("account", async () => {
      calls++;
      throw limited();
    }),
    /rate limited/,
  );
  assert.equal(calls, 4);
  assert.deepEqual(waits, [60000, 120000, 180000]);
  const second = clockPolicy();
  let attempt = 0;
  await second.run("account", async () => {
    if (!attempt++) throw limited(150000);
  });
  assert.deepEqual(second.waits, [150000]);
  const long = clockPolicy();
  await assert.rejects(
    long.run("account", async () => {
      throw limited(1200000);
    }),
    /rate limited/,
  );
  assert.deepEqual(long.waits, []);
});

test("cancellation during cooldown sends no new request and releases the account", async () => {
  const { run } = clockPolicy();
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(
    run(
      "account",
      async () => {
        calls++;
        throw limited();
      },
      {
        signal: controller.signal,
        onWait: (state) => {
          if (state) controller.abort();
        },
      },
    ),
    { name: "AbortError" },
  );
  assert.equal(calls, 1);
  assert.equal(await run("account", async () => "continued"), "continued");
});

test("ambiguous failures and account errors never retry automatically", async () => {
  for (const message of [
    "timeout",
    "invalid audio",
    "insufficient balance",
    "invalid key",
  ]) {
    const { run, waits } = clockPolicy();
    let calls = 0;
    await assert.rejects(
      run("account", async () => {
        calls++;
        throw new Error(message);
      }),
      { message },
    );
    assert.equal(calls, 1);
    assert.deepEqual(waits, []);
  }
});

test("speech overload recovers before failing, preserving account pacing and per-attempt notices", async () => {
  let time = 0,
    calls = 0;
  const waits = [],
    states = [];
  const run = createSpeechRequestPolicy({
    now: () => time,
    random: () => 0,
    wait: async (ms) => {
      waits.push(ms);
      time += ms;
    },
  });
  assert.equal(
    await run(
      "account",
      async () => {
        if (++calls < 3)
          throw Object.assign(new Error("busy"), { retryReason: "overload" });
        return "audio";
      },
      { onWait: (n) => states.push(n) },
    ),
    "audio",
  );
  assert.equal(calls, 3);
  assert.deepEqual(waits, [6100, 15000]);
  assert.deepEqual(
    states.filter(Boolean).map((n) => n.reason),
    ["overload", "overload"],
  );
  assert.equal(states.at(-1), null);
});

test("MiniMax explicit HTTP overload enters recovery; account errors and partial audio do not", async (t) => {
  for (const [data, expected] of [
    [{ error: { code: "server_is_overloaded" } }, true],
    [{ base_resp: { status_code: 1008 } }, false],
    [
      { error: { code: "server_is_overloaded" }, data: { audio: "partial" } },
      false,
    ],
  ]) {
    let calls = 0,
      state = null;
    const mock = t.mock.method(globalThis, "fetch", async () => {
      calls++;
      return new Response(JSON.stringify(data), { status: 503 });
    });
    const controller = new AbortController();
    await assert.rejects(
      synthesize(
        {
          baseUrl: "https://speech.test/v1",
          apiKey: `test-${JSON.stringify(data)}`,
          model: "speech-2.8-hd",
        },
        "test",
        SPEECH_DEFAULTS,
        controller.signal,
        (n) => {
          if (n && n.reason !== "pace") {
            state = n;
            controller.abort();
          }
        },
      ),
    );
    assert.equal(calls, 1);
    assert.equal(state?.reason || null, expected ? "overload" : null);
    mock.mock.restore();
  }
});

test("MiniMax business limits and HTTP 429 enter cancellable cooldown without exposing provider text", async (t) => {
  for (const [status, code, header, minimum, maximum] of [
    [200, 1002, "90", 89000, 90000],
    [200, 2045, "90", 89000, 90000],
    [429, null, "90", 89000, 90000],
    [200, 1002, new Date(Date.now() + 90000).toUTCString(), 88000, 90000],
    [200, 1002, "invalid", 59000, 60000],
  ]) {
    let calls = 0;
    const mock = t.mock.method(globalThis, "fetch", async () => {
      calls++;
      return new Response(
        JSON.stringify({
          base_resp: { status_code: code, status_msg: "sk-secret-provider" },
        }),
        { status, headers: { "Retry-After": header } },
      );
    });
    const controller = new AbortController();
    let cooldown;
    await assert.rejects(
      synthesize(
        {
          baseUrl: "https://speech.test/v1",
          apiKey: `test-${status}-${code}-${header}`,
          model: "speech-2.8-hd",
        },
        "test",
        SPEECH_DEFAULTS,
        controller.signal,
        (state) => {
          if (state?.reason === "rate-limit") {
            cooldown = state;
            controller.abort();
          }
        },
      ),
      { name: "AbortError" },
    );
    assert.equal(calls, 1);
    assert.equal(cooldown.reason, "rate-limit");
    assert(cooldown.ms > minimum && cooldown.ms <= maximum);
    mock.mock.restore();
  }
});

test("network failures, HTTP errors and incomplete audio do not resend synthesis", async (t) => {
  const responses = [
    () => {
      throw new TypeError("network failure");
    },
    () => new Response("service failure", { status: 500 }),
    () => new Response("invalid JSON"),
    () =>
      new Response(
        JSON.stringify({
          base_resp: { status_code: 0 },
          data: { status: 2, audio: "" },
        }),
      ),
  ];
  for (const [index, respond] of responses.entries()) {
    let calls = 0;
    const mock = t.mock.method(globalThis, "fetch", async () => {
      calls++;
      return respond();
    });
    await assert.rejects(
      synthesize(
        {
          baseUrl: "https://speech.test/v1",
          apiKey: `ambiguous-${index}`,
          model: "speech-2.8-hd",
        },
        "test",
        SPEECH_DEFAULTS,
      ),
    );
    assert.equal(calls, 1);
    mock.mock.restore();
  }
});

test("voice creation never retries a rejected clone operation automatically", async (t) => {
  const endpoints = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    endpoints.push(new URL(url).pathname);
    return new Response(
      JSON.stringify(
        endpoints.length === 1
          ? {
              base_resp: { status_code: 0 },
              file: { file_id: "12345678901234567" },
            }
          : { base_resp: { status_code: 1002 } },
      ),
    );
  });
  await assert.rejects(
    cloneVoice(
      { baseUrl: "https://speech.test/v1", apiKey: "clone-test" },
      { buffer: silenceMp3 },
      "custom-voice",
    ),
    /频率超限/,
  );
  assert.deepEqual(endpoints, ["/v1/files/upload", "/v1/voice_clone"]);
});

test("provider errors distinguish balance, credentials and voice permissions", async (t) => {
  for (const [code, message] of [
    [1008, /余额不足/],
    [1004, /密钥验证失败/],
    [2049, /密钥无效/],
    [2042, /无权使用这个音色/],
    [2013, /参数有误/],
    [1001, /超时/],
  ]) {
    let calls = 0;
    const mock = t.mock.method(globalThis, "fetch", async () => {
      calls++;
      return new Response(
        JSON.stringify({
          base_resp: {
            status_code: code,
            status_msg: "sk-secret-provider private content",
          },
        }),
      );
    });
    await assert.rejects(
      synthesize(
        {
          baseUrl: "https://speech.test/v1",
          apiKey: `test-error-${code}`,
          model: "speech-2.8-hd",
        },
        "test",
        SPEECH_DEFAULTS,
      ),
      (error) => {
        assert.match(error.message, message);
        assert(!error.message.includes("sk-secret-provider"));
        assert.equal(error.rateLimited, false);
        return true;
      },
    );
    assert.equal(calls, 1);
    mock.mock.restore();
  }
});
