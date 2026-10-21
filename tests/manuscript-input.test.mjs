import test from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  manuscriptLength,
  manuscriptLimitError,
} from "../shared/manuscript-input.mjs";

test("submission counts whole Unicode characters and preserves over-limit input", () => {
  const text = "讲".repeat(4999) + "🐱";
  assert.equal(manuscriptLength(text), 5000);
  assert.equal(manuscriptLimitError(text), "");
  assert.match(manuscriptLimitError(text + "。"), /超出 1 字/);
  assert.equal(manuscriptLength("你 好\n！"), 5);
  assert.equal(text, "讲".repeat(4999) + "🐱");
});

test(
  "API rejects new oversized batches without jobs or draft loss and recovers legacy accepted requests",
  { timeout: 30000 },
  async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "autoppt-manuscript-limit-"));
    let child;
    const start = async () => {
      child = fork("server/index.mjs", [], {
        silent: true,
        env: {
          PATH: process.env.PATH,
          NODE_ENV: "production",
          PORT: "0",
          AUTOPPT_DATA_DIR: dir,
          AUTOPPT_WORKER_TOKEN: "isolated-limit-test",
        },
      });
      child.stdout.resume();
      child.stderr.resume();
      const [{ port }] = await once(child, "message");
      return `http://127.0.0.1:${port}/api`;
    };
    const stop = async () => {
      if (child && child.exitCode === null) {
        const exited = once(child, "exit");
        child.kill("SIGTERM");
        await exited;
      }
    };
    let base;
    const request = async (url, body, method = body ? "POST" : "GET") => {
      const response = await fetch(base + url, {
        method,
        headers: {
          "content-type": "application/json",
          "x-autoppt-worker": "isolated-limit-test",
          "x-autoppt-role": "admin",
          "x-autoppt-model-ready": "0",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: response.status, data: await response.json() };
    };
    try {
      base = await start();
      const draft = "讲".repeat(5000) + "🐱";
      const created = await request("/projects", {
        title: "隔离字数测试",
        draft,
      });
      assert.equal(created.status, 201);
      const url = `/projects/${created.data.id}`;
      const response = await request(url + "/batches", { text: draft });
      assert.equal(response.status, 400);
      assert.match(response.data.error, /超出 1 字/);
      const unchanged = (await request(url)).data;
      assert.equal(unchanged.draft, draft);
      assert.deepEqual(unchanged.batches, []);
      assert.deepEqual((await request("/jobs")).data, []);
      // Exactly 5,000 characters pass the length gate and reach model readiness.
      const boundary = await request(url + "/batches", {
        text: "讲".repeat(4999) + "🐱",
      });
      assert.equal(boundary.status, 503);
      assert.match(boundary.data.error, /模型尚未就绪/);
      await stop();
      // Simulate a pre-upgrade accepted batch whose response the client lost.
      const db = new DatabaseSync(path.join(dir, "autoppt.sqlite"));
      const requestId = "legacy-accepted-request";
      const batch = {
        id: "legacy-batch",
        text: draft,
        requestId,
        generationMode: "full",
        jobId: "legacy-job",
        slideIds: [],
      };
      unchanged.batches = [batch];
      db.prepare("UPDATE records SET data=? WHERE kind='project' AND id=?").run(
        JSON.stringify(unchanged),
        unchanged.id,
      );
      db.prepare("INSERT INTO records VALUES ('job',?,?)").run(
        "legacy-job",
        JSON.stringify({
          id: "legacy-job",
          type: "append",
          status: "completed",
          projectId: unchanged.id,
          payload: { batchId: batch.id },
        }),
      );
      db.close();
      base = await start();
      const recovered = await request(url + "/batches", {
        text: draft,
        requestId,
      });
      assert.equal(recovered.status, 202);
      assert.equal(recovered.data.id, "legacy-job");
      assert.equal(recovered.data.accepted, true);
      const after = (await request(url)).data;
      assert.equal(after.batches.length, 1);
      assert.equal(after.batches[0].text, draft);
      assert.equal((await request("/jobs")).data.length, 1);
    } finally {
      await stop();
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
