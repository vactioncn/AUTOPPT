import { useId, useRef, useState, type ReactNode } from "react";
import { Button, Modal } from "./components";
import { useAccount } from "./Account";
import "./feedback.css";

type Action = { label: string; onClick: () => void };
export function Feedback({
  kind,
  title,
  children,
  action,
  onDismiss,
  id,
}: {
  kind: "blocking" | "risk" | "recommendation" | "teaching" | "success";
  title?: string;
  children: ReactNode;
  action?: Action;
  onDismiss?: () => void;
  id?: string;
}) {
  const generated = useId(),
    description = (id || generated) + "-description";
  return (
    <div
      id={id}
      className={`feedback feedback-${kind}`}
      data-feedback={kind}
      role={
        kind === "blocking" ? "alert" : kind === "success" ? "status" : "note"
      }
      aria-live={kind === "success" ? "polite" : undefined}
      aria-atomic={kind === "success" || undefined}
      aria-describedby={description}
    >
      {title && <strong>{title}</strong>}
      <div id={description}>{children}</div>
      {action && (
        <Button
          variant={kind === "blocking" ? "primary" : "ghost"}
          onClick={action.onClick}
        >
          {action.label}
        </Button>
      )}
      {onDismiss && (
        <Button variant="ghost" title="关闭提示" onClick={onDismiss}>
          {kind === "teaching" ? "知道了" : "收起完成提示"}
        </Button>
      )}
    </div>
  );
}
export function useRiskConfirmation() {
  const { hosted } = useAccount();
  const [pending, setPending] = useState<{
    title: string;
    detail: string;
    run: () => Promise<unknown>;
  } | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const lock = useRef(false);
  const ask = (
    title: string,
    run: () => Promise<unknown>,
    detail = "确认后调用模型处理当前内容。",
  ) => {
    if (lock.current) return;
    setError("");
    setPending({ title, detail, run });
  };
  const dialog = pending && (
    <Modal
      title={`确认${pending.title}`}
      onClose={() => !lock.current && setPending(null)}
    >
      <Feedback kind="risk" title={pending.title}>
        <p>{pending.detail}</p>
        <p>
          {hosted
            ? "将使用管理员提供的额度，实际用量以处理结果为准。"
            : "将调用已配置的模型服务，可能产生费用。"}
        </p>
        <p>取消会保留当前输入。</p>
      </Feedback>
      {error && (
        <Feedback
          kind="blocking"
          action={{ label: "返回检查", onClick: () => setPending(null) }}
        >
          {error}
        </Feedback>
      )}
      <div className="modal-actions">
        <Button disabled={busy} onClick={() => setPending(null)}>
          取消
        </Button>
        <Button
          variant="primary"
          loading={busy}
          onClick={async () => {
            if (lock.current) return;
            lock.current = true;
            setBusy(true);
            try {
              await pending.run();
              setPending(null);
            } catch {
              setError("操作没有完成，请返回检查后重试。");
            } finally {
              lock.current = false;
              setBusy(false);
            }
          }}
        >
          确认{pending.title}
        </Button>
      </div>
    </Modal>
  );
  return { ask, dialog };
}
