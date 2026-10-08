import { AsyncLocalStorage } from "node:async_hooks";
import { setTimeout as delay } from "node:timers/promises";

const progress = new AsyncLocalStorage();
export const withModelRequestProgress = (onWait, operation) =>
  progress.run(onWait, operation);

// Only explicit rejections qualify: an interrupted response may already have a result.
const responseMessage = (data) =>
  [
    data?.error?.code,
    data?.error?.type,
    data?.error?.message,
    typeof data?.error === "string" ? data.error : "",
    data?.message,
  ]
    .filter((v) => typeof v === "string")
    .join(" ");
export const hasProviderResult = (data) =>
  !!(
    data?.uncertain ||
    data?.usage ||
    data?.extra_info?.usage_characters !== undefined ||
    data?.choices?.length ||
    data?.data?.length ||
    data?.data?.audio ||
    data?.output?.length ||
    data?.task_id ||
    data?.task?.id ||
    data?.data?.task_id ||
    data?.file ||
    data?.file_id
  );

export function transientModelRejection(status, data) {
  if (hasProviderResult(data)) return null;
  const message = responseMessage(data);
  if (
    /stream.*(?:disconnect|closed)|response.*timeout|response\.completed|read.*timeout/i.test(
      message,
    )
  )
    return null;
  if (
    /insufficient_quota|quota_exceeded|insufficient.?(?:balance|credits)|no credits|billing|spend.limit|invalid.api.key|unauthorized|authentication_error|permission.denied|invalid_request|invalid_parameter|model_not_found|not supported|余额|额度不足/i.test(
      message,
    )
  )
    return null;
  if (
    status === 429 &&
    /rate.?limit|too many requests|slow_down|限流|频率/i.test(message)
  )
    return "rate-limit";
  if (![500, 502, 503, 504].includes(status)) return null;
  if (
    /server_is_overloaded|overloaded|service_unavailable_error|temporarily unavailable|服务.*(?:拥堵|繁忙)/i.test(
      message,
    )
  )
    return "overload";
  if (status === 503 && /auth_unavailable/i.test(message)) return "channel";
  return null;
}

export function retryAfterMs(value, now = Date.now()) {
  if (!value) return 0;
  const ms = /^\d+(\.\d+)?$/.test(value)
    ? Number(value) * 1000
    : Date.parse(value) - now;
  return Number.isFinite(ms) ? Math.max(0, ms) : 0;
}

export const recoveryReason = (reason) =>
  ({
    overload: "模型服务繁忙",
    channel: "模型通道暂不可用",
    "rate-limit": "模型请求限流",
    connection: "模型连接中断",
  })[reason] || "模型服务暂不可用";

export function upstreamHandshakeFailure(status, data) {
  const message =
    data?.error?.message ||
    (typeof data?.error === "string" ? data.error : "") ||
    data?.message ||
    "";
  return (
    [500, 502, 503, 504].includes(status) &&
    typeof message === "string" &&
    /\b(?:u?tls)[ :]+handshake\s*:\s*(?:EOF|unexpected EOF|connection reset by peer)\b/i.test(
      message,
    ) &&
    !hasProviderResult(data)
  );
}

export function createModelRequestPolicy({
  retryDelays = [2000, 5000, 10000],
  serviceRetryDelays = [5000, 15000, 30000],
  random = Math.random,
  wait = (ms, signal) => delay(ms, undefined, { signal }),
} = {}) {
  return async (
    operation,
    { signal, onWait = progress.getStore() || (() => {}) } = {},
  ) => {
    for (let attempt = 0; ; attempt++) {
      signal?.throwIfAborted();
      try {
        return await operation();
      } catch (error) {
        const reason =
          error.retryReason ||
          (error.retryableConnection ? "connection" : null);
        const delays =
          reason === "connection" ? retryDelays : serviceRetryDelays;
        if (signal?.aborted) throw error;
        if (
          !reason ||
          attempt >= delays.length ||
          error.retryAfterMs > 600000
        ) {
          if (attempt)
            error.message += ` 已自动重试 ${attempt} 次仍未恢复，请稍后继续或检查模型接口服务。`;
          if (error.retryAfterMs > 600000)
            error.message += " 服务方要求等待超过 10 分钟，请稍后继续。";
          throw error;
        }
        const jitter =
          reason === "connection"
            ? 0
            : Math.round(delays[attempt] * random() * 0.1);
        const ms = Math.max(delays[attempt] + jitter, error.retryAfterMs || 0);
        onWait({ ms, reason, attempt: attempt + 1, maxRetries: delays.length });
        try {
          await wait(ms, signal);
        } finally {
          onWait(null);
        }
      }
    }
  };
}

export const withModelConnectionRetry = createModelRequestPolicy();
