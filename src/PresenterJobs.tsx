import { useEffect, useRef, useState } from "react";
import { api, post } from "./api";
import { Button, Modal } from "./components";
import {
  presenterActive,
  presenterVideo,
  type PresenterGeneration,
} from "./presenter-types";
export function usePresenterJobs(endpoint: string) {
  const [jobs, setJobs] = useState<PresenterGeneration[]>([]),
    [error, setError] = useState("");
  useEffect(() => {
    let alive = true,
      timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const data = await api<PresenterGeneration[]>(endpoint);
        if (alive) {
          setJobs(data);
          setError("");
        }
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
      if (alive) timer = setTimeout(poll, 3000);
    };
    void poll();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [endpoint]);
  return { jobs, error, setJobs, active: jobs.some(presenterActive) };
}
export function PresenterJobs({
  jobs,
  endpoint,
  onUpdate,
  onPlay,
  preview = false,
}: {
  jobs: PresenterGeneration[];
  endpoint: string;
  onUpdate: (j: PresenterGeneration) => void;
  onPlay?: (j: PresenterGeneration) => void;
  preview?: boolean;
}) {
  const [resume, setResume] = useState<PresenterGeneration | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const lock = useRef(false);
  async function act(job: PresenterGeneration, action: "resume" | "stop") {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const data = await post(endpoint + "/" + job.id + "/" + action, {
        confirmed: true,
      });
      if (action === "resume") onUpdate(data);
      setResume(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <div
      className="presenter-jobs"
      aria-label={preview ? "试播记录" : "讲解生成记录"}
    >
      {jobs.slice(0, 8).map((job) => {
        const clips = job.pages.flatMap((p) => p.clips),
          ready = clips.filter((c) => c.file),
          running = presenterActive(job);
        return (
          <article key={job.id} className="presenter-job">
            <div className="presenter-job-heading">
              <strong>
                {job.avatarName || "数字人"} ·{" "}
                {job.scope === "all"
                  ? "整场讲解"
                  : preview
                    ? "文字试播"
                    : job.pages[0]?.title}
              </strong>
              <span>{new Date(job.createdAt).toLocaleString("zh-CN")}</span>
            </div>
            <p role={running ? "status" : undefined}>
              {job.status === "ready"
                ? `已完成 · ${ready.length} 段 · ${Math.round(ready.reduce((n, c) => n + c.duration, 0))} 秒`
                : job.message || "等待生成"}
            </p>
            {running && (
              <progress
                max={Math.max(clips.length, 1)}
                value={ready.length}
                aria-label="生成进度"
              />
            )}
            {preview && ready[0]?.file && (
              <>
                <video
                  controls
                  playsInline
                  preload="metadata"
                  src={presenterVideo(ready[0].file)}
                  aria-label="数字人试播视频"
                />
                <p className="presenter-script">{ready[0].text}</p>
              </>
            )}
            {!preview && !!ready.length && (
              <Button disabled={!job.compatible} onClick={() => onPlay?.(job)}>
                播放讲解{job.status !== "ready" ? "（已完成部分）" : ""}
              </Button>
            )}
            {!job.compatible && (
              <p>页面或数字人已改变。原视频仍保留，请按当前配置重新生成。</p>
            )}
            {running && (
              <Button disabled={busy} onClick={() => void act(job, "stop")}>
                停止后续生成
              </Button>
            )}
            {!running && job.status !== "ready" && (
              <Button
                disabled={busy || !job.compatible || jobs.some(presenterActive)}
                onClick={() => setResume(job)}
              >
                继续查询或下载
              </Button>
            )}
          </article>
        );
      })}
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      {resume && (
        <Modal title="继续这个任务" onClose={() => !busy && setResume(null)}>
          <p>
            已提交的片段只查询和下载；尚未提交的片段会继续生成并按 HeyGen API
            规则计费。
          </p>
          <Button
            variant="primary"
            loading={busy}
            onClick={() => void act(resume, "resume")}
          >
            确认继续
          </Button>
        </Modal>
      )}
    </div>
  );
}
