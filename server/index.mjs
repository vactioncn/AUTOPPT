import {
  registerUsage,
  recoverUsage,
  usageMiddleware,
} from "./usage/index.mjs";
import {
  designOptions,
  expandAudience,
  extractPalette,
} from "./design-options.mjs";
import { validateScene, renderSceneSvg } from "../shared/slides.mjs";
import { DEFAULT_STYLE_ID, defaultStyleId } from "../shared/styles.mjs";
import { productionTargetIds } from "../shared/production.mjs";
import express from "express";
import { createBuildInfo, readBuildInfo } from "./build-info.mjs";
import { frontendRelease } from "./frontend-release.mjs";
import { diagnostics } from "./diagnostics.mjs";
import { publicSpeechSettings } from "./speech/settings.mjs";
import multer from "multer";
import { screenImage } from "./image-storage.mjs";
import { readFile, writeFile } from "node:fs/promises";
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
} from "./core.mjs";
import {
  enqueue,
  assertIdle,
  activeJob,
  jobSlideIds,
  retry,
  cancel,
  recoverJobs,
  newSlide,
} from "./jobs.mjs";
import { jsonModel } from "./models.mjs";
import {
  exportPresentation,
  exportFilename,
  exportBundle,
  exportManuscript,
} from "./export.mjs";
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
import { registerHtmlExport } from "./html-export.mjs";
import { registerProjectPackages } from "./project-package.mjs";
import {
  registerStyleVersions,
  saveStyleVersion,
  assertStyleVersion,
  withStyleVersion,
} from "./style-versions.mjs";
import { registerStyleImports } from "./style-import.mjs";
import { registerAttachments, resolveAttachments } from "./attachments.mjs";
import { projectReport } from "./report.mjs";
import {
  registerSpeech,
  recoverSpeech,
  activeSpeechCount,
} from "./speech/index.mjs";
import {
  registerMotion,
  recoverMotion,
  activeMotionCount,
} from "./motion/index.mjs";

if (process.env.AUTOPPT_WORKER_TOKEN || process.env.AUTOPPT_DESKTOP_TOKEN)
  process.on("disconnect", () => process.exit(1));
const app = express();
app.disable("x-powered-by");
let port = Number(process.env.PORT || 4317);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const buildInfo =
  process.env.NODE_ENV === "production"
    ? readBuildInfo(root)
    : createBuildInfo();
