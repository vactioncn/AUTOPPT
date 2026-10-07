import type { Bootstrap } from "./types";
import type {
  BuildInfo,
  Capabilities,
  CapabilityId,
} from "../shared/diagnostics.mjs";

declare const __AUTOPPT_BUILD_INFO__: BuildInfo;
export const frontendBuildInfo = __AUTOPPT_BUILD_INFO__;
export const productionBuild = import.meta.env.PROD;

// One compatibility adapter for servers using the old feature flags. New
// components consume capabilities and never infer platform policy themselves.
export function resolveCapabilities(data: Bootstrap): Capabilities {
  const aliases = {
    projectPackages: "projectPackages",
    bundleExport: "insertAndManuscriptExport",
    standardPresentation: "speechPresentation",
    aiNarration: "speechPresentation",
    motionPresentation: "motionPresentation",
  } as const;
  return Object.fromEntries(
    (
      [
        ...Object.keys(aliases),
        "localModelSettings",
        "adminModelSettings",
      ] as CapabilityId[]
    ).map((id) => {
      if (data.capabilities?.[id]) return [id, data.capabilities[id]];
      const enabled =
        id in aliases
          ? !!data.features?.[aliases[id as keyof typeof aliases]]
          : id === "localModelSettings" &&
            data.buildInfo?.runtimeMode !== "hosted";
      return [
        id,
        enabled
          ? { enabled }
          : {
              enabled,
              reason: "当前服务未声明此能力，请更新服务或联系管理员。",
            },
      ];
    }),
  ) as Capabilities;
}
