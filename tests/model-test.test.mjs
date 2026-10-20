import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { fork } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { testConnectionConfig, testConnection } from "../server/model-test.mjs";

const config = {
  baseUrl: "https://custom.example/v1",
  apiKey: "synthetic-private-key",
};
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status });

test("connection drafts do not require a model name, save settings, or forward saved keys to another endpoint", () => {
  const saved = { ...config, model: "my-custom-alias" };
  const before = structuredClone(saved);
  assert.deepEqual(
    testConnectionConfig(saved, { ...saved, apiKey: "", model: "" }),
    config,
  );
  assert.deepEqual(saved, before);
  for (const draft of [
    { ...saved, baseUrl: "oops" },
    { ...saved, baseUrl: "https://a:b@custom.example/v1" },
    { ...saved, baseUrl: "https://custom.example/v1?key=secret" },
    { ...saved, baseUrl: "https://other.example/v1", apiKey: "" },
    { ...saved, clearKey: true },
  ])
    assert.throws(() => testConnectionConfig(saved, draft));
});

test("custom API connection succeeds independently of catalog contents and never sends a model or generation request", async () => {
  for (const body of [
    { data: [{ id: "another-model" }] },
    { data: [] },
    { models: ["private-alias"] },
    { service: "ready" },
  ]) {
    let calls = 0;
    const result = await testConnection(config, {
      fetchImpl: async (url, init) => {
        calls++;
        assert.equal(url, config.baseUrl + "/models");
        assert.equal(init.method, "GET");
        assert.equal(init.body, undefined);
        assert.equal(init.headers.Authorization, "Bearer " + config.apiKey);
        return json(body);
      },
    });
    assert.equal(calls, 1);
    assert.equal(result.ok, true);
    assert.equal(result.status, "connected");
    assert.equal(result.responseKind, "json");
    assert.equal(result.modelFound, undefined);
    assert.equal(result.invocationSucceeded, undefined);
  }
});

test("an HTML response proves only reachability and is explicitly described as such", async () => {
  const result = await testConnection(config, {
    fetchImpl: async () => new Response("<html>Gateway home</html>"),
  });
  assert.equal(result.ok, true);
  assert.equal(result.responseKind, "other");
  assert.match(result.message, /只.*地址可访问/);
  assert.match(result.message, /网页或非 JSON/);
  assert.doesNotMatch(result.message, /模型.*通过|密钥.*有效|生成.*成功/);
});

test("HTTP errors and explicit API errors remain failures without leaking responses or retrying", async () => {
  for (const status of [401, 403, 404, 429, 500, 503]) {
    let attempts = 0;
    await assert.rejects(
      testConnection(config, {
        fetchImpl: async () => {
          attempts++;
          return new Response(config.apiKey, { status });
        },
      }),
      (error) => {
        assert.match(error.message, new RegExp(String(status)));
        assert(!error.message.includes(config.apiKey));
        return true;
      },
    );
    assert.equal(attempts, 1);
  }
  for (const body of [
    { error: { message: config.apiKey } },
    { success: false, message: config.apiKey },
  ]) {
    await assert.rejects(
      testConnection(config, { fetchImpl: async () => json(body) }),
      (error) => {
        assert(!error.message.includes(config.apiKey));
        return true;
      },
    );
  }
});

test("timeouts fail and do not retry", async () => {
  let attempts = 0;
  await assert.rejects(
    testConnection(config, {
      timeoutMs: 5,
      fetchImpl: async (_url, { signal }) => {
        attempts++;
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, 100);
          signal.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              reject(signal.reason);
            },
            { once: true },
          );
        });
        return json({});
      },
    }),
    /连接超时/,
  );
  assert.equal(attempts, 1);
});

test(
  "settings API tests custom names without saving drafts, charging, or altering the configured request path",
  { timeout: 30000 },
  async () => {
    const calls = [];
    const provider = http.createServer(async (req, res) => {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      calls.push({
        method: req.method,
        path: req.url,
        body: Buffer.concat(chunks).toString(),
      });
      assert.equal(req.headers.authorization, "Bearer synthetic-route-key");
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ data: [{ id: "unrelated-listed-name" }] }));
    });
    provider.listen(0, "127.0.0.1");
    await once(provider, "listening");
    const dir = mkdtempSync(path.join(tmpdir(), "jianghao-connection-test-"));
    const saved = {
      text: {
        baseUrl: `http://127.0.0.1:${provider.address().port}/custom/api`,
        model: "private-alias",
        apiKey: "synthetic-route-key",
      },
    };
    const settingsPath = path.join(dir, "settings.json");
    writeFileSync(settingsPath, JSON.stringify(saved), { mode: 0o600 });
    const original = readFileSync(settingsPath);
    const child = fork("server/index.mjs", [], {
      silent: true,
      env: {
        PATH: process.env.PATH,
        NODE_ENV: "production",
        PORT: "0",
        AUTOPPT_DATA_DIR: dir,
      },
    });
    child.stdout.resume();
    child.stderr.resume();
    try {
      const [{ port }] = await once(child, "message");
      const post = (body) =>
        fetch(`http://127.0.0.1:${port}/api/settings/test`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      for (const mode of [undefined, "connection"]) {
        const response = await post({
          kind: "text",
          mode,
          connection: {
            ...saved.text,
            apiKey: "",
            model: "unsaved-custom-name",
          },
        });
        assert.equal(response.status, 200);
        assert.equal((await response.json()).status, "connected");
      }
      const before = calls.length;
      assert.equal((await post({ kind: "text", mode: "catalog" })).status, 400);
      assert.equal(
        (await post({ kind: "text", mode: "invocation", confirmed: true }))
          .status,
        400,
      );
      assert.equal(calls.length, before);
      assert.equal(calls.length, 2);
      for (const call of calls)
        assert.deepEqual(call, {
          method: "GET",
          path: "/custom/api/models",
          body: "",
        });
      assert.deepEqual(readFileSync(settingsPath), original);
      assert.equal(
        (await (await fetch(`http://127.0.0.1:${port}/api/settings`)).json())
          .text.model,
        "private-alias",
      );
    } finally {
      child.kill("SIGTERM");
      await once(child, "exit");
      await new Promise((resolve) => provider.close(resolve));
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
