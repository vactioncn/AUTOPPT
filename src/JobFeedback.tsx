import { useEffect, useState } from "react";
import {
  elapsedLabel,
  failureAdvice,
  retrySeconds,
} from "../shared/job-feedback.mjs";
import type { Job } from "./types";

export function JobFeedback({
  job,
  hosted = false,
}: {
  job: Job;
  hosted?: boolean;
}) {
  const progress = job.pageProgress;
  const running = ["running", "queued"].includes(job.status);
  const [clock, setClock] = useState(Date.now);
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running, job.id]);
  const issues = progress?.failed.length
    ? progress.failed
    : job.failures?.length
      ? job.failures
      : job.error && job.status === "failed"
        ? [{ page: 0, id: job.id, error: job.error, uncertain: job.uncertain }]
        : [];
  return (
    <div className="job-feedback">
      {running && (
        <p className="job-waiting" role="status">
          <strong>
            本次已等待{" "}
            {elapsedLabel(job.attemptStartedAt || job.createdAt, clock)}
          </strong>
          <span>
            {job.status === "queued"
              ? "排队后自动开始，可先处理其他内容。"
              : "后台继续制作，可以离开这一页；重新打开后可查看进度。"}
          </span>
        </p>
      )}
      {progress && (
        <p className="job-outcomes" role="status">
          <strong>本次 {progress.total} 页</strong>
          <span>已生成 {progress.succeeded}</span>
          <span className={progress.failed.length ? "job-failed-count" : ""}>
            失败 {progress.failed.length}
          </span>
          <span>
            待处理{" "}
            {Math.max(
              0,
              progress.total - progress.succeeded - progress.failed.length,
            )}
          </span>
          {!!progress.preserved && (
            <span>另有 {progress.preserved} 页已保存，本次跳过</span>
          )}
        </p>
      )}
      {job.autoRetry && (
        <p role="status" className="job-recovery">
          {job.autoRetry.reason || "模型连接中断"}，
          {retrySeconds(job.autoRetry, clock) > 0
            ? `等待 ${retrySeconds(job.autoRetry, clock)} 秒后自动重试`
            : "正在准备重试"}{" "}
          · 第 {job.autoRetry.attempt} / {job.autoRetry.maxRetries}{" "}
          次。无需点击继续。
        </p>
      )}
      {!!issues.length && (
        <details className="job-issues">
          <summary>
            {issues.some((p) => p.page)
              ? `${issues.length} 页未完成 · 查看原因与处理方式`
              : "查看原因与处理方式"}
          </summary>
          <p>
            {running
              ? "这些页面本轮已跳过，其他页面继续制作。"
              : "已完成的内容已保存。"}
            {job.uncertain
              ? "部分请求的生成结果需要先核对，再决定是否重新提交。"
              : progress
                ? "可恢复的临时故障会先自动重试；此处仅列出仍未完成的页面。处理后点击继续，仅补做未完成页面。"
                : "任务不会自动重新提交；处理后点击继续重试。"}
          </p>
          <ul>
            {issues.map((issue) => {
              const advice = failureAdvice(issue.error, {
                hosted,
                uncertain: issue.uncertain,
              });
              return (
                <li key={issue.id}>
                  <strong>
                    {issue.page ? `原第 ${issue.page} 页 · ` : ""}
                    {advice.reason}
                  </strong>
                  <p>{advice.action}</p>
                  <details>
                    <summary>具体错误</summary>
                    <p className="job-raw-error">{issue.error}</p>
                  </details>
                </li>
              );
            })}
          </ul>
        </details>
      )}
    </div>
  );
}
