import {
  all,
  get,
  put,
  id,
  now,
  saveProject,
  projectOrThrow,
} from "./store.mjs";
import {
  segment,
  design,
  analyzeStyle,
  generateImage,
  analyzePageContents,
  styleLanguageFor,
} from "./models.mjs";
import { PLANNING_VERSION, nearbyCompositions } from "./content-planning.mjs";
import { snapshot, styleStamp } from "./core.mjs";
import { MANUSCRIPT_VERSION, spokenManuscript } from "./manuscript.mjs";
import { runTrial } from "./trials.mjs";
const controllers = new Map();
let processing = false;
export function activeJob(projectId) {
  return all("job").find(
    (j) =>
      j.projectId === projectId && ["queued", "running"].includes(j.status),
  );
}
export function assertIdle(projectId) {
  if (
    activeJob(projectId) ||
    all("job").some((j) => j.projectId === projectId && controllers.has(j.id))
  )
    throw Object.assign(new Error("这一段还在制作中，请完成或停止后再修改。"), {
      status: 409,
    });
}
export function enqueue(type, projectId, payload = {}) {
  if (
    !projectId &&
    payload.styleId &&
    [...controllers.keys()].some(
      (key) => get("job", key)?.payload.styleId === payload.styleId,
    )
  )
    throw new Error("上一项风格任务还在结束，请稍后再试。");
  if (projectId) {
    assertIdle(projectId);
    const p = projectOrThrow(projectId);
    if (type !== "inspect") payload.styleSnapshot = selectedStyle(p);
  }
  const j = put("job", {
    id: id(),
    type,
    projectId,
    payload,
    status: "queued",
    stage: "等待开始",
    done: 0,
    total: 0,
    error: null,
    createdAt: now(),
    updatedAt: now(),
  });
  setImmediate(pump);
  return j;
}
export function cancel(jobId) {
  const j = get("job", jobId);
  if (!j) throw new Error("任务不存在");
  if (!["queued", "running"].includes(j.status)) return j;
  controllers.get(jobId)?.abort();
  j.status = "cancelled";
  j.stage = "已停止";
  j.updatedAt = now();
  put("job", j);
  return j;
}
export function retry(jobId) {
  const j = get("job", jobId);
  if (!j || !["failed", "interrupted", "cancelled"].includes(j.status))
    throw new Error("这个任务不需要重试。");
  if (controllers.has(jobId))
    throw new Error("正在停止上一次制作，请稍后继续。");
  if (j.projectId) {
    assertIdle(j.projectId);
    // A retry is a new attempt under the user's current choice, not the original job's style.
    if (j.type !== "inspect")
      j.payload.styleSnapshot = selectedStyle(projectOrThrow(j.projectId));
    delete j.payload.styleSnapshots;
  } else if (["style", "trial"].includes(j.type)) {
    const style = get("style", j.payload.styleId);
    if (!style || style.deletedAt) throw new Error("这个风格已删除。");
    if (
      j.type === "trial" &&
      all("job").some(
        (x) =>
          x.id !== j.id &&
          ["trial", "style"].includes(x.type) &&
          x.payload.styleId === style.id &&
          ["queued", "running"].includes(x.status),
      )
    )
      throw new Error("这个风格已有试做任务，请稍后再继续。");
  }
  j.status = "queued";
  j.error = null;
  j.stage = "准备继续";
  j.updatedAt = now();
  put("job", j);
  setImmediate(pump);
  return j;
}
function progress(j, stage, done = j.done, total = j.total) {
  Object.assign(j, { stage, done, total, updatedAt: now() });
  put("job", j);
}
function context(p, beforeId) {
  const slides = beforeId
    ? p.slides.slice(
        0,
        p.slides.findIndex((s) => s.id === beforeId),
      )
    : p.slides;
  return `演讲主题：${p.title}\n前文页面：${slides
    .slice(-12)
    .map((s) => s.plan?.title || s.notes.slice(0, 50))
    .join(" → ")}`;
}
function selectedStyle(p) {
  const style = get("style", p.styleId);
  if (!style || style.deletedAt || !style.rules)
    throw new Error("请先选择一个已经提炼完成的风格。");
  return style;
}
function styleFor(p, j) {
  return j.payload.styleSnapshot || selectedStyle(p);
}
export function newSlide(
  notes,
  batchIds,
  styleId,
  plan = null,
  planStyle = null,
) {
  return {
    id: id(),
    batchIds,
    styleId,
    // Input is already spoken text; do not reinterpret a manual split as Markdown.
    notes,
    manuscriptVersion: MANUSCRIPT_VERSION,
    plan,
    planStyle,
    image: null,
    scene: null,
    status: "pending",
    stale: false,
    error: null,
    versions: [],
    createdAt: now(),
  };
}
async function prepareContent(j, pages, contextText, signal) {
  j.payload.contentBriefs ||= {};
  const missing = pages.filter((p) => {
    const saved = j.payload.contentBriefs[p.id];
    return (
      !saved ||
      saved.notes !== p.notes ||
      saved.brief.version !== PLANNING_VERSION
    );
  });
  if (missing.length) {
    progress(
      j,
      `正在梳理 ${missing.length} 页的内容关系，再构思画面`,
      0,
      pages.length,
    );
    const briefs = await analyzePageContents(missing, contextText, signal);
    signal.throwIfAborted();
    for (const page of missing)
      j.payload.contentBriefs[page.id] = {
        notes: page.notes,
        brief: briefs[page.id],
      };
    put("job", j);
  }
  return Object.fromEntries(
    pages.map((p) => [p.id, j.payload.contentBriefs[p.id].brief]),
  );
}
async function renderSlides(j, ids, signal, redesign = false) {
  let failures = 0;
  let completed = 0;
  const initial = projectOrThrow(j.projectId);
  const pending = initial.slides.filter(
    (s) =>
      ids.includes(s.id) &&
      !(j.payload.finishedIds?.includes(s.id) && (s.image || s.scene)) &&
      (redesign || s.stale || !(s.image || s.scene)),
  );
  if (!pending.length) return;
  const briefs = await prepareContent(
    j,
    pending.map((s) => ({ id: s.id, notes: s.notes })),
    context(initial, pending[0].id),
    signal,
  );
  progress(j, "正在准备可延伸的风格规范", 0, pending.length);
  const language = await styleLanguageFor(styleFor(initial, j), signal);
  for (const sid of ids) {
    signal.throwIfAborted();
    let p = projectOrThrow(j.projectId);
    let s = p.slides.find((x) => x.id === sid);
    if (!s) throw new Error("原页面已经调整，请在当前页面重新发起制作。");
    if (j.payload.finishedIds?.includes(sid) && (s.image || s.scene)) {
      completed++;
      continue;
    }
    if (!redesign && (s.image || s.scene) && !s.stale) {
      completed++;
      continue;
    }
    try {
      s.status = "generating";
      s.error = null;
      saveProject(p);
      const style = styleFor(p, j);
      let stamp = styleStamp(style);
      const reusablePending =
        s.pendingPlan?.planningVersion === PLANNING_VERSION &&
        s.pendingPlanStyle?.fingerprint === stamp.fingerprint;
      let plan = reusablePending ? s.pendingPlan : s.plan;
      if (
        !reusablePending &&
        (!plan ||
          plan.engine !== "image" ||
          plan.planningVersion !== PLANNING_VERSION ||
          redesign ||
          s.stale ||
          s.planStyle?.fingerprint !== stamp.fingerprint)
      ) {
        progress(
          j,
          `正在重新构思第 ${completed + 1} / ${ids.length} 页`,
          completed,
          ids.length,
        );
        plan = await design(
          s.notes,
          style,
          context(p, s.id),
          j.payload.feedback || "",
          redesign ? s.plan : null,
          signal,
          {
            contentBrief: briefs[s.id],
            designLanguage: language,
            // Changed source copy must be re-edited; never freeze an obsolete headline or number.
            notesUnchanged: !s.stale,
            nearbyPages: nearbyCompositions(p.slides, s.id),
          },
        );
      }
      // Persist the proposed plan before image generation, without discarding the previous rendered version.
      stamp = styleStamp(style, plan);
      p = projectOrThrow(j.projectId);
      s = p.slides.find((x) => x.id === sid);
      s.pendingPlan = plan;
      s.pendingPlanStyle = stamp;
      if (!s.image && !s.scene) {
        s.plan = plan;
        s.planStyle = stamp;
        s.styleId = style.id;
      }
      saveProject(p);
      progress(
        j,
        `正在生成第 ${completed + 1} / ${ids.length} 页画面`,
        completed,
        ids.length,
      );
      const image = await generateImage(plan, style, signal);
      signal.throwIfAborted();
      p = projectOrThrow(j.projectId);
      s = p.slides.find((x) => x.id === sid);
      if (s.image || s.scene) s.versions.push(snapshot(s));
      Object.assign(s, {
        plan,
        image,
        scene: null,
        status: "ready",
        error: null,
        stale: false,
        styleId: style.id,
        planStyle: stamp,
        imageStyle: stamp,
        review: null,
        reviewError: null,
      });
      delete s.pendingPlan;
      delete s.pendingPlanStyle;
      saveProject(p);
      j.payload.finishedIds = [...(j.payload.finishedIds || []), sid];
      completed++;
      progress(
        j,
        `已生成 ${completed} / ${ids.length} 页`,
        completed,
        ids.length,
      );
    } catch (e) {
      if (signal.aborted) throw e;
      p = projectOrThrow(j.projectId);
      s = p.slides.find((x) => x.id === sid);
      s.status = "error";
      s.error = e.message;
      saveProject(p);
      failures++;
      completed++;
    }
  }
  if (failures)
    throw new Error(
      `${failures} 页生成失败，已完成的页面已保存。可继续失败页面，具体原因见页面提示。`,
    );
}
async function run(j, signal) {
  if (j.type === "trial")
    return runTrial(j, signal, (stage) => progress(j, stage));
  if (j.type === "style") {
    const style = get("style", j.payload.styleId);
    if (!style || style.deletedAt) throw new Error("风格不存在或已删除");
    style.status = "analyzing";
    put("style", style);
    progress(j, "正在观察参考图片，提炼设计规则");
    try {
      const extracted = await analyzeStyle(
        style,
        j.payload.feedback || "",
        signal,
        {},
        (stage) => progress(j, stage),
      );
      signal.throwIfAborted();
      style.history = [
        ...(style.history || []),
        {
          rules: style.rules,
          description: style.description,
          colors: style.colors,
          referenceProfiles: style.referenceProfiles,
          designSystem: style.designSystem,
          imageRecipes: style.imageRecipes,
          updatedAt: style.updatedAt,
        },
      ].filter((x) => x.rules);
      Object.assign(style, extracted, {
        status: "ready",
        error: null,
        updatedAt: now(),
      });
      put("style", style);
    } catch (e) {
      style.status = style.rules ? "ready" : "error";
      style.error = e.message;
      put("style", style);
      throw e;
    }
    return;
  }
  let p = projectOrThrow(j.projectId);
  if (j.type === "inspect")
    throw new Error("风格对比检查已停用，请直接调整页面。");
  if (j.type === "append") {
    const batch = p.batches.find((b) => b.id === j.payload.batchId);
    if (!batch) throw new Error("文稿段落不存在");
    let ids = batch.slideIds || [];
    if (!ids.length) {
      progress(j, "正在逐句理解文稿");
      const units = await segment(batch.text, context(p), signal, (a, b) =>
        progress(j, `正在拆解内容 ${a} / ${b}`),
      );
      signal.throwIfAborted();
      p = projectOrThrow(j.projectId);
      const slides = units.map((n) => newSlide(n, [batch.id], p.styleId));
      const batchIndex = p.batches.findIndex((b) => b.id === batch.id);
      const insertAt = p.slides.findIndex((s) =>
        s.batchIds.every(
          (bid) => p.batches.findIndex((b) => b.id === bid) > batchIndex,
        ),
      );
      p.slides.splice(insertAt < 0 ? p.slides.length : insertAt, 0, ...slides);
      p.batches.find((b) => b.id === batch.id).slideIds = slides.map(
        (s) => s.id,
      );
      p.undo = null;
      ids = slides.map((s) => s.id);
      saveProject(p);
    }
    await renderSlides(j, ids, signal);
    return;
  }
  if (j.type === "render") {
    await renderSlides(j, j.payload.slideIds, signal, !!j.payload.redesign);
    return;
  }
  if (j.type === "proposal") {
    if (j.payload.manuscriptVersion !== MANUSCRIPT_VERSION) {
      j.payload.notes = j.payload.notes.map(spokenManuscript);
      j.payload.manuscriptVersion = MANUSCRIPT_VERSION;
    }
    const plans = [];
    const style = styleFor(p, j);
    const initialRevision = p.revision;
    const pages = j.payload.notes.map((notes, i) => ({ id: String(i), notes }));
    const briefs = await prepareContent(j, pages, context(p), signal);
    const language = await styleLanguageFor(style, signal);
    for (let i = 0; i < j.payload.notes.length; i++) {
      progress(
        j,
        `正在设计调整后的第 ${i + 1} / ${j.payload.notes.length} 页`,
        i,
        j.payload.notes.length,
      );
      plans.push(
        await design(
          j.payload.notes[i],
          style,
          context(p),
          "这是合并或拆分后的新内容，重新组织画面。",
          null,
          signal,
          {
            contentBrief: briefs[String(i)],
            designLanguage: language,
            nearbyPages: plans.map((plan) => ({
              title: plan.title,
              visualForm: plan.visualForm,
              compositionKey: plan.compositionKey,
              visual: plan.visual,
            })),
          },
        ),
      );
    }
    signal.throwIfAborted();
    p = projectOrThrow(j.projectId);
    if (p.revision !== initialRevision)
      throw new Error("项目已发生变化，请重新预览调整方案。");
    p.proposal = {
      id: id(),
      type: j.payload.type,
      sourceIds: j.payload.sourceIds,
      notes: j.payload.notes,
      manuscriptVersion: MANUSCRIPT_VERSION,
      plans,
      styleId: p.styleId,
      planStyle: styleStamp(style),
      createdAt: now(),
    };
    saveProject(p);
    return;
  }
}
async function pump() {
  if (processing) return;
  processing = true;
  try {
    while (true) {
      const j = all("job")
        .filter((x) => x.status === "queued")
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
      if (!j) break;
      const controller = new AbortController();
      controllers.set(j.id, controller);
      j.status = "running";
      progress(j, "开始制作");
      try {
        await run(j, controller.signal);
        j.status = "completed";
        progress(j, "制作完成", j.total, j.total);
      } catch (e) {
        j.status = controller.signal.aborted ? "cancelled" : "failed";
        j.error = controller.signal.aborted
          ? "任务已停止，已完成的内容已保存。"
          : e.message;
        progress(j, controller.signal.aborted ? "已停止" : "需要处理");
      } finally {
        controllers.delete(j.id);
        if (j.projectId) {
          const p = get("project", j.projectId);
          if (p) {
            let dirty = false;
            for (const s of p.slides)
              if (s.status === "generating") {
                s.status = s.image || s.scene ? "ready" : "pending";
                dirty = true;
              }
            if (dirty) saveProject(p);
          }
        }
      }
    }
  } finally {
    processing = false;
  }
}
export function recoverJobs() {
  for (const j of all("job"))
    if (["queued", "running"].includes(j.status)) {
      j.status = "interrupted";
      j.stage = "上次制作中断";
      j.error = "应用重启，已生成页面完整保留。点击继续即可。";
      put("job", j);
    }
  for (const p of all("project")) {
    let dirty = false;
    for (const b of p.batches)
      if (!b.jobId) {
        const job = all("job").find(
          (j) => j.type === "append" && j.payload.batchId === b.id,
        );
        if (job) {
          b.jobId = job.id;
          dirty = true;
        }
      }
    for (const s of p.slides)
      if (s.status === "generating") {
        s.status = s.image || s.scene ? "ready" : "pending";
        dirty = true;
      }
    if (dirty) saveProject(p);
  }
  for (const s of all("style"))
    if (s.status === "analyzing") {
      s.status = s.rules ? "ready" : "error";
      s.error = "上次提炼中断，可重新提炼。";
      put("style", s);
    }
}
