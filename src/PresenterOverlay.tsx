import { useEffect, useRef, useState, type RefObject } from "react";
import { api } from "./api";
import { presenterVideo, type PresenterGeneration } from "./presenter-types";
import "./presenter-playback.css";

export function PresenterOverlay({
  projectId,
  narrationId,
  pageId,
  clipIndex,
  audio,
  enabled,
  onAvailable,
}: {
  projectId: string;
  narrationId: string;
  pageId: string;
  clipIndex: number;
  audio: RefObject<HTMLAudioElement | null>;
  enabled: boolean;
  onAvailable: (value: boolean) => void;
}) {
  const [jobs, setJobs] = useState<PresenterGeneration[]>([]);
  const [setup, setSetup] = useState<{
    avatarId: string;
    narrationId: string;
    placement: string;
    size: string;
  } | null>(null);
  const [failed, setFailed] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    let stopped = false;
    setJobs([]);
    setSetup(null);
    Promise.all([
      api<PresenterGeneration[]>(
        `/projects/${encodeURIComponent(projectId)}/presenter/generations`,
      ),
      api<{ setup: NonNullable<typeof setup> }>(
        `/projects/${encodeURIComponent(projectId)}/presenter/setup`,
      ),
    ])
      .then(([data, config]) => {
        if (!stopped) {
          setJobs(data);
          setSetup(config.setup);
        }
      })
      .catch(() => {
        /* Optional local enhancement: narration remains playable when unavailable. */
      });
    return () => {
      stopped = true;
    };
  }, [projectId, narrationId]);
  const valid = jobs.filter(
    (j) =>
      j.compatible &&
      j.narrationId === narrationId &&
      j.avatarId === setup?.avatarId,
  );
  const match = valid
    .map((j) => ({
      j,
      clip: j.pages
        .find((p) => p.id === pageId)
        ?.clips.find(
          (c) => c.index === clipIndex && c.status === "ready" && c.file,
        ),
    }))
    .find((v) => v.clip);
  const file = enabled ? match?.clip?.file : undefined;
  const available = valid.some((j) =>
    j.pages.some((p) => p.clips.some((c) => c.status === "ready" && c.file)),
  );
  useEffect(() => {
    onAvailable(available);
  }, [available, onAvailable]);
  useEffect(() => {
    setFailed(false);
    const a = audio.current,
      v = video.current;
    if (!a || !v || !file) return;
    let frame = 0,
      disposed = false;
    const sync = () => {
      if (disposed) return;
      v.muted = true;
      v.playbackRate = a.playbackRate;
      if (v.readyState >= 1 && Number.isFinite(v.duration)) {
        const target = Math.min(a.currentTime, Math.max(0, v.duration - 0.03));
        if (Math.abs(v.currentTime - target) > 0.15) v.currentTime = target;
      }
      if (a.paused || a.ended || a.readyState < 3) v.pause();
      else if (v.paused)
        void v.play().catch((e: DOMException) => {
          if (!disposed && e.name !== "AbortError") setFailed(true);
        });
    };
    const tick = () => {
      sync();
      frame = requestAnimationFrame(tick);
    };
    const events = [
      "play",
      "pause",
      "playing",
      "waiting",
      "seeking",
      "seeked",
      "timeupdate",
      "ratechange",
      "ended",
      "emptied",
    ];
    events.forEach((e) => a.addEventListener(e, sync));
    v.addEventListener("loadedmetadata", sync);
    frame = requestAnimationFrame(tick);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      v.pause();
      events.forEach((e) => a.removeEventListener(e, sync));
      v.removeEventListener("loadedmetadata", sync);
    };
  }, [file, audio]);
  if (!file) return null;
  return (
    <div
      className="presenter-overlay"
      data-placement={setup?.placement || match?.j.placement}
      data-size={setup?.size || match?.j.size}
    >
      <video
        ref={video}
        src={presenterVideo(file)}
        muted
        playsInline
        preload="auto"
        aria-label="同步数字人讲解"
        onError={() => setFailed(true)}
      />
      {failed && (
        <span role="status">
          数字人视频读取失败，普通口播继续。请重新打开播放器重读。
        </span>
      )}
    </div>
  );
}
