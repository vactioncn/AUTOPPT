import type { BuildInfo } from "../shared/diagnostics.mjs";
export const sourceRoot: string;
export function createBuildInfo(options?: {
  root?: string;
  env?: NodeJS.ProcessEnv;
  release?: boolean;
}): BuildInfo;
export function readBuildInfo(root?: string): BuildInfo;
