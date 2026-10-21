import {
  STYLE_SAMPLE_PAGES,
  STYLE_SAMPLE_VERSION,
} from "./style-sample-suite.mjs";

export function completedSample(trials, pageId, fingerprint) {
  return trials.find(
    (trial) =>
      trial.purpose === "standard-sample" &&
      trial.samplePageId === pageId &&
      trial.sampleVersion === STYLE_SAMPLE_VERSION &&
      trial.baseFingerprint === fingerprint &&
      trial.status === "completed" &&
      trial.image,
  );
}

// Each page gets a separate request. A saved, completed image is the only
// condition that permits advancing; errors never trigger automatic resubmission.
export async function runSampleSequence({
  read,
  create,
  fingerprint,
  stopped,
  onPage,
  onTrial,
  wait = () => new Promise((resolve) => setTimeout(resolve, 1800)),
}) {
  for (const page of STYLE_SAMPLE_PAGES) {
    if (stopped()) return;
    const state = await read();
    if (stopped()) return;
    if (state.fingerprint !== fingerprint)
      throw new Error("正式风格已改变，已暂停。请查看新风格后重新开始制作。");
    if (completedSample(state.trials, page.id, fingerprint)) continue;
    onPage(page);
    const trial = await create(page.id, fingerprint);
    onTrial(trial);
    for (;;) {
      if (stopped()) return;
      await wait();
      if (stopped()) return;
      const current = await read();
      if (stopped()) return;
      if (current.fingerprint !== fingerprint)
        throw new Error("正式风格已改变，已暂停。当前页完成后可单独查看。");
      const result = current.trials.find((item) => item.id === trial.id);
      if (!result)
        throw new Error("无法确认当前页的生成结果，已暂停，请刷新检查。");
      onTrial(result);
      if (result.status === "completed" && result.image) break;
      if (!["queued", "running"].includes(result.status))
        throw new Error(
          `第 ${page.number} 页未完成，已暂停。${result.error || "请检查这一页后再继续。"}`,
        );
    }
  }
}
