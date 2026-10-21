import type { SampleProgress } from "./types";
import "./style-publishing.css";

export function StyleSampleProgress({
  progress: p,
}: {
  progress: SampleProgress;
}) {
  const making = ["queued", "running"].includes(p.currentStatus || "");
  const page = p.currentPage
    ? `第 ${p.currentPage.number} 张 · ${p.currentPage.type}`
    : "";
  const state =
    p.status === "failed"
      ? "补齐失败"
      : p.status === "paused"
        ? "已暂停"
        : p.done === p.total
          ? "样例已齐"
          : p.background
            ? "后台补齐中"
            : making
              ? "正在制作"
              : "待补齐";
  return (
    <div
      className={`sample-progress sample-progress-${p.status}`}
      aria-live="polite"
    >
      <div className="sample-progress-heading">
        <strong>
          样例 {p.done} / {p.total} 张
        </strong>
        <span>{state}</span>
      </div>
      <progress aria-label="已完成样例" value={p.done} max={p.total} />
      {(making || p.background) && (
        <p>
          {making
            ? `${page} · ${p.stage || "正在生成"}`
            : "正在检查缺页，准备下一张…"}
          {p.status === "paused" && "（完成当前张后暂停）"}
        </p>
      )}
      {p.error && (
        <p className="error-text">
          {page && `${page}：`}
          {p.error}
        </p>
      )}
      {p.status === "paused" && !making && !p.error && p.done < p.total && (
        <p>已完成图片保留，可继续补齐缺页。</p>
      )}
    </div>
  );
}
