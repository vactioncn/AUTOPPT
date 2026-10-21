import { existsSync } from "node:fs";
import { all, get, assetPath } from "./store.mjs";
import { styleStamp } from "./core.mjs";
import {
  STYLE_SAMPLE_PAGES,
  STYLE_SAMPLE_VERSION,
} from "../shared/style-sample-suite.mjs";
import { sampleSelection } from "../shared/style-sample-sequence.mjs";

export const sampleBatchActive = (styleId) =>
  get("sample-batch", styleId)?.status === "running";
export const activeSampleBatchCount = () =>
  all("sample-batch").filter((b) => b.status === "running").length;
export function sampleTrials(styleId, snapshot) {
  return (snapshot?.trials || all("trial"))
    .filter((t) => t.styleId === styleId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((t) => {
      const job = snapshot ? snapshot.jobs.get(t.jobId) : get("job", t.jobId);
      const trial = {
        ...t,
        status: job?.status || t.status,
        stage: job?.stage,
        error: job?.error || t.error,
        uncertain: !!job?.uncertain,
      };
      if (
        trial.status === "completed" &&
        trial.purpose === "standard-sample" &&
        (!trial.image || !existsSync(assetPath(trial.image)))
      ) {
        trial.status = "failed";
        trial.error = "样例图片文件不可用，请重新补齐这一页。";
      }
      return trial;
    });
}
export function currentSamples(style, trials = sampleTrials(style.id)) {
  const fingerprint = styleStamp(style).fingerprint;
  return trials.filter(
    (t) =>
      t.purpose === "standard-sample" &&
      t.sampleVersion === STYLE_SAMPLE_VERSION &&
      t.baseFingerprint === fingerprint,
  );
}
export function sampleProgress(style, trials = sampleTrials(style.id)) {
  if (style.catalogSourceId || style.deletedAt) return undefined;
  const fingerprint = styleStamp(style).fingerprint;
  const saved = get("sample-batch", style.id);
  const batch = saved?.fingerprint === fingerprint ? saved : null;
  const candidates = currentSamples(style, trials);
  const done = sampleSelection(candidates, fingerprint).filter(Boolean).length;
  const live = candidates.find((t) => ["queued", "running"].includes(t.status));
  const current =
    live || candidates.find((t) => t.id === batch?.currentTrialId);
  const page = STYLE_SAMPLE_PAGES.find(
    (p) => p.id === (current?.samplePageId || batch?.currentPageId),
  );
  const complete = done === STYLE_SAMPLE_PAGES.length && !live;
  return {
    status: complete
      ? "completed"
      : batch?.status || (live ? "running" : done === 8 ? "completed" : "idle"),
    background: !!batch && batch.status === "running",
    done,
    total: STYLE_SAMPLE_PAGES.length,
    currentPage: page
      ? { id: page.id, number: page.number, type: page.type }
      : null,
    currentStatus: current?.status || null,
    stage: live?.stage || (live?.status === "queued" ? "排队中" : ""),
    error: complete
      ? ""
      : batch?.error ||
        (batch?.status === "paused" &&
        current &&
        !["completed", "running", "queued"].includes(current.status)
          ? current.error || "当前页未完成，请检查后继续。"
          : ""),
    uncertain:
      !complete &&
      (!!batch?.uncertain ||
        !!(
          batch?.status === "paused" &&
          (current?.uncertain || current?.status === "interrupted")
        )),
  };
}
