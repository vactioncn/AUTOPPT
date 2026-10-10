import { useEffect, useRef, useState } from "react";
import { asset } from "./api";
import { Button, Modal } from "./components";
import { SceneView } from "./SceneView";
import { presenterVideo } from "./presenter-types";
import { speechAudio } from "./speech-types";
import type { Project } from "./types";
import type { RehearsalRun, RehearsalPlan } from "./rehearsal-types";
export function RehearsalPlayer({
  project,
  run,
  layout,
  onClose,
}: {
  project: Project;
  run: RehearsalRun;
  layout?: RehearsalPlan;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(0),
    [continuous, setContinuous] = useState(false),
    [error, setError] = useState("");
  const audio = useRef<HTMLAudioElement>(null),
    video = useRef<HTMLVideoElement>(null);
  const pieces = run.pages.flatMap((p) =>
    p.clips.length
      ? p.clips.map((c) => ({ page: p, clip: c }))
      : [{ page: p, clip: {} }],
  );
  const piece = pieces[index],
    slide =
      piece?.page.image || piece?.page.scene
        ? piece.page
        : project.slides.find((s) => s.id === piece?.page.id);
  const motion = run.motion?.pages.find(
    (p) => p.id === piece?.page.id && p.status === "ready",
  );
  useEffect(() => {
    if (continuous) {
      const media = piece?.clip.file ? video.current : audio.current;
      void media?.play().catch(() => {
        setContinuous(false);
        setError("请按播放按钮开始。");
      });
    }
  }, [index, continuous, piece?.clip.file, piece?.clip.audioFile]);
  if (!piece) return null;
  const next = () => {
    if (continuous && index + 1 < pieces.length) setIndex(index + 1);
    else setContinuous(false);
  };
  return (
    <Modal
      wide
      title={run.scope === "trial" ? "试播效果" : "整场演练"}
      subtitle={`${piece.page.title} · ${index + 1} / ${pieces.length} 段 · ${run.voiceName || "自己讲"}`}
      onClose={onClose}
    >
      <div className="rehearsal-stage project-presenter-canvas">
        {motion ? (
          <iframe
            title="动态演示预览"
            src={`/api/motion/${run.motion!.id}/html?preview=1&pageId=${piece.page.id}`}
          />
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
            onEnded={next}
            onError={() => setError("视频暂时无法播放，请重新打开。")}
          />
        )}
      </div>
      {!piece.clip.file && piece.clip.audioFile && (
        <audio
          ref={audio}
          controls
          src={speechAudio(piece.clip.audioFile)}
          onEnded={next}
          aria-label="MiniMax 口播试播"
        />
      )}
      <div className="rehearsal-actions">
        <Button disabled={!index} onClick={() => setIndex(index - 1)}>
          上一段
        </Button>
        <Button
          variant="primary"
          disabled={!piece.clip.file && !piece.clip.audioFile}
          onClick={() => {
            setContinuous(!continuous);
            if (continuous) {
              video.current?.pause();
              audio.current?.pause();
            }
          }}
        >
          {continuous ? "暂停" : "连续播放"}
        </Button>
        <Button
          disabled={index + 1 >= pieces.length}
          onClick={() => setIndex(index + 1)}
        >
          下一段
        </Button>
      </div>
      <p>{piece.clip.text || piece.page.text}</p>
      {run.plan.actor === "digital" && !piece.clip.file && (
        <p>声音可先试听；嘴型完成后可播放数字人。</p>
      )}
      {run.plan.visual === "motion" && !motion && (
        <p>动态页面尚未完成，先显示原画面。</p>
      )}
      {error && <p role="alert">{error}</p>}
    </Modal>
  );
}
