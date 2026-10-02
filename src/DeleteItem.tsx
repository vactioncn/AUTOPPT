import { useState } from "react";
import { api } from "./api";
import { Button, Modal } from "./components";

export function DeleteItem({
  kind,
  id,
  name,
  onClose,
  onDeleted,
}: {
  kind: "project" | "style";
  id: string;
  name: string;
  onClose: () => void;
  onDeleted: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const label = kind === "project" ? "项目" : "风格";
  return (
    <Modal
      title={`删除${label}「${name}」？`}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <p>
        {kind === "project"
          ? "项目将从列表移除，讲稿、页面和历史不再显示。不会删除其他项目或共享风格。"
          : "风格将从风格库移除。已有页面、讲稿和历史版本保留；使用它的项目需另选风格才能继续制作。"}
      </p>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      <div className="modal-actions">
        <Button disabled={busy} onClick={onClose}>
          取消
        </Button>
        <Button
          variant="danger"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await api(
                `/${kind === "project" ? "projects" : "styles"}/${id}`,
                { method: "DELETE" },
              );
              await onDeleted();
              onClose();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          确认删除{label}
        </Button>
      </div>
    </Modal>
  );
}
