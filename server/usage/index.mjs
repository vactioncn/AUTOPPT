import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { all, get, put, id, now, transaction, settings } from "../store.mjs";
import { speechSettings } from "../speech/settings.mjs";

const context = new AsyncLocalStorage();
const enabled = !process.env.AUTOPPT_WORKER_TOKEN;
export const withUsage = (scope, fn) =>
  context.run({ ...context.getStore(), ...scope }, fn);
export const usageScope = (scope) =>
  Object.assign(context.getStore() || {}, scope);
const clean = (s, max = 160) =>
  String(s || "")
    .replace(/(?:\bsk-|Bearer\s+)[A-Za-z0-9_.-]+/gi, "[隐藏]")
    .slice(0, max);
const number = (n) =>
  typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : null;
const count = (n) => (Number.isSafeInteger(n) && n >= 0 ? n : null);
export function providerIdentity(config) {
  return {
    providerId: createHash("sha256")
      .update(config.baseUrl.replace(/\/+$/, ""))
      .digest("hex")
      .slice(0, 24),
    provider: new URL(config.baseUrl).origin,
  };
}
export function rateKey(row) {
  return [
    row.providerId,
    row.model,
    row.kind,
    row.size || "",
    row.quality || "",
  ].join("|");
}
export function usageSettings() {
  return (
    get("usage-settings", "local") || {
      id: "local",
      startedAt: null,
      rates: [],
    }
  );
}
export function recoverUsage() {
  if (!enabled) return;
  if (!usageSettings().startedAt)
    put("usage-settings", { ...usageSettings(), startedAt: now() });
  for (const row of all("usage-event"))
    if (row.status === "pending")
      put("usage-event", {
        ...row,
        status: "uncertain",
        costStatus: "unknown",
        costMicro: null,
        finishedAt: now(),
      });
}
function dimensions(config, kind, body) {
  const field = (key) =>
    body instanceof FormData ? body.get(key) : body?.[key];
  return {
    ...providerIdentity(config),
    kind,
    model: clean(
      kind === "clone" ? "voice-clone" : field("model") || config.model,
    ),
    size: kind === "image" ? clean(field("size"), 60) : "",
    quality: kind === "image" ? clean(field("quality"), 60) : "",
  };
}
export function normalizeUsage(kind, data, body, success) {
  const u = data?.usage || {},
    e = data?.extra_info || {};
  const inputTokens = count(u.prompt_tokens ?? u.input_tokens);
  const outputTokens = count(u.completion_tokens ?? u.output_tokens);
  const cachedTokens = count(
    u.prompt_tokens_details?.cached_tokens ??
      u.input_tokens_details?.cached_tokens,
  );
  const chars = count(e.usage_characters);
  return {
    inputTokens,
    outputTokens,
    cachedTokens,
    totalTokens:
      count(u.total_tokens) ??
      (inputTokens !== null && outputTokens !== null
        ? inputTokens + outputTokens
        : null),
    images:
      kind === "image" && Array.isArray(data?.data) && success
        ? data.data.filter((x) => x?.url || x?.b64_json).length || null
        : null,
    characters:
      kind === "speech"
        ? (chars ?? (success ? Array.from(body?.text || "").length : null))
        : null,
    characterSource:
      kind === "speech"
        ? chars !== null
          ? "provider"
          : success
            ? "estimated"
            : "unknown"
        : null,
    audioSeconds:
      number(e.audio_length) === null ? null : e.audio_length / 1000,
    calls: kind === "clone" && success ? 1 : null,
  };
}
export function estimateCost(row) {
  const { rate: r, usage: u } = row;
  if (!r || row.status === "pending") return null;
  let yuan;
  if (r.unit === "tokens") {
    if (u.inputTokens === null || u.outputTokens === null) return null;
    // Input includes cache reads; never add reasoning tokens to completion tokens again.
    if (r.cached !== null && r.cached !== r.input && u.cachedTokens === null)
      return null;
    if ((u.cachedTokens || 0) > u.inputTokens) return null;
    const cached = u.cachedTokens || 0;
    yuan =
      ((u.inputTokens - cached) * r.input +
        cached * (r.cached ?? r.input) +
        u.outputTokens * r.output) /
      1e6;
  } else {
    const qty =
      r.unit === "image"
        ? u.images
        : r.unit === "characters"
          ? u.characters
          : u.calls;
    if (qty === null) return null;
    yuan = (qty * r.price) / (r.unit === "characters" ? 10000 : 1);
  }
  const micro = Math.round(yuan * 1e6);
  return Number.isSafeInteger(micro) ? micro : null;
}
// Capture each physical provider attempt, including retries. Never persist prompts, keys, audio or image bytes.
export async function trackUsage(config, kind, body, fn) {
  if (!enabled) return fn(() => {});
  const scope = context.getStore() || {};
  const project = scope.projectId ? get("project", scope.projectId) : null;
  const row = {
    id: id(),
    createdAt: now(),
    ...dimensions(config, kind, body),
    projectId: project?.id || null,
    projectTitle: clean(project?.title),
    pageId: clean(scope.pageId),
    feature: clean(scope.feature || kind),
    taskId: clean(scope.taskId),
    status: "pending",
    costStatus: "unknown",
    costMicro: null,
    usage: {},
  };
  row.rate = structuredClone(
    usageSettings().rates.find((r) => rateKey(r) === rateKey(row)) || null,
  );
  put("usage-event", row);
  let data, httpStatus;
  try {
    const result = await fn((response, status) => {
      data = response;
      httpStatus = status;
    });
    data = result;
    row.status = "success";
    return result;
  } catch (error) {
    row.status =
      (httpStatus &&
        httpStatus >= 400 &&
        httpStatus < 500 &&
        httpStatus !== 408) ||
      [1002, 1004, 1008, 2013, 20132, 2038, 2042, 2045, 2049].includes(
        data?.base_resp?.status_code,
      )
        ? "rejected"
        : "uncertain";
    throw error;
  } finally {
    row.httpStatus = httpStatus || null;
    row.providerCode = count(data?.base_resp?.status_code);
    row.requestId = clean(data?.trace_id || data?.id, 100);
    row.usage = normalizeUsage(kind, data, body, row.status === "success");
    row.costMicro = estimateCost(row);
    row.costStatus = row.costMicro === null ? "unknown" : "estimated";
    row.finishedAt = now();
    put("usage-event", row);
  }
}
export function recordCache(config, duration) {
  if (!enabled) return;
  const scope = context.getStore() || {},
    p = get("project", scope.projectId || "");
  put("usage-event", {
    id: id(),
    createdAt: now(),
    finishedAt: now(),
    ...dimensions(config, "speech", {}),
    projectId: p?.id || null,
    projectTitle: clean(p?.title),
    pageId: clean(scope.pageId),
    feature: clean(scope.feature || "speech"),
    taskId: clean(scope.taskId),
    status: "cached",
    costMicro: 0,
    costStatus: "free",
    rate: null,
    usage: { audioSeconds: number(duration) },
  });
}
export function saveRate(input) {
  const kind = input.kind;
  if (!["text", "image", "speech", "clone"].includes(kind))
    throw new Error("请选择有效的用量类型");
  if (
    !/^[a-f0-9]{24}$/.test(input.providerId || "") ||
    !input.model ||
    input.model.length > 160
  )
    throw new Error("请选择已经配置或调用过的模型");
  const allowed = {
    text: ["tokens"],
    image: ["image", "tokens"],
    speech: ["characters"],
    clone: ["call"],
  };
  if (!allowed[kind].includes(input.unit)) throw new Error("计价单位无效");
  const parse = (v, optional = false) => {
    if (optional && (v === null || v === "" || v === undefined)) return null;
    if (
      v === "" ||
      v === null ||
      v === undefined ||
      !Number.isFinite(Number(v)) ||
      Number(v) < 0 ||
      Number(v) > 1000000
    )
      throw new Error("单价需为 0–1000000 元；未知价格请不要填 0");
    return Number(v);
  };
  const rate = {
    providerId: input.providerId,
    provider: clean(input.provider),
    model: clean(input.model),
    kind,
    size: clean(input.size, 60),
    quality: clean(input.quality, 60),
    unit: input.unit,
    input: input.unit === "tokens" ? parse(input.input) : null,
    output: input.unit === "tokens" ? parse(input.output) : null,
    cached: input.unit === "tokens" ? parse(input.cached, true) : null,
    price: input.unit !== "tokens" ? parse(input.price) : null,
    note: clean(input.note, 300),
    updatedAt: now(),
  };
  const s = usageSettings();
  s.rates = [...s.rates.filter((r) => rateKey(r) !== rateKey(rate)), rate];
  put("usage-settings", s);
  return rate;
}
export function addBudget(input) {
  if (!/^[a-zA-Z0-9-]{16,80}$/.test(input.id || ""))
    throw new Error("预算流水编号无效");
  if (
    !/^\d{1,7}(\.\d{1,2})?$/.test(String(input.amount)) ||
    Number(input.amount) <= 0
  )
    throw new Error("请填写大于 0 的金额，最多两位小数");
  const row = {
    id: input.id,
    amountMicro: Math.round(Number(input.amount) * 1e6),
    note: clean(input.note, 300),
    createdAt: now(),
  };
  return transaction(() => {
    const old = get("usage-budget", row.id);
    if (old) {
      if (old.amountMicro !== row.amountMicro || old.note !== row.note)
        throw new Error("流水编号已经用于另一笔预算");
      return old;
    }
    return put("usage-budget", row);
  });
}
const total = (rows) =>
  rows.reduce(
    (s, r) => {
      s.requests += r.status === "cached" ? 0 : 1;
      s.cached += r.status === "cached" ? 1 : 0;
      s.costMicro += r.costMicro ?? 0;
      s.unknown += r.costMicro === null ? 1 : 0;
      s.tokens += r.usage.totalTokens || 0;
      s.images += r.usage.images || 0;
      s.characters += r.usage.characters || 0;
      s.audioSeconds += r.usage.audioSeconds || 0;
      return s;
    },
    {
      requests: 0,
      cached: 0,
      costMicro: 0,
      unknown: 0,
      tokens: 0,
      images: 0,
      characters: 0,
      audioSeconds: 0,
    },
  );
