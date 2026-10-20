import { useEffect, useRef, useState } from "react";
import { asset } from "./api";
import { Button, Modal } from "./components";
import { SceneView } from "./SceneView";
import { LayeredView } from "./LayeredView";
import { BackgroundMusicControls } from "./BackgroundMusicControls";
import { presenterVideo } from "./presenter-types";
import { speechAudio } from "./speech-types";
import { rehearsalPlaybackPieces } from "../shared/rehearsal-playback.mjs";
import type { Project } from "./types";
import type { RehearsalRun, RehearsalPlan } from "./rehearsal-types";
export function RehearsalPlayer({
  project,
  run,
  layout,
  onClose,
  autoStart = false,
}: {
  project: Project;
  run: RehearsalRun;
  layout?: RehearsalPlan;
  onClose: () => void;
  autoStart?: boolean;
}) {
  const [index, setIndex] = useState(0),
    [isPlaying, setIsPlaying] = useState(false),
    [ended, setEnded] = useState(false),
    [error, setError] = useState("");
  const audio = useRef<HTMLAudioElement>(null),
    video = useRef<HTMLVideoElement>(null);
  const continuePlayback = useRef(autoStart);
  const gap = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearGap = () => {
    if (gap.current) clearTimeout(gap.current);
    gap.current = null;
  };
  const pieces = rehearsalPlaybackPieces(run);
  const piece = pieces[index];
  const slide =
    piece?.page.image || piece?.page.scene
      ? piece.page
      : project.slides.find((s) => s.id === piece?.page.id);
  const motion = run.motion?.pages.find(
    (p) => p.id === piece?.page.id && p.status === "ready",
  );
  const media = () => (piece?.clip.file ? video.current : audio.current);
  const play = () => {
    setError("");
    const current = media();
    if (!current) return;
    if (current.error) current.load();
    void current.play().catch(() => {
      continuePlayback.current = false;
      setIsPlaying(false);
      setError("未能开始播放，请点“播放”重试。无需重新生成声音。");
    });
  };
  useEffect(() => {
    setEnded(false);
    setError("");
    if (continuePlayback.current) play();
    return clearGap;
  }, [index, piece?.clip.file, piece?.clip.audioFile]);
  useEffect(() => {
    const a = audio.current,
      v = video.current;
    return () => {
      clearGap();
      a?.pause();
      v?.pause();
    };
  }, []);
  if (!piece) return null;
  const onPlay = () => {
    continuePlayback.current = true;
    setIsPlaying(true);
    setEnded(false);
    setError("");
  };
  const onPause = () => {
    // The browser pauses at the end before firing ended. Keep the sequence alive.
    if (media()?.ended) return;
    continuePlayback.current = false;
    setIsPlaying(false);
  };
  const advance = () => {
    if (continuePlayback.current && index + 1 < pieces.length)
      setIndex((i) => i + 1);
    else {
      continuePlayback.current = false;
      setIsPlaying(false);
      setEnded(true);
    }
  };
  const next = () => {
    clearGap();
    if (
      continuePlayback.current &&
      index + 1 < pieces.length &&
      piece.clip.pauseAfter
    ) {
      setIsPlaying(true);
      gap.current = setTimeout(() => {
        gap.current = null;
        advance();
      }, piece.clip.pauseAfter * 1000);
    } else advance();
  };
  const mediaError = () => {
    continuePlayback.current = false;
    setIsPlaying(false);
    setError("音频或视频暂时无法加载，请点“播放”重试。已生成的素材仍然保留。");
  };
  const toggle = () => {
    if (isPlaying) {
      clearGap();
      continuePlayback.current = false;
      media()?.pause();
      setIsPlaying(false);
    } else if (ended && index > 0) {
      continuePlayback.current = true;
      setIndex(0);
    } else if (media()?.ended && index + 1 < pieces.length) {
      continuePlayback.current = true;
      setIndex(index + 1);
    } else play();
  };
  return (
    <Modal
      wide
      className="rehearsal-player"
      title={run.scope === "trial" ? "试播效果" : "整场演练"}
      subtitle={`第 ${piece.page.number} 页 · ${piece.page.title} · ${run.voiceName || "自己讲"}`}
      onClose={onClose}
    >
      <div className="rehearsal-player-body">
        <div className="rehearsal-stage project-presenter-canvas">
          {motion ? (
            <iframe
              title="动态演示预览"
              src={`/api/motion/${run.motion!.id}/html?preview=1&pageId=${piece.page.id}`}
            />
          ) : slide?.layered ? (
            <LayeredView page={slide.layered} label={piece.page.title} />
          ) : slide?.scene ? (
            <SceneView scene={slide.scene} label={piece.page.title} />
          ) : slide?.image ? (
            <img src={asset(slide.image)} alt={piece.page.title} />
          ) : (
            <span>{piece.page.title}</span>
          )}
          {piece.clip.file && (
            <video
              key={piece.clip.file}
              ref={video}
              controls
              playsInline
              preload="metadata"
              src={presenterVideo(piece.clip.file)}
              className="project-presenter-avatar presenter-player-video"
              data-placement={layout?.placement || run.plan.placement}
              data-size={layout?.size || run.plan.size}
              aria-label="数字人试播"
              onPlay={onPlay}
              onPause={onPause}
              onEnded={next}
              onError={mediaError}
            />
          )}
        </div>
        <details className="rehearsal-player-script">
          <summary>查看本段口播正文</summary>
          <p>{piece.clip.spokenText || piece.clip.text || piece.page.text}</p>
        </details>
        {run.plan.actor === "digital" && !piece.clip.file && (
          <p>声音可先试听；嘴型完成后可播放数字人。</p>
        )}
        {run.plan.visual === "motion" && !motion && (
          <p>动态页面尚未完成，先显示原画面。</p>
        )}
      </div>
      <div className="rehearsal-player-transport">
        {!piece.clip.file && piece.clip.audioFile && (
          <audio
            ref={audio}
            controls
            preload="metadata"
            src={speechAudio(piece.clip.audioFile)}
            onPlay={onPlay}
            onPause={onPause}
            onEnded={next}
            onError={mediaError}
            aria-label="MiniMax 口播试播"
          />
        )}
        <div className="rehearsal-player-toolbar">
          <span role="status">
            {ended ? "播放结束" : isPlaying ? "正在播放" : "已暂停"} ·{" "}
            {index + 1} / {pieces.length} 段
            {run.status !== "ready" ? " · 仅播放已完成部分" : ""}
          </span>
          <div className="rehearsal-actions">
            {pieces.length > 1 && (
              <Button disabled={!index} onClick={() => setIndex(index - 1)}>
                上一段
              </Button>
            )}
            <Button
              variant="primary"
              disabled={!piece.clip.file && !piece.clip.audioFile}
              onClick={toggle}
            >
              {isPlaying ? "暂停" : ended ? "重新播放" : "播放"}
            </Button>
            {pieces.length > 1 && (
              <Button
                disabled={index + 1 >= pieces.length}
                onClick={() => setIndex(index + 1)}
              >
                下一段
              </Button>
            )}
          </div>
        </div>
        <BackgroundMusicControls playing={isPlaying} />
        {run.scope === "trial" && run.trialLength === "short" && (
          <p className="rehearsal-caption">
            这是本页开头的短片段。满意后关闭试播，即可生成整场完整口播。
          </p>
        )}
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
