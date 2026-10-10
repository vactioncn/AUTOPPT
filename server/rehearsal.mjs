import { publishRehearsalNarration } from "./rehearsal-narration.mjs";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  all,
  get,
  put,
  now,
  projectOrThrow,
  dataDir,
  settings,
} from "./store.mjs";
import { readFile } from "node:fs/promises";
import { rehearsalContext, saveRehearsalPlan } from "./rehearsal-plan.mjs";
import { speechSettings, providerIdentity } from "./speech/settings.mjs";
import { cachedAudio, optionsFor } from "./speech/index.mjs";
import {
  pageStamp,
  createGeneration,
  publicGeneration,
  resumeGeneration,
  stopGeneration,
} from "./presenter/generation.mjs";
import { presenterSettings } from "./presenter/settings.mjs";
import { createMotion, retryMotion, stopMotion } from "./motion/index.mjs";
import { splitSpeech } from "../shared/speech.mjs";
import { matchNarrationPage } from "./speech/export.mjs";
import { withUsage } from "./usage/index.mjs";
const active = (s) => ["queued", "running"].includes(s);
const fail = (message, status = 400) =>
  Object.assign(new Error(message), { status });
const hash = (b) => createHash("sha256").update(b).digest("hex");
const running = new Map();
const store = (run) => put("rehearsal-run", { ...run, updatedAt: now() });
export async function publicRun(run) {
  const child = run.presenterId && get("presenter-generation", run.presenterId),
    motion = run.motionId && get("motion", run.motionId);
  const presenter = child ? await publicGeneration(child) : null;
  const pages = presenter
    ? run.pages.map((p) => ({
        ...p,
        clips: presenter.pages.find((c) => c.id === p.id)?.clips || p.clips,
      }))
    : run.pages;
  const states = [
    ...(child
      ? [child.status]
      : run.plan.actor === "voice"
        ? [run.audioStatus]
        : []),
    ...(motion ? [motion.status] : []),
  ];
  const complete =
    run.prepared &&
    !run.motionError &&
    !run.error &&
    states.every((s) => s === "ready");
  const pending = running.has(run.id) || states.some(active);
  const componentError = run.motionError || run.error;
  const project = projectOrThrow(run.projectId);
  return {
    id: run.id,
    projectId: run.projectId,
    createdAt: run.createdAt,
    scope: run.scope,
    trialLength: run.trialLength,
    plan: run.plan,
    voiceName: run.voiceName,
    speechModel: run.speechModel,
    pages,
    compatible: run.pages.every((p) =>
      project.slides.some(
        (s) => s.id === p.id && pageStamp(s) === p.sourceFingerprint,
      ),
    ),
    status: complete ? "ready" : pending ? "running" : "interrupted",
    message: pending
      ? "正在生成，完成的声音和页面可先预览。"
      : complete
        ? "已完成，可以播放。"
        : componentError ||
          presenter?.message ||
          motion?.progress ||
          "上次准备中断，请继续。",
    audioStatus: run.audioStatus,
    presenter,
    motion: motion
      ? {
          id: motion.id,
          status: motion.status,
          progress: motion.progress,
          pages: motion.pages.map((p) => ({
            id: p.id,
            number: p.number,
            title: p.title,
            status: p.status,
            reused: !!p.reused,
            error: p.error,
          })),
        }
      : null,
  };
}
export async function createRun(projectId, input, dependencies = {}) {
  const project = projectOrThrow(projectId);
  if (
    input?.confirmed !== true ||
    !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(
      input.requestId || "",
    ) ||
    !["trial", "all", "selected"].includes(input.scope) ||
    !["short", "page"].includes(input.trialLength)
  )
    throw fail("请确认试播或整场的页面范围与费用。");
  const previous = get("rehearsal-run", input.requestId);
  if (previous) {
    if (previous.projectId !== projectId) throw fail("请求编号已使用。", 409);
    return publicRun(previous);
  }
  if (input.revision !== project.revision)
    throw fail("项目已更新，请重新打开演练中心。", 409);
  if (
    all("rehearsal-run").some(
      (r) =>
        r.projectId === projectId &&
        (running.has(r.id) ||
          (r.plan.actor === "voice" && active(r.audioStatus)) ||
          (r.presenterId &&
            active(get("presenter-generation", r.presenterId)?.status)) ||
          (r.motionId && active(get("motion", r.motionId)?.status))),
    )
  )
    throw fail("本场已有生成任务，请先查看进度。", 409);
  const context = rehearsalContext(projectId),
    plan = context.plan;
  const ids =
    input.scope === "trial"
      ? [plan.pageId]
      : input.scope === "all"
        ? project.slides.map((s) => s.id)
        : plan.slideIds;
  if (!ids.length) throw fail("请先选择页面。");
  const selected = project.slides.filter((s) => ids.includes(s.id));
  if (
    selected.length !== ids.length ||
    selected.some((s) => !s.image && !s.scene)
  )
    throw fail("所选页面缺少画面，请先到制作台补齐或调整范围。");
  const config = speechSettings(),
    voice = context.voices.find((v) => v.id === plan.voiceId);
  const narration = plan.narrationId && get("narration", plan.narrationId);
  if (plan.actor !== "self" && !narration && (!config.apiKey || !voice))
    throw fail("请在设置准备 MiniMax 声音，再为本场演讲选择。");
  if (
    plan.actor === "digital" &&
    (!presenterSettings().apiKey || !plan.avatarId)
  )
    throw fail("请先在设置准备数字人服务和头像，再回来试播。");
  if (
    plan.visual === "motion" &&
    (!settings().text.apiKey || !settings().image.apiKey)
  )
    throw fail("请先在设置保存动态演示需要的模型服务。");
  const options =
    narration?.options || (voice ? optionsFor(plan, config) : null);
  const pages = [];
  for (const slide of selected) {
    let text = context.script.pages.find((p) => p.id === slide.id)?.text || "";
    let fullText = text;
    let clips = [];
    if (plan.actor !== "self") {
      if (narration) {
        const page = matchNarrationPage(narration, slide);
        text = page.spokenText || page.notes;
        fullText = text;
        clips = await Promise.all(
          page.clips.map(async (c) => ({
            ...c,
            audioFile: c.file,
            audioHash: hash(
              await readFile(path.join(dataDir, "speech-audio", c.file)),
            ),
          })),
        );
      } else {
        if (!text.trim())
          throw fail(
            `第 ${project.slides.indexOf(slide) + 1} 页口播为空，请填写或在范围中取消这页。`,
          );
        if (input.scope === "trial" && input.trialLength === "short")
          text = shortText(text);
        clips = splitSpeech(text, 800).map((text) => ({
          text,
          status: "pending",
        }));
      }
    }
    pages.push({
      id: slide.id,
      number: project.slides.indexOf(slide) + 1,
      title: slide.plan?.title || `第 ${project.slides.indexOf(slide) + 1} 页`,
      sourceFingerprint: pageStamp(slide),
      image: slide.image,
      scene: slide.scene || null,
      notes: slide.notes,
      text,
      fullText,
      clips,
    });
  }
  const inserted = get("rehearsal-run", input.requestId);
  if (inserted) return publicRun(inserted);
  if (
    all("rehearsal-run").some(
      (r) => r.projectId === projectId && running.has(r.id),
    )
  )
    throw fail("本场已有任务，请先查看进度。", 409);
  // Snapshot before any paid request. No project revision, manuscript or library is changed.
  const run = store({
    id: input.requestId,
    projectId,
    projectTitle: project.title,
    sourceRevision: project.revision,
    scope: input.scope,
    trialLength: input.trialLength,
    plan: { ...plan },
    pages,
    voiceName: narration?.voiceName || voice?.name || "",
    options,
    speechProvider: providerIdentity(config),
    speechModel: config.model,
    createdAt: now(),
    audioStatus: narration ? "ready" : "queued",
    prepared: false,
  });
  start(run, dependencies);
  return publicRun(run);
}
export function shortText(text) {
  const chunks = text.match(/[^。！？.!?]+[。！？.!?]?/gu) || [text];
  let result = "";
  for (const part of chunks) {
    if (result && [...(result + part)].length > 100) break;
    result += part;
    if ([...result].length >= 50) break;
  }
  return [...result.trim()].slice(0, 100).join("");
}
function start(run, dependencies = {}) {
  if (running.has(run.id)) return;
  const task = prepare(run, dependencies).finally(() => running.delete(run.id));
  running.set(run.id, task);
}
async function prepare(
  run,
  {
    audioFactory = cachedAudio,
    motionFactory = createMotion,
    presenterFactory = createGeneration,
  } = {},
) {
  try {
    if (run.plan.visual === "motion" && !run.motionId) {
      try {
        const d = await motionFactory(run.projectId, {
          revision: projectOrThrow(run.projectId).revision,
          slideIds: run.pages.map((p) => p.id),
          reuse: true,
        });
        run.motionId = d.id;
        run.motionError = "";
        store(run);
      } catch (e) {
        run.motionError = e.message;
        store(run);
      }
    }
    if (run.plan.actor === "digital" && !run.presenterId) {
      const j = await presenterFactory(run.projectId, {
        requestId: run.id,
        confirmed: true,
        scope: run.scope === "trial" ? "page" : "all",
        pageId: run.scope === "trial" ? run.pages[0].id : undefined,
        mode: run.plan.narrationId ? "audio" : "text",
        rehearsalRunId: run.id,
      });
      run.presenterId = j.id;
      store(run);
    } else if (run.plan.actor === "voice" && run.audioStatus !== "ready") {
      const config = speechSettings();
      if (
        providerIdentity(config) !== run.speechProvider ||
        config.model !== run.speechModel
      )
        throw fail("MiniMax 服务已改变，请恢复配置后继续。");
      run.audioStatus = "running";
      store(run);
      for (const p of run.pages)
        for (const c of p.clips) {
          if (get("rehearsal-run", run.id).stopRequested)
            throw fail("已停止后续生成，完成的音频已保留。");
          if (c.audioFile) continue;
          const audio = await withUsage(
            {
              projectId: run.projectId,
              pageId: p.id,
              taskId: run.id,
              feature: "演练口播",
            },
            () => audioFactory(config, c.text, run.options),
          );
          Object.assign(c, {
            audioFile: audio.file,
            duration: audio.duration,
            status: "ready",
          });
          store(run);
        }
      run.audioStatus = "ready";
      publishRehearsalNarration(run);
      store(run);
    }
    run.prepared = true;
    run.error = "";
    store(run);
  } catch (e) {
    run.error = e.message;
    if (["queued", "running"].includes(run.audioStatus))
      run.audioStatus = "interrupted";
    store(run);
  }
}
export async function waitForRun(id) {
  await running.get(id);
  return get("rehearsal-run", id);
}
export function registerRehearsal(app) {
  const base = "/api/projects/:id/rehearsal";
  app.use(base, (_req, _res, next) =>
    process.env.AUTOPPT_WORKER_TOKEN
      ? next(fail("演练生成仅在本机 App 提供。", 403))
      : next(),
  );
  app.get(base, (req, res) => {
    const { provider, ...context } = rehearsalContext(req.params.id);
    res.json(context);
  });
  app.put(base, (req, res) =>
    res.json(saveRehearsalPlan(req.params.id, req.body)),
  );
  app.get(base + "/runs", async (req, res) => {
    projectOrThrow(req.params.id);
    res.json(
      await Promise.all(
        all("rehearsal-run")
          .filter((r) => r.projectId === req.params.id)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .map(publicRun),
      ),
    );
  });
  app.post(base + "/runs", async (req, res) =>
    res.status(202).json(await createRun(req.params.id, req.body)),
  );
  app.post(base + "/runs/:runId/resume", async (req, res) => {
    const run = get("rehearsal-run", req.params.runId);
    if (!run || run.projectId !== req.params.id)
      throw fail("演练任务不存在。", 404);
    if (req.body?.confirmed !== true) throw fail("请确认继续处理与费用。");
    if (!(await publicRun(run)).compatible)
      throw fail("页面已变化，请生成新版本，旧结果已保留。", 409);
    run.stopRequested = false;
    store(run);
    if (run.motionId && get("motion", run.motionId)?.status !== "ready")
      retryMotion(run.motionId);
    if (
      run.presenterId &&
      get("presenter-generation", run.presenterId)?.status !== "ready"
    )
      await resumeGeneration(run.projectId, run.presenterId, true);
    if (
      !run.prepared ||
      run.motionError ||
      (run.plan.actor === "voice" && run.audioStatus !== "ready")
    )
      start(run);
    res.json(await publicRun(run));
  });
  app.post(base + "/runs/:runId/stop", (req, res) => {
    const run = get("rehearsal-run", req.params.runId);
    if (!run || run.projectId !== req.params.id)
      throw fail("任务不存在。", 404);
    store({ ...run, stopRequested: true });
    if (run.motionId) stopMotion(run.motionId);
    if (run.presenterId) stopGeneration(run.projectId, run.presenterId);
    res.json({ stopped: true });
  });
}
