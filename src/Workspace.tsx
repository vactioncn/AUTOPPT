import {
  DesignOptionsEditor,
  emptyDesignOptions,
  validDesignOptions,
} from "./DesignOptionsEditor";
import type { DesignOptions } from "./types";
import { RawPromptDetails } from "./RawPromptDetails";
import { useState, useEffect, useRef, useCallback } from "react";
import {
  Plus,
  ArrowRight,
  ArrowUp,
  CheckCircle,
  CheckSquare,
  Square,
  Palette,
  Scissors,
  Unite,
  ArrowCounterClockwise,
  ArrowsClockwise,
  WarningCircle,
  SpinnerGap,
  FileText,
  ArrowLeft,
  CaretLeft,
  CaretRight,
  PencilSimple,
  Clock,
  X,
  Eye,
  FloppyDisk,
  Stop,
  DownloadSimple,
  Paperclip,
  ChartBar,
} from "@phosphor-icons/react";
import { api, post, patch, asset, active, downloadPresentation } from "./api";
import { SceneView } from "./SceneView";
import type {
  Project,
  Style,
  Slide,
  Job,
  Settings,
  ContentAttachment,
} from "./types";
import { ProjectReport } from "./ProjectReport";
import { CopyReview } from "./CopyReview";
import { Button, Modal, Field, SlideImage, Status } from "./components";

