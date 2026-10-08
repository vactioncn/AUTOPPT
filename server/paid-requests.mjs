import { speechScript } from "./speech/scripts.mjs";
import { createHash } from "node:crypto";
import { get, put, id, now, transaction, projectOrThrow } from "./store.mjs";
import { canonical, paidOperations } from "../shared/paid-operations.mjs";
import { sanitizeErrorFields } from "../shared/user-error.mjs";
import { operationContext } from "./operation-context.mjs";
const hash = (value) =>
  createHash("sha256")
    .update(
      typeof value === "string" || Buffer.isBuffer(value)
        ? value
        : JSON.stringify(canonical(value)),
    )
    .digest("hex");
const validId = (value) =>
  typeof value === "string" && /^[\w-]{16,80}$/.test(value);
const active = new Set();
// Each local runtime / hosted account has its own database and persistent random
// namespace. Never derive a public identity from a credential or provider URL.
export function requestScope() {
  return transaction(
    () =>
      get("request-namespace", "workspace") ||
      put("request-namespace", { id: "workspace", scope: id() }),
  ).scope;
}
const kinds = [
  "project",
  "job",
  "style",
  "trial",
  "motion",
  "narration",
  "presenter",
  "speech-script",
  "speaker",
  "speech-cache",
];
function reference(value) {
  if (Array.isArray(value))
    return { type: "array", items: value.map(reference) };
  if (!value || typeof value !== "object") return { type: "value", value };
  if (typeof value.id === "string") {
    for (const kind of kinds) {
      const saved = get(kind, value.id);
      if (saved)
        return {
          type: "resource",
          kind,
          id: value.id,
          fields: Object.keys(value).filter((key) => key in saved),
          extra: reference(
            Object.fromEntries(
              Object.entries(value).filter(([key]) => !(key in saved)),
            ),
          ),
        };
    }
  }
  return {
    type: "object",
    fields: Object.entries(value).map(([key, item]) => [key, reference(item)]),
  };
}
function resolve(value) {
  if (value.type === "value") return value.value;
  if (value.type === "array") return value.items.map(resolve);
  if (value.type === "script")
    return speechScript(projectOrThrow(value.projectId));
  if (value.type === "resource") {
    const saved = get(value.kind, value.id);
    if (!saved)
      throw Object.assign(
        new Error("已受理结果暂不可用，请查看项目记录；不会重新调用模型。"),
        { status: 409 },
      );
    if (value.kind === "narration") delete saved.provider;
    if (value.kind === "job") delete saved.payload;
    return {
      ...Object.fromEntries(
        (value.fields || Object.keys(saved))
          .filter((key) => key in saved)
          .map((key) => [key, saved[key]]),
      ),
      ...resolve(value.extra),
    };
  }
  return Object.fromEntries(
    value.fields.map(([key, item]) => [key, resolve(item)]),
  );
}
function fingerprint(req) {
  const { requestId, retryOf, retryConfirmed, ...payload } = req.body || {};
  return hash({
    payload,
    files: (req.files || (req.file ? [req.file] : [])).map((file) => ({
      field: file.fieldname,
      mime: file.mimetype,
      name: file.originalname,
      digest: hash(file.buffer),
    })),
  });
}
function fail(res, code, error, extra = {}) {
  return res.status(409).json({ error, code, ...extra });
}
export function paidRequest(operation) {
  return (req, res, next) => {
    const requestId = req.get("X-AutoPPT-Request-Id") || req.body?.requestId;
    if (!validId(requestId))
      return res.status(400).json({
        error: "请刷新工作台后重新确认操作。",
        code: "REQUEST_ID_REQUIRED",
      });
    if (req.body?.requestId && req.body.requestId !== requestId)
      return fail(
        res,
        "REQUEST_ID_CONFLICT",
        "请求编号不一致，请重新打开操作窗口。",
      );
    const scope = hash([requestScope(), operation, req.params]);
    const key = hash([scope, requestId]);
    const digest = fingerprint(req);
    const prior = get("paid-request", key);
    if (prior) {
      if (prior.fingerprint !== digest)
        return fail(
          res,
          "REQUEST_PAYLOAD_CONFLICT",
          "这次请求已用于其他内容，请重新确认新的操作。",
        );
      if (prior.resultId) {
        const result = get("operation-result", prior.resultId);
        if (result) {
          // Preserve the existing manuscript acceptance contract after a lost response:
          // autosave may have restored only the already accepted text. Keep newer edits.
          if (operation === "manuscript") {
            const project = get("project", req.params.id);
            if (
              project &&
              project.draft === req.body.text &&
              project.batches?.some((b) => b.requestId === requestId)
            ) {
              project.draft = "";
              put("project", project);
            }
          }
          res.set("X-AutoPPT-Replayed", "1");
          if (prior.status === "failed" && !prior.nextAttempt)
            res.set("X-AutoPPT-Retry-Allowed", "1");
          return res.status(result.status).json(resolve(result.value));
        }
      }
      return fail(
        res,
        "REQUEST_UNCERTAIN",
        "上次操作尚未确认完成，可能已产生费用。请先查看已有任务；需要重新调用时必须确认新的尝试。",
        { retryAllowed: !active.has(key) && !prior.nextAttempt },
      );
    }
    const retryOf = req.get("X-AutoPPT-Retry-Of") || req.body?.retryOf;
    if (retryOf) {
      const parentKey = hash([scope, retryOf]);
      const parent = get("paid-request", parentKey);
      if (
        !validId(retryOf) ||
        !parent ||
        parent.fingerprint !== digest ||
        (req.get("X-AutoPPT-Retry-Confirmed") !== "1" &&
          req.body?.retryConfirmed !== true) ||
        active.has(parentKey) ||
        parent.nextAttempt
      )
        return fail(
          res,
          "RETRY_CONFIRMATION_REQUIRED",
          "请先查看已有任务，再明确确认这次可能重复计费的新尝试。",
        );
    }
    // BEGIN IMMEDIATE makes claims atomic across processes/tabs. The only request
    // data retained here are hashes; results reference normal business records.
    const claimed = transaction(() => {
      if (get("paid-request", key)) return false;
      if (retryOf) {
        const parent = get("paid-request", hash([scope, retryOf]));
        if (parent.nextAttempt) return false;
        put("paid-request", { ...parent, nextAttempt: key });
      }
      put("paid-request", {
        id: key,
        operation,
        scope,
        fingerprint: digest,
        status: "pending",
        createdAt: now(),
        ...(retryOf ? { parent: hash([scope, retryOf]) } : {}),
      });
      return true;
    });
    if (!claimed)
      return fail(
        res,
        "REQUEST_UNCERTAIN",
        "同一次操作正在处理，请稍后查看已有任务。",
      );
    req.body ||= {};
    req.body.requestId = requestId;
    active.add(key);
    const original = res.json.bind(res);
    res.json = (body) => {
      sanitizeErrorFields(body);
      const resultId = id();
      transaction(() => {
        put("operation-result", {
          id: resultId,
          status: res.statusCode,
          value:
            operation === "performance" &&
            res.statusCode < 400 &&
            Array.isArray(body?.pages) &&
            "performanceTask" in body
              ? { type: "script", projectId: req.params.id }
              : reference(body),
        });
        put("paid-request", {
          ...get("paid-request", key),
          status: res.statusCode < 400 ? "complete" : "failed",
          resultId,
          finishedAt: now(),
        });
      });
      active.delete(key);
      return original(body);
    };
    // A dropped response does not cancel a chargeable operation. The handler must
    // finish saving its result; a process interruption leaves a durable pending.
    operationContext.run({ claim: key }, next);
  };
}
export function installPaidRequests(app) {
  app.use((req, res, next) => operationContext.run({ claim: null }, next));
  app.get("/api/request-scope", (_req, res) =>
    res.json({ scope: requestScope() }),
  );
  const post = app.post.bind(app);
  app.post = (route, ...handlers) => {
    const operation = paidOperations.find((r) => r.route === route);
    if (operation)
      handlers.splice(handlers.length - 1, 0, paidRequest(operation.name));
    return post(route, ...handlers);
  };
}
