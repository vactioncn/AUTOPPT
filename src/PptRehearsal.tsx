import { useEffect, useRef, useState } from "react";
import { PencilSimple, X } from "@phosphor-icons/react";
import "./standard-presentation.css";

// Playback reads the saved deck. Opening it never starts a generation job.
export function PptRehearsal({
  deckId,
  title,
  onClose,
  onEdit,
}: {
  deckId: string;
  title: string;
  onClose: () => void;
  onEdit: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const element = dialog.current!;
    const focus = document.activeElement as HTMLElement | null;
    element.showModal();
    return () => {
      element.close();
      if (focus?.isConnected) focus.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="standard-presentation ppt-rehearsal"
      aria-label="演练 PPT"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header className="standard-header">
        <h1>{title}</h1>
        <div className="standard-actions">
          <button onClick={onEdit}>
            <PencilSimple size={18} />
            返回制作台调整
          </button>
          <button onClick={onClose}>
            <X size={18} />
            结束演练
          </button>
        </div>
      </header>
      {error && (
        <div className="standard-error" role="alert">
          <p>{error}</p>
          <button
            onClick={() => {
              setError("");
              setAttempt((n) => n + 1);
            }}
          >
            重新加载
          </button>
        </div>
      )}
      <iframe
        key={attempt}
        title="已保存的 PPT · 文字与动效"
        src={`/api/motion/${encodeURIComponent(deckId)}/html?notes=1`}
        allow="fullscreen"
        onLoad={(event) => {
          const frame = event.currentTarget;
          const document = frame.contentDocument;
          if (!document?.getElementById("deck-data")) {
            setError(
              "PPT 暂时无法打开，请重新加载或返回制作台检查已保存的版本。",
            );
            return;
          }
          document.addEventListener("keydown", (key) => {
            if (key.key === "Escape" && !document.fullscreenElement) {
              key.preventDefault();
              onClose();
            }
          });
          frame.contentWindow?.focus();
        }}
      />
    </dialog>
  );
}
