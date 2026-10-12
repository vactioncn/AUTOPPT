import { analyzePerformance } from "./speech/performance-director.mjs";
import { compilePerformancePage } from "../shared/speech-performance.mjs";
import { jsonModel } from "./models.mjs";
import { withUsage } from "./usage/index.mjs";
import {
  withModelRequestProgress,
  recoveryReason,
} from "./model-request-policy.mjs";

// The run owns an immutable manuscript snapshot and resumable planning progress.
// Service settings and the project's original manuscript are never edited here.
export async function prepareRehearsalExpression(
  run,
  save,
  signal,
  callModel = jsonModel,
) {
  if (run.plan.expression !== "directed" || run.expressionReady) return;
  const pages = run.pages.map((p) => ({
    id: p.id,
    title: p.title,
    text: p.text,
    notes: p.text,
  }));
  run.expressionCheckpoint ||= { entries: [] };
  let stage = "正在通读讲稿，编排情绪、语速和停顿。";
  const checkpoint = run.expressionCheckpoint;
  const annotated = await withUsage(
    { projectId: run.projectId, taskId: run.id, feature: "口播情感编排" },
    () =>
      withModelRequestProgress(
        (waiting) => {
          run.progress = waiting
            ? `${stage} ${recoveryReason(waiting.reason)}，${Math.ceil(waiting.ms / 1000)} 秒后重试。`
            : stage;
          save(run);
        },
        () =>
          analyzePerformance(
            pages,
            { style: "natural", sounds: false },
            signal,
            (progress) => {
              stage = progress;
              run.progress = progress;
              save(run);
            },
            callModel,
            {
              entries: checkpoint.entries,
              director: checkpoint.director,
              onDirector: (director) => {
                checkpoint.director = director;
                save(run);
              },
              onCheckpoint: (entries) => {
                checkpoint.entries = entries;
                save(run);
              },
            },
          ),
      ),
  );
  signal?.throwIfAborted();
  // Validate and compile every page before publishing any new clips.
  const clips = annotated.map((page) =>
    compilePerformancePage(page, run.speechModel, run.options).map((clip) => ({
      ...clip,
      status: "pending",
    })),
  );
  run.pages.forEach((page, i) => {
    page.clips = clips[i];
  });
  run.expressionReady = true;
  run.progress = "情感编排已完成，正在合成声音。";
  save(run);
}
