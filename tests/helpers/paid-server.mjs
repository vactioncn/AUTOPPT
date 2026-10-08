import { operationContext } from "../../server/operation-context.mjs";
import express from "express";
import multer from "multer";
import { installPaidRequests } from "../../server/paid-requests.mjs";
import { paidOperations } from "../../shared/paid-operations.mjs";
import { assertPaidClaim } from "../../server/operation-context.mjs";
import { trackUsage } from "../../server/usage/index.mjs";
import { all, put, id, get } from "../../server/store.mjs";
import { publicErrorHandler } from "../../server/user-errors.mjs";
const app = express();
app.use(express.json());
installPaidRequests(app);
let ready = true;
app.get("/test/state", (_req, res) =>
  res.json({
    claims: all("paid-request"),
    results: all("operation-result"),
    usage: all("usage-event"),
    jobs: all("job"),
  }),
);
app.post("/test/readiness", (req, res) => {
  ready = req.body.ready;
  res.json({ ready });
});
app.post("/test/unregistered", () => assertPaidClaim());
for (const op of paidOperations)
  app.post(op.route, multer().any(), async (req, res) => {
    assertPaidClaim();
    if (!ready) throw new Error("模型凭据未配置，请先检查服务。");
    if (
      req.body.mode === "pending" &&
      !get("paid-request", operationContext.getStore().claim).parent
    ) {
      process.send?.({ pending: true });
      return;
    }
    if (req.body.mode === "malicious") throw new Error(req.body.error);
    await new Promise((resolve) => setTimeout(resolve, 30));
    await trackUsage(
      { baseUrl: "http://synthetic.invalid", model: "synthetic" },
      "text",
      {},
      async (capture) => {
        const data = { usage: { input_tokens: 3, output_tokens: 5 } };
        capture(data, 200);
        return data;
      },
    );
    const job = put("job", {
      id: id(),
      operation: op.name,
      status: "ready",
      payload: { privateText: "SYNTHETIC_PRIVATE_BODY" },
      error: null,
    });
    const { payload, ...publicJob } = job;
    res.status(202).json({ job: publicJob, accepted: true });
  });
app.use(publicErrorHandler);
const server = app.listen(0, "127.0.0.1", () =>
  process.send?.({ port: server.address().port }),
);
