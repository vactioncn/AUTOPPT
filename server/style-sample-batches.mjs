import { all, get, put, now } from "./store.mjs";
import { styleStamp } from "./core.mjs";
import {
  STYLE_SAMPLE_PAGES,
  STYLE_SAMPLE_VERSION,
} from "../shared/style-sample-suite.mjs";
import { sampleSelection } from "../shared/style-sample-sequence.mjs";
import {
  sampleTrials,
  currentSamples,
  sampleProgress,
} from "./style-sample-state.mjs";

const conflict = (message) =>
  Object.assign(new Error(message), { status: 409 });
const save = (batch) => put("sample-batch", { ...batch, updatedAt: now() });

// The coordinator owns no model concurrency slot: only individual image jobs do.
// Each child and its batch pointer are committed in the same SQLite transaction.
export function createSampleBatches({ createTrial }) {
  function step(batch) {
    const style = get("style", batch.id);
    if (
      !style ||
      style.deletedAt ||
      styleStamp(style).fingerprint !== batch.fingerprint ||
      batch.sampleVersion !== STYLE_SAMPLE_VERSION
    )
      throw new Error("风格已变化，请查看当前样例后重新补齐。");
    const trials = currentSamples(style);
    const current = trials.find((t) => t.id === batch.currentTrialId);
    if (batch.currentTrialId && !current)
      throw new Error("当前页任务记录不可用，请检查后继续补齐。");
    if (current && ["queued", "running"].includes(current.status)) return;
    if (current && current.status !== "completed")
      throw Object.assign(
        new Error(current.error || "当前页未完成，请检查后继续补齐。"),
        { uncertain: current.uncertain || current.status === "interrupted" },
      );
    const selected = sampleSelection(trials, batch.fingerprint);
    const page = STYLE_SAMPLE_PAGES.find((_, i) => !selected[i]);
    if (!page) {
      save({ ...batch, status: "completed", error: "", uncertain: false });
      return;
    }
    // Other work already admitted for this style finishes before the next page.
    if (
      all("job").some(
        (j) =>
          j.payload?.styleId === style.id &&
          ["queued", "running"].includes(j.status),
      )
    )
      return;
    createTrial(
      style.id,
      {
        samplePageId: page.id,
        sampleFingerprint: batch.fingerprint,
        reuseExisting: true,
      },
      {
        allowBatch: true,
        onCreated: (trial) =>
          save({ ...batch, currentPageId: page.id, currentTrialId: trial.id }),
      },
    );
  }
  function tick() {
    for (const batch of all("sample-batch").filter(
      (b) => b.status === "running",
    )) {
      try {
        step(batch);
      } catch (e) {
        save({
          ...batch,
          status: "failed",
          error: e.message,
          uncertain: !!e.uncertain,
        });
      }
    }
  }
  function start(styleId, body) {
    const style = get("style", styleId);
    if (
      !style ||
      style.deletedAt ||
      style.catalogSourceId ||
      !style.rules?.trim()
    )
      throw new Error("请先保存一个可用的原始风格。");
    const fingerprint = styleStamp(style).fingerprint;
    if (body.fingerprint !== fingerprint)
      throw conflict("风格已有变化，请刷新后再补齐。");
    if (
      typeof body.requestId !== "string" ||
      !/^[a-zA-Z0-9-]{16,80}$/.test(body.requestId)
    )
      throw new Error("补齐请求标识无效，请刷新后重试。");
    const old = get("sample-batch", styleId);
    if (old?.requestIds?.includes(body.requestId)) return sampleProgress(style);
    if (old?.status === "running") {
      save({ ...old, requestIds: [...(old.requestIds || []), body.requestId] });
      return sampleProgress(style);
    }
    if (sampleProgress(style).uncertain && body.acknowledgeUncertain !== true)
      throw conflict(
        "上一页结果不明，请核对服务用量并确认可能再次计费后继续。",
      );
    const live = currentSamples(style).find((t) =>
      ["queued", "running"].includes(t.status),
    );
    save({
      id: styleId,
      fingerprint,
      sampleVersion: STYLE_SAMPLE_VERSION,
      status: "running",
      requestIds: [...(old?.requestIds || []), body.requestId],
      currentTrialId: live?.id || null,
      currentPageId: live?.samplePageId || null,
      error: "",
      uncertain: false,
      createdAt: old?.createdAt || now(),
    });
    return sampleProgress(style);
  }
  function pause(styleId) {
    const batch = get("sample-batch", styleId);
    if (batch?.status === "running") save({ ...batch, status: "paused" });
    const style = get("style", styleId);
    if (!style || style.deletedAt) throw new Error("风格不存在。");
    return sampleProgress(style);
  }
  function recover() {
    // A process restart can leave provider billing uncertain. Browser navigation
    // never reaches this path; only an explicit continuation can retry a call.
    for (const batch of all("sample-batch").filter(
      (b) => b.status === "running",
    )) {
      const trial = sampleTrials(batch.id).find(
        (t) => t.id === batch.currentTrialId,
      );
      save({
        ...batch,
        status: "paused",
        error: "后台服务曾重启，补齐已暂停；已有图片保留，请检查后继续。",
        uncertain: !!trial && trial.status !== "completed",
      });
    }
  }
  function register(app) {
    app.post("/api/styles/:id/sample-batch", (req, res) =>
      res.status(202).json(start(req.params.id, req.body)),
    );
    app.post("/api/styles/:id/sample-batch/pause", (req, res) =>
      res.json(pause(req.params.id)),
    );
  }
  return { tick, start, pause, recover, register };
}
