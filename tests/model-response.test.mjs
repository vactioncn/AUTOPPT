import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

test("generation distinguishes reachable HTML pages, malformed responses, API errors and valid custom-model output", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "jianghao-model-response-"));
  process.env.AUTOPPT_DATA_DIR = dir;
  const config = {
    baseUrl: "https://fixture.invalid/custom/api",
    apiKey: "sk-fixture-secret",
    model: "my-private-alias",
  };
  writeFileSync(
    path.join(dir, "settings.json"),
    JSON.stringify({ text: config, image: config }),
  );
  const store = await import("../server/store.mjs");
  const { jsonModel, request } = await import("../server/models.mjs");
  t.after(() => {
    store.db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  let respond,
    calls = 0;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls++;
    assert.equal(url, config.baseUrl + "/chat/completions");
    assert.equal(JSON.parse(options.body).model, config.model);
    return respond();
  });
  const json = (data, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { "content-type": "application/json" },
    });
  for (const [name, response, pattern] of [
    [
      "HTML from a website route",
      () =>
        new Response("<!doctype html><html>Gateway</html>", {
          headers: { "content-type": "text/html" },
        }),
      /返回了网页.*API 基础地址.*\/v1/,
    ],
    [
      "truncated JSON",
      () =>
        new Response('{"choices":', {
          headers: { "content-type": "application/json" },
        }),
      /没有返回有效 JSON/,
    ],
    ["JSON null", () => json(null), /不是模型结果对象/],
    ["JSON array", () => json([]), /不是模型结果对象/],
    [
      "API error inside HTTP 200",
      () => json({ error: { message: "bad key sk-fixture-secret" } }),
      /模型服务返回 200/,
    ],
    [
      "HTTP authentication failure",
      () => json({ error: { message: "invalid key" } }, 401),
      /模型服务返回 401/,
    ],
  ]) {
    await t.test(name, async () => {
      respond = response;
      calls = 0;
      const previous = new Set(store.all("usage-event").map((e) => e.id));
      await assert.rejects(jsonModel("diagnostic", "fixed test"), (error) => {
        assert.match(error.message, pattern);
        assert.doesNotMatch(
          error.message,
          /不支持.*视觉|是否支持文本和视觉|sk-fixture-secret/,
        );
        return true;
      });
      assert.equal(calls, 1, "protocol errors must not trigger retries");
      const events = store
        .all("usage-event")
        .filter((e) => !previous.has(e.id));
      assert.equal(events.length, 1);
      assert.notEqual(
        events[0].status,
        "success",
        "an HTML or invalid response must not be recorded as model success",
      );
    });
  }
  await t.test(
    "missing text is a response-format problem, not evidence of missing vision support",
    async () => {
      respond = () => json({ choices: [] });
      calls = 0;
      await assert.rejects(
        jsonModel("diagnostic", "fixed test"),
        /接口已响应.*Chat Completions.*响应格式/,
      );
      assert.equal(calls, 1);
    },
  );
  await t.test(
    "custom aliases and absent or different response model names still work",
    async () => {
      for (const model of [undefined, "provider-internal-name"]) {
        respond = () =>
          json({
            model,
            choices: [{ message: { content: '{"ok":true}' } }],
            usage: { prompt_tokens: 10, completion_tokens: 4 },
          });
        calls = 0;
        assert.deepEqual(await jsonModel("diagnostic", "fixed test"), {
          ok: true,
        });
        assert.equal(calls, 1);
      }
    },
  );
  await t.test("non-JSON HTTP errors retain their status", async () => {
    respond = () => new Response("<html>Unauthorized</html>", { status: 401 });
    calls = 0;
    await assert.rejects(
      request("text", "/chat/completions", { model: config.model }),
      /模型服务返回 401/,
    );
    assert.equal(calls, 1);
  });
});
