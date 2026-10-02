import { designOptions, designOptionsKey } from "./design-options.mjs";
import { all, get, put, id, now, transaction } from "./store.mjs";
import { styleStamp } from "./core.mjs";
import { design, generateImage } from "./models.mjs";
import { PLANNING_VERSION } from "./content-planning.mjs";
import { DIRECT_PROMPT_MODE } from "./direct-image.mjs";
import { validateScene } from "../shared/slides.mjs";
import { saveStyleVersion } from "./style-versions.mjs";

function availableStyle(key) {
  const style = get("style", key);
  if (!style || style.deletedAt) throw new Error("风格不存在或已删除。");
  return style;
}
function trialFor(styleId, trialId) {
  const t = get("trial", trialId);
  if (!t || t.styleId !== styleId) throw new Error("试做版本不存在。");
  return t;
}
function assertStyleIdle(styleId) {
  if (
    all("job").some(
      (j) =>
        ["style", "trial"].includes(j.type) &&
        j.payload.styleId === styleId &&
        ["queued", "running"].includes(j.status),
    )
  )
    throw Object.assign(
      new Error("这个风格正在提炼或试做，请完成或停止后再操作。"),
      { status: 409 },
    );
}
export function registerTrials(app, { enqueue }) {
  app.get("/api/styles/:id/trials", (req, res) => {
    const style = availableStyle(req.params.id);
    res.json({
      fingerprint: styleStamp(style).fingerprint,
      trials: all("trial")
        .filter((t) => t.styleId === style.id)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((t) => {
          const job = get("job", t.jobId);
          return {
            ...t,
            status: job?.status || t.status,
            stage: job?.stage,
            error: job?.error || t.error,
          };
        }),
    });
  });
  app.post("/api/styles/:id/trials", (req, res) => {
    const style = availableStyle(req.params.id);
    assertStyleIdle(style.id);
    const {
      notes,
      rules,
      primaryRef = "",
      mode = "baseline",
      parentId,
      purpose = "transfer",
    } = req.body;
    if (typeof notes !== "string" || !notes.trim() || notes.length > 20000)
      throw new Error("请填写一页试做讲稿，最多 2 万字。");
    if (typeof rules !== "string" || !rules.trim() || rules.length > 30000)
      throw new Error("请填写试做的设计语言，最多 3 万字。");
    if (!["baseline", "redesign", "refine"].includes(mode))
      throw new Error("试做方式无效。");
    const parent = parentId ? trialFor(style.id, parentId) : null;
    if (
      parent &&
      (!(parent.image || parent.scene) ||
        get("job", parent.jobId)?.status !== "completed")
    )
      throw new Error("请先完成上一版试做。");
    const feedback = String(req.body.feedback || "")
      .trim()
      .slice(0, 10000);
    const copyFeedback = String(req.body.copyFeedback || "")
      .trim()
      .slice(0, 10000);
    const candidate = structuredClone(
      parent?.engine === "image" ? parent.styleSnapshot : style,
    );
    candidate.rules = rules;
    if (
      parent?.engine === "image" &&
      parent.baseFingerprint !== styleStamp(style).fingerprint &&
      style.appliedTrialId !== parent.id
    )
      throw Object.assign(
        new Error("正式风格已有变化，请点击“从正式风格重新开始”后再试做。"),
        { status: 409 },
      );
    const t = {
      id: id(),
      styleId: style.id,
      parentId: parent?.id || null,
      notes,
      feedback,
      copyFeedback,
      mode,
      purpose: "transfer",
      layoutId: "",
      engine: "image",
      needsSystem: false,
      calibrationVersion: 1,
      primaryRef: "",
      styleSnapshot: candidate,
      designOptions: designOptions(
        req.body.designOptions === undefined
          ? parent?.designOptions
          : req.body.designOptions,
      ),
      baseFingerprint: styleStamp(style).fingerprint,
      plan: null,
      image: null,
      scene: null,
      refined: false,
      status: "queued",
      createdAt: now(),
    };
    transaction(() => {
      put("trial", t);
      const job = enqueue("trial", null, { styleId: style.id, trialId: t.id });
      t.jobId = job.id;
      put("trial", t);
    });
    res.status(202).json(t);
  });
  app.post("/api/styles/:id/trials/:tid/inspect", (req, res) =>
    res.status(410).json({ error: "风格对比检查已停用，请直接调整页面。" }),
  );
  app.post("/api/styles/:id/trials/:tid/scene", (req, res) => {
    const style = availableStyle(req.params.id);
    assertStyleIdle(style.id);
    const old = trialFor(style.id, req.params.tid);
    if (!old.scene) throw new Error("历史图片需要重新试做后编辑。");
    const scene = validateScene(req.body.scene);
    const t = {
      ...structuredClone(old),
      id: id(),
      parentId: old.id,
      scene,
      plan: {
        ...old.plan,
        scene,
        displayText: scene.elements
          .filter((e) => e.type === "text")
          .map((e) => e.text),
      },
      mode: "manual",
      createdAt: now(),
      appliedAt: null,
      appliedFingerprint: null,
      baseFingerprint:
        style.appliedTrialId === old.id
          ? styleStamp(style).fingerprint
          : old.baseFingerprint,
    };
    transaction(() => {
      const job = put("job", {
        id: id(),
        type: "trial",
        projectId: null,
        payload: { styleId: style.id, trialId: t.id },
        status: "completed",
        stage: "画面修改已保存",
        done: 1,
        total: 1,
        error: null,
        createdAt: now(),
        updatedAt: now(),
      });
      t.jobId = job.id;
      put("trial", t);
    });
    res.status(201).json(t);
  });
  app.post("/api/styles/:id/trials/:tid/apply", (req, res) => {
    const style = availableStyle(req.params.id);
    assertStyleIdle(style.id);
    const t = trialFor(style.id, req.params.tid);
    if (
      t.engine !== "image" ||
      !t.image ||
      get("job", t.jobId)?.status !== "completed"
    )
      throw new Error("试做完成后才能保存为正式风格。");
    if (
      style.appliedTrialId === t.id &&
      styleStamp(style).fingerprint === t.appliedFingerprint
    )
      return res.json(style);
    if (styleStamp(style).fingerprint !== t.baseFingerprint)
      throw Object.assign(
        new Error(
          "正式风格已变化，请从正式风格重新开始试做，避免覆盖新的调整。",
        ),
        { status: 409 },
      );
    const before = structuredClone(style);
    for (const key of [
      "rules",
      "description",
      "colors",
      "referenceProfiles",
      "imageRecipes",
      "compositionMode",
    ])
      style[key] = t.styleSnapshot[key];
    Object.assign(style, {
      appliedTrialId: t.id,
      status: "ready",
      error: null,
      updatedAt: now(),
    });
    t.appliedAt = now();
    t.appliedFingerprint = styleStamp(style).fingerprint;
    const saved = saveStyleVersion(before, style, "trial", null, () => {
      put("trial", t);
    });
    res.json(saved.style);
  });
}

