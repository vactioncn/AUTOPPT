import test from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { paidOperations } from "../shared/paid-operations.mjs";
import { modelRouteContract } from "./model-route-contract.mjs";

test("independent route audit matches all billable dispatchers including public palette", async () => {
  assert.equal(paidOperations.length, modelRouteContract.length);
  for (const op of paidOperations)
    assert.equal(
      modelRouteContract.filter((c) =>
        c.path.test(op.route.replace(/:[^/]+/g, "fixture")),
      ).length,
      1,
      op.name,
    );
  for (const file of [
    "models.mjs",
    "jobs.mjs",
    "speech/provider.mjs",
    "presenter/index.mjs",
  ])
    assert.match(
      await readFile("server/" + file, "utf8"),
      /assertPaidClaim\(\)/,
    );
  assert.match(
    await readFile("server/index.mjs", "utf8"),
    /installPaidRequests\(app\)/,
  );
});

test(
  "all paid routes: required ID, concurrent replay, conflict, lost response, restart, usage once, readiness and explicit pending retry",
  { timeout: 60000 },
  async (t) => {
    const dir = await mkdtemp(path.join(tmpdir(), "autoppt-paid-contract-"));
    let child, base;
    const start = async () => {
      child = fork("tests/helpers/paid-server.mjs", [], {
        silent: true,
        env: {
          PATH: process.env.PATH,
          AUTOPPT_DATA_DIR: dir,
          NODE_ENV: "test",
        },
      });
      const [message] = await once(child, "message", {
        signal: AbortSignal.timeout(10000),
      });
      base = `http://127.0.0.1:${message.port}`;
    };
    const stop = async () => {
      const ended = once(child, "exit");
      child.kill();
      await ended;
    };
    t.after(async () => {
      if (child.exitCode === null) await stop();
      await rm(dir, { recursive: true, force: true });
    });
    await start();
    const post = (route, body, headers = {}) =>
      fetch(base + route, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body),
      });
    for (const op of paidOperations) {
      const route = op.route.replace(/:[^/]+/g, "fixture");
      assert.equal((await post(route, {})).status, 400, op.name);
      const body = { requestId: randomUUID(), value: "合成内容" };
      const [a, b] = await Promise.all([post(route, body), post(route, body)]);
      assert.deepEqual([a.status, b.status].sort(), [202, 409], op.name);
      const accepted = await (a.status === 202 ? a : b).json();
      const replay = await post(route, body);
      assert.equal(replay.status, 202);
      assert.deepEqual(await replay.json(), accepted);
      assert.equal(
        (await post(route, { ...body, value: "其他内容" })).status,
        409,
      );
    }
    const routePath = "/api/design-options/palette",
      requestId = randomUUID(),
      payload = {
        requestId,
        description: "合成讲稿，不应写入 claim",
        secret: "synthetic-secret",
        url: "https://synthetic.invalid/?token=synthetic",
      };
    // Simulate a response disappearing: abort client while server completes.
    await assert.rejects(
      fetch(base + routePath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10),
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 80));
    let state = await (await fetch(base + "/test/state")).json();
    const count = state.usage.length;
    assert.equal(count, paidOperations.length + 1);
    assert(!JSON.stringify(state.results).includes("SYNTHETIC_PRIVATE_BODY"));
    assert(!JSON.stringify(state.claims).includes("synthetic"));
    assert(!JSON.stringify(state.claims).includes("合成讲稿"));
    await stop();
    await start();
    await post("/test/readiness", { ready: false });
    assert.equal((await post(routePath, payload)).status, 202);
    assert.equal(
      (await (await fetch(base + "/test/state")).json()).usage.length,
      count,
    );
    assert.equal(
      (await post(routePath, { ...payload, requestId: randomUUID() })).status,
      400,
    );
    await post("/test/readiness", { ready: true });
    const pending = { requestId: randomUUID(), mode: "pending" };
    const pendingEvent = once(child, "message");
    const unresolved = post(routePath, pending).catch(() => {});
    await pendingEvent;
    await stop();
    await unresolved;
    await start();
    const blocked = await post(routePath, pending);
    assert.equal(blocked.status, 409);
    assert.equal((await blocked.json()).retryAllowed, true);
    // Retry must retain the exact payload; changing it is not a retry.
    assert.equal(
      (
        await post(routePath, {
          ...pending,
          requestId: randomUUID(),
          mode: "changed",
          retryOf: pending.requestId,
          retryConfirmed: true,
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await post(routePath, {
          ...pending,
          requestId: randomUUID(),
          retryOf: pending.requestId,
        })
      ).status,
      409,
    );
    const attempt = {
      ...pending,
      requestId: randomUUID(),
      retryOf: pending.requestId,
      retryConfirmed: true,
    };
    assert.equal((await post(routePath, attempt)).status, 202);
    assert.equal((await post(routePath, attempt)).status, 202);
    assert.equal(
      (await post(routePath, { ...attempt, requestId: randomUUID() })).status,
      409,
    );
    assert.equal(
      (await (await post(routePath, pending)).json()).retryAllowed,
      false,
    );
    assert.equal(
      (await (await fetch(base + "/test/state")).json()).usage.length,
      count + 1,
    );
    assert.equal((await post("/test/unregistered", {})).status, 409);
    const form = new FormData();
    form.set("name", "合成声音");
    form.set("audio", new Blob(["synthetic bytes"]), "sample.mp3");
    const uploadId = randomUUID();
    const upload = () =>
      fetch(base + "/api/speech/voices/clone", {
        method: "POST",
        headers: { "X-AutoPPT-Request-Id": uploadId },
        body: form,
      });
    assert.equal((await upload()).status, 202);
    assert.equal((await upload()).status, 202);
    form.set("audio", new Blob(["changed bytes"]), "sample.mp3");
    assert.equal((await upload()).status, 409);
  },
);

test("uncertain charge outcomes never automatically retry either model dispatcher", async () => {
  const { createModelRequestPolicy } =
    await import("../server/model-request-policy.mjs");
  const { createSpeechRequestPolicy } =
    await import("../server/speech/request-policy.mjs");
  const model = createModelRequestPolicy({
    wait: async () =>
      assert.fail("uncertain result must not back off and resend"),
  });
  const speech = createSpeechRequestPolicy({
    intervalMs: 0,
    wait: async () =>
      assert.fail("uncertain result must not back off and resend"),
  });
  for (const run of [(op) => model(op), (op) => speech("synthetic", op)]) {
    let calls = 0;
    await assert.rejects(
      run(async () => {
        calls++;
        throw Object.assign(new Error("synthetic uncertain"), {
          uncertain: true,
          retryReason: "overload",
          retryableConnection: true,
          rateLimited: true,
        });
      }),
    );
    assert.equal(calls, 1);
  }
});
