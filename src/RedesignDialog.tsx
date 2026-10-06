import { useState } from "react";
import { ArrowsClockwise } from "@phosphor-icons/react";
import { Button, Modal, SlideImage } from "./components";
import { post } from "./api";
import type { Project, Style } from "./types";
import "./redesign.css";

export function RedesignDialog({
  project,
  style,
  selected,
  pageBusy,
  onClose,
  onSubmitted,
}: {
  project: Project;
  style?: Style;
  selected: string[];
  pageBusy: (id: string) => boolean;
  onClose: () => void;
  onSubmitted: (count: number) => void;
}) {
  const [scope, setScope] = useState(selected.length ? "selected" : "all");
  const [chosen, setChosen] = useState(selected);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  // Resolve from current project order, including pages outside the workspace filter.
  const pages = project.slides.filter(
    (p) => scope === "all" || chosen.includes(p.id),
  );
  const locked = pages.filter((p) => pageBusy(p.id));
  const available = project.slides.filter((p) => !pageBusy(p.id));
  const submit = async () => {
    setSubmitting(true);
    setError("");
    try {
      await post(`/projects/${project.id}/render`, {
        slideIds: pages.map((p) => p.id),
        redesign: true,
      });
      onSubmitted(pages.length);
    } catch (e) {
      setError((e as Error).message);
      setSubmitting(false);
    }
  };
  return (
    <Modal
      title="重新设计 PPT 页面"
      subtitle="选择全部页面，或只重做需要调整的几页。"
      wide
      onClose={() => !submitting && onClose()}
    >
      <div className="redesign-dialog">
        <fieldset disabled={submitting}>
          <div
            className="redesign-scope"
            role="group"
            aria-label="重新设计范围"
          >
            <button
              className={scope === "all" ? "chosen" : ""}
              aria-pressed={scope === "all"}
              onClick={() => setScope("all")}
            >
              <strong>全部页面重新设计</strong>
              <span>整个项目 · {project.slides.length} 页</span>
            </button>
            <button
              className={scope === "selected" ? "chosen" : ""}
              aria-pressed={scope === "selected"}
              onClick={() => setScope("selected")}
            >
              <strong>选择几页重新设计</strong>
              <span>勾选要调整的页面</span>
            </button>
          </div>
          {scope === "selected" && (
            <>
              <div className="redesign-selection">
                <strong>已选 {pages.length} 页</strong>
                <Button onClick={() => setChosen(available.map((p) => p.id))}>
                  全选可重做页面
                </Button>
                <Button disabled={!chosen.length} onClick={() => setChosen([])}>
                  清空选择
                </Button>
              </div>
              <div
                className="redesign-pages"
                role="group"
                aria-label="选择重新设计页面"
              >
                {project.slides.map((p, i) => (
                  <label
                    key={p.id}
                    className={chosen.includes(p.id) ? "chosen" : ""}
                  >
                    <input
                      type="checkbox"
                      aria-label={`重新设计第 ${i + 1} 页`}
                      checked={chosen.includes(p.id)}
                      disabled={pageBusy(p.id)}
                      onChange={(e) =>
                        setChosen((ids) =>
                          e.target.checked
                            ? [...ids, p.id]
                            : ids.filter((id) => id !== p.id),
                        )
                      }
                    />
                    <SlideImage slide={p} />
                    <span>
                      第 {i + 1} 页{pageBusy(p.id) ? " · 制作中" : ""}
                    </span>
                    <small>
                      {p.plan?.title ||
                        p.notes.trim().slice(0, 40) ||
                        "待设计页面"}
                    </small>
                  </label>
                ))}
              </div>
            </>
          )}
          <div className="redesign-summary">
            <p>
              使用当前项目风格：<strong>{style?.name || "尚未选择"}</strong>
            </p>
            <p>
              按当前保存的讲稿、内容附件和配色重新出图。旧图在成功后存入历史版本，失败时保留。点击开始后会调用模型并产生费用。
            </p>
            {scope === "selected" && pages.length > 0 && (
              <p>
                本次页码：
                {pages.map((p) => project.slides.indexOf(p) + 1).join("、")}
              </p>
            )}
          </div>
          {(!style || style.deletedAt) && (
            <p className="error-text">请先关闭窗口，选择一个可用的项目风格。</p>
          )}
          {locked.length > 0 && (
            <p className="error-text">
              所选范围有 {locked.length}{" "}
              页正在制作。请等待完成，或选择其他空闲页。
            </p>
          )}
          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <Button onClick={onClose}>取消</Button>
            <Button
              variant="primary"
              loading={submitting}
              disabled={
                !pages.length || !!locked.length || !style || !!style.deletedAt
              }
              onClick={submit}
            >
              <ArrowsClockwise size={18} />
              开始重新设计 {pages.length} 页
            </Button>
          </div>
        </fieldset>
      </div>
    </Modal>
  );
}