export async function runTrial(job, signal, progress) {
  const t = trialFor(job.payload.styleId, job.payload.trialId);
  const parent = t.parentId ? get("trial", t.parentId) : null;
  try {
    if (job.payload.inspectOnly) throw new Error("风格对比检查已停用。");
    if (!t.notes?.trim())
      throw new Error("旧复刻任务不再继续，请填写讲稿创建新的图片试做。");
    if (t.engine !== "image") {
      t.layoutId = "";
      t.plan = null;
      t.engine = "image";
      t.needsSystem = false;
    }
    t.status = "running";
    t.error = null;
    put("trial", t);
    // A manual edit is already the user's chosen prompt. Historical refine
    // requests now adjust this page only; they cannot rewrite saved style text.
    t.needsSystem = false;
    if (
      !t.plan ||
      t.plan.engine !== "image" ||
      t.plan.planningVersion !== PLANNING_VERSION ||
      t.plan.promptMode !== DIRECT_PROMPT_MODE ||
      designOptionsKey(t.plan.designOptions) !==
        designOptionsKey(t.designOptions)
    ) {
      progress("正在提炼上屏文案，使用原始风格提示词");
      t.plan = await design(
        t.notes,
        t.styleSnapshot,
        "单页试做",
        t.feedback,
        t.plan || parent?.plan,
        signal,
        {
          designOptions: t.designOptions,
          onProgress: progress,
          copyFeedback: t.copyFeedback || "",
        },
      );
      signal.throwIfAborted();
      put("trial", t);
    }
    progress("正在生成图片，完成后自动显示");
    t.image = await generateImage(t.plan, t.styleSnapshot, signal);
    signal.throwIfAborted();
    t.scene = null;
    t.review = null;
    t.reviewError = null;
    t.engine = "image";
    t.status = "completed";
    t.imageStyle = styleStamp(t.styleSnapshot, t.plan);
    put("trial", t);
  } catch (e) {
    t.status = signal.aborted ? "cancelled" : "failed";
    t.error = e.message;
    put("trial", t);
    throw e;
  }
}
