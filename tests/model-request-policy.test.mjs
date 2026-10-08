import test from "node:test";
import assert from "node:assert/strict";
import {
  createModelRequestPolicy,
  upstreamHandshakeFailure,
  withModelRequestProgress,
} from "../server/model-request-policy.mjs";

const handshake = {
  error: {
    message: 'Post "https://example.test/responses": utls: TLS handshake: EOF',
  },
};
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
