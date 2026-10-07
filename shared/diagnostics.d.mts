export type RuntimeMode = "local-browser" | "desktop" | "hosted";
export type BuildInfo = {
  appVersion: string;
  gitSha: string;
  buildTime: string;
  apiSchemaVersion: number;
  runtimeMode: RuntimeMode;
};
export type Capability = { enabled: boolean; reason?: string };
export type CapabilityId =
  | "projectPackages"
  | "bundleExport"
  | "standardPresentation"
  | "aiNarration"
  | "motionPresentation"
  | "localModelSettings"
  | "adminModelSettings";
export type Capabilities = Record<CapabilityId, Capability>;
export type BuildComparison = {
  status: "incompatible" | "mismatch" | "unknown" | "matched";
  blocked: boolean;
  message: string;
};
export const API_SCHEMA_VERSION: number;
export const runtimeLabels: Record<RuntimeMode, string>;
export const dataRootLabels: Record<RuntimeMode, string>;
export const capabilityLabels: Record<CapabilityId, string>;
export function knownSha(value: unknown): boolean;
export function compareBuildInfo(
  frontend: BuildInfo,
  backend: BuildInfo | undefined,
  production?: boolean,
): BuildComparison;
