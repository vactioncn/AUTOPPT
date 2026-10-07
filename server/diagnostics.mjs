import { dataRootLabels } from "../shared/diagnostics.mjs";

export function runtimeMode(env = process.env) {
  return env.AUTOPPT_WORKER_TOKEN
    ? "hosted"
    : env.AUTOPPT_DESKTOP_TOKEN
      ? "desktop"
      : "local-browser";
}
export function diagnostics(
  buildInfo,
  { mode = runtimeMode(), speechReady = false } = {},
) {
  const hosted = mode === "hosted";
  const speechReason =
    "当前托管服务未开放演讲播放器与语音功能；模型与服务由管理员管理。";
  const capability = (enabled, reason) =>
    enabled ? { enabled: true } : { enabled: false, reason };
  return {
    buildInfo: { ...buildInfo, runtimeMode: mode },
    dataRootLabel: dataRootLabels[mode],
    capabilities: {
      projectPackages: capability(true),
      bundleExport: capability(true),
      standardPresentation: capability(!hosted, speechReason),
      aiNarration: capability(
        !hosted && speechReady,
        hosted
          ? speechReason
          : "尚未配置语音服务，AI 口播生成不可用；仍可打开播放器手动翻页。",
      ),
      motionPresentation: capability(true),
      localModelSettings: capability(
        !hosted,
        "托管版的模型由管理员统一配置；当前账号不能修改本机模型设置。",
      ),
      adminModelSettings: capability(
        hosted,
        "本机模型由你在“模型与服务”中配置，无需托管管理员。",
      ),
    },
    // Keep the existing contract, including keys not yet in the capability matrix.
    features: {
      styleUrlImport: true,
      unifiedStyleCover: true,
      directStylePrompt: true,
      designOptions: true,
      insertAndManuscriptExport: true,
      motionPresentation: true,
      speechPresentation: !hosted,
      projectPackages: true,
      spokenHtml: true,
    },
  };
}
