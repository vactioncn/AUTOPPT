import { userError } from "../shared/user-error.mjs";
import { failureAdvice } from "../shared/job-feedback.mjs";
import type { Job } from "./types";

export function JobFeedback({ job }: { job: Job }) {
  const progress = job.pageProgress;
  const running = ["running", "queued"].includes(job.status);
  const issues = progress?.failed.length
    ? progress.failed
    : job.failures?.length
      ? job.failures
      : job.error && job.status === "failed"
        ? [{ page: 0, id: job.id, error: job.error }]
        : [];
  return (
    <div className="job-feedback">
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
          {job.autoRetry.reason || "模型连接中断"}，等待 {job.autoRetry.seconds}{" "}
          秒后自动重试 · 第 {job.autoRetry.attempt} / {job.autoRetry.maxRetries}{" "}
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
            {progress
              ? "可恢复的临时故障会先自动重试；此处仅列出仍未完成的页面。处理后点击继续，仅补做未完成页面。"
              : "任务不会自动重新提交；处理后点击继续重试。"}
          </p>
          <ul>
            {issues.map((issue) => {
              const advice = failureAdvice(issue.error);
              return (
                <li key={issue.id}>
                  <strong>
                    {issue.page ? `原第 ${issue.page} 页 · ` : ""}
                    {advice.reason}
                  </strong>
                  <p>{advice.action}</p>
                  <details>
                    <summary>具体错误</summary>
                    <p className="job-raw-error">{userError(issue.error)}</p>
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
