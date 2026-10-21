import { BRAND } from "../shared/brand.mjs";
import { buildLabel } from "../shared/diagnostics.mjs";
import { frontendBuildInfo } from "./diagnostics";

const build = buildLabel(frontendBuildInfo);

export function BrandLockup({
  compact = false,
  showVersion = false,
}: {
  compact?: boolean;
  showVersion?: boolean;
}) {
  return (
    <span className="jianghao-lockup">
      <img src="/brand/mark.svg" width="40" height="40" alt="" />
      <span className="jianghao-wordmark">{BRAND.name}</span>
      {!compact && (
        <span className="jianghao-descriptor">{BRAND.descriptor}</span>
      )}
      {showVersion && (
        <span
          className="jianghao-build"
          title={`当前页面版本：${build.version} · ${frontendBuildInfo.gitSha}\n构建更新时间：${build.date} ${build.time}（北京时间）`}
        >
          <span className="jianghao-build-version">
            <span>{build.version}</span>
            <span>{build.revision}</span>
          </span>
          <time dateTime={build.dateTime}>
            <span>更新 {build.date}</span>
            <span>{build.time}</span>
          </time>
        </span>
      )}
    </span>
  );
}
