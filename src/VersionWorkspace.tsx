import type { Bootstrap } from "./types";
import type { BuildInfo, CapabilityId } from "../shared/diagnostics.mjs";
import {
  capabilityLabels,
  compareBuildInfo,
  knownSha,
  runtimeLabels,
} from "../shared/diagnostics.mjs";
import {
  frontendBuildInfo,
  productionBuild,
  resolveCapabilities,
} from "./diagnostics";
import { Button } from "./components";
import "./diagnostics.css";

function BuildDetails({ title, info }: { title: string; info?: BuildInfo }) {
  const version = /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(info?.appVersion || "")
    ? info!.appVersion
    : "unknown";
  const time =
    info && Number.isFinite(Date.parse(info.buildTime))
      ? new Date(info.buildTime).toLocaleString("zh-CN", { hour12: false })
      : "unknown";
  return (
    <div className="build-details">
      <h3>{title}</h3>
      <dl>
        <div>
          <dt>版本</dt>
          <dd>{version}</dd>
        </div>
        <div>
          <dt>提交</dt>
          <dd>
            <code title={knownSha(info?.gitSha) ? info!.gitSha : undefined}>
              {knownSha(info?.gitSha) ? info!.gitSha.slice(0, 12) : "unknown"}
            </code>
          </dd>
        </div>
        <div>
          <dt>构建时间</dt>
          <dd>{time}</dd>
        </div>
        <div>
          <dt>接口版本</dt>
          <dd>
            {Number.isInteger(info?.apiSchemaVersion)
              ? info!.apiSchemaVersion
              : "unknown"}
          </dd>
        </div>
      </dl>
    </div>
  );
}

export function VersionWorkspace({
  data,
  blocked = false,
}: {
  data: Bootstrap;
  blocked?: boolean;
}) {
  const comparison = compareBuildInfo(
    frontendBuildInfo,
    data.buildInfo,
    productionBuild,
  );
  const capabilities = resolveCapabilities(data);
  return (
    <section className="version-workspace" aria-label="版本与工作区">
      <div className="version-heading">
        <div>
          <h2>版本与工作区</h2>
          <p>核对当前发布、数据工作区与服务能力。</p>
        </div>
        <Button onClick={() => location.reload()}>刷新页面</Button>
      </div>
      <div
        className={`build-status build-status-${comparison.status}`}
        role={
          comparison.blocked || comparison.status === "mismatch"
            ? "alert"
            : "status"
        }
      >
        <strong>
          {comparison.blocked ? "需要更新或刷新" : "前后端一致性"}
        </strong>
        <p>{comparison.message}</p>
      </div>
      <div className="build-grid">
        <BuildDetails title="前端页面" info={frontendBuildInfo} />
        <BuildDetails title="后端服务" info={data.buildInfo} />
      </div>
      <div className="workspace-description">
        <h3>
          {data.buildInfo
            ? runtimeLabels[data.buildInfo.runtimeMode] || "运行形态待确认"
            : "运行形态待确认"}
        </h3>
        <p>{data.dataRootLabel || "工作区信息待服务更新后确认"}</p>
        <p className="detail-help">
          {data.buildInfo?.runtimeMode === "hosted"
            ? "内容保存在托管服务中属于当前账号的独立工作区，具体存储由管理员管理。"
            : data.buildInfo?.runtimeMode === "desktop"
              ? "内容保存在此 Mac App 的独立工作区。可通过 App 菜单“打开数据文件夹”查看；与本机浏览器工作区分开保存。"
              : data.buildInfo?.runtimeMode === "local-browser"
                ? "内容保存在本机服务的工作区中；浏览器用于访问，项目数据不会随浏览器缓存清理而删除。"
                : "请更新服务后核对实际工作区。"}
        </p>
      </div>
      {!blocked && (
        <div className="capability-matrix" role="table" aria-label="能力矩阵">
          <div role="row" className="capability-row capability-header">
            <span role="columnheader">能力</span>
            <span role="columnheader">状态与说明</span>
          </div>
          {(Object.keys(capabilityLabels) as CapabilityId[]).map((id) => (
            <div role="row" className="capability-row" key={id}>
              <span role="cell">{capabilityLabels[id]}</span>
              <span role="cell">
                <strong
                  className={
                    capabilities[id].enabled
                      ? "capability-on"
                      : "capability-off"
                  }
                >
                  {capabilities[id].enabled
                    ? id === "adminModelSettings"
                      ? "由管理员管理"
                      : "可用"
                    : "不可用"}
                </strong>
                {!capabilities[id].enabled && (
                  <span>{capabilities[id].reason}</span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
