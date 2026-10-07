// Increment when bootstrap/API contracts become incompatible. Equality is the
// compatibility policy until a negotiated schema range is introduced.
export const API_SCHEMA_VERSION = 1;
export const runtimeLabels = {
  "local-browser": "本机浏览器",
  desktop: "Mac App",
  hosted: "托管服务",
};
export const dataRootLabels = {
  "local-browser": "本机浏览器工作区",
  desktop: "Mac App 独立工作区",
  hosted: "hosted 账号工作区",
};
export const capabilityLabels = {
  projectPackages: "项目源文件导入导出",
  bundleExport: "PPTX + 逐字稿",
  standardPresentation: "标准放映",
  aiNarration: "AI 口播生成",
  motionPresentation: "动态演示",
  localModelSettings: "本机模型设置",
  adminModelSettings: "管理员模型设置",
};
export const knownSha = (value) => /^[a-f0-9]{40}$/i.test(value || "");

export function compareBuildInfo(frontend, backend, production = true) {
  if (!backend || backend.apiSchemaVersion !== frontend.apiSchemaVersion)
    return {
      status: "incompatible",
      blocked: true,
      message:
        "前后端接口版本不兼容，已暂停进入工作台。请刷新页面；若仍未恢复，请更新 App 或请管理员部署同一发布的前后端。已保存内容不受影响。",
    };
  if (
    knownSha(frontend.gitSha) &&
    knownSha(backend.gitSha) &&
    frontend.gitSha.toLowerCase() !== backend.gitSha.toLowerCase()
  )
    return {
      status: "mismatch",
      blocked: production,
      message: production
        ? "前后端来自不同发布，已暂停进入工作台。请刷新页面；若仍未恢复，请更新 App 或请管理员完整部署同一发布。已保存内容不受影响。"
        : "开发环境前后端提交不同，请核对开发服务与页面；热更新仍可继续使用。",
    };
  if (!knownSha(frontend.gitSha) || !knownSha(backend.gitSha))
    return {
      status: "unknown",
      blocked: false,
      message: "提交信息为 unknown，无法核对前后端发布；接口版本兼容。",
    };
  return {
    status: "matched",
    blocked: false,
    message: "前后端提交一致，接口版本兼容。",
  };
}
