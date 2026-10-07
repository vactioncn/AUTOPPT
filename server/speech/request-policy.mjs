import { setTimeout as delay } from "node:timers/promises";

// Default to MiniMax's lower T2A tier (10 requests/minute), with a small margin.
// Only explicit rate-limit rejections may be retried. Timeouts are ambiguous.
export function createSpeechRequestPolicy({
  now = Date.now,
  wait = (ms, signal) => delay(ms, undefined, { signal }),
  intervalMs = 6100,
  retryDelays = [60000, 120000, 180000],
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
      let limited = false;
      for (let attempt = 0; ; attempt++) {
        signal?.throwIfAborted();
        const ms = Math.max(0, account.nextAt - now());
        if (ms) {
          onWait({
            reason: limited ? "rate-limit" : "pace",
            ms,
            attempt,
            maxRetries: retryDelays.length,
          });
          await wait(ms, signal);
        }
        signal?.throwIfAborted();
        account.nextAt = now() + intervalMs;
        onWait(null);
        try {
          return await operation();
        } catch (error) {
          if (
            signal?.aborted ||
            !error.rateLimited ||
            attempt >= retryDelays.length
          )
            throw error;
          const cooldown = Math.max(
            retryDelays[attempt],
            error.retryAfterMs || 0,
          );
          // A very long provider cooldown requires a later, explicit continuation.
          if (cooldown > 600000) throw error;
          account.nextAt = Math.max(account.nextAt, now() + cooldown);
          limited = true;
        }
      }
    } finally {
      release();
    }
  };
}