app.use((req, res, next) => {
  if (
    process.env.AUTOPPT_DESKTOP_TOKEN &&
    req.headers["x-autoppt-desktop"] !== process.env.AUTOPPT_DESKTOP_TOKEN
  )
    return res.status(403).json({ error: "请通过 AutoPPT App 访问。" });
  if (process.env.AUTOPPT_WORKER_TOKEN) {
    if (req.headers["x-autoppt-worker"] !== process.env.AUTOPPT_WORKER_TOKEN)
      return res.status(403).json({ error: "请通过登录入口访问。" });
    if (req.path.startsWith("/api/settings") && req.method !== "GET")
      return res.status(403).json({ error: "模型由管理员在服务器配置。" });
    return next();
  }
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
app.use(usageMiddleware);
// Explicit download variants leave saved originals and asset URLs untouched.
app.get("/assets/:filename", async (req, res, next) => {
  if (req.query.download !== "screen") return next();
  const image = await screenImage(
    await readFile(assetPath(req.params.filename)),
  );
  res.set("Cache-Control", "no-store");
  res.attachment(
    req.params.filename.replace(/\.[^.]+$/, "." + image.extension),
  );
  res.type(image.mime).send(image.data);
});
app.use(
  "/assets",
  express.static(assetsDir, {
    dotfiles: "deny",
    immutable: true,
    maxAge: "1y",
  }),
);
if (process.env.AUTOPPT_WORKER_TOKEN)
  app.use("/assets", (req, res) =>
    res.status(404).json({ error: "图片不存在。" }),
  );
app.use("/api", (req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});
registerUsage(app);
const safeJob = (j) => {
  const project = j.projectId ? get("project", j.projectId) : null;
  const targets = productionTargetIds(j, project);
  return {
    ...j,
    styleId: j.payload.styleId || j.payload.styleSnapshot?.id,
    slideIds: jobSlideIds(j),
    targetSlideIds: targets,
    // Older tasks did not record per-attempt counters. Show known page failures
    // without inventing a count for their historical attempt.
    failures:
      !j.pageProgress && !["queued", "running"].includes(j.status) && project
        ? project.slides.flatMap((s, i) =>
            targets.includes(s.id) && s.status === "error" && s.error
              ? [{ id: s.id, page: i + 1, error: s.error }]
              : [],
          )
        : undefined,
    batchId: j.type === "append" ? j.payload.batchId : undefined,
    payload: undefined,
  };
};
const styleReady = (styleId) => {
  const s = get("style", styleId);
  if (!s?.rules || s.deletedAt)
    throw new Error("请选择一个可用风格，或先到风格库完成提炼。");
  return s;
};
app.get("/api/account", (req, res) => res.json({ hosted: false, user: null }));
app.get("/api/health", (req, res) => res.json({ app: "AutoPPT", ok: true }));
app.get("/api/activity", (req, res) =>
  res.json({
    activeJobs:
      all("job").filter((j) => ["queued", "running"].includes(j.status))
        .length +
      activeMotionCount() +
      activeSpeechCount(),
  }),
);
if (process.env.AUTOPPT_DESKTOP_TOKEN)
  app.get("/api/desktop/status", (req, res) =>
    res.json({
      activeJobs:
        all("job").filter((job) => ["queued", "running"].includes(job.status))
          .length +
        activeMotionCount() +
        activeSpeechCount(),
    }),
  );
app.get("/api/bootstrap", (req, res) =>
  res.json({
    ...diagnostics(buildInfo, { speechReady: publicSpeechSettings().hasKey }),
    projects: all("project")
      .filter((p) => !p.deletedAt)
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
    styles: all("style")
      .map(withStyleVersion)
      .sort(
        (a, b) =>
          Number(b.id === DEFAULT_STYLE_ID) - Number(a.id === DEFAULT_STYLE_ID),
      ),
    settings: publicSettings(),
    jobs: all("job")
      .sort((a, b) =>
        (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt),
      )
      .slice(0, 50)
      .map(safeJob),
  }),
);
app.get("/api/projects/:id", (req, res) =>
  res.json(projectOrThrow(req.params.id)),
);
app.get("/api/projects/:id/report", (req, res) =>
  res.json(projectReport(projectOrThrow(req.params.id))),
);
registerAttachments(app, { assertIdle });
// Draft helpers never mutate a style or project; the user reviews and saves the result.
app.post("/api/design-options/audience", async (req, res) => {
  const controller = new AbortController();
  res.on("close", () => controller.abort());
  res.json(
    await expandAudience(req.body.description, jsonModel, controller.signal),
  );
});
app.post("/api/design-options/palette", async (req, res) => {
  const controller = new AbortController();
  res.on("close", () => controller.abort());
  const style = styleReady(req.body.styleId);
  // Trial editors may extract from their unsaved prompt without changing the library.
  const rules = req.body.rules === undefined ? style.rules : req.body.rules;
  res.json(await extractPalette(rules, jsonModel, controller.signal));
});
app.post("/api/projects", (req, res) => {
  const title = String(req.body.title || "").trim();
  if (!title || title.length > 100)
    throw new Error("请输入 1–100 字的演讲主题。");
  const styleId =
    req.body.styleId === undefined
      ? defaultStyleId(all("style"))
      : req.body.styleId;
  styleReady(styleId);
  const p = put("project", {
    id: id(),
    title,
    styleId,
    designOptions: designOptions(req.body.designOptions),
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
app.delete("/api/projects/:id", (req, res) => {
  const p = projectOrThrow(req.params.id);
  if (activeSpeechCount(p.id))
    throw new Error("请先完成或停止本项目的口播生成，再删除项目。");
  if (activeMotionCount(p.id))
    throw new Error("请先完成或停止本项目的动态演示转换，再删除项目。");
  assertIdle(p.id);
  // Keep source/assets/history; deletion only removes access and discovery.
  p.deletedAt = now();
  saveProject(p);
  res.json({ deleted: true });
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
  if ("designOptions" in req.body) {
    assertIdle(p.id);
    p.designOptions = designOptions(req.body.designOptions);
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
  const { text, requestId } = req.body;
  // Legacy clients may omit the ID. New clients retain it until acceptance.
  if (
    requestId !== undefined &&
    (typeof requestId !== "string" || !/^[\w-]{16,80}$/.test(requestId))
  )
    throw new Error("生成请求无效，请重新提交。");
  const existing =
    requestId && p.batches.find((b) => b.requestId === requestId);
  if (existing) {
    if (existing.text !== text)
      throw Object.assign(
        new Error("这次请求已提交，请使用新的请求提交修改后的讲稿。"),
        { status: 409 },
      );
    const job = get("job", existing.jobId);
    if (!job || job.projectId !== p.id || job.payload.batchId !== existing.id)
      throw Object.assign(
        new Error("已提交批次的任务记录不可用，请检查项目任务。"),
        { status: 409 },
      );
    // A retry may have autosaved the submitted draft after losing the response.
    // Clear only that exact text; never discard newer edits.
    if (p.draft === text) {
      p.draft = "";
      put("project", p);
    }
    return res
      .status(202)
      .json({ ...job, accepted: true, batchId: existing.id });
  }
  // Worker authentication above makes this gateway-owned header trustworthy.
  // Fail closed for new work, but never block recovery of an accepted request.
  if (
    process.env.AUTOPPT_WORKER_TOKEN &&
    req.headers["x-autoppt-model-ready"] !== "1"
  )
    throw Object.assign(
      new Error(
        "模型尚未就绪，请联系管理员或稍后查看模型服务状态。草稿可以继续保存。",
      ),
      { status: 503 },
    );
  styleReady(p.styleId);
  if (typeof text !== "string" || !text.trim())
    throw new Error("请先写下这一段逐字稿。");
  if (text.length > 200000)
    throw new Error("单次最多支持 20 万字，请分段添加。");
  if (!spokenManuscript(text).trim())
    throw new Error("去掉 Markdown 标题后没有正文，请补充需要讲述的内容。");
  const batch = {
    id: id(),
    text,
    ...(requestId ? { requestId } : {}),
    label: `第 ${p.batches.length + 1} 段`,
    createdAt: now(),
    slideIds: [],
  };
  let j;
  transaction(() => {
    p.batches.push(batch);
    p.draft = "";
    p.undo = null;
    saveProject(p);
    j = enqueue("append", p.id, { batchId: batch.id });
    batch.jobId = j.id;
    put("project", p);
  });
  res.status(202).json({ ...j, accepted: true, batchId: batch.id });
});
// Anchor by stable page ID, never by an index that can shift during generation.
app.post("/api/projects/:id/slides", (req, res) => {
  const p = projectOrThrow(req.params.id);
  const { afterSlideId, requestId, generate = true } = req.body;
  if (typeof requestId !== "string" || !/^[\w-]{16,80}$/.test(requestId))
    throw new Error("插页请求无效，请重新打开窗口。");
  if (
    typeof req.body.notes !== "string" ||
    !req.body.notes.trim() ||
    req.body.notes.length > 200000
  )
    throw new Error("请填写新页面的逐字稿，最多 20 万字。");
  const notes = spokenManuscript(req.body.notes);
  if (!notes.trim())
    throw new Error("去掉 Markdown 标题后没有正文，请补充需要讲述的内容。");
  const existing = p.batches.find((b) => b.insertion?.requestId === requestId);
  if (existing) {
    if (
      existing.text !== req.body.notes ||
      existing.insertion.afterSlideId !== afterSlideId
    )
      throw Object.assign(new Error("这次插页已提交，请关闭窗口查看新页面。"), {
        status: 409,
      });
    return res.json({ project: p, slideId: existing.slideIds[0] });
  }
  const anchor =
    afterSlideId === null
      ? -1
      : p.slides.findIndex((s) => s.id === afterSlideId);
  if (afterSlideId !== null && anchor < 0)
    throw Object.assign(
      new Error("插入位置的页面已变化，请关闭窗口后重新选择位置。"),
      { status: 409 },
    );
  // New pages do not modify or lock their neighbours.
  assertIdle(p.id, []);
  if (generate) styleReady(p.styleId);
  const batch = {
    id: id(),
    text: req.body.notes,
    label: "插入页面",
    createdAt: now(),
    slideIds: [],
    insertion: { requestId, afterSlideId },
  };
  const slide = newSlide(notes, [batch.id], p.styleId);
  batch.slideIds = [slide.id];
  transaction(() => {
    p.slides.splice(anchor + 1, 0, slide);
    p.batches.push(batch);
    p.undo = null;
    saveProject(p);
    if (generate)
      enqueue("render", p.id, { slideIds: [slide.id], redesign: false });
  });
  res.status(201).json({ project: p, slideId: slide.id });
});
app.patch("/api/projects/:id/slides/:sid", (req, res) => {
  const p = projectOrThrow(req.params.id);
  assertIdle(p.id, [req.params.sid]);
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
    if (p.proposal?.sourceIds.includes(s.id)) p.proposal = null;
    p.undo = null;
    saveProject(p);
  }
  res.json(p);
});
// Acknowledgement only: keep the current artwork and manuscript intact.
app.post("/api/projects/:id/slides/:sid/keep-visual", (req, res) => {
  const p = projectOrThrow(req.params.id);
  if (req.body.revision !== p.revision)
    return res.status(409).json({ error: "项目已更新，请重新查看后确认。" });
  assertIdle(p.id, [req.params.sid]);
  const s = p.slides.find((slide) => slide.id === req.params.sid);
  if (!s || !(s.image || s.scene))
    return res.status(400).json({ error: "该页还没有可保留的画面。" });
  if (s.stale) {
    s.versions.push(snapshot(s));
    s.stale = false;
    p.undo = null;
    saveProject(p);
  }
  res.json(p);
});
app.post("/api/projects/:id/render", (req, res) => {
  const p = projectOrThrow(req.params.id);
  styleReady(p.styleId);
  const ids = req.body.slideIds;
  if (
    !Array.isArray(ids) ||
    !ids.length ||
    ids.some((id) => !p.slides.some((s) => s.id === id))
  )
    throw new Error("请选择需要制作的页面。");
  assertIdle(p.id, ids);
  p.undo = null;
  if (req.body.attachmentIds !== undefined && ids.length !== 1)
    throw new Error("添加内容附件时，请单独重新设计这一页。");
  const attachmentSnapshots = Object.fromEntries(
    ids.map((sid) => {
      const s = p.slides.find((s) => s.id === sid);
      return [
        sid,
        resolveAttachments(
          p.id,
          req.body.attachmentIds ??
            (s.pendingAttachments ?? s.attachments ?? []).map((a) => a.id),
        ),
      ];
    }),
  );
  for (const sid of ids) {
    const slide = p.slides.find((s) => s.id === sid);
    delete slide.pendingPlan;
    delete slide.pendingPlanStyle;
    slide.pendingAttachments = attachmentSnapshots[sid];
  }
  saveProject(p);
  res.status(202).json(
    enqueue("render", p.id, {
      slideIds: ids,
      redesign:
        req.body.attachmentIds !== undefined || req.body.redesign !== false,
      feedback: String(req.body.feedback || "").slice(0, 10000),
      copyFeedback: String(req.body.copyFeedback || "").slice(0, 10000),
      attachmentSnapshots,
    }),
  );
});
app.post("/api/projects/:id/slides/:sid/inspect", (req, res) =>
  res.status(410).json({ error: "风格对比检查已停用。" }),
);
app.patch("/api/projects/:id/slides/:sid/scene", (req, res) => {
  const p = projectOrThrow(req.params.id);
  assertIdle(p.id, [req.params.sid]);
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
  if (p.proposal?.sourceIds.includes(s.id)) p.proposal = null;
  saveProject(p);
  res.json(p);
});
app.post("/api/projects/:id/slides/:sid/restore", (req, res) => {
  const p = projectOrThrow(req.params.id);
  assertIdle(p.id, [req.params.sid]);
  const s = p.slides.find((s) => s.id === req.params.sid);
  const v = s?.versions.find((v) => v.id === req.body.versionId);
  if (!v) throw new Error("历史版本不存在");
  s.versions.push(snapshot(s));
  Object.assign(s, {
    notes: speakerNotes(v),
    attachments: v.attachments || [],
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
  delete s.pendingAttachments;
  if (p.proposal?.sourceIds.includes(s.id)) p.proposal = null;
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
// Manual boundaries are already a complete structural decision: persist first,
// then let independent render jobs prepare copy and images in the background.
app.post("/api/projects/:id/slides/:sid/split", (req, res) => {
  const p = projectOrThrow(req.params.id);
  assertIdle(p.id, [req.params.sid]);
  const index = p.slides.findIndex((s) => s.id === req.params.sid);
  const source = p.slides[index];
  if (!source) throw new Error("页面不存在");
  if (req.body.expectedNotes !== source.notes)
    throw Object.assign(new Error("原文已变化，请重新打开拆分窗口。"), {
      status: 409,
    });
  const parts = splitAt(source.notes, req.body.cuts);
  const slides = parts.map((notes) => ({
    ...newSlide(notes, [...source.batchIds], p.styleId),
    attachments: structuredClone(
      source.pendingAttachments ?? source.attachments ?? [],
    ),
  }));
  const jobs = [];
  transaction(() => {
    p.slides.splice(index, 1, ...slides);
    for (const b of p.batches)
      b.slideIds = p.slides
        .filter((s) => s.batchIds.includes(b.id))
        .map((s) => s.id);
    p.undo = {
      label: "拆分页面",
      sourceSlides: [structuredClone(source)],
      replacementIds: slides.map((s) => s.id),
      createdAt: now(),
    };
    if (p.proposal?.sourceIds.includes(source.id)) p.proposal = null;
    saveProject(p);
    if (req.body.generate !== false)
      for (const s of slides)
        jobs.push(
          enqueue("render", p.id, { slideIds: [s.id], redesign: false }),
        );
  });
  res.json({ project: p, jobs: jobs.map(safeJob) });
});
app.post("/api/projects/:id/proposal", (req, res) => {
  const p = projectOrThrow(req.params.id);
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
  if (p.proposal) assertIdle(p.id, p.proposal.sourceIds);
  p.proposal = null;
  saveProject(p);
  res.json(p);
});
app.post("/api/projects/:id/proposal/commit", (req, res) => {
  const p = projectOrThrow(req.params.id);
  const proposal = p.proposal;
  if (!proposal || proposal.id !== req.body.proposalId)
    throw new Error("方案已经变更，请重新查看。");
  assertIdle(p.id, proposal.sourceIds);
  const style = styleReady(p.styleId);
  if (proposal.planStyle?.fingerprint !== styleStamp(style).fingerprint)
    throw new Error("风格已变化，请重新预览调整方案后再生成。");
  const selected = p.slides.filter((s) => proposal.sourceIds.includes(s.id));
  if (selected.length !== proposal.sourceIds.length)
    throw new Error("原始页面已变化，请重新预览。");
  const first = p.slides.findIndex((s) => s.id === proposal.sourceIds[0]);
  if (proposal.sourceIds.some((sid, i) => p.slides[first + i]?.id !== sid))
    throw new Error("原始页面的顺序已变化，请重新预览。");
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
      sourceSlides: structuredClone(selected),
      replacementIds: slides.map((s) => s.id),
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
  if (!p.undo) throw new Error("当前没有可撤销的结构调整。");
  assertIdle(p.id, p.undo.replacementIds ?? null);
  if (p.undo.replacementIds) {
    const ids = p.undo.replacementIds;
    const first = p.slides.findIndex((s) => s.id === ids[0]);
    if (first < 0 || ids.some((id, i) => p.slides[first + i]?.id !== id))
      throw new Error("调整后的页面已变化，无法撤销这次调整。");
    // Restore only this split; keep images/notes completed on unrelated pages.
    p.slides.splice(first, ids.length, ...p.undo.sourceSlides);
    if (p.proposal?.sourceIds.some((id) => ids.includes(id))) p.proposal = null;
  } else {
    p.slides = p.undo.slides;
    p.proposal = null;
  }
  p.undo = null;
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
  const bundle = req.query.bundle === "1";
  const buffer = await (bundle ? exportBundle : exportPresentation)(p, {
    allowStale:
      req.query.allowStale === "1" && req.query.revision === String(p.revision),
  });
  res
    .attachment(
      bundle
        ? exportFilename(p.title).replace(/\.pptx$/, `-v${p.revision}.zip`)
        : exportFilename(p.title),
    )
    .send(buffer);
});
app.get("/api/projects/:id/manuscript", (req, res) => {
  const p = projectOrThrow(req.params.id);
  if (req.query.download === "1") {
    if (req.query.revision !== String(p.revision))
      throw Object.assign(new Error("项目内容已更新，请重新打开导出窗口。"), {
        status: 409,
      });
    return res
      .attachment(
        exportFilename(p.title).replace(/\.pptx$/, `-逐字稿-v${p.revision}.md`),
      )
      .type("text/markdown; charset=utf-8")
      .send(exportManuscript(p));
  }
  res.type("text/plain").send(p.slides.map(speakerNotes).join(""));
});
app.get("/api/jobs", (req, res) =>
  res.json(
    all("job")
      .filter(
        (j) => !req.query.projectId || j.projectId === req.query.projectId,
      )
      .sort((a, b) =>
        (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt),
      )
      .filter(
        (j, index) => index < 30 || ["queued", "running"].includes(j.status),
      )
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
registerStyleVersions(app);
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
  if (req.body.rules !== undefined) {
    const rules = req.body.rules;
    if (typeof rules !== "string" || !rules.trim() || rules.length > 30000)
      throw new Error("请填写风格提示词，最多 3 万字。");
    if (req.files?.length)
      throw new Error(
        "请分别使用手动填写或参考图提炼；手动风格创建后可补充图片。",
      );
    const style = put("style", {
      id: id(),
      name,
      rules,
      refs: [],
      colors: [],
      description: "手动填写的风格提示词，可直接试做。",
      compositionMode: "direct",
      status: "ready",
      builtin: false,
      createdAt: now(),
      updatedAt: now(),
    });
    return res.status(201).json({ style: withStyleVersion(style), job: null });
  }
  if (!req.files?.length)
    throw new Error("请填写风格提示词，或上传 PNG、JPG、WebP 参考图。");
  const refs = [];
  for (const file of req.files) {
    const stored = await screenImage(file.buffer, {
      width: 1600,
      height: 1600,
      force: true,
    });
    const filename = id() + "." + stored.extension;
    await writeFile(assetPath(filename), stored.data);
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
  assertStyleVersion(s, req.body.expectedVersion);
  const before = structuredClone(s);
  for (const k of ["name", "rules", "description"])
    if (typeof req.body[k] === "string") s[k] = req.body[k];
  if (req.body.compositionMode !== undefined) {
    if (!["direct", "content-led"].includes(req.body.compositionMode))
      throw new Error("构图方式无效。");
    s.compositionMode = req.body.compositionMode;
  }
  if (!s.name.trim() || !s.rules.trim())
    throw new Error("风格名称和规则不能为空。");
  const current = get("style", s.id);
  if (!current || current.deletedAt || current.updatedAt !== previousUpdatedAt)
    throw Object.assign(new Error("风格已在另一处更新，请刷新后重试。"), {
      status: 409,
    });
  s.updatedAt = now();
  res.json(saveStyleVersion(before, s, "manual").style);
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
  if (!s.refs?.length)
    throw new Error("重新提炼需要参考图；也可以直接手动修改提示词。");
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
      const stored = await screenImage(file.buffer, {
        width: 1600,
        height: 1600,
        force: true,
      });
      const filename = id() + "." + stored.extension;
      await writeFile(assetPath(filename), stored.data);
      s.refs.push(filename);
    }
    s.updatedAt = now();
    put("style", s);
    res.json(s);
  },
);
app.get("/api/settings", (req, res) => res.json(publicSettings()));
app.put("/api/settings", (req, res) => {
  if (
    activeMotionCount() ||
    activeSpeechCount() ||
    all("job").some((j) => ["queued", "running"].includes(j.status))
  )
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
registerMotion(app);
registerSpeech(app);
registerHtmlExport(app);
registerProjectPackages(app, {
  assertIdle: (projectId) => {
    assertIdle(projectId);
    if (activeMotionCount(projectId) || activeSpeechCount(projectId))
      throw Object.assign(
        new Error("请等待此项目的动画或口播任务结束后再打包"),
        { status: 409 },
      );
  },
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
        ? req.path === "/api/projects/import"
          ? "项目包不能超过 1 GB。"
          : req.path.startsWith("/api/speech")
            ? "录音不能超过 20 MB。"
            : "单张图片不能超过 12 MB。"
        : err.message || "操作失败，请重试。",
  });
});
if (process.env.NODE_ENV === "production") {
  if (!process.env.AUTOPPT_WORKER_TOKEN) {
    const frontend = frontendRelease(root, buildInfo);
    app.use(frontend.assets);
    app.get("/{*path}", frontend.index);
  }
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
}
const listener = app.listen(port, "127.0.0.1", (error) => {
  if (error) {
    console.error(`AutoPPT 启动失败：${error.message}`);
    process.exit(1);
  }
  port = listener.address().port;
  // A second process must never mark the real server's jobs as interrupted.
  recoverUsage();
  recoverJobs();
  recoverMotion();
  recoverSpeech();
  migrateManuscripts();
  process.send?.({ type: "ready", port: listener.address().port });
  console.log(`AutoPPT → http://127.0.0.1:${listener.address().port}`);
});
