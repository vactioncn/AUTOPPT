import test from "node:test";
import assert from "node:assert/strict";
import {
  createModelRequestPolicy,
  upstreamHandshakeFailure,
  withModelRequestProgress,
  transientModelRejection,
  retryAfterMs,
} from "../server/model-request-policy.mjs";

const handshake = {
  error: {
    message: 'Post "https://example.test/responses": utls: TLS handshake: EOF',
  },
};
const overloaded = {
  error: {
    message:
      "auth_unavailable: no auth available; last upstream error: server_is_overloaded",
  },
};
test("only explicit temporary rejections qualify; account faults and possible results do not", () => {
  assert.equal(transientModelRejection(503, overloaded), "overload");
  assert.equal(
    transientModelRejection(503, {
      error: "auth_unavailable: no auth available",
    }),
    "channel",
  );
  assert.equal(
    transientModelRejection(429, { error: { code: "rate_limit_exceeded" } }),
    "rate-limit",
  );
  assert.equal(
    transientModelRejection(503, { error: { code: "server_is_overloaded" } }),
    "overload",
  );
  for (const [status, data] of [
    [401, overloaded],
    [403, overloaded],
    [408, overloaded],
    [503, { error: "generic error" }],
    [429, { error: "insufficient_quota: rate limit" }],
    [503, { error: "overloaded; invalid_api_key" }],
    [503, { error: "overloaded; invalid_request_error" }],
    [503, { ...overloaded, uncertain: true }],
    [503, { ...overloaded, task_id: "accepted-generation" }],
    [503, { error: "overloaded; stream disconnected before completion" }],
    [503, { ...overloaded, usage: { total_tokens: 0 } }],
    [503, { ...overloaded, choices: [{ message: { content: "partial" } }] }],
    [503, { ...overloaded, data: [{ url: "saved.png" }] }],
    [503, { ...overloaded, data: { audio: "abc" } }],
    [503, { ...overloaded, extra_info: { usage_characters: 0 } }],
  ])
    assert.equal(transientModelRejection(status, data), null);
});

test("temporary outages recover without failure and respect provider cooldown", async () => {
  const waits = [],
    events = [];
  const policy = createModelRequestPolicy({
    random: () => 0,
    wait: async (ms) => waits.push(ms),
  });
  let calls = 0;
  const result = await policy(
    async () => {
      if (++calls < 3)
        throw Object.assign(new Error("overloaded"), {
          retryReason: "overload",
          retryAfterMs: 9000,
        });
      return "saved result";
    },
    { onWait: (event) => events.push(event) },
  );
  assert.equal(result, "saved result");
  assert.equal(calls, 3);
  assert.deepEqual(waits, [9000, 15000]);
  assert.deepEqual(
    events.filter(Boolean).map((v) => [v.reason, v.attempt]),
    [
      ["overload", 1],
      ["overload", 2],
    ],
  );
  assert.equal(events.at(-1), null);
  waits.length = 0;
  calls = 0;
  await assert.rejects(
    policy(async () => {
      calls++;
      throw Object.assign(new Error("no channel"), { retryReason: "channel" });
    }),
    /已自动重试 3 次/,
  );
  assert.equal(calls, 4);
  assert.deepEqual(waits, [5000, 15000, 30000]);
});

test("cooldowns parse safely; excessive cooldown and cancellation never resubmit", async () => {
  assert.equal(retryAfterMs("60"), 60000);
  assert.equal(retryAfterMs("1.5"), 1500);
  assert.equal(
    retryAfterMs(
      "Thu, 08 Oct 2026 08:01:00 GMT",
      Date.parse("2026-10-08T08:00:00Z"),
    ),
    60000,
  );
  assert.equal(retryAfterMs("bad"), 0);
  const controller = new AbortController();
  for (const long of [true, false]) {
    let calls = 0;
    const events = [];
    await assert.rejects(
      createModelRequestPolicy()(
        async () => {
          calls++;
          throw Object.assign(new Error("busy"), {
            retryReason: "overload",
            retryAfterMs: long ? 600001 : 0,
          });
        },
        {
          signal: controller.signal,
          onWait: (n) => {
            events.push(n);
            if (n) controller.abort();
          },
        },
      ),
    );
    assert.equal(calls, 1);
    assert.equal(events.length, long ? 0 : 2);
  }
});
test("only explicit interrupted upstream TLS handshakes qualify for recovery", () => {
  assert.equal(upstreamHandshakeFailure(500, handshake), true);
  assert.equal(
    upstreamHandshakeFailure(502, {
      message: "tls: handshake: unexpected EOF",
    }),
    true,
  );
  for (const [status, data] of [
    [401, handshake],
    [429, handshake],
    [200, handshake],
    [500, { error: "EOF" }],
    [504, { error: "response timeout" }],
    [500, { error: "tls: handshake: certificate has expired" }],
    [500, { ...handshake, uncertain: true }],
    [500, { ...handshake, usage: { total_tokens: 100 } }],
    [500, { ...handshake, choices: [{ message: { content: "done" } }] }],
  ])
    assert.equal(upstreamHandshakeFailure(status, data), false);
});

test("bounded backoff, progress restoration and final failure", async () => {
  const delays = [],
    notices = [];
  const policy = createModelRequestPolicy({
    wait: async (ms) => delays.push(ms),
  });
  let calls = 0;
  await assert.rejects(
    withModelRequestProgress(
      (n) => notices.push(n),
      () =>
        policy(async () => {
          calls++;
          throw Object.assign(new Error("TLS 握手失败。"), {
            retryableConnection: true,
          });
        }),
    ),
    /已自动重试 3 次/,
  );
  assert.equal(calls, 4);
  assert.deepEqual(delays, [2000, 5000, 10000]);
  assert.deepEqual(
    notices.filter(Boolean).map((n) => n.attempt),
    [1, 2, 3],
  );
  assert.equal(notices.filter((n) => n === null).length, 3);
  calls = 0;
  await assert.rejects(
    policy(async () => {
      calls++;
      throw new Error("ordinary failure");
    }),
    /ordinary failure/,
  );
  assert.equal(calls, 1);
});

test("success stops retrying; cancellation during backoff sends no further request", async () => {
  const policy = createModelRequestPolicy({ wait: async () => {} });
  let calls = 0;
  assert.equal(
    await policy(async () => {
      if (++calls === 1)
        throw Object.assign(new Error("TLS"), { retryableConnection: true });
      return "ok";
    }),
    "ok",
  );
  assert.equal(calls, 2);
  const controller = new AbortController();
  calls = 0;
  const events = [];
  await assert.rejects(
    createModelRequestPolicy()(
      async () => {
        calls++;
        throw Object.assign(new Error("TLS"), { retryableConnection: true });
      },
      {
        signal: controller.signal,
        onWait: (n) => {
          events.push(n);
          if (n) controller.abort();
        },
      },
    ),
    { name: "AbortError" },
  );
  assert.equal(calls, 1);
  assert.equal(events.at(-1), null);
});

test("concurrent jobs keep their retry notices separate", async () => {
  const a = [],
    b = [];
  const policy = createModelRequestPolicy({ wait: async () => {} });
  const run = async (events) =>
    withModelRequestProgress(
      (n) => events.push(n),
      async () => {
        let calls = 0;
        await policy(async () => {
          if (++calls === 1)
            throw Object.assign(new Error("TLS"), {
              retryableConnection: true,
            });
        });
      },
    );
  await Promise.all([run(a), run(b)]);
  assert.equal(a.length, 2);
  assert.equal(b.length, 2);
});
