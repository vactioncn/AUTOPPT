import { useEffect, useId, useRef, useState } from "react";
import { ArrowRight, Pause, Play } from "@phosphor-icons/react";
import "./narration-example.css";

type NarrationManifest = {
  title: string;
  speaker: string;
  project: string;
  excerpt: string;
  durationSeconds?: number;
  disclosure?: string;
};

function timeLabel(seconds: number) {
  const total = Math.max(0, Math.floor(seconds || 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function NarrationExample() {
  const figure = useRef<HTMLElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const playAttempt = useRef(0);
  const detailsId = useId();
  const [revealed, setRevealed] = useState(false);
  const [manifest, setManifest] = useState<NarrationManifest | null>(null);
  const [manifestError, setManifestError] = useState("");
  const [retry, setRetry] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [audioError, setAudioError] = useState("");
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    if (!figure.current || !("IntersectionObserver" in window)) {
      setRevealed(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setRevealed(true);
          observer.disconnect();
        }
      },
      { rootMargin: "160px 0px" },
    );
    observer.observe(figure.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!revealed) return;
    const controller = new AbortController();
    setManifestError("");
    void fetch("/narration-demo/manifest.json", {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("case unavailable");
        const value = await response.json();
        if (
          !value ||
          !["title", "speaker", "project", "excerpt"].every(
            (key) => typeof value[key] === "string" && value[key].trim(),
          )
        )
          throw new Error("case incomplete");
        if (!controller.signal.aborted) setManifest(value);
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setManifestError("案例暂时无法加载，请重试。");
      });
    return () => controller.abort();
  }, [revealed, retry]);

  async function togglePlayback() {
    const media = audio.current;
    if (!media) return;
    const attempt = ++playAttempt.current;
    if (!media.paused) {
      media.pause();
      return;
    }
    setAudioError("");
    setWaiting(true);
    if (media.error) media.load();
    try {
      await media.play();
    } catch {
      if (attempt !== playAttempt.current) return;
      setWaiting(false);
      setAudioError("声音暂时无法播放，请重试，或打开音频试听。");
    }
  }

  const total =
    duration ||
    (Number.isFinite(manifest?.durationSeconds)
      ? Math.max(0, manifest?.durationSeconds || 0)
      : 0);

  return (
    <figure
      ref={figure}
      className="narration-example"
      data-revealed={revealed}
      aria-label="Amanda 的朝花夕拾有声讲述案例"
    >
      <img
        className="narration-example-page"
        src="/narration-demo/page.webp"
        width="1600"
        height="900"
        loading="lazy"
        alt={
          manifest
            ? `《${manifest.project}》实际演讲页面：${manifest.title}`
            : "《朝花夕拾》实际演讲页面"
        }
      />
      <figcaption>
        <div className="narration-example-speaker">
          <img
            className="narration-example-avatar"
            src="/narration-demo/avatar.webp"
            alt="Amanda 的小女孩插画头像"
            width="64"
            height="64"
            loading="lazy"
          />
          <div>
            <h3>{manifest?.title || "听 Amanda 讲《朝花夕拾》"}</h3>
            <p>
              {manifest?.speaker || "Amanda"} · 《
              {manifest?.project || "朝花夕拾"}》
            </p>
          </div>
        </div>
        {!revealed && (
          <button
            type="button"
            className="narration-example-reveal"
            onClick={() => setRevealed(true)}
            aria-expanded={false}
            aria-controls={detailsId}
          >
            查看这段有声讲述 <ArrowRight size={16} aria-hidden="true" />
          </button>
        )}
        {revealed && (
          <div id={detailsId} className="narration-example-details">
            {manifestError ? (
              <div className="narration-example-error" role="alert">
                <p>{manifestError}</p>
                <button type="button" onClick={() => setRetry(retry + 1)}>
                  重试加载
                </button>
              </div>
            ) : !manifest ? (
              <p className="narration-example-loading" role="status">
                正在准备这段讲述…
              </p>
            ) : (
              <>
                <p className="narration-example-excerpt">{manifest.excerpt}</p>
                {manifest.disclosure && (
                  <p className="narration-example-disclosure">
                    {manifest.disclosure}
                  </p>
                )}
                <div className="narration-example-player">
                  <button
                    type="button"
                    className="narration-example-play"
                    onClick={() => void togglePlayback()}
                    aria-label={
                      playing
                        ? `暂停 ${manifest.speaker} 的讲述`
                        : `播放 ${manifest.speaker} 的讲述`
                    }
                  >
                    {playing ? (
                      <Pause size={20} weight="fill" aria-hidden="true" />
                    ) : (
                      <Play size={20} weight="fill" aria-hidden="true" />
                    )}
                    {playing ? "暂停" : "听这一页"}
                  </button>
                  <div className="narration-example-progress">
                    <input
                      type="range"
                      min="0"
                      max={total || 1}
                      step="0.1"
                      value={Math.min(position, total || 1)}
                      aria-label="Amanda 讲述播放进度"
                      aria-valuetext={`${timeLabel(position)}，共 ${timeLabel(total)}`}
                      disabled={!duration}
                      onChange={(event) => {
                        const seconds = Number(event.target.value);
                        if (audio.current) audio.current.currentTime = seconds;
                        setPosition(seconds);
                      }}
                    />
                    <div className="narration-example-time" aria-hidden="true">
                      <span>{timeLabel(position)}</span>
                      <span>{timeLabel(total)}</span>
                    </div>
                  </div>
                </div>
                <audio
                  ref={audio}
                  src="/narration-demo/story.mp3"
                  preload="metadata"
                  aria-label={`${manifest.speaker} 讲述《${manifest.project}》：${manifest.title}`}
                  onPlay={() => {
                    audio.current
                      ?.closest(".web-site")
                      ?.querySelectorAll<HTMLMediaElement>("audio, video")
                      .forEach((media) => {
                        if (media !== audio.current && !media.paused)
                          media.pause();
                      });
                    setPlaying(true);
                    setAudioError("");
                  }}
                  onPlaying={() => setWaiting(false)}
                  onPause={() => {
                    playAttempt.current++;
                    setPlaying(false);
                    setWaiting(false);
                  }}
                  onEnded={() => {
                    setPlaying(false);
                    setWaiting(false);
                  }}
                  onWaiting={() => setWaiting(true)}
                  onTimeUpdate={() =>
                    setPosition(audio.current?.currentTime || 0)
                  }
                  onLoadedMetadata={() => {
                    if (Number.isFinite(audio.current?.duration))
                      setDuration(audio.current?.duration || 0);
                  }}
                  onError={() => {
                    setPlaying(false);
                    setWaiting(false);
                    setAudioError("声音暂时无法加载，请重试，或打开音频试听。");
                  }}
                />
                {waiting && (
                  <p className="narration-example-loading" role="status">
                    正在加载声音…
                  </p>
                )}
                {audioError && (
                  <p className="narration-example-error" role="alert">
                    {audioError}{" "}
                    <a href="/narration-demo/story.mp3">打开音频</a>
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </figcaption>
    </figure>
  );
}
