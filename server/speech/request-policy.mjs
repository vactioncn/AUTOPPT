import { setTimeout as delay } from "node:timers/promises";

// Default to MiniMax's lower T2A tier (10 requests/minute), with a small margin.
// Retry explicit rejections while preserving the shared account pacing.
export function createSpeechRequestPolicy({
  now = Date.now,
  wait = (ms, signal) => delay(ms, undefined, { signal }),
  intervalMs = 6100,
  retryDelays = [60000, 120000, 180000],
  serviceRetryDelays = [5000, 15000, 30000],
  random = Math.random,
} = {}) {
  const accounts = new Map();
  return async (key, operation, { signal, onWait = () => {} } = {}) => {
    let account = accounts.get(key);
    if (!account) {
      account = { nextAt: 0, tail: Promise.resolve() };
      accounts.set(key, account);
    }
    const previous = account.tail;
    let release;
    account.tail = new Promise((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      let cooldownReason = null;
      for (let attempt = 0; ; attempt++) {
        signal?.throwIfAborted();
        const ms = Math.max(0, account.nextAt - now());
        if (ms) {
          onWait({
            reason: cooldownReason || "pace",
            ms,
            attempt,
            maxRetries:
              cooldownReason === "rate-limit"
                ? retryDelays.length
                : serviceRetryDelays.length,
          });
          await wait(ms, signal);
        }
        signal?.throwIfAborted();
        account.nextAt = now() + intervalMs;
        onWait(null);
        try {
          return await operation();
        } catch (error) {
          const reason = error.rateLimited ? "rate-limit" : error.retryReason;
          const delays =
            reason === "rate-limit" ? retryDelays : serviceRetryDelays;
          if (signal?.aborted || !reason || attempt >= delays.length) {
            if (!signal?.aborted && attempt)
              error.message += ` 已自动重试 ${attempt} 次仍未恢复，请稍后继续。`;
            throw error;
          }
          const cooldown = Math.max(
            delays[attempt] +
              (reason === "rate-limit"
                ? 0
                : Math.round(delays[attempt] * random() * 0.1)),
            error.retryAfterMs || 0,
          );
          // A very long provider cooldown requires a later, explicit continuation.
          if (cooldown > 600000) {
            error.message += " 服务方要求等待超过 10 分钟，请稍后继续。";
            throw error;
          }
          account.nextAt = Math.max(account.nextAt, now() + cooldown);
          cooldownReason = reason;
        }
      }
    } finally {
      try {
        onWait(null);
      } finally {
        release();
      }
    }
  };
}
