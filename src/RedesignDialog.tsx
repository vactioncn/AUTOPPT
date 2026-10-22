import { useState } from "react";
import { ArrowsClockwise } from "@phosphor-icons/react";
import { Button, Field, Modal, SlideImage, StylePreview } from "./components";
import {
  DesignOptionsEditor,
  emptyDesignOptions,
  validDesignOptions,
} from "./DesignOptionsEditor";
import { projectStyles } from "../shared/styles.mjs";
import {
  AUDIENCE_PRESETS,
  audiencePreset,
  audiencePresetId,
} from "../shared/audience-presets.mjs";
import { post } from "./api";
import type { DesignOptions, Project, Style } from "./types";
import "./redesign.css";

export function RedesignDialog({
  project,
  styles,
  hosted,
  selected,
  pageBusy,
  onClose,
  onSubmitted,
}: {
  project: Project;
  styles: Style[];
  hosted: boolean;
  selected: string[];
  pageBusy: (id: string) => boolean;
  onClose: () => void;
  onSubmitted: (count: number) => void;
}) {
  const [scope, setScope] = useState(selected.length ? "selected" : "all");
  const [chosen, setChosen] = useState(selected);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [styleId, setStyleId] = useState(project.styleId);
  const [choices, setChoices] = useState<DesignOptions>(
    project.designOptions || emptyDesignOptions,
  );
  const [audienceKind, setAudienceKind] = useState(
    audiencePresetId(project.designOptions?.audience || null),
  );
  const [customAudience, setCustomAudience] = useState(
    project.designOptions?.audience || { description: "", brief: "" },
  );
  const stylesAvailable = projectStyles(styles, hosted, project.styleId);
  const style = stylesAvailable.find((s) => s.id === styleId);
  const audienceLabel =
    audienceKind === "custom"
      ? "自定义内容倾向"
      : AUDIENCE_PRESETS.find((p) => p.id === audienceKind)?.label ||
        "通用 · 不限定行业";
  // Resolve from current project order, including pages outside the workspace filter.
  const pages = project.slides.filter(
    (p) => scope === "all" || chosen.includes(p.id),
  );
  const locked = pages.filter((p) => pageBusy(p.id));
  const available = project.slides.filter((p) => !pageBusy(p.id));
  const submit = async () => {
    if (
      submitting ||
      !pages.length ||
      locked.length ||
      !style ||
      !validDesignOptions(choices)
    )
      return;
    setSubmitting(true);
    setError("");
    try {
      await post(`/projects/${project.id}/render`, {
        slideIds: pages.map((p) => p.id),
        redesign: true,
        revision: project.revision,
        redesignSettings: { styleId, designOptions: choices },
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
      subtitle="先选页面，再调整风格和内容倾向，确认后开始重新设计。"
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
          <section className="redesign-settings" aria-label="本次设计方向">
            <h3>本次设计方向</h3>
            <div className="redesign-setting-fields">
              <Field label="视觉风格（主题）">
                <select
                  value={styleId}
                  onChange={(e) => setStyleId(e.target.value)}
                >
                  {!style && <option value={styleId}>请选择可用风格</option>}
                  {stylesAvailable.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                      {s.id === project.styleId ? "（项目当前风格）" : ""}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="内容倾向">
                <select
                  value={audienceKind}
                  onChange={(e) => {
                    const kind = e.target.value;
                    setAudienceKind(kind);
                    setChoices({
                      ...choices,
                      audience:
                        kind === "custom"
                          ? customAudience
                          : audiencePreset(kind),
                    });
                  }}
                >
                  <option value="none">通用 · 不限定行业</option>
                  {AUDIENCE_PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                  <option value="custom">自定义受众与场景</option>
                </select>
              </Field>
            </div>
            {style && (
              <div className="redesign-style-preview">
                <StylePreview style={style} compact />
                <div>
                  <strong>{style.name}</strong>
                  <p>用这个风格重新构思所选页面，讲稿和内容附件继续保留。</p>
                </div>
              </div>
            )}
            {audienceKind === "custom" && (
              <div className="redesign-custom-audience">
                <Field label="受众与场景">
                  <textarea
                    rows={2}
                    maxLength={2000}
                    value={customAudience.description}
                    placeholder="例如：面向儿童摄影影楼老板，强调客户体验和团队协作"
                    onChange={(e) => {
                      const audience = {
                        description: e.target.value,
                        brief: "",
                      };
                      setCustomAudience(audience);
                      setChoices({ ...choices, audience });
                    }}
                  />
                </Field>
                <details>
                  <summary>补充内容倾向说明（可选）</summary>
                  <Field label="内容倾向说明">
                    <textarea
                      rows={3}
                      maxLength={10000}
                      value={customAudience.brief}
                      onChange={(e) => {
                        const audience = {
                          ...customAudience,
                          brief: e.target.value,
                        };
                        setCustomAudience(audience);
                        setChoices({ ...choices, audience });
                      }}
                    />
                  </Field>
                </details>
              </div>
            )}
            <p className="detail-help">
              内容倾向用于受众、行业和场景表达，保留讲稿原意。选择预设或直接填写即可，开始前不会调用模型。
            </p>
            <details className="redesign-palette">
              <summary>
                配色方案 · {choices.palette?.name || "沿用风格"}
              </summary>
              <DesignOptionsEditor
                value={choices}
                onChange={setChoices}
                styleId={styleId}
                hideAudience
                disabled={submitting}
              />
            </details>
          </section>
          <div className="redesign-summary" aria-live="polite">
            <p>
              本次使用：<strong>{style?.name || "尚未选择"}</strong> ·{" "}
              {audienceLabel} · {choices.palette?.name || "沿用风格配色"}
            </p>
            <p>
              设置仅用于本次所选页面，项目默认设置和其他页面保持原样。旧图在成功后存入历史版本，失败时保留。点击开始后会调用模型并产生费用。
            </p>
            {scope === "selected" && pages.length > 0 && (
              <p>
                本次页码：
                {pages.map((p) => project.slides.indexOf(p) + 1).join("、")}
              </p>
            )}
          </div>
          {(!style || style.deletedAt) && (
            <p className="error-text">请在上方选择一个可用的风格。</p>
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
                !pages.length ||
                !!locked.length ||
                !style ||
                !validDesignOptions(choices)
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
