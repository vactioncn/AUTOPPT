import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { fork } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { testConnectionConfig, testModel } from "../server/model-test.mjs";

const config = {
  baseUrl: "https://provider.example/v1",
  model: "real-model",
  apiKey: "synthetic-private-key",
};
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status });
const completion = (model = config.model) => ({
  model,
  choices: [{ message: { content: '{"ok":true}' } }],
});

test("draft testing preserves settings and cannot forward a saved key to a changed endpoint", () => {
  const before = structuredClone(config);
  assert.deepEqual(
    testConnectionConfig(config, { ...config, apiKey: "", model: "a-typo" }),
    { ...config, model: "a-typo" },
  );
  assert.deepEqual(config, before);
  for (const draft of [
    { ...config, model: " " },
    { ...config, baseUrl: "oops" },
    { ...config, baseUrl: "https://a:b@provider.example/v1" },
    { ...config, baseUrl: "https://provider.example/v1?key=secret" },
    { ...config, baseUrl: "https://other.example/v1", apiKey: "" },
    { ...config, clearKey: true },
  ])
    assert.throws(() => testConnectionConfig(config, draft));
});

test("catalog HTTP 200 does not pass missing models, malformed lists or HTML", async () => {
  let calls = 0;
  for (const data of [
    { data: [] },
    { data: [{ id: "some-other-model" }] },
    {},
    { data: [{ name: config.model }] },
  ]) {
    const result = await testModel("text", config, {
      fetchImpl: async (url, init) => {
        calls++;
        assert.equal(url, config.baseUrl + "/models");
        assert.equal(init.method, "GET");
        assert.equal(init.body, undefined);
        return json(data);
      },
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, "unverified");
  }
  assert.equal(calls, 4);
  const listed = await testModel("image", config, {
    fetchImpl: async () => json({ data: [{ id: config.model }] }),
  });
  assert.equal(listed.status, "listed");
  assert.equal(listed.invocationSucceeded, undefined);
  await assert.rejects(
    testModel("text", config, {
      fetchImpl: async () => new Response("<html>login</html>"),
    }),
    /不是有效 JSON/,
  );
});

test("actual tests require confirmation, send exactly the supplied model, and never retry", async () => {
  let count = 0;
  const fetchImpl = async (_url, init) => {
    count++;
    const body = JSON.parse(init.body);
    assert.equal(body.model, "arbitrary-invalid-name");
    assert.equal(body.response_format.type, "json_object");
    return json(
      { error: { code: "model_not_found", message: config.apiKey } },
      404,
    );
  };
  await assert.rejects(
    testModel("text", config, { mode: "invocation", fetchImpl }),
    /先确认/,
  );
  assert.equal(count, 0);
  await assert.rejects(
    testModel(
      "text",
      { ...config, model: "arbitrary-invalid-name" },
      { mode: "invocation", confirmed: true, fetchImpl },
    ),
    (error) => {
      assert.match(error.message, /没有找到指定模型/);
      assert(!error.message.includes(config.apiKey));
      return true;
    },
  );
  assert.equal(count, 1);
  for (const status of [401, 403, 429, 503]) {
    let attempts = 0;
    await assert.rejects(
      testModel("text", config, {
        mode: "invocation",
        confirmed: true,
        fetchImpl: async () => {
          attempts++;
          return json({ error: { message: config.apiKey } }, status);
        },
      }),
    );
    assert.equal(attempts, 1);
  }
});

test("text evidence rejects empty/error/non-JSON bodies and distinguishes model identity", async () => {
  const options = { mode: "invocation", confirmed: true };
  for (const data of [
    {},
    { error: { message: "bad" } },
    { choices: [{ message: { content: "hello" } }] },
    { choices: [{ message: { content: '{"ok":false}' } }] },
  ])
    await assert.rejects(
      testModel("text", config, {
        ...options,
        fetchImpl: async () => json(data),
      }),
    );
  const success = await testModel("text", config, {
    ...options,
    fetchImpl: async () => json(completion()),
  });
  assert.equal(success.status, "verified");
  assert.equal(success.sample.text, '{"ok":true}');
  for (const model of ["actual-other-model", "", config.apiKey]) {
    const result = await testModel("text", config, {
      ...options,
      fetchImpl: async () => json(completion(model)),
    });
    assert.equal(result.status, "unverified");
    assert.equal(result.ok, false);
    assert.equal(result.invocationSucceeded, true);
    assert(!JSON.stringify(result).includes(config.apiKey));
  }
});

test("images must decode, have the PPT aspect and opaque pixels; a URL alone never proves success", async () => {
  const png = await sharp({
    create: { width: 160, height: 90, channels: 3, background: "#ffffff" },
  })
    .png()
    .toBuffer();
  const image = {
    model: config.model,
    data: [{ b64_json: png.toString("base64") }],
  };
  const options = { mode: "invocation", confirmed: true };
  const valid = await testModel("image", config, {
    ...options,
    fetchImpl: async (url, init) => {
      assert.equal(url, config.baseUrl + "/images/generations");
      const body = JSON.parse(init.body);
      assert.equal(body.model, config.model);
      assert.equal(body.size, "2560x1440");
      assert.equal(body.n, 1);
      return json(image);
    },
  });
  assert.equal(valid.status, "verified");
  assert.equal(valid.sample.width, 160);
  assert.match(valid.sample.image, /^data:image\/jpeg;base64,/);
  for (const data of [
    {},
    { data: [{ b64_json: "aW52YWxpZA==" }] },
    { data: [{ url: "http://local/image.png" }] },
  ])
    await assert.rejects(
      testModel("image", config, {
        ...options,
        fetchImpl: async () => json(data),
      }),
    );
  const square = await sharp({
    create: { width: 100, height: 100, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();
  await assert.rejects(
    testModel("image", config, {
      ...options,
      fetchImpl: async () =>
        json({ data: [{ b64_json: square.toString("base64") }] }),
    }),
    /16:9/,
  );
  const transparent = await sharp({
    create: {
      width: 160,
      height: 90,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .png()
    .toBuffer();
  await assert.rejects(
    testModel("image", config, {
      ...options,
      fetchImpl: async () =>
        json({ data: [{ b64_json: transparent.toString("base64") }] }),
    }),
    /透明/,
  );
  await assert.rejects(
    testModel("image", config, {
      ...options,
      fetchImpl: async () =>
        json({ data: [{ url: "https://cdn.example/image.png" }] }),
      download: async () => ({ status: 403 }),
    }),
    /无法下载/,
  );
});

test("a timed-out attempt cannot become success or automatically repeat", async () => {
  let calls = 0;
  await assert.rejects(
    testModel("text", config, {
      mode: "invocation",
      confirmed: true,
      timeoutMs: 5,
      fetchImpl: async (_url, { signal }) => {
        calls++;
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
        return json(completion());
      },
    }),
    /测试超时/,
  );
  assert.equal(calls, 1);
});

test(
  "real settings HTTP route validates drafts without changing saved credentials and protects legacy clients",
  { timeout: 30000 },
  async () => {
    const calls = [];
    const provider = http.createServer(async (req, res) => {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : null;
      calls.push({ method: req.method, path: req.url, body });
      assert.equal(req.headers.authorization, "Bearer synthetic-route-key");
      res.setHeader("Content-Type", "application/json");
      if (req.url === "/v1/models")
        res.end(JSON.stringify({ data: [{ id: "available-model" }] }));
      else if (body?.model === "available-model")
        res.end(JSON.stringify(completion("available-model")));
      else {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: { code: "model_not_found" } }));
      }
    });
    provider.listen(0, "127.0.0.1");
    await once(provider, "listening");
    const dir = mkdtempSync(path.join(tmpdir(), "jianghao-model-test-"));
    const saved = {
      text: {
        baseUrl: `http://127.0.0.1:${provider.address().port}/v1`,
        model: "saved-typo",
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
      const origin = `http://127.0.0.1:${port}`;
      const post = (body) =>
        fetch(origin + "/api/settings/test", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      const legacy = await post({ kind: "text" });
      assert.equal(legacy.status, 422);
      assert.equal((await legacy.json()).ok, false);
      const draft = { ...saved.text, apiKey: "", model: "available-model" };
      const listed = await (
        await post({ kind: "text", mode: "catalog", connection: draft })
      ).json();
      assert.equal(listed.status, "listed");
      const before = calls.length;
      assert.notEqual(
        (await post({ kind: "text", mode: "invocation", connection: draft }))
          .status,
        200,
      );
      assert.equal(calls.length, before);
      const generated = await (
        await post({
          kind: "text",
          mode: "invocation",
          confirmed: true,
          connection: draft,
        })
      ).json();
      assert.equal(generated.status, "verified");
      assert.equal(calls.at(-1).path, "/v1/chat/completions");
      assert.equal(calls.at(-1).body.model, "available-model");
      const rejected = await post({
        kind: "text",
        mode: "invocation",
        confirmed: true,
        connection: { ...draft, model: "any-nonsense" },
      });
      assert.notEqual(rejected.status, 200);
      assert.equal(calls.at(-1).body.model, "any-nonsense");
      assert.deepEqual(readFileSync(settingsPath), original);
      assert.equal(
        (await (await fetch(origin + "/api/settings")).json()).text.model,
        "saved-typo",
      );
    } finally {
      child.kill("SIGTERM");
      await once(child, "exit");
      await new Promise((resolve) => provider.close(resolve));
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
