import { useEffect, useRef, useState } from "react";
import { asset } from "./api";
import { Button, Modal } from "./components";
import { SceneView } from "./SceneView";
import type { Project } from "./types";
import { presenterVideo, type PresenterGeneration } from "./presenter-types";
export function PresenterPlayer({
  project,
  job,
  onClose,
}: {
  project: Project;
  job: PresenterGeneration;
  onClose: () => void;
}) {
  const pieces = job.pages.flatMap((p) =>
    p.clips.filter((c) => c.file).map((c) => ({ page: p, clip: c })),
  );
  const [index, setIndex] = useState(0),
    [speed, setSpeed] = useState(1),
    [auto, setAuto] = useState(false),
    [error, setError] = useState("");
  const video = useRef<HTMLVideoElement>(null);
  const piece = pieces[index],
    slide = project.slides.find((s) => s.id === piece?.page.id);
  useEffect(() => {
    setError("");
    if (video.current) {
      video.current.playbackRate = speed;
      if (auto) void video.current.play().catch(() => setAuto(false));
    }
  }, [index, speed, auto]);
  if (!piece) return null;
  return (
    <Modal
      wide
      title="数字人讲解"
      subtitle={`${piece.page.title} · ${index + 1} / ${pieces.length} 段`}
      onClose={onClose}
    >
      <div className="presenter-player-stage project-presenter-canvas">
        {slide?.scene ? (
          <SceneView scene={slide.scene} label={piece.page.title} />
        ) : slide?.image ? (
          <img src={asset(slide.image)} alt={piece.page.title} />
        ) : (
          <span>{piece.page.title}</span>
        )}
        <video
          key={piece.clip.file}
          ref={video}
          src={presenterVideo(piece.clip.file!)}
          className="project-presenter-avatar presenter-player-video"
          data-placement={job.placement}
          data-size={job.size}
          playsInline
          controls
          preload="auto"
          aria-label="数字人讲解视频"
          onError={() =>
            setError("视频暂时无法播放，请关闭后重开，或查看生成记录。")
          }
          onEnded={() => {
            if (auto && index + 1 < pieces.length) setIndex(index + 1);
            else setAuto(false);
          }}
        />
      </div>
      <div className="presenter-actions presenter-player-controls">
        <Button disabled={!index} onClick={() => setIndex(index - 1)}>
          上一段
        </Button>
        <Button
          variant="primary"
          onClick={() => {
            if (!video.current) return;
            if (video.current.paused) {
              setAuto(true);
              void video.current.play().catch(() => {
                setAuto(false);
                setError("请使用视频上的播放按钮开始。");
              });
            } else {
              video.current.pause();
              setAuto(false);
            }
          }}
        >
          {auto ? "暂停讲解" : "连续播放"}
        </Button>
        <Button
          disabled={index + 1 >= pieces.length}
          onClick={() => setIndex(index + 1)}
        >
          下一段
        </Button>
        <label>
          播放速度{" "}
          <select
            aria-label="讲解播放速度"
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
          >
            {[0.75, 1, 1.25, 1.5].map((n) => (
              <option key={n} value={n}>
                {n} 倍
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="presenter-player-script">
        {piece.clip.text || slide?.notes}
      </p>
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
    </Modal>
  );
}
