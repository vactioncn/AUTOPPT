import { randomUUID } from "node:crypto";
// HTTP fixtures represent an explicit user-confirmed attempt; preserve supplied
// identities so replay/conflict tests still exercise the server contract.
export const requestIdentity = (body) => ({
  "X-AutoPPT-Request-Id": body?.requestId || randomUUID(),
});
