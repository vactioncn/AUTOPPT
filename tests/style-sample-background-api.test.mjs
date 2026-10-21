import test from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import express from "express";
import sharp from "sharp";
import { styleStamp } from "../server/core.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn) {
  for (let i = 0; i < 300; i++) {
    const result = await fn();
    if (result) return result;
    await sleep(50);
  }
  throw new Error("timed out waiting for background work");
}
test(
  "real scheduler finishes with no client requests; progress, pause and failure survive fresh reads",
  { timeout: 45000 },
  async (t) => {
    const dir = mkdtempSync(path.join(tmpdir(), "autoppt-background-api-"));
    const provider = express();
    provider.use(express.json({ limit: "25mb" }));
    const png = (
      await sharp({
        create: { width: 16, height: 9, channels: 3, background: "#eee" },
      })
        .png()
        .toBuffer()
    ).toString("base64");
    let calls = 0,
      fail = false,
      hold = false,
      release;
    provider.post("/v1/images/generations", async (_req, res) => {
      calls++;
      if (hold)
        await new Promise((r) => {
          release = r;
        });
      if (fail)
        return res
          .status(400)
          .json({ error: { message: "mock image rejected" } });
      res.json({ data: [{ b64_json: png }] });
    });
    const mock = provider.listen(0, "127.0.0.1");
    await once(mock, "listening");
    writeFileSync(
      path.join(dir, "settings.json"),
      JSON.stringify({
        image: {
          baseUrl: `http://127.0.0.1:${mock.address().port}/v1`,
          model: "mock",
          apiKey: "local-only",
        },
      }),
    );
    const child = fork("server/index.mjs", [], {
      env: {
        ...process.env,
        PORT: "0",
        NODE_ENV: "production",
        AUTOPPT_DATA_DIR: dir,
        AUTOPPT_WORKER_TOKEN: "",
        AUTOPPT_DESKTOP_TOKEN: "",
      },
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    });
    let log = "";
    child.stderr.on("data", (s) => {
      log += s;
    });
    t.after(async () => {
      release?.();
      if (child.exitCode === null) {
        const done = once(child, "exit");
        child.kill();
        await done;
      }
      await new Promise((r) => mock.close(r));
      rmSync(dir, { recursive: true, force: true });
    });
    const [ready] = await Promise.race([
      once(child, "message"),
      once(child, "exit").then(() => {
        throw new Error(log);
      }),
    ]);
    const base = `http://127.0.0.1:${ready.port}/api`;
    const request = async (
      url,
      body,
      status = 200,
      method = body === undefined ? "GET" : "POST",
    ) => {
      const res = await fetch(base + url, {
        method,
        headers: { "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const data = await res.json();
      assert.equal(res.status, status, JSON.stringify(data));
      return data;
    };
    const create = async (name) =>
      (await request("/styles", { name, rules: "simple fixed style" }, 201))
        .style;
    const start = (s, requestId = randomUUID()) =>
      request(
        `/styles/${s.id}/sample-batch`,
        { fingerprint: styleStamp(s).fingerprint, requestId },
        202,
      );
    const progress = async (s) =>
      (await request("/bootstrap")).styles.find((x) => x.id === s.id)
        .sampleProgress;
    const first = await create("background");
    const id = randomUUID();
    await start(first, id);
    await start(first, id);
    await start(first);
    // No application reads between submitting and all eight provider calls.
    await until(() => calls === 8);
    await until(async () => (await progress(first)).status === "completed");
    assert.equal(
      (await request(`/styles/${first.id}/trials`)).trials.length,
      8,
    );
    assert.equal((await progress(first)).done, 8);
    await start(first);
    await sleep(900);
    assert.equal(calls, 8);

    const second = await create("pause-and-failure");
    hold = true;
    await start(second);
    await until(() => calls === 9 && release);
    const live = await progress(second);
    assert.equal(live.currentPage.number, "01");
    assert.equal(live.background, true);
    assert((await request("/activity")).activeJobs > 0);
    await request(`/styles/${second.id}/trials`, { purpose: "cover" }, 409);
    await request(`/styles/${second.id}/sample-batch/pause`, {});
    hold = false;
    release();
    await until(async () => (await progress(second)).done === 1);
    await sleep(900);
    assert.equal(calls, 9);
    assert.equal((await progress(second)).status, "paused");
    fail = true;
    const failId = randomUUID();
    await start(second, failId);
    const failed = await until(async () => {
      const p = await progress(second);
      return p.status === "failed" && p;
    });
    assert.equal(failed.currentPage.number, "02");
    assert.equal(failed.done, 1);
    assert.match(failed.error, /mock image rejected/);
    await start(second, failId);
    await sleep(900);
    assert.equal(calls, 10);
    fail = false;
    await start(second);
    await until(async () => (await progress(second)).status === "completed");
    assert.equal(calls, 17);
    assert.equal((await progress(second)).done, 8);
    await until(async () => (await request("/activity")).activeJobs === 0);
  },
);
