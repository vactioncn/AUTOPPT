import { useEffect, useRef, useState } from "react";
import { api, post } from "./api";
import { Button, Field, Modal } from "./components";
import type { Narration } from "./speech-types";
import {
  presenterVideo,
  type PresenterGeneration as Generation,
} from "./presenter-types";

export function PresenterGeneration({
  projectId,
  narrationId,
  enabled,
  onSpeech,
}: {
  projectId: string;
  narrationId: string;
  enabled: boolean;
  onSpeech: () => void;
}) {
  const endpoint = `/projects/${encodeURIComponent(projectId)}/presenter/generations`;
  const [narration, setNarration] = useState<Narration | null>(null);
  const [jobs, setJobs] = useState<Generation[]>([]);
  const [pageId, setPageId] = useState("");
  const [confirmation, setConfirmation] = useState<{
    scope: "page" | "all";
    jobId?: string;
  } | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const lock = useRef(false);
  const request = useRef<{
    requestId: string;
    scope: "page" | "all";
    pageId?: string;
  } | null>(null);
  useEffect(() => {
    let stopped = false;
    setNarration(null);
    if (narrationId)
      api<Narration>(`/narration/${encodeURIComponent(narrationId)}`)
        .then((n) => {
          if (!stopped) {
            setNarration(n);
            setPageId(n.pages.find((p) => p.clips.length)?.id || "");
          }
        })
        .catch((e) => {
          if (!stopped) setError(e.message);
        });
    return () => {
      stopped = true;
    };
  }, [narrationId]);
  useEffect(() => {
    let stopped = false,
      timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const data = await api<Generation[]>(endpoint);
        if (!stopped) setJobs(data);
      } catch (e) {
        if (!stopped) setError((e as Error).message);
      }
      if (!stopped) timer = setTimeout(poll, 2000);
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [endpoint]);
  const active = jobs.some((j) => ["queued", "running"].includes(j.status));
  const selectedPages =
    narration?.pages.filter(
      (p) => confirmation?.scope === "all" || p.id === pageId,
    ) || [];
  const clips = selectedPages.flatMap((p) => p.clips);
  const seconds = Math.ceil(clips.reduce((n, c) => n + (c.duration || 0), 0));
  async function submit() {
    if (lock.current || !confirmation) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      let job: Generation;
      if (confirmation.jobId)
        job = await post(endpoint + "/" + confirmation.jobId + "/resume", {
          confirmed: true,
        });
      else {
        if (
          request.current &&
          (request.current.scope !== confirmation.scope ||
            request.current.pageId !==
              (confirmation.scope === "page" ? pageId : undefined))
        )
          throw new Error(
            "上一次提交结果尚未确认，请先按上次的生成范围重试，或继续查询已有任务。",
          );
        request.current ||= {
          requestId: crypto.randomUUID(),
          scope: confirmation.scope,
          ...(confirmation.scope === "page" ? { pageId } : {}),
        };
        job = await post(endpoint, { ...request.current, confirmed: true });
        request.current = null;
      }
      setJobs((before) => [job, ...before.filter((j) => j.id !== job.id)]);
      setConfirmation(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="presenter-generation" aria-label="生成数字人口型">
      <h4>生成数字人口型</h4>
      <p>
        先生成一页试听，再生成整场。嘴型匹配所选的现成口播音频；画面、声音和节奏沿用原版本。
      </p>
      <Field label="先试哪一页">
        <select
          value={pageId}
          onChange={(e) => setPageId(e.target.value)}
          disabled={busy || active || !narration}
        >
          {!narration && <option value="">请先选择已完成口播</option>}
          {narration?.pages
            .filter((p) => p.clips.length)
            .map((p) => (
              <option key={p.id} value={p.id}>
                第 {p.number} 页 · {p.title}
              </option>
            ))}
        </select>
      </Field>
      <div className="project-presenter-actions">
        <Button
          variant="primary"
          disabled={!enabled || !pageId || active || busy}
          onClick={() => {
            setError("");
            setConfirmation({ scope: "page" });
          }}
        >
          生成本页数字人口型
        </Button>
        <Button
          disabled={!enabled || !pageId || active || busy}
          onClick={() => {
            setError("");
            setConfirmation({ scope: "all" });
          }}
        >
          生成整场数字人讲解
        </Button>
      </div>
      {!enabled && (
        <p>
          请先保存可用的头像、口播版本及项目配置，并在设置中保存 HeyGen Key。
        </p>
      )}
      <p>
        照片和所选音频在确认生成后才上传到 HeyGen。HeyGen
        按音频时长计费，金额以账号账单为准。整场生成会复用素材一致的已完成片段。
      </p>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {jobs.map((j) => {
        const allClips = j.pages.flatMap((p) => p.clips);
        const ready = allClips.filter((c) => c.status === "ready" && c.file);
        return (
          <article key={j.id} className="presenter-generation-job">
            <strong>
              {j.scope === "all" ? "整场数字人" : "单页数字人"} · {ready.length}
              /{allClips.length} 片段已完成
            </strong>
            <p role="status">{j.message || "正在准备"}</p>
            {!j.compatible && (
              <p className="journey-warning">
                页面、头像或口播已改变，此版本保留供预览，当前播放器不会使用。
              </p>
            )}
            {["queued", "running"].includes(j.status) ? (
              <Button
                disabled={busy}
                onClick={async () => {
                  try {
                    await post(endpoint + "/" + j.id + "/stop");
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                停止后续生成
              </Button>
            ) : (
              j.status !== "ready" && (
                <Button
                  disabled={busy || active || !j.compatible}
                  onClick={() => {
                    setError("");
                    setConfirmation({ scope: j.scope, jobId: j.id });
                  }}
                >
                  继续查询或下载
                </Button>
              )
            )}
            {!!ready.length && (
              <details>
                <summary>预览已完成视频</summary>
                {j.pages.map((p) =>
                  p.clips
                    .filter((c) => c.file)
                    .map((c) => (
                      <figure key={p.id + ":" + c.index}>
                        <figcaption>
                          {p.title} · 片段 {c.index + 1}
                        </figcaption>
                        <video
                          controls
                          preload="none"
                          src={presenterVideo(c.file!)}
                          aria-label={p.title + "数字人口型预览"}
                        />
                      </figure>
                    )),
                )}
              </details>
            )}
            {!!ready.length && j.compatible && (
              <Button
                onClick={(e) => {
                  e.currentTarget
                    .closest("article")
                    ?.querySelectorAll("video")
                    .forEach((v) => v.pause());
                  onSpeech();
                }}
              >
                打开演讲播放器
              </Button>
            )}
          </article>
        );
      })}
      {confirmation && (
        <Modal
          title={confirmation.jobId ? "继续数字人任务" : "确认生成数字人口型"}
          onClose={() => {
            if (!busy) setConfirmation(null);
          }}
        >
          {confirmation.jobId ? (
            <p>
              继续查询已经提交的视频，并处理尚未提交的片段。已有视频不会重新生成；尚未提交的片段可能产生新费用。超过安全重试时限的未知提交会被拦截。
            </p>
          ) : (
            <p>
              将生成{confirmation.scope === "all" ? "整场" : "所选一页"}，共{" "}
              {clips.length} 个口播片段、约 {seconds} 秒（
              {Math.ceil(seconds / 60)} 分钟）。已完成且素材一致的片段会复用。
            </p>
          )}
          <p>
            确认后会将头像照片和所选口播音频发送至
            HeyGen。请使用你有权使用的照片和声音。HeyGen
            按音频时长计费，具体金额以账号账单为准。
          </p>
          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
          <div className="project-presenter-actions">
            <Button disabled={busy} onClick={() => setConfirmation(null)}>
              取消
            </Button>
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => void submit()}
            >
              {busy ? "正在提交…" : "确认并开始生成"}
            </Button>
          </div>
        </Modal>
      )}
    </section>
  );
}
