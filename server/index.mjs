import { validateScene, renderSceneSvg } from "../shared/slides.mjs";
import express from "express";
import multer from "multer";
import sharp from "sharp";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  all,
  get,
  put,
  id,
  now,
  dataDir,
  assetsDir,
  assetPath,
  publicSettings,
  updateSettings,
  settings,
  projectOrThrow,
  saveProject,
  transaction,
} from "./store.mjs";
import {
  splitAt,
  orderedSelection,
  snapshot,
  sentences,
  unitsFromEnds,
  styleStamp,
  styleLanguageKey,
} from "./core.mjs";
import {
  enqueue,
  assertIdle,
  activeJob,
  retry,
  cancel,
  recoverJobs,
  newSlide,
} from "./jobs.mjs";
import { jsonModel } from "./models.mjs";
import { exportPresentation, exportFilename } from "./export.mjs";
import {
  spokenManuscript,
  speakerNotes,
  MANUSCRIPT_VERSION,
} from "./manuscript.mjs";
import {
  cleanProjectManuscripts,
  migrateManuscripts,
} from "./manuscript-migration.mjs";

import { registerTrials } from "./trials.mjs";
import { registerStyleImports } from "./style-import.mjs";

const app = express();
app.disable("x-powered-by");
const port = Number(process.env.PORT || 4317);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
app.use((req, res, next) => {
  const host = req.hostname;
  if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(host))
    return res.status(403).json({ error: "只允许本机访问。" });
  if (req.path.startsWith("/api") && req.headers.origin) {
    let origin;
    try {
      origin = new URL(req.headers.origin);
    } catch {
      return res.status(403).json({ error: "请求来源无效。" });
    }
    if (
      !["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname) ||
      Number(origin.port || 80) !== port
    )
      return res.status(403).json({ error: "请在本机 AutoPPT 页面中操作。" });
  }
  next();
});
app.use("/api", (req, res, next) => {
  if (
    ["POST", "PUT", "PATCH"].includes(req.method) &&
    !req.is("application/json") &&
    !req.is("multipart/form-data")
  )
    return res.status(415).json({ error: "请使用工作台提交操作。" });
  next();
});
app.use(express.json({ limit: "4mb" }));
app.use(
  "/assets",
  express.static(assetsDir, {
    dotfiles: "deny",
    immutable: true,
    maxAge: "1y",
  }),
);
app.use("/api", (req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});
const safeJob = (j) => ({
  ...j,
  styleId: j.payload.styleId || j.payload.styleSnapshot?.id,
  payload: undefined,
});
const styleReady = (styleId) => {
  const s = get("style", styleId);
  if (!s?.rules || s.deletedAt)
    throw new Error("请选择一个可用风格，或先到风格库完成提炼。");
  return s;
};
app.get("/api/health", (req, res) => res.json({ app: "AutoPPT", ok: true }));
app.get("/api/bootstrap", (req, res) =>
  res.json({
    features: { styleUrlImport: true },
    projects: all("project")
      .map((p) => ({
        id: p.id,
        title: p.title,
        styleId: p.styleId,
        updatedAt: p.updatedAt,
        createdAt: p.createdAt,
        pageCount: p.slides.length,
        batchCount: p.batches.length,
        cover: p.slides.find((s) => s.image)?.image,
        coverScene: p.slides.find((s) => s.scene)?.scene,
        wordCount: p.slides.reduce((n, s) => n + s.notes.trim().length, 0),
      }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    styles: all("style").map((s) => ({
      ...s,
      designLanguage: get("styleLanguage", styleLanguageKey(s))?.language,
    })),
    settings: publicSettings(),
    jobs: all("job")
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 50)
      .map(safeJob),
  }),
);
app.get("/api/projects/:id", (req, res) =>
  res.json(projectOrThrow(req.params.id)),
);
app.post("/api/projects", (req, res) => {
  const title = String(req.body.title || "").trim();
  if (!title || title.length > 100)
    throw new Error("请输入 1–100 字的演讲主题。");
  styleReady(req.body.styleId);
  const p = put("project", {
    id: id(),
    title,
    styleId: req.body.styleId,
    createdAt: now(),
    updatedAt: now(),
    revision: 0,
    batches: [],
    slides: [],
    draft: "",
    proposal: null,
    undo: null,
  });
  res.status(201).json(p);
});
app.patch("/api/projects/:id", (req, res) => {
  const p = projectOrThrow(req.params.id);
  if ("draft" in req.body) {
    if (typeof req.body.draft !== "string" || req.body.draft.length > 200000)
      throw new Error("草稿最多支持 20 万字。");
    p.draft = req.body.draft;
  }
  if ("title" in req.body) {
    assertIdle(p.id);
    const title = String(req.body.title).trim();
    if (!title || title.length > 100) throw new Error("主题需要 1–100 字。");
    p.title = title;
  }
  if ("styleId" in req.body) {
    assertIdle(p.id);
    styleReady(req.body.styleId);
    p.styleId = req.body.styleId;
    p.proposal = null;
  }
  // Draft autosave is independent from generation and must not invalidate a pending proposal.
  if (Object.keys(req.body).every((k) => k === "draft")) {
    p.updatedAt = now();
    put("project", p);
  } else saveProject(p);
  res.json(p);
});
app.post("/api/projects/:id/batches", (req, res) => {
  const p = projectOrThrow(req.params.id);
  assertIdle(p.id);
  styleReady(p.styleId);
  const text = req.body.text;
  if (typeof text !== "string" || !text.trim())
    throw new Error("请先写下这一段逐字稿。");
  if (text.length > 200000)
    throw new Error("单次最多支持 20 万字，请分段添加。");
  if (!spokenManuscript(text).trim())
    throw new Error("去掉 Markdown 标题后没有正文，请补充需要讲述的内容。");
  const batch = {
    id: id(),
    text,
    label: `第 ${p.batches.length + 1} 段`,
    createdAt: now(),
    slideIds: [],
  };
  let j;
  transaction(() => {
    p.batches.push(batch);
    p.draft = "";
    p.proposal = null;
    p.undo = null;
    saveProject(p);
    j = enqueue("append", p.id, { batchId: batch.id });
    batch.jobId = j.id;
    put("project", p);
  });
  res.status(202).json(j);
});
app.patch("/api/projects/:id/slides/:sid", (req, res) => {
  const p = projectOrThrow(req.params.id);
  assertIdle(p.id);
  const s = p.slides.find((s) => s.id === req.params.sid);
  if (!s) throw new Error("页面不存在");
  if (typeof req.body.notes !== "string" || !req.body.notes.trim())
    throw new Error("逐字稿不能为空。");
  if (req.body.notes.length > 200000)
    throw new Error("逐字稿过长，请拆分页面。");
  const notes = spokenManuscript(req.body.notes);
  if (!notes.trim())
    throw new Error("去掉 Markdown 标题后没有正文，请补充需要讲述的内容。");
  if (s.notes !== notes) {
    s.versions.push(snapshot(s));
    s.notes = notes;
    s.manuscriptVersion = MANUSCRIPT_VERSION;
    s.stale = true;
    delete s.pendingPlan;
    delete s.pendingPlanStyle;
    p.proposal = null;
    p.undo = null;
    saveProject(p);
  }
  res.json(p);
});
app.post("/api/projects/:id/render", (req, res) => {
  const p = projectOrThrow(req.params.id);
  assertIdle(p.id);
  styleReady(p.styleId);
  const ids = req.body.slideIds;
  if (
    !Array.isArray(ids) ||
    !ids.length ||
    ids.some((id) => !p.slides.some((s) => s.id === id))
  )
    throw new Error("请选择需要制作的页面。");
  p.undo = null;
  for (const sid of ids) {
    const slide = p.slides.find((s) => s.id === sid);
    delete slide.pendingPlan;
    delete slide.pendingPlanStyle;
  }
  saveProject(p);
  res.status(202).json(
    enqueue("render", p.id, {
      slideIds: ids,
      redesign: req.body.redesign !== false,
      feedback: String(req.body.feedback || "").slice(0, 10000),
    }),
  );
});
app.post("/api/projects/:id/slides/:sid/inspect", (req, res) =>
  res.status(410).json({ error: "风格对比检查已停用。" }),
);
app.patch("/api/projects/:id/slides/:sid/scene", (req, res) => {
  const p = projectOrThrow(req.params.id);
  assertIdle(p.id);
  const s = p.slides.find((s) => s.id === req.params.sid);
  if (!s?.scene)
    throw new Error("这页还是历史图片，请先重新设计为可编辑页面。");
  if (req.body.revision !== p.revision)
    throw Object.assign(new Error("页面已在别处修改，请重新打开后再编辑。"), {
      status: 409,
    });
  const scene = validateScene(req.body.scene);
  s.versions.push(snapshot(s));
  s.scene = scene;
  s.plan = {
    ...s.plan,
    scene,
    displayText: scene.elements
      .filter((e) => e.type === "text")
      .map((e) => e.text),
  };
  p.undo = null;
  p.proposal = null;
  saveProject(p);
  res.json(p);
});
app.post("/api/projects/:id/slides/:sid/restore", (req, res) => {
  const p = projectOrThrow(req.params.id);
  assertIdle(p.id);
  const s = p.slides.find((s) => s.id === req.params.sid);
  const v = s?.versions.find((v) => v.id === req.body.versionId);
  if (!v) throw new Error("历史版本不存在");
  s.versions.push(snapshot(s));
  Object.assign(s, {
    notes: speakerNotes(v),
    manuscriptVersion: MANUSCRIPT_VERSION,
    plan: v.plan,
    image: v.image,
    scene: v.scene || null,
    styleId: v.styleId,
    planStyle: v.planStyle,
    imageStyle: v.imageStyle,
    review: v.review,
    reviewError: v.reviewError,
    stale: v.stale,
    status: v.image || v.scene ? "ready" : "pending",
    error: null,
  });
  delete s.pendingPlan;
  delete s.pendingPlanStyle;
  p.proposal = null;
  p.undo = null;
  saveProject(p);
  res.json(p);
});
app.post("/api/projects/:id/suggest-split", async (req, res) => {
  const p = projectOrThrow(req.params.id);
  const s = p.slides.find((s) => s.id === req.body.slideId);
  if (!s) throw new Error("页面不存在");
  const parts = sentences(s.notes);
  if (parts.length < 2) return res.json({ cuts: [] });
  const out = await jsonModel(
    '分析演讲段落，建议语义转折的分界。只建议，不改写。返回 {"ends":[各单元最后一句编号]}，从1开始，严格递增，最后一个为总句数。',
    parts.map((s, i) => `[${i + 1}]${s}`).join("\n"),
  );
  const units = unitsFromEnds(parts, out.ends);
  let n = 0;
  res.json({ cuts: units.slice(0, -1).map((u) => (n += u.length)) });
});
app.post("/api/projects/:id/proposal", (req, res) => {
  const p = projectOrThrow(req.params.id);
  assertIdle(p.id);
  let notes, sourceIds;
  if (req.body.type === "merge") {
    const selected = orderedSelection(p.slides, req.body.slideIds);
    const batchPositions = selected.flatMap((slide) =>
      slide.batchIds.map((bid) =>
        p.batches.findIndex((batch) => batch.id === bid),
      ),
    );
    const firstBatch = Math.min(...batchPositions);
    const lastBatch = Math.max(...batchPositions);
    if (
      p.batches
        .slice(firstBatch, lastBatch + 1)
        .some((batch) => !batch.slideIds.length)
    ) {
      throw new Error(
        "所选页面之间还有未完成拆分的逐字稿，请先完成中间段落，再合并页面。",
      );
    }
    notes = [selected.map((s) => s.notes).join("")];
    sourceIds = selected.map((s) => s.id);
  } else if (req.body.type === "split") {
    const s = p.slides.find((s) => s.id === req.body.slideId);
    if (!s) throw new Error("页面不存在");
    notes = splitAt(s.notes, req.body.cuts);
    sourceIds = [s.id];
  } else throw new Error("未知的调整方式");
  res.status(202).json(
    enqueue("proposal", p.id, {
      type: req.body.type,
      notes,
      sourceIds,
      manuscriptVersion: MANUSCRIPT_VERSION,
    }),
  );
});
app.delete("/api/projects/:id/proposal", (req, res) => {
  const p = projectOrThrow(req.params.id);
  assertIdle(p.id);
  p.proposal = null;
  saveProject(p);
  res.json(p);
});
app.post("/api/projects/:id/proposal/commit", (req, res) => {
  const p = projectOrThrow(req.params.id);
  assertIdle(p.id);
  const proposal = p.proposal;
  if (!proposal || proposal.id !== req.body.proposalId)
    throw new Error("方案已经变更，请重新查看。");
  const style = styleReady(p.styleId);
  if (proposal.planStyle?.fingerprint !== styleStamp(style).fingerprint)
    throw new Error("风格已变化，请重新预览调整方案后再生成。");
  const before = structuredClone(p.slides);
  const selected = p.slides.filter((s) => proposal.sourceIds.includes(s.id));
  if (selected.length !== proposal.sourceIds.length)
    throw new Error("原始页面已变化，请重新预览。");
  const first = p.slides.findIndex((s) => s.id === proposal.sourceIds[0]);
  const batchIds = [...new Set(selected.flatMap((s) => s.batchIds))];
  const slides = proposal.notes.map((n, i) =>
    newSlide(
      n,
      batchIds,
      proposal.styleId,
      proposal.plans[i],
      proposal.planStyle,
    ),
  );
  let j;
  transaction(() => {
    p.slides.splice(first, selected.length, ...slides);
    for (const b of p.batches)
      b.slideIds = p.slides
        .filter((s) => s.batchIds.includes(b.id))
        .map((s) => s.id);
    p.undo = {
      label: proposal.type === "merge" ? "合并页面" : "拆分页面",
      slides: before,
      createdAt: now(),
    };
    p.proposal = null;
    saveProject(p);
    j = enqueue("render", p.id, {
      slideIds: slides.map((s) => s.id),
      redesign: false,
    });
  });
  res.status(202).json(j);
});
app.post("/api/projects/:id/undo", (req, res) => {
  const p = projectOrThrow(req.params.id);
  assertIdle(p.id);
  if (!p.undo) throw new Error("当前没有可撤销的结构调整。");
  p.slides = p.undo.slides;
  p.undo = null;
  p.proposal = null;
  cleanProjectManuscripts(p);
  for (const b of p.batches)
    b.slideIds = p.slides
      .filter((s) => s.batchIds.includes(b.id))
      .map((s) => s.id);
  saveProject(p);
  res.json(p);
});
app.get("/api/projects/:id/export", async (req, res) => {
  const p = projectOrThrow(req.params.id);
  assertIdle(p.id);
  if (
    req.query.revision !== undefined &&
    req.query.revision !== String(p.revision)
  )
    throw Object.assign(
      new Error("项目内容已更新，请关闭导出窗口后重新导出。"),
      { status: 409 },
    );
  const buffer = await exportPresentation(p, {
    allowStale:
      req.query.allowStale === "1" &&
      req.query.revision === String(p.revision),
  });
  res.attachment(exportFilename(p.title)).send(buffer);
});
app.get("/api/projects/:id/manuscript", (req, res) => {
  const p = projectOrThrow(req.params.id);
  res.type("text/plain").send(p.slides.map(speakerNotes).join(""));
});
app.get("/api/jobs", (req, res) =>
  res.json(
    all("job")
      .filter(
        (j) => !req.query.projectId || j.projectId === req.query.projectId,
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 30)
      .map(safeJob),
  ),
);
app.post("/api/jobs/:id/retry", (req, res) =>
  res.json(safeJob(retry(req.params.id))),
);
app.post("/api/jobs/:id/cancel", (req, res) =>
  res.json(safeJob(cancel(req.params.id))),
);
registerTrials(app, { enqueue });
registerStyleImports(app, { dataDir, assetPath, put, id, now, enqueue });
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024, files: 12 },
  fileFilter(req, file, cb) {
    cb(null, ["image/png", "image/jpeg", "image/webp"].includes(file.mimetype));
  },
});
app.post("/api/styles", upload.array("images", 12), async (req, res) => {
  const name = String(req.body.name || "").trim();
  if (!name || name.length > 60) throw new Error("请输入 1–60 字的风格名称。");
  if (!req.files?.length)
    throw new Error("请上传 PNG、JPG 或 WebP 格式的参考图。");
  const refs = [];
  for (const file of req.files) {
    const filename = id() + ".png";
    await sharp(file.buffer, { limitInputPixels: 40000000 })
      .rotate()
      .resize({
        width: 1600,
        height: 1600,
        fit: "inside",
        withoutEnlargement: true,
      })
      .png()
      .toFile(assetPath(filename));
    refs.push(filename);
  }
  const style = put("style", {
    id: id(),
    name,
    refs,
    colors: [],
    rules: "",
    description: "等待提炼参考图",
    status: "pending",
    builtin: false,
    createdAt: now(),
    updatedAt: now(),
  });
  const job = enqueue("style", null, { styleId: style.id });
  res.status(201).json({ style, job });
});
app.get("/api/styles/:id/layouts", (req, res) =>
  res
    .status(410)
    .json({ error: "不再使用模板库，每页按内容构思并应用选定风格。" }),
);
app.patch("/api/styles/:id", async (req, res) => {
  const s = get("style", req.params.id);
  if (!s || s.deletedAt) throw new Error("风格不存在或已删除");
  if (
    all("job").some(
      (j) =>
        ["style", "trial"].includes(j.type) &&
        j.payload.styleId === s.id &&
        ["queued", "running"].includes(j.status),
    )
  )
    throw new Error("风格正在提炼，请稍后修改。");
  const previousUpdatedAt = s.updatedAt;
  for (const k of ["name", "rules", "description"])
    if (typeof req.body[k] === "string") s[k] = req.body[k];
  if (!s.name.trim() || !s.rules.trim())
    throw new Error("风格名称和规则不能为空。");
  const current = get("style", s.id);
  if (!current || current.deletedAt || current.updatedAt !== previousUpdatedAt)
    throw Object.assign(new Error("风格已在另一处更新，请刷新后重试。"), {
      status: 409,
    });
  s.updatedAt = now();
  put("style", s);
  res.json(s);
});
app.delete("/api/styles/:id", (req, res) => {
  const s = get("style", req.params.id);
  if (!s) throw Object.assign(new Error("风格不存在"), { status: 404 });
  if (
    s.status === "analyzing" ||
    all("job").some(
      (j) =>
        ["style", "trial"].includes(j.type) &&
        j.payload.styleId === s.id &&
        ["queued", "running"].includes(j.status),
    )
  )
    throw Object.assign(
      new Error("这个风格正在提炼，请完成或停止提炼后再删除。"),
      { status: 409 },
    );
  // Keep a tombstone and reference assets for existing projects, image history and in-flight snapshots.
  s.deletedAt ||= now();
  put("style", s);
  res.json({ deleted: true });
});
app.post("/api/styles/:id/analyze", (req, res) => {
  const s = get("style", req.params.id);
  if (!s || s.deletedAt) throw new Error("风格不存在或已删除");
  if (
    all("job").some(
      (j) =>
        ["style", "trial"].includes(j.type) &&
        j.payload.styleId === s.id &&
        ["queued", "running"].includes(j.status),
    )
  )
    throw new Error("正在提炼中");
  res.status(202).json(
    enqueue("style", null, {
      styleId: s.id,
      feedback: String(req.body.feedback || ""),
    }),
  );
});
app.post(
  "/api/styles/:id/references",
  upload.array("images", 12),
  async (req, res) => {
    const s = get("style", req.params.id);
    if (!s || s.deletedAt) throw new Error("风格不存在或已删除");
    if (s.status === "analyzing") throw new Error("请等待当前提炼完成。");
    if (!req.files?.length) throw new Error("请选择参考图片。");
    if (s.refs.length + req.files.length > 12)
      throw new Error("每个风格最多保存 12 张参考图。");
    for (const file of req.files) {
      const filename = id() + ".png";
      await sharp(file.buffer, { limitInputPixels: 40000000 })
        .rotate()
        .resize({
          width: 1600,
          height: 1600,
          fit: "inside",
          withoutEnlargement: true,
        })
        .png()
        .toFile(assetPath(filename));
      s.refs.push(filename);
    }
    s.updatedAt = now();
    put("style", s);
    res.json(s);
  },
);
app.get("/api/settings", (req, res) => res.json(publicSettings()));
app.put("/api/settings", (req, res) => {
  if (all("job").some((j) => ["queued", "running"].includes(j.status)))
    throw new Error("请等待生成任务完成，或先停止任务，再更换模型设置。");
  res.json(updateSettings(req.body));
});
app.post("/api/settings/test", async (req, res) => {
  const kind = req.body.kind === "image" ? "image" : "text";
  const s = settings()[kind];
  if (!s.apiKey) throw new Error("还没有配置 API Key。");
  let response;
  try {
    response = await fetch(s.baseUrl + "/models", {
      headers: { Authorization: `Bearer ${s.apiKey}` },
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new Error("无法连接接口，请检查网络和地址。");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(`连接失败（${response.status}），请检查地址和密钥。`);
  const models = data.data?.map((m) => m.id) || [];
  res.json({
    ok: true,
    modelFound: models.includes(s.model),
    message: models.includes(s.model)
      ? "接口连通，模型在可用列表中。"
      : "接口连通，列表中未找到该模型；请确认模型名称。实际生成仍需单独验证。",
  });
});
app.use("/api", (req, res) => res.status(404).json({ error: "接口不存在" }));
app.use((err, req, res, next) => {
  console.error(
    "[AutoPPT]",
    String(err.message).replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]"),
  );
  res.status(err.status || 400).json({
    error:
      err.code === "LIMIT_FILE_SIZE"
        ? "单张图片不能超过 12 MB。"
        : err.message || "操作失败，请重试。",
  });
});
if (process.env.NODE_ENV === "production") {
  app.use(express.static(path.join(root, "dist")));
  app.get("/{*path}", (req, res) =>
    res.sendFile(path.join(root, "dist/index.html")),
  );
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
}
recoverJobs();
migrateManuscripts();
app.listen(port, "127.0.0.1", () =>
  console.log(`AutoPPT → http://127.0.0.1:${port} · data: ${dataDir}`),
);
