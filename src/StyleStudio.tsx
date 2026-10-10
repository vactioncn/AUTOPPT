import { PageNumberHelp } from "./PageNumberHelp";
import {
  DesignOptionsEditor,
  emptyDesignOptions,
  validDesignOptions,
} from "./DesignOptionsEditor";
import type { DesignOptions } from "./types";
import { useState, useEffect, useRef, useCallback, useId } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Stop,
  FloppyDisk,
  FileText,
} from "@phosphor-icons/react";
import type { Style, Trial, Project, ProjectSummary } from "./types";
import { api, post, active, asset } from "./api";
import { Button, Field, Status } from "./components";
import { SceneView } from "./SceneView";
import { RawPromptDetails } from "./RawPromptDetails";
import { CopyReview } from "./CopyReview";
import { TrialCopyPreview } from "./TrialCopyPreview";
import { StyleVersions } from "./StyleVersions";
import { STYLE_DEMOS, STYLE_COVER } from "../shared/style-demo.mjs";
import "./style-studio.css";
import { isSlideAspect } from "../shared/image-output.mjs";
export function StyleStudio({
  style,
  onBack,
  refreshStyles,
  notify,
}: {
  style: Style;
  onBack: () => void;
  refreshStyles: () => Promise<void>;
  notify: (s: string) => void;
}) {
  const key = "autoppt-style-trial:" + style.id;
  const [initial] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(key) || "{}");
    } catch {
      return {};
    }
  });
  const [choices, setChoices] = useState<DesignOptions>(
    initial.designOptions || emptyDesignOptions,
  );
  const [optionsBusy, setOptionsBusy] = useState(false);
  const [loadedImage, setLoadedImage] = useState<{
    image: string;
    width: number;
    height: number;
  } | null>(null);
  const [notes, setNotes] = useState<string>(
      initial.notes ?? STYLE_DEMOS[0].notes,
    ),
    [feedback, setFeedback] = useState<string>(initial.feedback || ""),
    [copyFeedback, setCopyFeedback] = useState<string>(
      initial.copyFeedback || "",
    ),
    [rules, setRules] = useState<string>(initial.rules || style.rules),
    [selectedId, setSelectedId] = useState<string>(initial.selectedId || ""),
    [trials, setTrials] = useState<Trial[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [projects, setProjects] = useState<ProjectSummary[] | null>(null),
    [source, setSource] = useState<Project | null>(null);
  const hydrated = useRef(false),
    pending = useRef<string | null>(localStorage.getItem(key + ":pending")),
    sourceRequest = useRef(0);
  const setPending = (id: string | null) => {
    pending.current = id;
    if (id) localStorage.setItem(key + ":pending", id);
    else localStorage.removeItem(key + ":pending");
  };
  const refresh = useCallback(async () => {
    const d = await api<{ trials: Trial[] }>(`/styles/${style.id}/trials`);
    setTrials(d.trials);
    if (!hydrated.current) {
      hydrated.current = true;
      if (!initial.selectedId && !initial.notes && d.trials.length) {
        const t = d.trials.find((t) => t.engine === "image") || d.trials[0];
        setSelectedId(t.id);
        setNotes(t.notes);
        setChoices(t.designOptions || emptyDesignOptions);
        setRules(t.styleSnapshot.rules);
      }
    }
    const t = d.trials.find((t) => t.id === pending.current);
    if (t && !active(t.status)) {
      if (t.purpose !== "cover") setRules(t.styleSnapshot.rules);
      setPending(null);
      if (t.purpose === "cover") await refreshStyles();
    }
    setLoading(false);
  }, [style.id]);
  useEffect(() => {
    refresh().catch((e) => {
      setError(e.message);
      setLoading(false);
    });
    const timer = setInterval(() => refresh().catch(() => {}), 1800);
    return () => clearInterval(timer);
  }, [refresh]);
  useEffect(() => {
    localStorage.setItem(
      key,
      JSON.stringify({
        notes,
        feedback,
        copyFeedback,
        rules,
        selectedId,
        designOptions: choices,
      }),
    );
  }, [key, notes, feedback, copyFeedback, rules, selectedId, choices]);
  const selected = trials.find((t) => t.id === selectedId),
    running = trials.find((t) => active(t.status)),
    disabled = busy || optionsBusy || !!running || loading;
  const imageSize =
    selected?.image && loadedImage?.image === selected.image
      ? loadedImage
      : selected?.plan?.imageResponse;
  const wrongAspect =
    !!imageSize && !isSlideAspect(imageSize.width, imageSize.height);
  const edited =
    !!selected &&
    (selected.notes !== notes ||
      selected.styleSnapshot.rules !== rules ||
      JSON.stringify(selected.designOptions || emptyDesignOptions) !==
        JSON.stringify(choices));
  const act = async (fn: () => Promise<void>, propagate = false) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
      if (propagate) throw e;
    } finally {
      setBusy(false);
    }
  };
  const choose = (t: Trial) => {
    setSelectedId(t.id);
    setNotes(t.notes);
    setChoices(t.designOptions || emptyDesignOptions);
    setRules(t.styleSnapshot.rules);
    setFeedback("");
    setCopyFeedback("");
  };
  const start = (mode: string) =>
    act(async () => {
      if (!validDesignOptions(choices))
        throw new Error("请填写有效的内容倾向与配色说明。");
      const t = await post<Trial>(`/styles/${style.id}/trials`, {
        notes,
        designOptions: choices,
        rules,
        feedback,
        copyFeedback,
        mode,
        parentId:
          selected?.engine === "image" &&
          selected.purpose !== "cover" &&
          selected.status === "completed"
            ? selected.id
            : undefined,
      });
      setSelectedId(t.id);
      setPending(t.id);
    });
  const [editorView, setEditorView] = useState<"content" | "refine">("content");
  const editorId = useId();
  const editorTabs = [
    { id: "content", label: "试做内容" },
    { id: "refine", label: "调整效果" },
  ] as const;
  const canRefine =
    selected?.engine === "image" &&
    selected.purpose !== "cover" &&
    selected.status === "completed" &&
    !!selected.image;
  const generationDisabled =
    disabled || !validDesignOptions(choices) || !notes.trim() || !rules.trim();
  return (
    <div className="page style-studio">
      <Button variant="ghost" onClick={onBack}>
        <ArrowLeft size={16} />
        返回风格库
      </Button>
      <div className="page-heading studio-heading">
        <div>
          <h1>{style.name} · 试做一页</h1>
          <p>试做不会修改已保存的风格；满意后可将调整保存为新版本。</p>
        </div>
        <Button
          disabled={disabled}
          onClick={() => {
            setSelectedId("");
            setRules(style.rules);
            setFeedback("");
            setCopyFeedback("");
            setEditorView("content");
          }}
        >
          从正式风格重新开始
        </Button>
      </div>
      <details className="studio-cover-tools">
        <summary>风格封面</summary>
        <section className="unified-style-cover" aria-label="统一风格封面">
          <div>
            <h2>统一封面</h2>
            <strong>{STYLE_COVER.title}</strong>
            <p>{STYLE_COVER.subtitle}</p>
            <p className="detail-help">
              所有风格使用同一文案，按已保存的风格设计横向 16:9
              封面。通过画幅检查后自动更新封面；不会带入下方的讲稿、调试意见、临时配色或内容倾向。
            </p>
          </div>
          <Button
            disabled={disabled || !style.rules?.trim()}
            onClick={() =>
              act(async () => {
                const capabilities = await api("/bootstrap");
                if (!capabilities.features?.unifiedStyleCover)
                  throw new Error(
                    "当前后台还是旧版本，未加载统一封面功能。请在制作任务完成后重新打开 AutoPPT；仅刷新页面不会更新后台。",
                  );
                const t = await post<Trial>(`/styles/${style.id}/trials`, {
                  purpose: "cover",
                });
                setSelectedId(t.id);
                setPending(t.id);
              })
            }
          >
            {style.cover ? "重新生成统一封面" : "生成统一封面"}
          </Button>
        </section>
      </details>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {running && (
        <div className="inline-notice">
          <div>
            <strong>{running.stage || "等待开始"}</strong>
            <p>页面完成后会自动显示。</p>
          </div>
          <Button
            variant="ghost"
            onClick={() =>
              act(async () => {
                await post(`/jobs/${running.jobId}/cancel`);
              })
            }
          >
            <Stop size={15} />
            停止试做
          </Button>
        </div>
      )}
      <div className="studio-workspace">
        <div className="studio-preview-column">
          <div className="studio-preview-heading">
            <h2>试做预览</h2>
            {canRefine && (
              <Button
                variant="ghost"
                disabled={disabled}
                onClick={() => setEditorView("refine")}
              >
                调整这一页
                <ArrowRight size={15} />
              </Button>
            )}
          </div>
          <section className="web-studio-canvas" aria-label="本次图片试做">
            {selected?.scene ? (
              <SceneView scene={selected.scene} label="本次试做页面" />
            ) : selected?.image ? (
              <>
                <div className="studio-slide-preview">
                  <img
                    key={selected.image}
                    src={asset(selected.image)}
                    alt="本次风格试做图片"
                    onLoad={(event) =>
                      setLoadedImage({
                        image: selected.image!,
                        width: event.currentTarget.naturalWidth,
                        height: event.currentTarget.naturalHeight,
                      })
                    }
                  />
                </div>
                {wrongAspect && (
                  <p className="error-text" role="alert">
                    这张历史图片为 {imageSize!.width}×{imageSize!.height}
                    ，不符合横向 16:9
                    演讲画幅。原图已保留；新生成会检查比例，异常结果不会更新封面。
                  </p>
                )}
                <p className="studio-caption">
                  {edited
                    ? "输入已有调整，当前显示上一次生成的图片。"
                    : "图片已保存"}{" "}
                  ·{" "}
                  <a href={asset(selected.image) + "?download=screen"} download>
                    保存图片
                  </a>
                </p>
                {selected.purpose === "cover" && (
                  <p className="detail-help">
                    统一封面示例 ·{" "}
                    {style.coverTrialId === selected.id
                      ? wrongAspect
                        ? "历史封面画幅异常，需重新生成"
                        : "已更新为风格封面"
                      : "保留的封面版本；如风格已修改，请重新生成。"}
                  </p>
                )}
              </>
            ) : (
              <div className="studio-empty">
                <FileText size={36} />
                <p>
                  {running
                    ? "正在组织这一页的内容…"
                    : "右侧已准备好示例，生成一页看看。"}
                </p>
              </div>
            )}
            {selected?.scene && (
              <p className="studio-caption">
                {edited
                  ? "输入已有调整，当前仍显示上一次结果。"
                  : "历史网页记录 · 重新试做将生成图片"}
              </p>
            )}
          </section>
          {selected &&
            ["failed", "cancelled", "interrupted"].includes(
              selected.status,
            ) && (
              <div className="inline-notice warm">
                <div>
                  <strong>这版尚未完成</strong>
                  <p>{selected.error}</p>
                </div>
                <Button
                  disabled={disabled}
                  onClick={() =>
                    act(async () => {
                      await post(`/jobs/${selected.jobId}/retry`);
                      setPending(selected.id);
                    })
                  }
                >
                  继续这版试做
                </Button>
              </div>
            )}
          <div className="studio-result-save">
            <div>
              <strong>
                {selected?.appliedAt
                  ? "这版已保存为正式风格"
                  : "将调整保存为风格新版本"}
              </strong>
              <p>
                {edited
                  ? "输入有修改，再试做后可保存。"
                  : selected?.purpose === "cover"
                    ? "这是封面，使用已保存的正式风格。"
                    : selected?.appliedAt
                      ? "后续制作将沿用这版规则。"
                      : "当前风格已保存，确认后可更新为这版规则。"}
              </p>
            </div>
            <Button
              disabled={
                disabled ||
                !selected?.image ||
                selected.purpose === "cover" ||
                selected.engine !== "image" ||
                selected.status !== "completed" ||
                edited ||
                !!selected.appliedAt
              }
              onClick={() =>
                act(async () => {
                  await post(
                    `/styles/${style.id}/trials/${selected!.id}/apply`,
                  );
                  await refreshStyles();
                  notify("这版规则已保存为正式风格。");
                })
              }
            >
              <FloppyDisk size={16} />
              保存这版为正式风格
            </Button>
          </div>
          {selected?.plan && (
            <details className="studio-rules studio-rule-details">
              <summary>查看上屏文案与生成依据</summary>
              <TrialCopyPreview
                key={selected.id}
                trial={selected}
                designOptions={choices}
                notes={notes}
                rules={rules}
                notify={notify}
              />
              <details className="studio-analysis">
                <summary>查看生成依据</summary>
                {selected.plan.contentBrief && (
                  <>
                    <h4>这一页要表达什么</h4>
                    <p>{selected.plan.contentBrief.claim}</p>
                    <p>{selected.plan.contentBrief.visualTask}</p>
                    {selected.plan.selectionReason && (
                      <p>{selected.plan.selectionReason}</p>
                    )}
                  </>
                )}
                <RawPromptDetails plan={selected.plan} />
                <h4>内容与表达</h4>
                <p>{selected.plan.layout}</p>
                <p>{selected.plan.rationale}</p>
                <h4>图形与风格细节</h4>
                <p>{selected.plan.visual}</p>
                {selected.plan.styleFeatures?.map((feature, i) => (
                  <p key={i}>{feature}</p>
                ))}
                <p>{selected.plan.adaptations}</p>
                {selected.plan.displayText.map((s, i) => (
                  <p key={i}>{s}</p>
                ))}
                <CopyReview copy={selected.plan.screenCopy} />
              </details>
            </details>
          )}
          <section className="studio-history">
            <div className="section-heading">
              <h2>
                试做记录 <span>{trials.length}</span>
              </h2>
            </div>
            {!trials.length && (
              <p className="detail-help">
                每次试做都保留在这里，可随时切回查看。
              </p>
            )}
            <div className="web-studio-history">
              {trials.map((t, i) => (
                <button
                  key={t.id}
                  disabled={disabled}
                  aria-pressed={t.id === selectedId}
                  onClick={() => choose(t)}
                >
                  {t.scene ? (
                    <SceneView scene={t.scene} />
                  ) : t.image ? (
                    <img src={asset(t.image)} alt="历史图片" />
                  ) : (
                    <Status>尚未完成</Status>
                  )}
                  <strong>
                    试做 {trials.length - i} ·{" "}
                    {t.purpose === "cover"
                      ? "封面"
                      : t.scene
                        ? "历史网页"
                        : t.image
                          ? "图片"
                          : "未完成"}
                  </strong>
                </button>
              ))}
            </div>
          </section>
        </div>
        <section className="studio-editor" aria-label="试做编辑区">
          <div
            className="studio-editor-tabs"
            role="tablist"
            aria-label="试做操作"
          >
            {editorTabs.map((tab, index) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                id={`${editorId}-${tab.id}-tab`}
                aria-controls={`${editorId}-${tab.id}-panel`}
                aria-selected={editorView === tab.id}
                tabIndex={editorView === tab.id ? 0 : -1}
                onClick={() => setEditorView(tab.id)}
                onKeyDown={(event) => {
                  const next =
                    event.key === "ArrowRight"
                      ? (index + 1) % editorTabs.length
                      : event.key === "ArrowLeft"
                        ? (index + editorTabs.length - 1) % editorTabs.length
                        : event.key === "Home"
                          ? 0
                          : event.key === "End"
                            ? editorTabs.length - 1
                            : -1;
                  if (next < 0) return;
                  event.preventDefault();
                  setEditorView(editorTabs[next].id);
                  document
                    .getElementById(`${editorId}-${editorTabs[next].id}-tab`)
                    ?.focus();
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="studio-editor-body">
            <div
              role="tabpanel"
              id={`${editorId}-content-panel`}
              aria-labelledby={`${editorId}-content-tab`}
              hidden={editorView !== "content"}
              tabIndex={0}
            >
              <div className="studio-section-heading">
                <h2>一页试做讲稿</h2>
                <Button
                  variant="ghost"
                  disabled={disabled}
                  onClick={() =>
                    act(async () => {
                      const d = await api<{ projects: ProjectSummary[] }>(
                        "/bootstrap",
                      );
                      setProjects(d.projects);
                    })
                  }
                >
                  <FileText size={16} />
                  从已有页面选
                </Button>
              </div>
              {projects && (
                <div className="studio-sources">
                  <Field label="选择演讲项目">
                    <select
                      defaultValue=""
                      onChange={async (e) => {
                        const request = ++sourceRequest.current;
                        setSource(null);
                        try {
                          const next = e.target.value
                            ? await api<Project>("/projects/" + e.target.value)
                            : null;
                          if (request === sourceRequest.current)
                            setSource(next);
                        } catch (e) {
                          if (request === sourceRequest.current)
                            setError((e as Error).message);
                        }
                      }}
                    >
                      <option value="">选择项目</option>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.title}
                        </option>
                      ))}
                    </select>
                  </Field>
                  {source?.slides.map((s, i) => (
                    <button
                      key={s.id}
                      onClick={() => {
                        setNotes(s.notes);
                        setChoices(source.designOptions || emptyDesignOptions);
                        setProjects(null);
                      }}
                    >
                      {i + 1} · {s.plan?.title || s.notes.slice(0, 24)}
                    </button>
                  ))}
                </div>
              )}
              <Field label="试做讲稿">
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  disabled={disabled}
                  placeholder="粘贴一段完整的逐字稿，画面会提炼重点，原文保留。"
                />
              </Field>
              <details className="studio-examples">
                <summary>换一段示例</summary>
                <div className="web-studio-actions" aria-label="示例文案">
                  {STYLE_DEMOS.map((demo) => (
                    <Button
                      key={demo.id}
                      disabled={disabled}
                      onClick={() => {
                        setNotes(demo.notes);
                        setFeedback("");
                        setCopyFeedback("");
                        setSelectedId("");
                        setPending(null);
                      }}
                    >
                      使用{demo.name}示例
                    </Button>
                  ))}
                </div>
              </details>
              <p className="detail-help">
                试做草稿自动保存在本机，仅用于试做。讲稿、受众与配色不会保存为正式风格。
              </p>
              <details className="studio-options">
                <summary>内容倾向与配色（可选）</summary>
                <DesignOptionsEditor
                  value={choices}
                  onChange={setChoices}
                  styleId={style.id}
                  rules={rules}
                  disabled={disabled}
                  onBusyChange={setOptionsBusy}
                />
              </details>
              <details className="studio-advanced">
                <summary>高级设置</summary>
                <h3>设计提示词原文</h3>
                <p className="detail-help">
                  {rules === style.rules
                    ? "正在使用已保存的正式提示词。"
                    : "这是试做中的提示词，尚未保存为正式风格。"}
                  修改后先试做，再确认保存。
                </p>
                <Field label="试做设计规范">
                  <textarea
                    className="rules-editor"
                    value={rules}
                    onChange={(e) => setRules(e.target.value)}
                    disabled={disabled}
                  />
                </Field>
                <p className="detail-help">
                  只在明确的页码位置填入动态编号，其他文字原样用于出图。
                </p>
                <PageNumberHelp rules={rules} />
                <StyleVersions
                  style={style}
                  disabled={disabled || rules !== style.rules}
                  blockedReason={
                    rules !== style.rules
                      ? "试做区有不同的提示词。先保存为正式风格，或从正式风格重新开始，再恢复历史版本。"
                      : undefined
                  }
                  onRestored={async (saved, changed) => {
                    setRules(saved.rules);
                    setSelectedId("");
                    await refreshStyles();
                    notify(
                      changed
                        ? "已恢复并保存为新版本。"
                        : "当前内容已一致，无需恢复。",
                    );
                  }}
                />
              </details>
            </div>
            <div
              role="tabpanel"
              id={`${editorId}-refine-panel`}
              aria-labelledby={`${editorId}-refine-tab`}
              hidden={editorView !== "refine"}
              tabIndex={0}
            >
              <h2>哪里还需要调整？</h2>
              <Field label="画面调整（可选）">
                <textarea
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  disabled={disabled}
                  placeholder="例如：换成左右对比；标题更轻，解释文字放到右侧。"
                />
              </Field>
              <Field label="上屏文字调整（可选）">
                <textarea
                  value={copyFeedback}
                  onChange={(e) => setCopyFeedback(e.target.value)}
                  disabled={disabled}
                  placeholder="例如：只保留核心问题，背景说明留在口播。留空则复用已提炼文案。"
                />
              </Field>
              <p className="detail-help">
                {canRefine
                  ? "写下想改的地方，再生成一版对比。画面调整不会改写风格提示词。"
                  : "先在“试做内容”生成一页，再针对成图调整。"}
              </p>
            </div>
          </div>
          <div className="studio-editor-footer">
            <p>
              {running
                ? "正在生成，完成后自动显示。"
                : editorView === "refine"
                  ? "生成一版新结果，原图保留。"
                  : "试做草稿自动保存，点击下方才会生成。"}
            </p>
            {editorView === "refine" ? (
              <Button
                variant="primary"
                disabled={
                  generationDisabled ||
                  !canRefine ||
                  (!feedback.trim() && !copyFeedback.trim())
                }
                onClick={() => start("redesign")}
              >
                只调整这一页
                <ArrowRight size={16} />
              </Button>
            ) : (
              <Button
                variant="primary"
                disabled={generationDisabled}
                onClick={() => start("baseline")}
              >
                生成图片试做
                <ArrowRight size={16} />
              </Button>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
