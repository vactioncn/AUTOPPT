import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowsOut,
  FileText,
  X,
} from "@phosphor-icons/react";
import { asset } from "./api";
import { SceneView } from "./SceneView";
import type { Project } from "./types";
import "./standard-presentation.css";

// Plain presentation only reads the already loaded project and its assets.
export function StandardPresentation({
  project,
  onClose,
}: {
  project: Project;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [index, setIndex] = useState(0);
  const [notes, setNotes] = useState(false);
  const [error, setError] = useState("");
  const slide = project.slides[index];
  const title = slide?.plan?.title || `第 ${index + 1} 页`;
  const move = (page: number) =>
    setIndex(Math.max(0, Math.min(project.slides.length - 1, page)));
  useEffect(() => {
    const element = dialog.current!;
    const focus = document.activeElement as HTMLElement | null;
    element.showModal();
    return () => {
      if (document.fullscreenElement === element)
        void document.exitFullscreen();
      element.close();
      if (focus?.isConnected) focus.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="standard-presentation"
      aria-label="普通放映"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onKeyDown={(e) => {
        if ((e.target as HTMLElement).closest("input, textarea, select"))
          return;
        if (
          [
            "ArrowRight",
            "PageDown",
            "ArrowLeft",
            "PageUp",
            "Home",
            "End",
          ].includes(e.key)
        ) {
          e.preventDefault();
          move(
            e.key === "Home"
              ? 0
              : e.key === "End"
                ? project.slides.length - 1
                : index + (["ArrowRight", "PageDown"].includes(e.key) ? 1 : -1),
          );
        }
      }}
    >
      <header className="standard-header">
        <h1>{project.title}</h1>
        <div className="standard-actions">
          <button aria-pressed={notes} onClick={() => setNotes(!notes)}>
            <FileText size={18} />
            {notes ? "收起讲稿" : "查看讲稿"}
          </button>
          {document.fullscreenEnabled && (
            <button
              onClick={async () => {
                setError("");
                try {
                  if (document.fullscreenElement === dialog.current)
                    await document.exitFullscreen();
                  else await dialog.current?.requestFullscreen();
                } catch {
                  setError("暂时无法进入全屏，可继续在当前窗口放映。");
                }
              }}
            >
              <ArrowsOut size={18} />
              全屏
            </button>
          )}
          <button onClick={onClose}>
            <X size={18} />
            退出放映
          </button>
        </div>
      </header>
      <div className={`standard-stage ${notes ? "with-notes" : ""}`}>
        <div className="standard-image">
          {slide?.image ? (
            <img src={asset(slide.image)} alt={title} />
          ) : slide?.scene ? (
            <SceneView scene={slide.scene} label={title} />
          ) : (
            <p>本页尚未生成画面，可查看讲稿后返回制作。</p>
          )}
        </div>
        {notes && (
          <aside className="standard-notes" aria-label="当前页讲稿">
            <h2>{title}</h2>
            <p>{slide?.notes || "本页没有讲稿。"}</p>
          </aside>
        )}
      </div>
      {error && (
        <p className="standard-error" role="status">
          {error}
        </p>
      )}
      <footer className="standard-controls">
        <button disabled={!index} onClick={() => move(index - 1)}>
          <ArrowLeft size={18} />
          上一页
        </button>
        <label>
          页面{" "}
          <select
            aria-label="跳转到页面"
            value={index}
            onChange={(e) => move(Number(e.target.value))}
          >
            {project.slides.map((s, i) => (
              <option key={s.id} value={i}>
                {i + 1} / {project.slides.length}
              </option>
            ))}
          </select>
        </label>
        <button
          disabled={index >= project.slides.length - 1}
          onClick={() => move(index + 1)}
        >
          下一页
          <ArrowRight size={18} />
        </button>
        <span className="standard-keyboard">方向键翻页 · Esc 返回</span>
      </footer>
    </dialog>
  );
}
