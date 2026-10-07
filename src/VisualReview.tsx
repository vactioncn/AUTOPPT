import { useState } from "react";
import type { Project } from "./types";
import { Modal, Button } from "./components";
import { api, asset } from "./api";
import { SceneView } from "./SceneView";
import { visualReviewReason } from "../shared/visual-review.mjs";
import "./review-help.css";
export function VisualReview({
  project,
  onClose,
  onUpdated,
  onEdit,
}: {
  project: Project;
  onClose: () => void;
  onUpdated: (p: Project) => void;
  onEdit: (id: string) => void;
}) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [confirmed, setConfirmed] = useState(0);
  const pages = project.slides
    .map((slide, index) => ({ slide, number: index + 1 }))
    .filter((p) => p.slide.stale);
  return (
    <Modal
      title={`画面核对 · ${pages.length} 页`}
      subtitle="讲稿改过，不等于画面必须重做。逐页确认后，提醒就会消失。"
      onClose={() => !busy && onClose()}
      wide
    >
      <div className="visual-review-scroll">
        <p className="detail-help">
          这里只比对讲稿历史，未自动判断图片内容。确认保留不会生成图片或调用模型；以后再次修改讲稿，会重新提醒核对。
        </p>
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        {!!confirmed && (
          <p role="status">已确认保留 {confirmed} 页当前画面。</p>
        )}
        {!pages.length && <p>全部核对完成，可以继续演练或交付。</p>}
        {pages.map(({ slide, number }) => {
          const reason = visualReviewReason(slide);
          return (
            <article className="visual-review-item" key={slide.id}>
              <div className="visual-review-preview">
                {slide.scene ? (
                  <SceneView scene={slide.scene} label={`第 ${number} 页`} />
                ) : slide.image ? (
                  <img src={asset(slide.image)} alt={`第 ${number} 页画面`} />
                ) : (
                  <span>尚无画面</span>
                )}
              </div>
              <div className="visual-review-content">
                <h3>
                  第 {number} 页 · {slide.plan?.title || "讲稿已修改"}
                </h3>
                <p>{reason.reason}</p>
                <details>
                  <summary>查看前后讲稿</summary>
                  <div className="visual-review-diff">
                    <section>
                      <h4>画面对应的原稿</h4>
                      <p>{reason.before ?? "没有可比历史，请直接查看画面。"}</p>
                    </section>
                    <section>
                      <h4>当前讲稿</h4>
                      <p>{slide.notes}</p>
                    </section>
                  </div>
                </details>
                <div className="speech-inline">
                  <Button disabled={!!busy} onClick={() => onEdit(slide.id)}>
                    查看并修改画面
                  </Button>
                  <Button
                    disabled={!!busy || !(slide.image || slide.scene)}
                    onClick={async () => {
                      setBusy(slide.id);
                      setError("");
                      try {
                        const p = await api<Project>(
                          `/projects/${project.id}/slides/${slide.id}/keep-visual`,
                          {
                            method: "POST",
                            body: JSON.stringify({
                              revision: project.revision,
                            }),
                          },
                        );
                        onUpdated(p);
                        setConfirmed((n) => n + 1);
                      } catch (e) {
                        setError((e as Error).message);
                      } finally {
                        setBusy("");
                      }
                    }}
                  >
                    {busy === slide.id ? "保存中…" : `确认保留第 ${number} 页`}
                  </Button>
                </div>
              </div>
            </article>
          );
        })}
      </div>
      <div className="modal-actions">
        <Button disabled={!!busy} onClick={onClose}>
          {pages.length ? "稍后处理剩余页面" : "完成核对"}
        </Button>
      </div>
    </Modal>
  );
}
