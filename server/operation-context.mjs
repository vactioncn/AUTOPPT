import { AsyncLocalStorage } from "node:async_hooks";
export const operationContext = new AsyncLocalStorage();
export function assertPaidClaim() {
  const context = operationContext.getStore();
  if (context && !context.claim)
    throw Object.assign(
      new Error("收费操作缺少已持久化的请求，请刷新后重新确认。"),
      { status: 409 },
    );
}
