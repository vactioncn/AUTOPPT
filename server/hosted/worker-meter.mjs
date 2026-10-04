import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
const context = new AsyncLocalStorage();
export const hostedWorker = !!process.env.AUTOPPT_WORKER_TOKEN;
export function meterHeaders() {
  return hostedWorker
    ? { "x-autoppt-lease": context.getStore()?.id || "" }
    : {};
}
async function control(action, body) {
  const res = await fetch(`${process.env.AUTOPPT_GATEWAY}/internal/${action}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.AUTOPPT_WORKER_TOKEN}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  const data = await res.json();
  if (!res.ok)
    throw new Error(data.error || "额度服务暂时不可用，请稍后重试。");
  return data;
}
export async function meteredImage(fn) {
  if (!hostedWorker) return fn();
  const id = randomUUID();
  await control("reserve", { id });
  return context.run({ id }, async () => {
    let filename;
    try {
      filename = await fn();
    } catch (e) {
      // The gateway marks dispatched calls uncertain until their result is known.
      // Definite provider errors are released at the gateway, and local errors
      // after a provider response are released here when no deliverable was saved.
      await control("finish", {
        id,
        status: e.uncertain ? "uncertain" : "failed",
      }).catch(() => {});
      throw e;
    }
    // The PNG is durable before settlement. A sidecar lets the gateway recover
    // settlement after a network/process interruption without a second debit.
    const { writeFileSync } = await import("node:fs");
    const { dataDir } = await import("../store.mjs");
    const path = await import("node:path");
    writeFileSync(
      path.join(dataDir, `receipt-${id}.json`),
      JSON.stringify({ id, filename }),
      { mode: 0o600 },
    );
    await control("finish", { id, status: "complete", filename }).catch(
      () => {},
    );
    return filename;
  });
}
