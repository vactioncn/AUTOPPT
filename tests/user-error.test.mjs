import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import express from "express";
import { userError } from "../shared/user-error.mjs";
import { publicErrorHandler } from "../server/user-errors.mjs";
export const hostileErrors = [
  "错误 accessToken=SYNTHETIC",
  "错误 clientSecret=SYNTHETIC",
  "错误 refresh_token=SYNTHETIC",
  "Bearer SYNTHETIC_BEARER_FRAGMENT",
  "Basic U1lOVEhFVElDOlRPS0VO",
  "api_key=SYNTHETIC_KEY&access_token=SYNTHETIC_TOKEN",
  "secret=SYNTHETIC_SECRET",
  "https://synthetic.invalid/media?X-Amz-Signature=SYNTHETIC_SIGNATURE",
  "synthetic-person@example.invalid",
  "/Users/synthetic-user/private/input.md",
  "/opt/synthetic/private.file",
  "C:\\synthetic\\secret.file",
  "非标准错误 SYNTHETIC_ARBITRARY_FRAGMENT_1234567890",
  "provider 原始诊断 SYNTHETIC_RAW",
];
test("public errors classify actionable causes without quoting any provider diagnostic", () => {
  for (const raw of hostileErrors)
    assert(
      !userError(raw).includes("SYNTHETIC") &&
        !userError(raw).includes("synthetic"),
      raw,
    );
  for (const [raw, pattern] of [
    ["insufficient_quota synthetic", /余额/],
    ["invalid api key synthetic", /凭据/],
    ["permission denied synthetic", /权限/],
    ["overloaded synthetic", /繁忙/],
    ["ECONNRESET synthetic", /网络/],
    ["corrupt synthetic", /文件/],
  ])
    assert.match(userError(raw), pattern);
  assert.equal(
    userError("上游中文原文", { external: true }),
    userError("untrusted english"),
  );
  assert.equal(userError("请选择需要制作的页面。"), "请选择需要制作的页面。");
});
test("database objects, API responses and ordinary logs are sanitized before writing or sending", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "autoppt-user-error-"));
  process.env.AUTOPPT_DATA_DIR = dir;
  const store = await import("../server/store.mjs");
  t.after(async () => {
    store.db.close();
    await rm(dir, { recursive: true, force: true });
  });
  for (const [index, raw] of hostileErrors.entries()) {
    const value = {
      id: String(index),
      error: raw,
      status: "partial",
      progress: raw,
      pages: [{ error: raw }],
      performanceTask: { status: "failed", progress: raw },
      slides: [{ reviewError: raw }],
      pageProgress: { failed: [{ error: raw }] },
    };
    store.put("job", value);
    assert(!JSON.stringify(value).includes(raw));
    const persisted = store.db
      .prepare("SELECT data FROM records WHERE kind='job' AND id=?")
      .get(String(index)).data;
    assert(
      !persisted.includes("SYNTHETIC") && !persisted.includes("synthetic"),
    );
  }
  const logs = [],
    original = console.error;
  console.error = (...args) => logs.push(args.join(" "));
  const app = express();
  app.get("/hostile/:index", (req) => {
    throw new Error(hostileErrors[Number(req.params.index)]);
  });
  app.use(publicErrorHandler);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    for (let i = 0; i < hostileErrors.length; i++) {
      const r = await fetch(
        `http://127.0.0.1:${server.address().port}/hostile/${i}`,
      );
      assert.equal(r.status, 400);
      assert(!JSON.stringify(await r.json()).includes("synthetic"));
    }
  } finally {
    console.error = original;
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  assert.equal(
    logs.filter((line) => line.startsWith("[AutoPPT]")).length,
    hostileErrors.length,
  );
  assert(
    !logs.join().includes("SYNTHETIC") && !logs.join().includes("synthetic"),
  );
});