export function Workspace({
  id,
  styles,
  settings,
  notify,
  onRefresh,
  onSettings,
}: {
  id: string;
  styles: Style[];
  settings: Settings;
  notify: (s: string) => void;
  onRefresh: () => Promise<void>;
  onSettings: () => void;
}) {
  const [editingOptions, setEditingOptions] = useState<DesignOptions | null>(
    null,
  );
  const [optionsBusy, setOptionsBusy] = useState(false);
  const [project, setProject] = useState<Project | null>(null),
    [jobs, setJobs] = useState<Job[]>([]),
    [draft, setDraft] = useState(""),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(""),
    [submitting, setSubmitting] = useState(false),
    [filter, setFilter] = useState("latest"),
    [selected, setSelected] = useState<string[]>([]),
    [detail, setDetail] = useState<string | null>(null),
    [split, setSplit] = useState<string | null>(null),
    [proposalOpen, setProposalOpen] = useState(false),
    [showScript, setShowScript] = useState(false),
    [exportOpen, setExportOpen] = useState(false),
    [reportOpen, setReportOpen] = useState(false),
    [renaming, setRenaming] = useState(false);
  const initialized = useRef(false),
    draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    draftRequest = useRef<Promise<unknown>>(Promise.resolve()),
    composer = useRef<HTMLTextAreaElement>(null);
  const refresh = useCallback(async () => {
    const [p, j] = await Promise.all([
      api<Project>("/projects/" + id),
      api<Job[]>("/jobs?projectId=" + id),
    ]);
    setProject((prev) => (!prev || p.revision >= prev.revision ? p : prev));
    setJobs(j);
    if (!initialized.current) {
      setDraft(localStorage.getItem("autoppt-draft:" + id) ?? p.draft);
      initialized.current = true;
    }
  }, [id]);
  useEffect(() => {
    refresh().catch((e) => setError(e.message));
    const t = setInterval(
      () => refresh().catch((e) => setError(e.message)),
      1800,
    );
    return () => {
      clearInterval(t);
      if (draftTimer.current) clearTimeout(draftTimer.current);
    };
  }, [refresh]);
  const run = async (fn: () => Promise<unknown>, message?: string) => {
    setError("");
    try {
      await fn();
      await refresh();
      await onRefresh();
      if (message) notify(message);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  function updateDraft(text: string) {
    localStorage.setItem("autoppt-draft:" + id, text);
    setDraft(text);
    setSaving(true);
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => {
      draftRequest.current = patch("/projects/" + id, { draft: text })
        .then(() => {
          setSaving(false);
          if (localStorage.getItem("autoppt-draft:" + id) === text)
            localStorage.removeItem("autoppt-draft:" + id);
        })
        .catch((e) => {
          setSaving(false);
          setError("草稿保存失败：" + e.message);
        });
    }, 700);
  }
  const add = async () => {
    if (!draft.trim()) return;
    setSubmitting(true);
    setError("");
    if (draftTimer.current) clearTimeout(draftTimer.current);
    try {
      await draftRequest.current;
      await post("/projects/" + id + "/batches", { text: draft });
      localStorage.removeItem("autoppt-draft:" + id);
      setDraft("");
      setSaving(false);
      setFilter("latest");
      await refresh();
      await onRefresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };
  if (!project)
    return (
      <div className="page loading-page">
        {error ? (
          <p className="error-text">{error}</p>
        ) : (
          <SpinnerGap className="spin" size={24} />
        )}
      </div>
    );
  const activeJobs = jobs.filter((j) => active(j.status));
  const busy = activeJobs[0];
  const pageBusy = (sid: string) =>
    activeJobs.some(
      (j) => j.type !== "render" || !j.slideIds || j.slideIds.includes(sid),
    );
  const lastJob = jobs[0];
  const currentBatch = project.batches.at(-1);
  const sourceBatch =
    filter === "latest" || filter === "all"
      ? currentBatch
      : project.batches.find((b) => b.id === filter);
  const incomplete = project.batches.filter((b) => !b.slideIds.length);
  const style = styles.find((s) => s.id === project.styleId);
  const shown =
    filter === "all"
      ? project.slides
      : project.slides.filter((s) =>
          s.batchIds.includes(
            filter === "latest" ? currentBatch?.id || "" : filter,
          ),
        );
  const detailSlide = project.slides.find((s) => s.id === detail);
  const splitSlide = project.slides.find((s) => s.id === split);
  const selectedPages = project.slides.filter((s) => selected.includes(s.id));
  const select = (sid: string) =>
    setSelected((old) =>
      old.includes(sid) ? old.filter((s) => s !== sid) : [...old, sid],
    );
  const merge = () =>
    run(async () => {
      await post("/projects/" + id + "/proposal", {
        type: "merge",
        slideIds: selected,
      });
      setSelected([]);
    }, "正在准备合并方案，原页面会保留到你确认。");
  const pending = project.slides.filter(
    (s) => !(s.image || s.scene) || s.status === "error",
  );
  return (
    <div className="page workspace">
      <div className="workspace-heading">
        <div>
          <div className="project-title-row">
            <h1>{project.title}</h1>
            <button
              className="icon-btn"
              aria-label="修改项目名称"
              onClick={() => setRenaming(true)}
            >
              <PencilSimple size={18} />
            </button>
          </div>
          <p>
            {project.batches.length} 段逐字稿<span>·</span>
            {project.slides.length} 页画面<span>·</span>
            {project.slides
              .reduce((n, s) => n + s.notes.trim().length, 0)
              .toLocaleString()}{" "}
            字
          </p>
        </div>
        <div className="project-output-actions">
          <Button onClick={() => setReportOpen(true)}>
            <ChartBar size={18} />
            报告
          </Button>
          <Button
            onClick={() => setExportOpen(true)}
            disabled={!project.slides.length && !project.batches.length}
          >
            <DownloadSimple size={18} />
            导出 PPT
          </Button>
        </div>
      </div>
      <div className="project-controls">
        <div className="project-style">
          <Palette size={17} />
          <span>当前风格</span>
          <select
            aria-label="项目视觉风格"
            value={project.styleId}
            disabled={!!busy}
            onChange={(e) =>
              run(
                () => patch("/projects/" + id, { styleId: e.target.value }),
                "继续制作和重新设计将使用这个风格，已生成画面保持原样。",
              )
            }
          >
            {(!style || style.deletedAt) && (
              <option value={project.styleId} disabled>
                {style?.name || "原风格"}（已删除，请另选）
              </option>
            )}
            {styles
              .filter((s) => !!s.rules && !s.deletedAt)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </select>
        </div>
        <Button
          disabled={!!busy || submitting}
          onClick={() =>
            setEditingOptions(
              structuredClone(project.designOptions || emptyDesignOptions),
            )
          }
        >
          内容倾向与配色
        </Button>
        <div className="quiet-meta">
          <span>16:9 宽屏</span>
          <span>逐页保留完整讲稿</span>
        </div>
      </div>
      <p className="generation-style-help">
        内容倾向：{project.designOptions?.audience?.description || "未限定"} ·
        配色：{project.designOptions?.palette?.name || "沿用风格"}。
        继续制作和重新设计使用当前设置，已有画面保持原样；可选中页面批量重做。只换配色会复用已确认文案。
      </p>
      {style?.deletedAt && (
        <div className="inline-notice warm">
          <WarningCircle size={20} />
          <span>
            当前风格已删除，请在上方选择其他风格。已有页面与备注已保留。
          </span>
        </div>
      )}
      {(!settings.text.hasKey || !settings.image.hasKey) && (
        <div className="inline-notice">
          <WarningCircle size={20} />
          <span>
            先连接模型，即可自动分析文稿和生成画面。草稿可以先写下来。
          </span>
          <Button onClick={onSettings}>连接模型</Button>
        </div>
      )}
      {error && (
        <div className="error-banner" role="alert">
          <WarningCircle size={19} />
          <span>{error}</span>
          <button
            className="icon-btn"
            aria-label="关闭错误提示"
            onClick={() => setError("")}
          >
            <X size={18} />
          </button>
        </div>
      )}
      {activeJobs.length > 0 && (
        <p>
          后台制作：{activeJobs.filter((j) => j.status === "running").length}{" "}
          项进行中，{activeJobs.filter((j) => j.status === "queued").length}{" "}
          项排队。最多同时执行 4 项，可继续修改其他页面。
        </p>
      )}
      {activeJobs.map((busy) => (
        <div className="job-banner" role="status" key={busy.id}>
          <SpinnerGap className="spin" size={22} />
          <div>
            <strong>
              {busy.slideIds?.length === 1
                ? `第 ${project.slides.findIndex((s) => s.id === busy.slideIds![0]) + 1} 页 · `
                : ""}
              {busy.stage}
            </strong>
            <span>已完成的内容会自动保存，可以继续编辑其他空闲页面。</span>
          </div>
          {busy.total > 0 && (
            <span className="job-count">
              {busy.done} / {busy.total}
            </span>
          )}
          <Button
            variant="ghost"
            onClick={() => run(() => post("/jobs/" + busy.id + "/cancel"))}
          >
            <Stop size={15} />
            停止
          </Button>
          {busy.total > 0 && (
            <div
              className="job-progress"
              style={{
                transform: `scaleX(${Math.max(0.03, busy.done / busy.total)})`,
              }}
            />
          )}
        </div>
      ))}
      {!busy &&
        lastJob &&
        ["failed", "interrupted", "cancelled"].includes(lastJob.status) && (
          <div className="inline-notice warm">
            <WarningCircle size={20} />
            <div>
              <strong>{lastJob.stage}</strong>
              <p>{lastJob.error}</p>
            </div>
            <Button
              onClick={() => run(() => post("/jobs/" + lastJob.id + "/retry"))}
            >
              继续未完成任务
              <ArrowRight size={16} />
            </Button>
          </div>
        )}
      {!busy &&
        incomplete
          .filter((b) => b.jobId !== lastJob?.id)
          .map((b) => (
            <div className="inline-notice warm" key={b.id}>
              <WarningCircle size={20} />
              <div>
                <strong>{b.label} 尚未完成拆分</strong>
                <p>原文已保存。可以继续完成这一段的图片制作。</p>
              </div>
              {b.jobId && (
                <Button
                  onClick={() => run(() => post("/jobs/" + b.jobId + "/retry"))}
                >
                  继续这一段
                  <ArrowRight size={16} />
                </Button>
              )}
            </div>
          ))}
      {project.proposal && (
        <div className="inline-notice proposal-notice">
          <CheckCircle size={22} />
          <div>
            <strong>
              {project.proposal.type === "split" ? "拆分" : "合并"}方案已准备好
            </strong>
            <p>
              预览 {project.proposal.notes.length} 页新方案，确认后再生成画面。
            </p>
          </div>
          <Button variant="primary" onClick={() => setProposalOpen(true)}>
            查看新方案
            <ArrowRight size={16} />
          </Button>
        </div>
      )}
      {sourceBatch && (
        <details className="submitted-manuscript">
          <summary>
            {sourceBatch.label} · 提交时的原文{" "}
            <span>{sourceBatch.text.length} 字</span>
          </summary>
          <p>{sourceBatch.text}</p>
        </details>
      )}
      {project.slides.length > 0 && (
        <>
          <div className="gallery-toolbar">
            <div className="segmented">
              <button
                className={filter === "latest" && !showScript ? "active" : ""}
                onClick={() => {
                  setFilter("latest");
                  setShowScript(false);
                  setSelected([]);
                }}
              >
                本次制作{" "}
                <span>
                  {
                    project.slides.filter((s) =>
                      s.batchIds.includes(currentBatch?.id || ""),
                    ).length
                  }
                </span>
              </button>
              <button
                className={filter === "all" && !showScript ? "active" : ""}
                onClick={() => {
                  setFilter("all");
                  setShowScript(false);
                  setSelected([]);
                }}
              >
                全部页面 <span>{project.slides.length}</span>
              </button>
              <button
                className={showScript ? "active" : ""}
                onClick={() => {
                  setShowScript(true);
                  setSelected([]);
                }}
              >
                <FileText size={15} />
                演说稿
              </button>
            </div>
            <div className="gallery-actions">
              {!busy && pending.some((s) => !(s.image || s.scene)) && (
                <Button
                  variant="ghost"
                  onClick={() =>
                    run(() =>
                      post("/projects/" + id + "/render", {
                        slideIds: pending
                          .filter((s) => !(s.image || s.scene))
                          .map((s) => s.id),
                        redesign: false,
                      }),
                    )
                  }
                >
                  <ArrowsClockwise size={15} />
                  补齐未生成页面
                </Button>
              )}
              {project.undo && (
                <Button
                  variant="ghost"
                  disabled={!!busy}
                  onClick={() =>
                    run(
                      () => post("/projects/" + id + "/undo"),
                      "已恢复调整前的页面。",
                    )
                  }
                >
                  <ArrowCounterClockwise size={15} />
                  撤销{project.undo.label}
                </Button>
              )}
              {project.batches.length > 1 && !showScript && (
                <select
                  className="batch-select"
                  aria-label="查看段落"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                >
                  <option value="latest">最近一段</option>
                  <option value="all">全部段落</option>
                  {project.batches.map((b, i) => (
                    <option value={b.id} key={b.id}>
                      第 {i + 1} 段 · {b.text.trim().slice(0, 12)}…
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>
          {showScript ? (
            <div className="manuscript-list">
              <div className="manuscript-intro">
                <h2>你的完整演说稿</h2>
                <p>按照页面顺序排列。点击任意一段，修改对应页面的讲稿。</p>
              </div>
              {project.slides.map((s, i) => (
                <button
                  key={s.id}
                  className="manuscript-row"
                  onClick={() => setDetail(s.id)}
                >
                  <span>{String(i + 1).padStart(2, "0")}</span>
                  <p>{s.notes}</p>
                  <PencilSimple size={16} />
                </button>
              ))}
            </div>
          ) : (
            <div className="slide-grid">
              {shown.map((s) => (
                <article
                  className={`slide-card ${selected.includes(s.id) ? "selected" : ""}`}
                  key={s.id}
                >
                  <button
                    className="slide-open"
                    onClick={() => setDetail(s.id)}
                    aria-label={`打开第 ${project.slides.indexOf(s) + 1} 页：${s.plan?.title || "页面"}`}
                  >
                    <SlideImage slide={s} />
                  </button>
                  <button
                    className={`slide-checkbox ${selected.includes(s.id) ? "checked" : ""}`}
                    disabled={!!busy}
                    onClick={() => select(s.id)}
                    aria-label={`选择第 ${project.slides.indexOf(s) + 1} 页`}
                  >
                    {selected.includes(s.id) ? (
                      <CheckSquare size={23} weight="fill" />
                    ) : (
                      <Square size={23} />
                    )}
                  </button>
                  <div className="slide-caption">
                    <span className="page-number">
                      {String(project.slides.indexOf(s) + 1).padStart(2, "0")}
                    </span>
                    <div>
                      <h3>{s.plan?.title || s.notes.trim().slice(0, 24)}</h3>
                      <p>
                        {s.notes.trim().length} 字讲稿
                        {s.versions.length > 0 &&
                          ` · ${s.versions.length + 1} 个版本`}
                      </p>
                      <p className="slide-style-label">
                        {s.image || s.scene ? "画面风格：" : "待制作："}
                        {s.image || s.scene
                          ? s.imageStyle?.name ||
                            styles.find((style) => style.id === s.styleId)
                              ?.name ||
                            "原风格"
                          : style?.name || "请选择风格"}
                      </p>
                    </div>
                    {s.status === "generating" ? (
                      <Status>制作中</Status>
                    ) : s.status === "error" ? (
                      <Status tone="warm">需重试</Status>
                    ) : s.stale ? (
                      <Status tone="warm">画面待更新</Status>
                    ) : s.image || s.scene ? (
                      <CheckCircle className="ready-check" size={17} />
                    ) : (
                      <Status>待制作</Status>
                    )}
                  </div>
                  {s.error && <p className="card-error">{s.error}</p>}
                </article>
              ))}
            </div>
          )}
        </>
      )}
      {selected.length > 0 && (
        <div className="selection-bar">
          <span>已选 {selected.length} 页</span>
          <span className="selection-pages">
            {selectedPages.map((s) => project.slides.indexOf(s) + 1).join("、")}
          </span>
          <Button
            disabled={!!busy || !style || !!style.deletedAt}
            onClick={() =>
              run(async () => {
                await post("/projects/" + id + "/render", {
                  slideIds: selected,
                  redesign: true,
                });
                setSelected([]);
              }, `正在按「${style?.name}」重新设计，旧版本会保留。`)
            }
          >
            <ArrowsClockwise size={17} />
            按当前风格重做
          </Button>
          <Button
            variant="primary"
            disabled={selected.length < 2 || !!busy}
            onClick={merge}
          >
            <Unite size={17} />
            合并所选页面
          </Button>
          <button
            className="icon-btn"
            aria-label="取消选择"
            onClick={() => setSelected([])}
          >
            <X size={18} />
          </button>
        </div>
      )}
      {!project.slides.length && !busy && (
        <div className="workspace-empty">
          <div className="empty-page-stack">
            <div />
            <div />
            <div>
              <FileText size={35} weight="light" />
              <span>你的第一段，会成为新的画面。</span>
            </div>
          </div>
          <h2>先从一小段开始。</h2>
          <p>粘贴你的逐字稿，内容拆分、画面设计和图片生成，交给 AutoPPT。</p>
        </div>
      )}
      <section
        className={`composer ${!project.slides.length ? "first-composer" : ""}`}
      >
        <div className="composer-heading">
          <div>
            <span className="composer-number">
              {String(project.batches.length + 1).padStart(2, "0")}
            </span>
            <h2>
              {project.batches.length ? "继续添加下一段" : "添加第一段逐字稿"}
            </h2>
          </div>
          <span className="draft-state">
            {saving
              ? "正在保存草稿…"
              : draft
                ? "草稿已保存"
                : "可以先给一小段，满意后再继续"}
          </span>
        </div>
        <textarea
          ref={composer}
          aria-label="添加逐字稿"
          value={draft}
          onChange={(e) => updateDraft(e.target.value)}
          placeholder={
            project.batches.length
              ? "接下来，你想讲什么？粘贴下一段逐字稿…"
              : "把你准备讲的话放在这里。\n不需要整理格式，也不需要自己分成 PPT 页面。"
          }
          maxLength={200000}
          onKeyDown={(e) => {
            if (
              (e.metaKey || e.ctrlKey) &&
              e.key === "Enter" &&
              !busy &&
              !submitting
            ) {
              e.preventDefault();
              add();
            }
          }}
        />
        <div className="composer-footer">
          <span>
            {draft.length.toLocaleString()} 字
            <span className="composer-shortcut">⌘ Enter 生成</span>
          </span>
          <Button
            variant="primary"
            onClick={add}
            disabled={
              !draft.trim() ||
              !!busy ||
              !settings.text.hasKey ||
              !settings.image.hasKey
            }
            loading={submitting}
          >
            {busy ? "正在制作上一段" : "生成这一段"}
            <ArrowUp size={17} />
          </Button>
        </div>
      </section>
      {project.slides.length > 0 && (
        <p className="workspace-bottom">
          逐字稿与图片自动关联 · 逐段制作，随时调整 · 所有内容保存在本机
        </p>
      )}
      {exportOpen && (
        <ExportDialog
          project={project}
          busy={!!busy}
          hasDraft={!!draft.trim()}
          onClose={() => setExportOpen(false)}
          notify={notify}
        />
      )}
      {editingOptions && (
        <Modal
          title="内容倾向与配色"
          subtitle="仅用于这个项目，不改变风格库或其他项目。"
          onClose={() => {
            if (!submitting) setEditingOptions(null);
          }}
        >
          <DesignOptionsEditor
            value={editingOptions}
            onChange={setEditingOptions}
            styleId={project.styleId}
            disabled={!!busy || submitting}
            onBusyChange={setOptionsBusy}
          />
          <div className="modal-actions">
            <Button
              disabled={submitting}
              onClick={() => setEditingOptions(null)}
            >
              取消
            </Button>
            <Button
              variant="primary"
              loading={submitting}
              disabled={
                !!busy || optionsBusy || !validDesignOptions(editingOptions)
              }
              onClick={() =>
                run(async () => {
                  await patch("/projects/" + id, {
                    designOptions: editingOptions,
                  });
                  setEditingOptions(null);
                }, "内容倾向与配色已保存。已有画面保持原样，选中页面重新设计即可应用。")
              }
            >
              保存设置
            </Button>
          </div>
        </Modal>
      )}
      {reportOpen && (
        <ProjectReport
          projectId={id}
          revision={project.revision}
          title={project.title}
          onClose={() => setReportOpen(false)}
          onOpenPage={(sid) => {
            setReportOpen(false);
            setDetail(sid);
          }}
        />
      )}
      {detailSlide && (
        <SlideDetail
          slide={detailSlide}
          index={project.slides.indexOf(detailSlide)}
          total={project.slides.length}
          projectId={id}
          revision={project.revision}
          styles={styles}
          currentStyle={style}
          busy={pageBusy(detailSlide.id)}
          projectBusy={!!busy}
          onClose={() => setDetail(null)}
          onNavigate={(offset) =>
            setDetail(
              project.slides[project.slides.indexOf(detailSlide) + offset]
                ?.id || detail,
            )
          }
          onSplit={() => {
            setSplit(detailSlide.id);
            setDetail(null);
          }}
          onChanged={async () => {
            await refresh();
            await onRefresh();
          }}
          notify={notify}
        />
      )}
      {splitSlide && (
        <SplitDialog
          slide={splitSlide}
          projectId={id}
          onClose={() => setSplit(null)}
          onDone={async () => {
            setSplit(null);
            await refresh();
            notify("正在准备拆分后的画面方案。");
          }}
        />
      )}
      {proposalOpen && project.proposal && (
        <Modal
          wide
          title={
            project.proposal.type === "split" ? "预览拆分方案" : "预览合并方案"
          }
          subtitle="确认后生成新页面。原来的页面会保留，可撤销这次调整。"
          onClose={() => setProposalOpen(false)}
        >
          <div className="proposal-grid">
            {project.proposal.plans.map((plan, i) => (
              <div className="proposal-item" key={i}>
                <Status>新页面 {i + 1}</Status>
                <h3>{plan.title}</h3>
                <div className="proposed-display">
                  {plan.displayText.map((t, i) => (
                    <p key={i}>{t}</p>
                  ))}
                </div>
                <p>{plan.layout}</p>
                <CopyReview copy={plan.screenCopy} />
                <details>
                  <summary>
                    对应逐字稿 · {project.proposal!.notes[i].length} 字
                  </summary>
                  <p className="preserve-text">{project.proposal!.notes[i]}</p>
                </details>
              </div>
            ))}
          </div>
          <div className="modal-actions">
            <Button
              onClick={() =>
                run(async () => {
                  await api("/projects/" + id + "/proposal", {
                    method: "DELETE",
                  });
                  setProposalOpen(false);
                })
              }
            >
              放弃这次调整
            </Button>
            <Button
              variant="primary"
              disabled={!!busy}
              onClick={() =>
                run(async () => {
                  await post("/projects/" + id + "/proposal/commit", {
                    proposalId: project.proposal!.id,
                  });
                  setProposalOpen(false);
                })
              }
            >
              确认并生成页面
              <ArrowRight size={17} />
            </Button>
          </div>
        </Modal>
      )}
      {renaming && (
        <Rename
          project={project}
          onClose={() => setRenaming(false)}
          onSave={(title) =>
            run(async () => {
              await patch("/projects/" + id, { title });
              setRenaming(false);
            })
          }
        />
      )}
    </div>
  );
}
function ExportDialog({
  project,
  busy,
  hasDraft,
  onClose,
  notify,
}: {
  project: Project;
  busy: boolean;
  hasDraft: boolean;
  onClose: () => void;
  notify: (message: string) => void;
}) {
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const missing = project.slides.flatMap((s, i) =>
    !s.image && !s.scene ? [i + 1] : [],
  );
  const unsegmented = project.batches.filter((b) => !b.slideIds.length).length;
  const stale = project.slides.filter((s) => s.stale).length;
  const blocked =
    busy || !!missing.length || !!unsegmented || !project.slides.length;
  const download = async () => {
    setExporting(true);
    setError("");
    try {
      await downloadPresentation(project.id, project.revision, !!stale);
      notify("PPT 已开始下载，每页图片和对应讲稿备注已包含。");
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setExporting(false);
    }
  };
  return (
    <Modal
      title="导出 PPT"
      subtitle="每页一张完整图片，逐字稿保存在对应页备注中。"
      onClose={() => {
        if (!exporting) onClose();
      }}
    >
      <div className="ppt-export-summary">
        <h3>{project.title}</h3>
        <p>全部 {project.slides.length} 页 · 16:9 宽屏 · .pptx 文件</p>
        <p>
          图片按原比例完整放入页面，保留原图清晰度。备注使用每页最新保存的完整讲稿。
        </p>
      </div>
      {busy && (
        <p className="export-notice">页面正在制作中，完成或停止后即可导出。</p>
      )}
      {!!unsegmented && (
        <p className="export-notice">
          还有 {unsegmented} 段逐字稿未完成拆分，请先继续制作。
        </p>
      )}
      {!!missing.length && (
        <p className="export-notice">
          还有 {missing.length} 页未完成（第 {missing.join("、")}{" "}
          页），请先补齐图片后导出。
        </p>
      )}
      {!!stale && (
        <p className="export-notice">
          有 {stale}{" "}
          页讲稿已修改，图片尚未更新。本次将使用当前图片，备注采用最新讲稿。
        </p>
      )}
      {hasDraft && (
        <p className="detail-help">
          输入框中尚未提交生成的草稿不包含在本次导出中。
        </p>
      )}
      {project.proposal && (
        <p className="detail-help">
          合并或拆分方案尚未确认，本次导出当前页序。
        </p>
      )}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      <div className="modal-actions">
        <Button onClick={onClose} disabled={exporting}>
          返回
        </Button>
        <Button
          variant="primary"
          onClick={download}
          loading={exporting}
          disabled={blocked}
        >
          {!exporting && <DownloadSimple size={18} />}
          {exporting
            ? "正在导出…"
            : stale
              ? "使用当前图片与最新备注下载"
              : "下载 PPT"}
        </Button>
      </div>
    </Modal>
  );
}

function Rename({
  project,
  onClose,
  onSave,
}: {
  project: Project;
  onClose: () => void;
  onSave: (s: string) => void;
}) {
  const [name, setName] = useState(project.title);
  return (
    <Modal title="修改演讲主题" onClose={onClose}>
      <Field label="主题">
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={100}
        />
      </Field>
      <div className="modal-actions">
        <Button onClick={onClose}>取消</Button>
        <Button
          variant="primary"
          onClick={() => onSave(name)}
          disabled={!name.trim()}
        >
          保存
        </Button>
      </div>
    </Modal>
  );
}
function SlideDetail({
  slide,
  index,
  total,
  projectId,
  revision,
  styles,
  currentStyle,
  busy,
  projectBusy,
  onClose,
  onNavigate,
  onSplit,
  onChanged,
  notify,
}: {
  slide: Slide;
  index: number;
  total: number;
  projectId: string;
  revision: number;
  styles: Style[];
  currentStyle?: Style;
  busy: boolean;
  projectBusy: boolean;
  onClose: () => void;
  onNavigate: (n: number) => void;
  onSplit: () => void;
  onChanged: () => Promise<void>;
  notify: (s: string) => void;
}) {
  const [tab, setTab] = useState("notes"),
    [notes, setNotes] = useState(slide.notes),
    [feedback, setFeedback] = useState(""),
    [copyFeedback, setCopyFeedback] = useState(""),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [history, setHistory] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<ContentAttachment[]>(
    slide.pendingAttachments ?? slide.attachments ?? [],
  );
  const [uploading, setUploading] = useState(false);
  const [leaveAction, setLeaveAction] = useState<number | "close" | null>(null);
  const attachmentInput = useRef<HTMLInputElement>(null);
  const savedAttachmentKey = (
    slide.pendingAttachments ??
    slide.attachments ??
    []
  )
    .map((a) => a.id)
    .join(",");
  const attachmentsDirty =
    attachments.map((a) => a.id).join(",") !== savedAttachmentKey;
  useEffect(() => {
    setAttachments(slide.pendingAttachments ?? slide.attachments ?? []);
  }, [slide.id, savedAttachmentKey]);
  const addAttachments = async (files: File[]) => {
    if (!files.length) return;
    setError("");
    if (files.length + attachments.length > 4) {
      setError("每页最多 4 张附件，请先移除不需要的图片。");
      return;
    }
    if (
      files.some(
        (f) =>
          !["image/png", "image/jpeg", "image/webp"].includes(f.type) ||
          f.size > 12 * 1024 * 1024,
      )
    ) {
      setError("附件支持 PNG、JPG、WebP，每张最多 12 MB。");
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      files.forEach((f) => form.append("images", f));
      const result = await api<{ attachments: ContentAttachment[] }>(
        `/projects/${projectId}/slides/${slide.id}/attachments`,
        { method: "POST", body: form },
      );
      setAttachments((current) => [...current, ...result.attachments]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  };
  useEffect(() => {
    setNotes(slide.notes);
    setFeedback("");
    setCopyFeedback("");
    setHistory(null);
  }, [slide.id, slide.notes]);
  const dirty = notes !== slide.notes;
  const act = async (fn: () => Promise<unknown>) => {
    setLoading(true);
    setError("");
    try {
      await fn();
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  const persistNotes = async () => {
    const saved = await patch<Project>(
      `/projects/${projectId}/slides/${slide.id}`,
      { notes },
    );
    setNotes(saved.slides.find((s) => s.id === slide.id)!.notes);
  };
  const save = () =>
    act(async () => {
      await persistNotes();
      notify("演讲正文已保存，Markdown 标题已自动去掉。");
    });
  const redesign = () =>
    act(async () => {
      if (dirty) await persistNotes();
      await post(`/projects/${projectId}/render`, {
        slideIds: [slide.id],
        redesign: true,
        feedback,
        copyFeedback,
        attachmentIds: attachments.map((a) => a.id),
      });
      setFeedback("");
      setCopyFeedback("");
      notify("修改已提交到后台，可以继续编辑下一页；旧版本会保留。");
    });
  const leave = (action: number | "close") => {
    if (uploading || loading) return;
    if (dirty || attachmentsDirty) {
      setLeaveAction(action);
      return;
    }
    if (action === "close") onClose();
    else onNavigate(action);
  };
  const nav = (n: number) => leave(n);
  const close = () => leave("close");
  const version = slide.versions.find((v) => v.id === history);
  const displayed = version || slide;
  const imageStyleName =
    displayed.imageStyle?.name ||
    styles.find((s) => s.id === displayed.styleId)?.name ||
    "原风格";
  return (
    <>
      <Modal
        wide
        title={`第 ${index + 1} 页 · ${slide.plan?.title || "页面详情"}`}
        subtitle={`${index + 1} / ${total} · ${slide.notes.length} 字讲稿`}
        onClose={close}
      >
        <div className="detail-layout">
          <div className="detail-visual">
            <SlideImage
              slide={
                version
                  ? {
                      ...slide,
                      image: version.image,
                      scene: version.scene,
                      plan: version.plan,
                    }
                  : slide
              }
            />
            {(displayed.image || displayed.scene) && (
              <p className="image-style-meta">
                画面风格：{imageStyleName}
                {displayed.scene
                  ? " · 历史网页记录"
                  : displayed.imageStyle
                    ? displayed.imageStyle.imageRefs.length
                      ? ` · 出图时附有 ${displayed.imageStyle.imageRefs.length} 张参考图`
                      : displayed.attachments?.length
                        ? ` · 出图时使用 ${displayed.attachments.length} 张内容附件`
                        : " · 仅按风格规则与设计方案出图"
                    : " · 历史页面"}
              </p>
            )}
            {version && (
              <div className="version-viewing">
                <Clock size={15} />
                正在查看历史版本
                <Button variant="ghost" onClick={() => setHistory(null)}>
                  返回当前版本
                </Button>
              </div>
            )}
            <div className="detail-toolbar">
              <div>
                <Button
                  variant="ghost"
                  onClick={() => nav(-1)}
                  disabled={index === 0 || uploading || loading}
                >
                  <CaretLeft size={17} />
                  上一页
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => nav(1)}
                  disabled={index === total - 1 || uploading || loading}
                >
                  下一页
                  <CaretRight size={17} />
                </Button>
              </div>
              <Button
                disabled={
                  projectBusy ||
                  loading ||
                  uploading ||
                  dirty ||
                  attachmentsDirty
                }
                onClick={onSplit}
                title={
                  dirty
                    ? "请先保存讲稿"
                    : attachmentsDirty
                      ? "请先提交或移除新增附件"
                      : "手动选择原文分界"
                }
              >
                <Scissors size={17} />
                拆分这一页
              </Button>
            </div>
            {displayed.image && (
              <a
                className="btn secondary"
                href={asset(displayed.image)}
                download={`第${index + 1}页.png`}
              >
                保存图片
              </a>
            )}
            <div className="redesign-box">
              <h3>换一个思路，再设计一次</h3>
              <p className="generation-style-help">
                将使用：
                {currentStyle && !currentStyle.deletedAt
                  ? currentStyle.name
                  : "请先在项目中选择可用风格"}
              </p>
              <textarea
                aria-label="重新设计要求"
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder={
                  "画面调整：例如换一种构图、增加主体画面的比重。\n留空则按当前风格重新生成。"
                }
                disabled={busy}
              />
              <textarea
                aria-label="上屏文字调整"
                value={copyFeedback}
                onChange={(e) => setCopyFeedback(e.target.value)}
                placeholder="上屏文字调整：例如只保留核心问题，解释留给口播。留空则复用已提炼文案。"
                disabled={busy}
              />
              <p className="detail-help">
                画面和文案分别调整，风格提示词保持原文。
              </p>
              <div className="content-attachments">
                <div className="content-attachments-heading">
                  <strong>
                    内容附件 <span>{attachments.length} / 4</span>
                  </strong>
                  <Button
                    onClick={() => attachmentInput.current?.click()}
                    loading={uploading}
                    disabled={busy || loading || attachments.length >= 4}
                  >
                    <Paperclip size={16} />
                    添加图片
                  </Button>
                </div>
                <p>
                  添加图表、产品截图等材料，直接融入新页面。PNG、JPG、WebP，每张最多
                  12 MB。
                </p>
                <input
                  ref={attachmentInput}
                  className="visually-hidden"
                  type="file"
                  aria-label="添加内容附件"
                  accept="image/png,image/jpeg,image/webp"
                  multiple
                  disabled={
                    busy || loading || uploading || attachments.length >= 4
                  }
                  onChange={(e) => {
                    void addAttachments(Array.from(e.target.files || []));
                    e.target.value = "";
                  }}
                />
                {attachments.length > 0 && (
                  <div className="content-attachment-grid">
                    {attachments.map((a, i) => (
                      <div key={a.id}>
                        <a
                          href={asset(a.filename)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <img
                            src={asset(a.filename)}
                            alt={`附件 ${i + 1}：${a.name}`}
                          />
                        </a>
                        <span title={a.name}>
                          {i + 1}. {a.name}
                        </span>
                        <button
                          disabled={busy || loading || uploading}
                          aria-label={`移除附件 ${i + 1}`}
                          onClick={() =>
                            setAttachments((items) =>
                              items.filter((item) => item.id !== a.id),
                            )
                          }
                        >
                          <X size={15} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {!!attachments.length && (
                  <p>
                    点击“重新设计这页”时，这些附件会同时用于设计和图片生成。
                  </p>
                )}
                {(error || (!busy && slide.error)) && (
                  <p className="error-text" role="alert">
                    {error || slide.error}
                  </p>
                )}
              </div>
              <Button
                variant="primary"
                onClick={redesign}
                loading={loading}
                disabled={
                  busy ||
                  uploading ||
                  !notes.trim() ||
                  !currentStyle ||
                  !!currentStyle.deletedAt
                }
              >
                <ArrowsClockwise size={17} />
                {busy
                  ? "正在制作中"
                  : slide.stale || dirty
                    ? "按新稿重新设计"
                    : "重新设计这页"}
              </Button>
            </div>
          </div>
          <div className="detail-info">
            <div className="detail-tabs">
              <button
                className={tab === "notes" ? "active" : ""}
                onClick={() => setTab("notes")}
              >
                逐字稿
              </button>
              <button
                className={tab === "plan" ? "active" : ""}
                onClick={() => setTab("plan")}
              >
                上屏文案与风格
              </button>
              <button
                className={tab === "versions" ? "active" : ""}
                onClick={() => setTab("versions")}
              >
                版本 {slide.versions.length + 1}
              </button>
            </div>
            {tab === "notes" ? (
              <>
                <p className="detail-help">
                  这里是对应本页的演讲正文。保存时会自动去掉 Markdown
                  标题，保留正文段落。
                </p>
                <textarea
                  className="notes-editor"
                  aria-label="本页逐字稿"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  disabled={busy}
                />
                <div className="notes-footer">
                  <span>
                    {notes.length} 字
                    {dirty
                      ? " · 未保存"
                      : slide.stale
                        ? " · 画面待更新"
                        : " · 已保存"}
                  </span>
                  <Button
                    onClick={save}
                    loading={loading}
                    disabled={!dirty || busy || !notes.trim()}
                  >
                    <FloppyDisk size={16} />
                    保存讲稿
                  </Button>
                </div>
                {slide.stale && (
                  <p className="small-notice">
                    讲稿已经修改。确认内容后，可以按新稿重新设计画面。
                  </p>
                )}
              </>
            ) : tab === "plan" ? (
              <div className="plan-details">
                {slide.plan ? (
                  <>
                    {slide.plan.contentBrief && (
                      <>
                        <h4>这一页要表达什么</h4>
                        <p>{slide.plan.contentBrief.claim}</p>
                        <p>{slide.plan.contentBrief.visualTask}</p>
                        {slide.plan.selectionReason && (
                          <p>{slide.plan.selectionReason}</p>
                        )}
                      </>
                    )}
                    <h4>画面文字</h4>
                    {slide.plan.displayText.map((t, i) => (
                      <p className="display-line" key={i}>
                        {t}
                      </p>
                    ))}
                    <CopyReview
                      copy={slide.plan.screenCopy}
                      stale={slide.stale}
                    />
                    <RawPromptDetails plan={slide.plan} />
                    <h4>版面安排</h4>
                    <p>{slide.plan.layout}</p>
                    <h4>视觉表达</h4>
                    <p>{slide.plan.visual}</p>
                    {!!slide.plan.attachmentPlacements?.length && (
                      <>
                        <h4>内容附件安排</h4>
                        {slide.plan.attachmentPlacements.map((a, i) => (
                          <p key={a.id}>
                            附件 {i + 1}：{a.role}。{a.placement}。{a.preserve}
                          </p>
                        ))}
                      </>
                    )}
                    <h4>讲述意图</h4>
                    <p>{slide.plan.rationale}</p>
                  </>
                ) : (
                  <p>画面方案将在制作时生成。</p>
                )}
              </div>
            ) : (
              <div className="versions-list">
                <p className="detail-help">
                  可以先比较画面，再恢复。恢复会一并还原对应讲稿与内容附件。
                </p>
                <button
                  className={!history ? "version-card current" : "version-card"}
                  onClick={() => setHistory(null)}
                >
                  {slide.scene ? (
                    <SceneView scene={slide.scene} label="当前版本" />
                  ) : (
                    slide.image && (
                      <img src={asset(slide.image)} alt="当前版本" />
                    )
                  )}
                  <span>
                    当前版本
                    <CheckCircle size={16} />
                  </span>
                </button>
                {[...slide.versions].reverse().map((v, i) => (
                  <div key={v.id} className="version-item">
                    <button
                      className={
                        history === v.id
                          ? "version-card current"
                          : "version-card"
                      }
                      onClick={() => setHistory(v.id)}
                    >
                      {v.scene ? (
                        <SceneView scene={v.scene} label="历史版本" />
                      ) : v.image ? (
                        <img
                          src={asset(v.image)}
                          alt={`历史版本 ${slide.versions.length - i}`}
                        />
                      ) : (
                        <span>尚未生成</span>
                      )}
                      <span>
                        版本 {slide.versions.length - i}
                        <small>
                          {new Date(v.createdAt).toLocaleTimeString("zh-CN", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </small>
                      </span>
                    </button>
                    <Button
                      variant="ghost"
                      disabled={
                        busy || loading || uploading || attachmentsDirty
                      }
                      onClick={() =>
                        act(async () => {
                          await post(
                            `/projects/${projectId}/slides/${slide.id}/restore`,
                            { versionId: v.id },
                          );
                          setHistory(null);
                          notify("已恢复画面及对应讲稿。");
                        })
                      }
                    >
                      恢复这个版本
                      <ArrowCounterClockwise size={14} />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </Modal>
      {leaveAction !== null && (
        <Modal
          title="有修改尚未提交"
          subtitle="讲稿或附件选择尚未提交，离开后不会应用到页面。"
          onClose={() => setLeaveAction(null)}
        >
          <div className="modal-actions">
            <Button onClick={() => setLeaveAction(null)}>留在此页</Button>
            <Button
              onClick={() => {
                const action = leaveAction;
                setLeaveAction(null);
                if (action === "close") onClose();
                else onNavigate(action);
              }}
            >
              放弃修改并离开
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
function SplitDialog({
  slide,
  projectId,
  onClose,
  onDone,
}: {
  slide: Slide;
  projectId: string;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const [cuts, setCuts] = useState<number[]>([]),
    [cursor, setCursor] = useState(0),
    [suggestions, setSuggestions] = useState<number[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const textarea = useRef<HTMLTextAreaElement>(null);
  const add = (n: number) => {
    if (n <= 0 || n >= slide.notes.length) {
      setError("请把光标放在原文中间，两侧都需要有讲稿。");
      return;
    }
    setError("");
    setCuts((old) => [...new Set([...old, n])].sort((a, b) => a - b));
  };
  const suggest = async () => {
    setBusy(true);
    setError("");
    try {
      const data = await post("/projects/" + projectId + "/suggest-split", {
        slideId: slide.id,
      });
      setSuggestions(data.cuts);
      if (!data.cuts.length)
        setError("AI 认为这段内容适合保持完整；你仍然可以手动分界。");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      await post("/projects/" + projectId + "/proposal", {
        type: "split",
        slideId: slide.id,
        cuts,
      });
      await onDone();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  const boundaries = [0, ...cuts, slide.notes.length];
  return (
    <Modal
      wide
      title="你来决定，在哪里翻页"
      subtitle="点击原文中的分界位置，再插入分界。原文保持完整，不会删改。"
      onClose={onClose}
    >
      <div className="split-layout">
        <div>
          <textarea
            ref={textarea}
            className="split-source"
            aria-label="选择逐字稿分界位置"
            readOnly
            value={slide.notes}
            onSelect={(e) => setCursor(e.currentTarget.selectionStart)}
          />
          <div className="split-cursor">
            分界位置：
            {cursor === 0
              ? "请点击原文中的位置"
              : `第 ${cursor} 个字符之后`}{" "}
            {cursor > 0 && (
              <span>
                …{slide.notes.slice(Math.max(0, cursor - 12), cursor)}
                <b>｜</b>
                {slide.notes.slice(cursor, cursor + 12)}…
              </span>
            )}
          </div>
          <div className="split-buttons">
            <Button
              variant="primary"
              onClick={() => add(cursor)}
              disabled={cursor <= 0 || cursor >= slide.notes.length}
            >
              <Scissors size={17} />
              在这里插入分界
            </Button>
            <Button onClick={suggest} loading={busy}>
              建议分界
            </Button>
          </div>
          {suggestions.length > 0 && (
            <div className="split-suggestions">
              <strong>AI 建议，仅供参考</strong>
              {suggestions.map((n) => (
                <button key={n} onClick={() => add(n)}>
                  …{slide.notes.slice(Math.max(0, n - 14), n)}
                  <Plus size={15} />
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="split-preview">
          <h3>将拆成 {cuts.length + 1} 页</h3>
          {boundaries.slice(0, -1).map((from, i) => (
            <div className="split-unit" key={from}>
              <div>
                <span>第 {i + 1} 页</span>
                <small>{boundaries[i + 1] - from} 字</small>
                {i > 0 && (
                  <button
                    className="icon-btn"
                    aria-label={`移除第 ${i} 个分界`}
                    onClick={() => setCuts(cuts.filter((c) => c !== from))}
                  >
                    <X size={15} />
                  </button>
                )}
              </div>
              <p>{slide.notes.slice(from, boundaries[i + 1])}</p>
            </div>
          ))}
        </div>
      </div>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      <div className="modal-actions">
        <Button onClick={onClose}>取消</Button>
        <Button
          variant="primary"
          loading={busy}
          disabled={!cuts.length}
          onClick={submit}
        >
          预览 {cuts.length + 1} 页新方案
          <ArrowRight size={17} />
        </Button>
      </div>
    </Modal>
  );
}
