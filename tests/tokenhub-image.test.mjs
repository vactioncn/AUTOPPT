import test from "node:test";
import assert from "node:assert/strict";
import {
  usesTokenHubImage,
  prepareTokenHubImageRequest,
  normalizeTokenHubImageResponse,
  tokenHubFailureDiagnostic,
} from "../server/hosted/tokenhub-image.mjs";

const model = "hy-image-v3.5-preview";
const prepare = (input) =>
  prepareTokenHubImageRequest({
    model,
    route: "/images/generations",
    contentType: "application/json",
    body: Buffer.from(
      JSON.stringify({
        model,
        prompt: "画一只猫",
        n: 1,
        size: "2560x1440",
        quality: "high",
        background: "opaque",
      }),
    ),
    ...input,
  });
async function multipart(extra = {}) {
  const form = new FormData();
  form.set("model", model);
  form.set("prompt", "修改参考图");
  form.append("image[]", new Blob(["first"], { type: "image/png" }), "a.png");
  form.append("image[]", new Blob(["second"], { type: "image/jpeg" }), "b.jpg");
  for (const [name, value] of Object.entries(extra)) form.set(name, value);
  const request = new Request("http://localhost/", {
    method: "POST",
    body: form,
  });
  return prepare({
    route: "/images/edits",
    contentType: request.headers.get("content-type"),
    body: Buffer.from(await request.arrayBuffer()),
  });
}

test("only selects the configured Hy 3.5 model", () => {
  assert.equal(usesTokenHubImage({ model }), true);
  assert.equal(usesTokenHubImage({ model: "gpt-image" }), false);
});
test("converts generation to Messages and drops unsupported Images parameters", async () => {
  const result = await prepare();
  assert.equal(result.route, "/wand/hunyuan-image/v35-generation");
  assert.equal(result.contentType, "application/json");
  assert.deepEqual(JSON.parse(result.body), {
    model,
    size: "2560x1440",
    messages: [{ role: "user", content: [{ type: "text", text: "画一只猫" }] }],
  });
});
test("preserves every reference as inline data rather than publishing private files", async () => {
  const result = JSON.parse((await multipart()).body);
  assert.equal(result.messages[0].content.length, 3);
  assert.equal(
    result.messages[0].content[1].image_url.url,
    "data:image/png;base64,Zmlyc3Q=",
  );
  assert.equal(
    result.messages[0].content[2].image_url.url,
    "data:image/jpeg;base64,c2Vjb25k",
  );
});
test("rejects mask edits rather than silently discarding the mask", async () => {
  await assert.rejects(
    multipart({ mask: new Blob(["mask"], { type: "image/png" }) }),
    { status: 400, message: /AUTOPPT_LAYERED_ENABLED=0/ },
  );
});
test("rejects malformed JSON, mismatched model and oversized dimensions", async () => {
  for (const body of [
    "{",
    JSON.stringify({ model: "other", prompt: "cat" }),
    JSON.stringify({ model, prompt: "cat", size: "8192x8192" }),
  ])
    await assert.rejects(prepare({ body }), { status: 400 });
});
test("reads final delta image even with null finish_reason, ignores intermediate images", async () => {
  const result = await normalizeTokenHubImageResponse(
    Response.json({
      choices: [
        {
          delta: {
            type: "image",
            image: { url: "https://example.com/final.png" },
          },
          finish_reason: null,
        },
      ],
      assembled_history: [
        {
          content: [
            { image_url: { url: "https://example.com/intermediate.png" } },
          ],
        },
      ],
    }),
  );
  assert.deepEqual(await result.json(), {
    data: [{ url: "https://example.com/final.png" }],
  });
});
test("does not treat HTTP 200 moderation failures as a completed image", async () => {
  const result = await normalizeTokenHubImageResponse(
    Response.json({
      error: { code: "content_filter", message: "upstream private detail" },
    }),
  );
  assert.equal(result.status, 422);
  assert.doesNotMatch(JSON.stringify(await result.json()), /private detail/);
});
test("missing, intermediate-only and non-HTTPS results remain uncertain", async () => {
  for (const data of [
    {},
    { assembled_history: [] },
    { choices: [{ delta: { image: { url: "http://example.com/a.png" } } }] },
  ]) {
    const result = await normalizeTokenHubImageResponse(Response.json(data));
    assert.equal(result.status, 502);
  }
});
test("preserves upstream non-2xx status for gateway accounting and sanitization", async () => {
  const response = Response.json({ error: "private" }, { status: 429 });
  assert.equal(await normalizeTokenHubImageResponse(response), response);
});

test("diagnostic records route and provider reason without credentials or prompt", async () => {
  const response = Response.json(
    {
      error: {
        code: "invalid_size",
        message:
          "size rejected: 画一只猫 secret-key Bearer private https://example.com/private",
      },
      request_id: "trace-123",
    },
    { status: 400 },
  );
  const result = await tokenHubFailureDiagnostic(
    response,
    await prepare(),
    "secret-key",
  );
  assert.equal(result.route, "/wand/hunyuan-image/v35-generation");
  assert.equal(result.code, "invalid_size");
  assert.equal(result.requestId, "trace-123");
  assert.equal(result.referenceCount, 0);
  assert.match(result.message, /size rejected/);
  assert.doesNotMatch(
    JSON.stringify(result),
    /画一只猫|secret-key|Bearer private|example\.com/,
  );
});
test("diagnostic handles Tencent-style and non-JSON errors", async () => {
  const result = await tokenHubFailureDiagnostic(
    Response.json(
      {
        Response: {
          Error: { Code: "InvalidParameter", Message: "wrong model" },
          RequestId: "trace",
        },
      },
      { status: 400 },
    ),
    await prepare(),
    "",
  );
  assert.equal(result.code, "InvalidParameter");
  assert.equal(result.requestId, "trace");
  const html = await tokenHubFailureDiagnostic(
    new Response("<html>private details</html>", { status: 400 }),
    await prepare(),
    "",
  );
  assert.doesNotMatch(html.message, /private details/);
});
