import test from "node:test";
import assert from "node:assert/strict";
import {
  failureAdvice,
  elapsedLabel,
  retrySeconds,
} from "../shared/job-feedback.mjs";

test("observed provider errors distinguish permissions, limits, uncertain responses and validation without promising automatic repair", () => {
  assert.match(
    failureAdvice("503 auth_unavailable: no auth available").reason,
    /没有可用通道/,
  );
  assert.match(
    failureAdvice(
      "503 auth_unavailable: no auth available; last upstream error: server_is_overloaded",
    ).reason,
    /服务拥堵/,
  );
  assert.match(failureAdvice("401 unauthorized").reason, /认证或权限/);
  assert.match(failureAdvice("429 rate limit").reason, /限制/);
  assert.match(
    failureAdvice("408 stream disconnected before completion").action,
    /先核对用量/,
  );
  assert.match(
    failureAdvice("500 utls: TLS handshake: EOF").action,
    /不会无限重试/,
  );
  assert.match(failureAdvice("503 overloaded").action, /手动继续/);
  assert.match(
    failureAdvice("内容关系缺少有效原文依据").action,
    /不会自动修改/,
  );
  assert.match(failureAdvice("unknown error").reason, /未完成/);
});

test("hosted failures give account and administrator guidance and uncertainty takes priority", () => {
  assert.match(
    failureAdvice("401 unauthorized", { hosted: true }).action,
    /管理员/,
  );
  assert.doesNotMatch(
    failureAdvice("401 unauthorized", { hosted: true }).action,
    /密钥|模型与服务/,
  );
  assert.match(
    failureAdvice("429 rate limit", { hosted: true }).action,
    /可用和预留/,
  );
  const unknown = failureAdvice("503 overload", {
    hosted: true,
    uncertain: true,
  });
  assert.match(unknown.reason, /需要核对/);
  assert.match(unknown.action, /不会自动重复请求/);
  assert.match(
    failureAdvice("timeout", { hosted: true }).action,
    /管理员先核对/,
  );
});

test("elapsed waiting and automatic retry countdown use observed timestamps, never an invented ETA", () => {
  const start = "2026-10-10T00:00:00.000Z",
    time = Date.parse(start);
  assert.equal(elapsedLabel(start, time + 65000), "1 分 5 秒");
  assert.equal(elapsedLabel(start, time - 1000), "0 秒");
  assert.equal(elapsedLabel("invalid", time), "");
  const retry = { retryAt: new Date(time + 10000).toISOString(), seconds: 10 };
  assert.equal(retrySeconds(retry, time + 4000), 6);
  assert.equal(retrySeconds(retry, time + 20000), 0);
  assert.equal(retrySeconds({ seconds: 7 }, time), 7);
});