function filtered(query) {
  const from = query.from ? Date.parse(query.from) : -Infinity;
  const to = query.to ? Date.parse(query.to) : Infinity;
  if (Number.isNaN(from) || Number.isNaN(to) || from >= to)
    throw new Error("日期范围无效");
  return all("usage-event")
    .filter(
      (r) =>
        Date.parse(r.createdAt) >= from &&
        Date.parse(r.createdAt) < to &&
        (!query.projectId ||
          (r.projectId || "unassigned") === query.projectId) &&
        (!query.kind || r.kind === query.kind),
    )
    .sort(
      (a, b) =>
        b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
    );
}
export function usageReport(query = {}) {
  const rows = filtered(query),
    allRows = all("usage-event"),
    budgets = all("usage-budget").sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
  const allTotal = total(allRows),
    budgetMicro = budgets.reduce((sum, b) => sum + b.amountMicro, 0);
  const group = (key) =>
    Object.entries(Object.groupBy(rows, key)).map(([id, rows]) => ({
      id,
      title: rows[0].projectTitle,
      ...total(rows),
    }));
  const variants = [
    ...usageSettings().rates,
    ...allRows,
    ...Object.entries(settings()).map(([kind, config]) =>
      dimensions(
        config,
        kind,
        kind === "image" ? { size: "2560x1440", quality: "high" } : {},
      ),
    ),
    dimensions(settings().image, "image", { quality: "high" }),
    ...["speech", "clone"].map((kind) =>
      dimensions(speechSettings(), kind, {}),
    ),
  ];
  const models = [
    ...new Map(
      variants.map((r) => [
        rateKey(r),
        {
          providerId: r.providerId,
          provider: r.provider,
          model: r.model,
          kind: r.kind,
          size: r.size,
          quality: r.quality,
        },
      ]),
    ).values(),
  ];
  const offset = Math.max(0, Math.floor(Number(query.offset) || 0));
  return {
    startedAt: usageSettings().startedAt,
    rates: usageSettings().rates,
    models,
    summary: total(rows),
    lifetime: allTotal,
    budgetMicro,
    remainingMicro: budgetMicro - allTotal.costMicro,
    budgets,
    byKind: group((r) => r.kind),
    byProject: group((r) => r.projectId || "unassigned"),
    projects: [
      ...new Map(
        allRows.map((r) => [
          r.projectId || "unassigned",
          {
            id: r.projectId || "unassigned",
            title: r.projectTitle || "公共功能 / 未归属项目",
          },
        ]),
      ).values(),
    ],
    total: rows.length,
    rows: rows.slice(offset, offset + 100),
  };
}
export function usageCsv(query = {}) {
  const quote = (v) =>
    '"' +
    String(v ?? "")
      .replace(/^(?:\s*[=+\-@]|[\t\r\n])/, "'$&")
      .replaceAll('"', '""') +
    '"';
  const head = [
    "请求编号",
    "时间",
    "项目",
    "项目编号",
    "页面编号",
    "任务编号",
    "功能",
    "类型",
    "供应商",
    "模型",
    "尺寸",
    "质量",
    "状态",
    "输入Token",
    "缓存Token(包含于输入)",
    "输出Token",
    "总Token",
    "图片数",
    "语音字符数",
    "字符依据",
    "音频秒",
    "复刻次数",
    "预估人民币",
    "费用状态",
    "计价快照",
    "供应商请求编号",
  ];
  const rows = filtered(query).map((r) => [
    r.id,
    r.createdAt,
    r.projectTitle,
    r.projectId,
    r.pageId,
    r.taskId,
    r.feature,
    r.kind,
    r.provider,
    r.model,
    r.size,
    r.quality,
    r.status,
    r.usage.inputTokens,
    r.usage.cachedTokens,
    r.usage.outputTokens,
    r.usage.totalTokens,
    r.usage.images,
    r.usage.characters,
    r.usage.characterSource,
    r.usage.audioSeconds,
    r.usage.calls,
    r.costMicro === null ? "" : r.costMicro / 1e6,
    r.costStatus,
    r.rate ? JSON.stringify(r.rate) : "",
    r.requestId,
  ]);
  return (
    "\uFEFF" + [head, ...rows].map((r) => r.map(quote).join(",")).join("\r\n")
  );
}
export function registerUsage(app) {
  app.use("/api/usage", (req, res, next) =>
    enabled
      ? next()
      : res.status(403).json({
          error: "此版本用量账本仅用于本机工作空间；在线账号沿用现有额度规则。",
        }),
  );
  app.get("/api/usage", (req, res) => res.json(usageReport(req.query)));
  app.post("/api/usage/rates", (req, res) => res.json(saveRate(req.body)));
  app.post("/api/usage/budget", (req, res) => res.json(addBudget(req.body)));
  app.get("/api/usage/export", (req, res) =>
    res
      .type("text/csv")
      .set("Content-Disposition", 'attachment; filename="AutoPPT-usage.csv"')
      .send(usageCsv(req.query)),
  );
}
export function usageMiddleware(req, res, next) {
  const projectId =
    req.path.match(/^\/api\/projects\/([^/]+)/)?.[1] || req.body?.projectId;
  const feature = req.path.includes("speech-performance")
    ? "演绎编排"
    : req.path.includes("speech/preview")
      ? "口播试听"
      : req.path.includes("voices/clone")
        ? "声音复刻"
        : req.path.includes("suggest-split")
          ? "段落拆分建议"
          : req.path.includes("audience")
            ? "听众分析"
            : req.path.includes("palette")
              ? "配色提取"
              : "内容分析";
  return withUsage(
    {
      projectId,
      pageId: req.body?.pageId || req.body?.slideId,
      taskId: id(),
      feature,
    },
    next,
  );
}
