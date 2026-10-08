import { AsyncLocalStorage } from "node:async_hooks";
import { setTimeout as delay } from "node:timers/promises";

const progress = new AsyncLocalStorage();
export const withModelRequestProgress = (onWait, operation) =>
  progress.run(onWait, operation);

// Retry only explicit upstream TLS handshake interruptions for text requests.
// Generic 5xx, response timeouts and interrupted bodies may already be billable.
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
    !data?.uncertain &&
    !data?.usage &&
    !data?.choices?.length &&
    !data?.data?.length
  );
}

export function createModelRequestPolicy({
  retryDelays = [2000, 5000, 10000],
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
        if (signal?.aborted || !error.retryableConnection) throw error;
        if (attempt >= retryDelays.length) {
          if (attempt)
            error.message += ` 已自动重试 ${attempt} 次仍未恢复，请稍后继续或检查模型接口服务。`;
          throw error;
        }
        const ms = retryDelays[attempt];
        onWait({ ms, attempt: attempt + 1, maxRetries: retryDelays.length });
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
