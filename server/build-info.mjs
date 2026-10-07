import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import {
  API_SCHEMA_VERSION,
  knownSha,
  runtimeLabels,
} from "../shared/diagnostics.mjs";

export const sourceRoot = path.resolve(import.meta.dirname, "..");
export function createBuildInfo({
  root = sourceRoot,
  env = process.env,
  release = false,
} = {}) {
  let gitSha = env.AUTOPPT_BUILD_GIT_SHA;
  if (!gitSha) {
    try {
      if (!existsSync(path.join(root, ".git")))
        throw new Error("No source repository");
      gitSha = execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {
      gitSha = "unknown";
    }
  }
  if (!knownSha(gitSha)) {
    if (release)
      throw new Error(
        "发布构建需要完整 Git SHA；无 Git 的构建目录请设置 AUTOPPT_BUILD_GIT_SHA。",
      );
    gitSha = "unknown";
  }
  const runtimeMode = env.AUTOPPT_RUNTIME_MODE || "local-browser";
  if (!Object.hasOwn(runtimeLabels, runtimeMode))
    throw new Error("构建运行形态无效。");
  const buildTime = env.AUTOPPT_BUILD_TIME || new Date().toISOString();
  if (!Number.isFinite(Date.parse(buildTime)))
    throw new Error("构建时间无效。");
  return {
    appVersion: JSON.parse(
      readFileSync(path.join(root, "package.json"), "utf8"),
    ).version,
    gitSha,
    buildTime: new Date(buildTime).toISOString(),
    apiSchemaVersion: API_SCHEMA_VERSION,
    runtimeMode,
  };
}

// Production must never consult runtime HEAD, cwd or environment overrides.
// This separate server copy also detects an old backend paired with new dist/.
export function readBuildInfo(root = sourceRoot) {
  let info;
  try {
    info = JSON.parse(readFileSync(path.join(root, "build-info.json"), "utf8"));
  } catch {
    throw new Error("构建版本信息缺失，请重新构建并完整部署 AutoPPT。");
  }
  if (
    !info ||
    !knownSha(info.gitSha) ||
    !/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(info.appVersion) ||
    !Number.isFinite(Date.parse(info.buildTime)) ||
    info.apiSchemaVersion !== API_SCHEMA_VERSION ||
    !Object.hasOwn(runtimeLabels, info.runtimeMode)
  )
    throw new Error("构建版本信息无效，请重新构建并完整部署 AutoPPT。");
  // Only public, validated fields leave this boundary.
  return Object.fromEntries(
    [
      "appVersion",
      "gitSha",
      "buildTime",
      "apiSchemaVersion",
      "runtimeMode",
    ].map((k) => [k, info[k]]),
  );
}
