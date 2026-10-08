import test from "node:test";
import assert from "node:assert/strict";
import { failureAdvice } from "../shared/job-feedback.mjs";

test("observed provider errors distinguish permissions, limits, uncertain responses and validation without promising automatic repair", () => {
  assert.match(
    failureAdvice("503 auth_unavailable: no auth available").reason,
    /没有可用通道/,
  );
  assert.match(failureAdvice("503 auth_unavailable: no auth available; last upstream error: server_is_overloaded").reason, /服务拥堵/);
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
