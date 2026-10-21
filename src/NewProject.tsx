import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle,
  SpinnerGap,
  Sparkle,
} from "@phosphor-icons/react";
import {
  createAudienceDraft,
  type AudienceDraftState,
} from "../shared/audience-draft.mjs";
import {
  AUDIENCE_PRESETS,
  audiencePreset,
  audiencePresetId,
  type Audience,
} from "../shared/audience-presets.mjs";
import { DEFAULT_STYLE_ID } from "../shared/styles.mjs";
import { api, post } from "./api";
import { Button, Field, Modal, StylePreview } from "./components";
import {
  DesignOptionsEditor,
  emptyDesignOptions,
  validDesignOptions,
} from "./DesignOptionsEditor";
import type { DesignOptions, Project, Style } from "./types";
import "./new-project.css";

export type NewProjectDraft = {
  title: string;
  styleId: string;
  choices: DesignOptions;
  audienceKind: string;
  customAudience: Audience;
};

export function NewProject({
  styles,
  initialStyle,
  initialDraft,
  onStyles,
  onClose,
  onCreated,
  onDraftChange,
  createProject,
  retainedManuscript = false,
}: {
  styles: Style[];
  initialStyle: string;
  initialDraft: NewProjectDraft | null;
  onStyles: (draft: NewProjectDraft) => void;
  onClose: () => void;
  onCreated: (project: Project) => void;
  onDraftChange?: (draft: NewProjectDraft) => void;
  createProject?: (input: {
    title: string;
    styleId: string;
    designOptions: DesignOptions;
  }) => Promise<Project>;
  retainedManuscript?: boolean;
}) {
  const [step, setStep] = useState(1);
  const [title, setTitle] = useState(initialDraft?.title || "");
  const [styleId, setStyleId] = useState(initialStyle);
  const [query, setQuery] = useState("");
  const [choices, setChoices] = useState(
    initialDraft?.choices || emptyDesignOptions,
  );
  const [audienceKind, setAudienceKind] = useState(
    initialDraft?.audienceKind ||
      audiencePresetId(initialDraft?.choices.audience || null),
  );
  const [customAudience, setCustomAudience] = useState<Audience>(
    initialDraft?.customAudience || { description: "", brief: "" },
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [draftState, setDraftState] = useState<AudienceDraftState>({
    status: "idle",
    error: "",
  });
  const [composing, setComposing] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const draft = useRef<ReturnType<typeof createAudienceDraft> | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const firstStep = useRef(true);
  const generateActions = useRef<HTMLDivElement>(null);
  const wasGenerating = useRef(false);
  const [reviewingCustom, setReviewingCustom] = useState(
    !!initialDraft?.customAudience.brief,
  );
  const generating = ["waiting", "generating"].includes(draftState.status);
  const available = styles.filter((s) => s.rules && !s.deletedAt);
  const selectedStyle = available.find((s) => s.id === styleId);
  const filtered = available.filter((s) =>
    s.name.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const customReady =
    audienceKind !== "custom" ||
    !!(customAudience.description.trim() && customAudience.brief.trim());
  const canContinue = !!title.trim() && !!selectedStyle;
  useEffect(() => {
    onDraftChange?.({ title, styleId, choices, audienceKind, customAudience });
  }, [title, styleId, choices, audienceKind, customAudience, onDraftChange]);
  const chooseAudience = (kind: string) => {
    draft.current?.cancel();
    setCancelled(false);
    setAudienceKind(kind);
    setChoices((v) => ({
      ...v,
      audience: kind === "custom" ? customAudience : audiencePreset(kind),
    }));
  };
  const editCustom = (audience: Audience) => {
    if (audience.description !== customAudience.description)
      setReviewingCustom(false);
    setCancelled(false);
    setCustomAudience(audience);
    setChoices((v) => ({ ...v, audience }));
  };
  useEffect(() => {
    const coordinator = createAudienceDraft({
      autoGenerate: false,
      generate: (description, signal) =>
        api<Audience>("/design-options/audience", {
          method: "POST",
          signal,
          body: JSON.stringify({ description }),
        }),
      onState: setDraftState,
      onResult: (audience) => {
        setReviewingCustom(true);
        setCustomAudience(audience);
        setChoices((v) => ({ ...v, audience }));
      },
    });
    draft.current = coordinator;
    return () => {
      coordinator.dispose();
      draft.current = null;
    };
  }, []);
  useEffect(() => {
    draft.current?.update({
      description: customAudience.description,
      brief: customAudience.brief,
      enabled: audienceKind === "custom" && !busy,
      composing,
      context: styleId,
    });
  }, [customAudience, audienceKind, busy, composing, styleId]);
  useEffect(() => {
    if (wasGenerating.current && !generating)
      generateActions.current?.querySelector("button")?.focus();
    wasGenerating.current = generating;
    if (!generating) return;
    const started = Date.now();
    setElapsed(0);
    const timer = setInterval(
      () => setElapsed(Math.floor((Date.now() - started) / 1000)),
      1000,
    );
    return () => clearInterval(timer);
  }, [generating]);
  useEffect(() => {
    scroll.current?.scrollTo(0, 0);
    if (firstStep.current) firstStep.current = false;
    else heading.current?.focus();
  }, [step]);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || generating || !canContinue) return;
    if (step === 1) {
      setStep(2);
      return;
    }
    if (!customReady || !validDesignOptions(choices)) return;
    setBusy(true);
    setError("");
    try {
      onCreated(
        await (createProject || ((input) => post<Project>("/projects", input)))(
          { title, styleId, designOptions: choices },
        ),
      );
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  const cancelGeneration = () => {
    draft.current?.cancel();
    setCancelled(true);
  };
  const close = () => {
    if (!busy) {
      draft.current?.cancel();
      onClose();
    }
  };
  return (
    <Modal
      title="开始一场新的演讲"
      subtitle="选好画面风格，再决定向谁表达。"
      onClose={close}
      className="new-project-modal"
    >
      <form onSubmit={submit} className="new-project-form">
        <ol className="creation-steps" aria-label="创建步骤">
          <li aria-current={step === 1 ? "step" : undefined}>
            <span>1</span>主题与风格
          </li>
          <li aria-current={step === 2 ? "step" : undefined}>
            <span>2</span>内容倾向<small>可选</small>
          </li>
        </ol>
        <div ref={scroll} className="new-project-scroll">
          {retainedManuscript && (
            <p className="creation-help" role="status">
              已保留之前的讲稿。创建后带入制作台，确认提交时才生成画面。
            </p>
          )}
          <div hidden={step !== 1}>
            <Field label="演讲主题">
              <input
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="例如：儿童摄影行业的下一步"
                maxLength={100}
                required
                disabled={busy}
              />
            </Field>
            <div className="creation-section-heading">
              <h3 ref={step === 1 ? heading : undefined} tabIndex={-1}>
                选择视觉风格
              </h3>
              {available.length > 6 && (
                <input
                  type="search"
                  aria-label="查找风格"
                  placeholder="查找风格"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              )}
            </div>
            {available.length ? (
              <>
                <div
                  className="style-choice-grid"
                  role="group"
                  aria-label="选择视觉风格"
                >
                  {filtered.map((s) => (
                    <button
                      type="button"
                      key={s.id}
                      className={`style-choice ${styleId === s.id ? "chosen" : ""}`}
                      aria-pressed={styleId === s.id}
                      onClick={() => setStyleId(s.id)}
                    >
                      <StylePreview style={s} compact />
                      <span>
                        {s.name}
                        {styleId === s.id && (
                          <CheckCircle size={18} weight="fill" />
                        )}
                      </span>
                      {s.id === DEFAULT_STYLE_ID && (
                        <small className="creation-style-default">默认</small>
                      )}
                    </button>
                  ))}
                </div>
                {!filtered.length && (
                  <p className="detail-help">
                    没有找到这个风格，试试其他关键词。
                  </p>
                )}
                <p className="creation-style-summary">
                  已选：
                  <strong>{selectedStyle?.name || "请选择一个风格"}</strong>
                </p>
              </>
            ) : (
              <div className="small-notice">
                <p>风格库还没有可用风格。保存一个风格后，即可回来继续。</p>
              </div>
            )}
            <Button
              type="button"
              variant="ghost"
              className="creation-library"
              onClick={() =>
                onStyles({
                  title,
                  styleId,
                  choices,
                  audienceKind,
                  customAudience,
                })
              }
            >
              {available.length ? "去风格库添加" : "前往风格库创建"}
              <ArrowRight size={15} />
            </Button>
          </div>
          <div hidden={step !== 2}>
            <div className="creation-context">
              <span>{title}</span>
              <small>{selectedStyle?.name}</small>
              <Button type="button" variant="ghost" onClick={() => setStep(1)}>
                修改
              </Button>
            </div>
            <h3 ref={step === 2 ? heading : undefined} tabIndex={-1}>
              这场演讲，面向谁？
            </h3>
            <p className="creation-help">
              选择常用行业即可使用，也可以保持通用。只调整表达语境，保留讲稿原意。
            </p>
            <div
              className="audience-preset-grid"
              role="group"
              aria-label="内容倾向"
            >
              {[
                {
                  id: "none",
                  label: "通用 · 不限定行业",
                  hint: "沿用讲稿本身的语境",
                },
                ...AUDIENCE_PRESETS,
              ].map((p) => (
                <button
                  type="button"
                  key={p.id}
                  aria-pressed={audienceKind === p.id}
                  onClick={() => chooseAudience(p.id)}
                  disabled={busy}
                >
                  <strong>
                    {p.label}
                    {audienceKind === p.id && (
                      <CheckCircle size={17} weight="fill" />
                    )}
                  </strong>
                  <span>{p.hint}</span>
                </button>
              ))}
              <button
                className="audience-custom-choice"
                type="button"
                aria-pressed={audienceKind === "custom"}
                onClick={() => chooseAudience("custom")}
                disabled={busy}
              >
                <Sparkle size={19} />
                <span>
                  <strong>定制我的内容倾向</strong>
                  <small>写下具体受众，由 AI 单独生成</small>
                </span>
                {audienceKind === "custom" && (
                  <CheckCircle size={18} weight="fill" />
                )}
              </button>
            </div>
            {audienceKind === "custom" && (
              <div className="audience-custom-editor">
                <Field label="受众与场景">
                  <textarea
                    rows={2}
                    maxLength={2000}
                    placeholder="例如：面向儿童摄影影楼老板，分享如何提升客户体验"
                    value={customAudience.description}
                    disabled={busy}
                    onCompositionStart={() => setComposing(true)}
                    onCompositionEnd={() => setComposing(false)}
                    onChange={(e) =>
                      editCustom({ description: e.target.value, brief: "" })
                    }
                  />
                </Field>
                <div
                  ref={generateActions}
                  className="audience-generate-actions"
                >
                  <small>
                    点击后调用已配置的内容模型，生成完成再创建演讲。
                  </small>
                  <Button
                    type="button"
                    disabled={
                      busy || composing || !customAudience.description.trim()
                    }
                    onClick={() => {
                      setCancelled(false);
                      draft.current?.retry();
                    }}
                  >
                    <Sparkle size={16} />
                    {draftState.status === "error"
                      ? "重试生成"
                      : customReady
                        ? "重新生成"
                        : "生成专属倾向"}
                  </Button>
                </div>
                {draftState.error && (
                  <p className="error-text" role="alert">
                    {draftState.error} 可重试，或选择上方行业继续。
                  </p>
                )}
                {cancelled && (
                  <p className="detail-help" role="status">
                    已取消，输入已保留。可重新生成或选择常用行业。
                  </p>
                )}
                {customReady && (
                  <div className="audience-ready" role="status">
                    <CheckCircle size={17} weight="fill" />
                    专属倾向已就绪，可查看或修改后创建。
                  </div>
                )}
                {reviewingCustom && (
                  <details className="audience-details">
                    <summary>查看并修改说明</summary>
                    <Field label="受众与行业语境（可编辑）">
                      <textarea
                        rows={7}
                        maxLength={10000}
                        disabled={busy}
                        value={customAudience.brief}
                        onChange={(e) =>
                          editCustom({
                            ...customAudience,
                            brief: e.target.value,
                          })
                        }
                      />
                    </Field>
                  </details>
                )}
              </div>
            )}
            {audienceKind !== "none" && audienceKind !== "custom" && (
              <p className="audience-ready" role="status">
                <CheckCircle size={17} weight="fill" />
                已选{" "}
                {AUDIENCE_PRESETS.find((p) => p.id === audienceKind)?.label}
                ，内置说明可直接使用，无需生成。
              </p>
            )}
            <details className="new-project-options">
              <summary>
                配色调整（可选）
                <span>{choices.palette?.name || "沿用风格"}</span>
              </summary>
              <DesignOptionsEditor
                value={choices}
                onChange={setChoices}
                styleId={styleId}
                disabled={busy}
                hideAudience
              />
            </details>
          </div>
          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="modal-actions">
          <Button
            type="button"
            disabled={busy || generating}
            onClick={step === 1 ? close : () => setStep(1)}
          >
            {step === 1 ? (
              "取消"
            ) : (
              <>
                <ArrowLeft size={16} />
                上一步
              </>
            )}
          </Button>
          <Button
            type="submit"
            variant="primary"
            loading={busy}
            disabled={
              generating ||
              !canContinue ||
              (step === 2 && (!customReady || !validDesignOptions(choices)))
            }
          >
            {step === 1 ? "下一步 · 内容倾向" : "创建并写第一段"}
            <ArrowRight size={17} />
          </Button>
        </div>
      </form>
      {generating && (
        <Modal
          title="正在生成专属内容倾向"
          subtitle="根据你填写的受众与场景，整理表达重点和使用边界。"
          onClose={cancelGeneration}
          className="audience-progress-modal"
        >
          <div
            className="audience-progress"
            role="status"
            aria-live="polite"
            aria-busy="true"
          >
            <SpinnerGap size={34} className="spin" />
            <strong>内容模型正在处理</strong>
            <p>{customAudience.description}</p>
            <small>完成后可查看和修改，再创建演讲。</small>
          </div>
          <p className="audience-elapsed">
            已等待 {elapsed} 秒
            {elapsed >= 30
              ? " · 仍在等待模型返回，可取消后重试。"
              : " · 通常需要几十秒"}
          </p>
          <div className="modal-actions">
            <Button type="button" onClick={cancelGeneration}>
              取消生成，返回修改
            </Button>
          </div>
        </Modal>
      )}
    </Modal>
  );
}
