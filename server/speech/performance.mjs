import { withUsage } from "../usage/index.mjs";
import {
  withModelRequestProgress,
  recoveryReason,
} from "../model-request-policy.mjs";
import { all, get, put, id, now, settings, projectOrThrow } from "../store.mjs";
import { jsonModel } from "../models.mjs";
import { prepareSpeechScript, speechScript } from "./scripts.mjs";
import {
  performanceFingerprint,
  readPerformanceCheckpoint,
} from "./performance-checkpoint.mjs";
import { prepareSpeechText } from "../../shared/speech-text.mjs";
import {
  PERFORMANCE_VERSION,
  performanceSettings,
} from "../../shared/speech-performance.mjs";
import { analyzePerformance } from "./performance-director.mjs";
export {
  analyzePerformance,
  PERFORMANCE_PROMPT,
} from "./performance-director.mjs";
const controllers = new Map();
const running = (task) => task && ["queued", "running"].includes(task.status);
export const activePerformanceCount = (projectId) =>
  all("speech-script").filter(
    (s) =>
      (!projectId || s.projectId === projectId) && running(s.performanceTask),
  ).length;
function update(projectId, job, plan, checkpoint) {
  const script = get("speech-script", projectId);
  if (!script || script.performanceTask?.id !== job.id) return;
  put("speech-script", {
    ...script,
    performanceTask: job,
    ...(plan ? { performance: plan } : {}),
    ...(checkpoint !== undefined ? { performanceCheckpoint: checkpoint } : {}),
    updatedAt: now(),
  });
}
export function recoverPerformances() {
  for (const s of all("speech-script"))
    if (running(s.performanceTask))
      update(s.projectId, {
        ...s.performanceTask,
        status: "interrupted",
        progress:
          "编排已中断，已保存进度；点击继续编排才会调用模型，旧方案已保留",
      });
}
export function registerPerformance(app, assertIdle) {
  app.post("/api/projects/:id/speech-performance", (req, res) => {
    assertIdle();
    const project = projectOrThrow(req.params.id),
      config = performanceSettings(req.body.settings);
    if (!settings().text.apiKey)
      throw new Error("请先在设置中配置内容分析模型，再编排演讲");
    if (!project.slides.length || project.slides.length > 500)
      throw new Error("演绎编排支持 1–500 页");
    // Validate resume compatibility before mutating the saved draft or checkpoint.
    const script = prepareSpeechScript(project, req.body);
    script.pages = script.pages.map((p) => ({
      ...p,
      text: prepareSpeechText(p.text).text,
    }));
    const pages = script.pages.map((p, i) => ({
      id: p.id,
      text: p.text,
      notes: p.notes,
      title: project.slides[i].plan?.title || `第 ${i + 1} 页`,
    }));
    if (pages.reduce((n, p) => n + p.text.length, 0) > 300000)
      throw new Error("单次演绎编排最多 30 万字符");
    const modelConfig = settings().text;
    const fingerprint = performanceFingerprint(pages, config, modelConfig);
    const saved = get("speech-script", project.id);
    const resume =
      req.body.resume === true &&
      readPerformanceCheckpoint(
        saved?.performanceCheckpoint,
        fingerprint,
        pages,
        config,
      );
    if (req.body.resume === true && !resume)
      throw Object.assign(
        new Error(
          "讲稿、页序、表达设置或内容分析模型已变化，或没有可用进度。请从头编排；原有方案和音频仍保留。",
        ),
        { status: 409 },
      );
    const checkpoint = {
      fingerprint,
      settings: config,
      entries: resume ? resume.entries : [],
      ...(resume?.director ? { director: resume.director } : {}),
    };
    const job = {
      id: id(),
      status: "running",
      progress: resume
        ? `正在继续编排，已完成 ${resume.completed}/${pages.length} 页`
        : "正在分析演讲脉络",
      completed: resume ? resume.completed : 0,
      savedUnits: resume ? resume.savedUnits : 0,
      total: pages.length,
    };
    put("speech-script", {
      ...saved,
      ...script,
      performanceTask: job,
      performanceCheckpoint: checkpoint,
    });
    const controller = new AbortController();
    controllers.set(job.id, controller);
    const model = modelConfig.model;
    res.status(202).json(speechScript(project));
    void (async () => {
      let stageBeforeRetry;
      try {
        const annotated = await withUsage(
          { projectId: project.id, taskId: job.id, feature: "演绎编排" },
          () =>
            withModelRequestProgress(
              (waiting) => {
                if (waiting) {
                  stageBeforeRetry ??= job.progress;
                  job.progress = `${stageBeforeRetry}；${recoveryReason(waiting.reason)}，${Math.ceil(waiting.ms / 1000)} 秒后自动重试（${waiting.attempt}/${waiting.maxRetries}）`;
                } else if (stageBeforeRetry !== undefined) {
                  job.progress = stageBeforeRetry;
                  stageBeforeRetry = undefined;
                }
                update(project.id, job);
              },
              () =>
                analyzePerformance(
                  pages,
                  config,
                  controller.signal,
                  (progress, completed) => {
                    job.progress = progress;
                    job.completed = completed;
                    update(project.id, job);
                  },
                  jsonModel,
                  {
                    entries: checkpoint.entries,
                    director: checkpoint.director,
                    onDirector: (director) => {
                      checkpoint.director = director;
                      update(project.id, job, undefined, checkpoint);
                    },
                    onCheckpoint: (entries, completed) => {
                      checkpoint.entries = entries;
                      job.completed = completed;
                      job.savedUnits = entries.reduce(
                        (n, p) => n + p.units.length,
                        0,
                      );
                      update(project.id, job, undefined, checkpoint);
                    },
                  },
                ),
            ),
        );
        controller.signal.throwIfAborted();
        job.status = "ready";
        job.completed = pages.length;
        job.progress = "演绎编排已完成，请逐页检查后生成口播";
        update(
          project.id,
          job,
          {
            id: job.id,
            version: PERFORMANCE_VERSION,
            model,
            settings: config,
            createdAt: now(),
            pages: annotated,
            ...(checkpoint.director?.plan
              ? { direction: checkpoint.director.plan }
              : {}),
          },
          null,
        );
      } catch (e) {
        job.status = controller.signal.aborted ? "cancelled" : "failed";
        job.progress = controller.signal.aborted
          ? "已停止编排，已保存进度；上一份方案和音频保留"
          : e.message;
        update(project.id, job);
      } finally {
        controllers.delete(job.id);
      }
    })();
  });
  app.post("/api/projects/:id/speech-performance/cancel", (req, res) => {
    const project = projectOrThrow(req.params.id),
      script = get("speech-script", project.id);
    if (script?.performanceTask)
      controllers.get(script.performanceTask.id)?.abort();
    res.json(speechScript(project));
  });
}
