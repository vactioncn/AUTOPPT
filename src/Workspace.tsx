import { VisualReview } from "./VisualReview";
import { JobFeedback } from "./JobFeedback";
import { PageConcepts } from "./OnboardingUI";
import {
  createGenerationRequest,
  exampleManuscript,
  unknownModelStatus,
  type OnboardingState,
} from "./onboarding";
import {
  DesignOptionsEditor,
  emptyDesignOptions,
  validDesignOptions,
} from "./DesignOptionsEditor";
import type { DesignOptions } from "./types";
import { RawPromptDetails } from "./RawPromptDetails";
import { currentProduction } from "../shared/production.mjs";
import { browsePages } from "../shared/page-browser.mjs";
import { planImageBatch } from "../shared/image-batch.mjs";
import { PageBrowser, PagePagination } from "./PageBrowser";
import { useAccount } from "./Account";
import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  lazy,
  Suspense,
} from "react";
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
} from "@phosphor-icons/react";
import {
  api,
  post,
  patch,
  asset,
  active,
  downloadPresentation,
  downloadManuscript,
  downloadFile,
} from "./api";
import { SceneView } from "./SceneView";
import { StandardPresentation } from "./StandardPresentation";
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
import { MotionPresentation } from "./MotionPresentation";
import { RedesignDialog } from "./RedesignDialog";
import {
  HtmlExportOptions,
  useHtmlExportOptions,
  type ExportFormat,
} from "./HtmlExportOptions";
import { Button, Modal, Field, SlideImage, Status } from "./components";
import {
  DeliveryCenter,
  ProjectOverview,
  RehearsalCenter,
  usePresentationRecords,
} from "./ProjectJourney";
import {
  projectAreas,
  projectJourney,
  projectPrimaryAction,
  type JourneyAction,
  type ProjectArea,
} from "./project-journey";

const SpeechPresentation = lazy(() =>
  import("./SpeechPresentation").then((m) => ({
    default: m.SpeechPresentation,
  })),
);

export function Workspace({
  capabilities,
  dataRootLabel,
  hosted,
  modelsReady,
  modelStatusUnknown,
  generationScope,
  onboarding,
  onOnboardingChange,
  area,
  onAreaChange,
  id,
  styles,
  settings,
  notify,
  onRefresh,
  onSettings,
}: {
  id: string;
  capabilities: import("../shared/diagnostics.mjs").Capabilities;
  dataRootLabel: string;
  hosted: boolean;
  modelsReady: boolean;
  modelStatusUnknown: boolean;
  generationScope: string;
  onboarding: OnboardingState;
  onOnboardingChange: (change: Partial<OnboardingState>) => void;
  area: ProjectArea;
  onAreaChange: (area: ProjectArea) => void;
  styles: Style[];
  settings: Settings;
  notify: (s: string) => void;
  onRefresh: () => Promise<void>;
  onSettings: () => void;
}) {
  const insertExportAvailable = capabilities.bundleExport.enabled;
  const motionAvailable = capabilities.motionPresentation.enabled;
  const speechAvailable = capabilities.standardPresentation.enabled;
  const [editingOptions, setEditingOptions] = useState<DesignOptions | null>(
    null,
  );
  const [optionsBusy, setOptionsBusy] = useState(false);
  const [scriptExporting, setScriptExporting] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [generationDialog, setGenerationDialog] = useState<
    "confirm" | "models" | null
  >(null);
  const [directGeneration, setDirectGeneration] = useState(false);
  const [generationMode, setGenerationMode] = useState<"preview" | "full">(
    hosted ? "preview" : "full",
  );
  const [imageBatch, setImageBatch] = useState<{
    ids: string[];
    preview: boolean;
  } | null>(null);
  const account = useAccount();
  const [checkedQuota, setCheckedQuota] = useState<{
    available: number;
    held: number;
  } | null>(null);
  const [checkingQuota, setCheckingQuota] = useState(false);
  const [imageBatchError, setImageBatchError] = useState("");
  const credits = checkedQuota || account.user;
  const [pageQuery, setPageQuery] = useState("");
  const [pageGroup, setPageGroup] = useState(0);
  const [completingPreview, setCompletingPreview] = useState(false);
  const [retryReview, setRetryReview] = useState<Job | null>(null);
  const [retryError, setRetryError] = useState("");
  const [reviewedRetry, setReviewedRetry] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const submitLock = useRef(false);
  const latestModelsReady = useRef(modelsReady);
  latestModelsReady.current = modelsReady;
  const latestDraft = useRef("");
  const generationRequest = useRef<ReturnType<
    typeof createGenerationRequest
  > | null>(null);
  if (!generationRequest.current)
    generationRequest.current = createGenerationRequest(generationScope);
  const [generationPersistent, setGenerationPersistent] = useState(
    generationRequest.current.isPersistent(),
  );
  const managedModels = !capabilities.localModelSettings.enabled;
  const [draftSaveError, setDraftSaveError] = useState(false);
  const [speechOpen, setSpeechOpen] = useState(false);
  const [speechInitialPanel, setSpeechInitialPanel] = useState<"play" | "text">(
    "play",
  );
  const [visualReviewOpen, setVisualReviewOpen] = useState(false);
  const records = usePresentationRecords(id, speechAvailable, motionAvailable);
  const [insertion, setInsertion] = useState<{
    afterSlideId: string | null;
  } | null>(null);
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
    [proposalError, setProposalError] = useState(""),
    [proposalSubmitting, setProposalSubmitting] = useState(false),
    [showScript, setShowScript] = useState(false),
    [motionOpen, setMotionOpen] = useState(false),
    [redesignOpen, setRedesignOpen] = useState(false),
    [exportOpen, setExportOpen] = useState<ExportFormat | null>(null),
    [reportOpen, setReportOpen] = useState(false),
    [renaming, setRenaming] = useState(false);
  const studioTasks = useRef<HTMLDivElement>(null);
  const gallery = useRef<HTMLDivElement>(null);
  const initialized = useRef(false),
    draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    draftRequest = useRef<Promise<unknown>>(Promise.resolve()),
    composer = useRef<HTMLTextAreaElement>(null);
  const focusComposer = () => {
    setComposerOpen(true);
    requestAnimationFrame(() => {
      composer.current?.scrollIntoView({
        block: "center",
        behavior: "instant",
      });
      composer.current?.focus({ preventScroll: true });
    });
  };
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [area]);
  useEffect(() => {
    if (
      area === "studio" &&
      project &&
      !project.slides.length &&
      !project.batches.length
    )
      focusComposer();
  }, [area, !!project, project?.slides.length, project?.batches.length]);
  const refresh = useCallback(async () => {
    const [p, j] = await Promise.all([
      api<Project>("/projects/" + id),
      api<Job[]>("/jobs?projectId=" + id),
    ]);
    setProject((prev) => (!prev || p.revision >= prev.revision ? p : prev));
    setJobs(j);
    if (!initialized.current) {
      let recovered = p.draft;
      try {
        recovered = localStorage.getItem("autoppt-draft:" + id) ?? p.draft;
      } catch {
        /* Use workspace draft. */
      }
      latestDraft.current = recovered;
      setDraft(recovered);
      initialized.current = true;
    }
  }, [id]);
  useEffect(() => setCheckedQuota(null), [account.user]);
  const pageScope = useMemo(() => {
    if (!project) return [];
    if (filter === "all") return project.slides;
    if (filter === "latest") return currentProduction(project, jobs).slides;
    return project.slides.filter((slide) => slide.batchIds.includes(filter));
  }, [project, jobs, filter]);
  const pageResult = useMemo(
    () => browsePages(pageScope, project?.slides || [], pageQuery, pageGroup),
    [pageScope, project?.slides, pageQuery, pageGroup],
  );
  useEffect(() => setPageGroup(0), [filter, pageQuery]);
  useEffect(() => setPageGroup(pageResult.current), [pageResult.current]);
  const checkQuota = async () => {
    const next = await api<{
      user: { available: number; held: number } | null;
    }>("/account");
    if (!next.user)
      throw new Error("登录状态已失效，请重新登录后继续。草稿和页面会保留。");
    setCheckedQuota(next.user);
    return next.user;
  };
  const openImageBatch = async (ids: string[], preview = false) => {
    setError("");
    setImageBatchError("");
    setImageBatch({ ids, preview });
    if (!hosted) return;
    setCheckingQuota(true);
    try {
      await checkQuota();
    } catch (error) {
      setImageBatchError((error as Error).message);
    } finally {
      setCheckingQuota(false);
    }
  };
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
  const cacheDraft = (text: string | null) => {
    try {
      if (text === null) localStorage.removeItem("autoppt-draft:" + id);
      else localStorage.setItem("autoppt-draft:" + id, text);
    } catch {
      /* Workspace persistence still works when browser storage is denied. */
    }
  };
  const saveDraft = async (text: string) => {
    if (draftTimer.current) clearTimeout(draftTimer.current);
    setSaving(true);
    setDraftSaveError(false);
    // Serialize autosaves so an older request cannot overwrite a newer draft.
    const request = draftRequest.current
      .catch(() => {})
      .then(() => patch("/projects/" + id, { draft: text }));
    draftRequest.current = request;
    try {
      await request;
      if (draftRequest.current === request && latestDraft.current === text) {
        setSaving(false);
        cacheDraft(null);
      }
    } catch (e) {
      setSaving(false);
      setDraftSaveError(true);
      throw e;
    }
  };
  function updateDraft(text: string) {
    latestDraft.current = text;
    cacheDraft(text);
    setDraft(text);
    setSaving(true);
    setDraftSaveError(false);
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => {
      void saveDraft(text).catch((e) => setError("草稿保存失败：" + e.message));
    }, 700);
  }
  const connectModels = async () => {
    try {
      await saveDraft(draft);
      setGenerationDialog(null);
      onSettings();
    } catch (e) {
      setError("草稿保存失败，请重试：" + (e as Error).message);
    }
  };
  const submitDraft = async (rememberDirect = false) => {
    if (!draft.trim() || submitLock.current) return;
    if (!modelsReady) {
      setGenerationDialog("models");
      return;
    }
    submitLock.current = true;
    setSubmitting(true);
    setGenerationDialog(null);
    setError("");
    let acceptedSubmission = false;
    try {
      const requestId = await generationRequest.current!.forText(
        draft,
        generationMode,
      );
      setGenerationPersistent(generationRequest.current!.isPersistent());
      await saveDraft(draft);
      // Account polling may invalidate readiness while the draft is saving.
      if (!latestModelsReady.current) {
        setGenerationDialog("models");
        return;
      }
      if (hosted && (await checkQuota()).available < 1)
        throw new Error(
          "可用图片额度为 0，请联系管理员补充。完整草稿已保存，补充后即可继续。",
        );
      const accepted = await post<{
        id: string;
        batchId: string;
        accepted: boolean;
      }>("/projects/" + id + "/batches", {
        text: draft,
        requestId,
        generationMode,
      });
      if (!accepted.accepted || !accepted.id || !accepted.batchId)
        throw new Error("尚未确认服务端接受，请重试；相同讲稿不会重复提交。");
      acceptedSubmission = true;
      generationRequest.current!.accepted();
      if (onboarding.generation !== "direct")
        onOnboardingChange({
          generation: rememberDirect ? "direct" : "confirmed",
        });
      cacheDraft(null);
      latestDraft.current = "";
      setDraft("");
      setComposerOpen(false);
      setSaving(false);
      setFilter("latest");
      setPageQuery("");
      setPageGroup(0);
      await refresh();
      await onRefresh();
    } catch (e) {
      if (!acceptedSubmission) cacheDraft(draft);
      setError((e as Error).message);
    } finally {
      submitLock.current = false;
      setSubmitting(false);
    }
  };
  const add = () => {
    if (!draft.trim() || submitLock.current) return;
    if (!modelsReady) {
      setGenerationDialog("models");
      return;
    }
    if (onboarding.generation !== "direct") {
      setDirectGeneration(false);
      setGenerationDialog("confirm");
    } else void submitDraft();
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
  const previewJob = jobs.find(
    (j) => j.status === "completed" && j.preview && j.type === "append",
  );
  const previewPage = project.slides.find(
    (s) => s.id === previewJob?.preview?.slideId && (s.image || s.scene),
  );
  const previewBatch = project.batches.find(
    (b) => b.id === previewJob?.batchId,
  );
  const previewRemaining = project.slides.filter(
    (s) => previewBatch?.slideIds.includes(s.id) && !s.image && !s.scene,
  );
  const imagePlan = planImageBatch(imageBatch?.ids || [], credits?.available);
  const completeImageBatch = async (count: number) => {
    if (completingPreview || busy || !imageBatch || count < 1) return;
    setCompletingPreview(true);
    setImageBatchError("");
    let accepted = false;
    try {
      if (hosted && (await checkQuota()).available < count)
        throw new Error(
          "可用额度刚刚发生变化，请按更新后的张数重新确认。此次尚未提交生成。",
        );
      const ids = imageBatch.ids.filter((sid) =>
        project.slides.some(
          (slide) => slide.id === sid && !slide.image && !slide.scene,
        ),
      );
      if (ids.length !== imageBatch.ids.length) {
        setImageBatch({ ...imageBatch, ids });
        throw new Error(
          "部分页面已完成或已调整，已更新待生成范围，请重新确认。",
        );
      }
      await post(`/projects/${id}/render`, {
        slideIds: imagePlan.ids.slice(0, count),
        redesign: false,
      });
      accepted = true;
      setImageBatch(null);
      await refresh();
      await onRefresh();
    } catch (e) {
      if (accepted)
        setError(
          "任务已提交，但页面状态暂未刷新。请稍后查看进度，不要重复提交。",
        );
      else setImageBatchError((e as Error).message);
    } finally {
      setCompletingPreview(false);
    }
  };
  const pageBusy = (sid: string) =>
    activeJobs.some((j) => !j.slideIds || j.slideIds.includes(sid));
  const retryTask = (job: Job) => {
    setError("");
    setRetryError("");
    if (
      job.uncertain ||
      job.pageProgress?.failed.some((page) => page.uncertain)
    ) {
      setReviewedRetry(false);
      setRetryReview(job);
    } else void run(() => post(`/jobs/${job.id}/retry`));
  };
  const confirmRetry = async () => {
    if (!retryReview || !reviewedRetry || retrying) return;
    setRetrying(true);
    setRetryError("");
    try {
      await post(`/jobs/${retryReview.id}/retry`, {
        acknowledgeUncertain: true,
      });
      setRetryReview(null);
      await refresh();
      await onRefresh();
    } catch (e) {
      setRetryError((e as Error).message);
    } finally {
      setRetrying(false);
    }
  };
  const proposalBusy = project.proposal?.sourceIds.some(pageBusy) ?? false;
  const submitProposal = async (commit: boolean) => {
    const proposalId = project.proposal?.id;
    if (!proposalId || proposalSubmitting) return;
    setProposalSubmitting(true);
    setProposalError("");
    try {
      if (commit)
        await post("/projects/" + id + "/proposal/commit", { proposalId });
      else await api("/projects/" + id + "/proposal", { method: "DELETE" });
      setProposalOpen(false);
      notify(commit ? "已确认调整，新页面正在后台制作。" : "已放弃这次调整。");
      try {
        await refresh();
        await onRefresh();
      } catch {
        setError(
          "调整已提交，但页面状态暂未刷新，请稍后刷新页面，不要重复提交。",
        );
      }
    } catch (e) {
      setProposalError((e as Error).message);
    } finally {
      setProposalSubmitting(false);
    }
  };
  const lastJob = jobs[0];
  const production = currentProduction(project, jobs);
  const currentBatch = project.batches.at(-1);
  const sourceBatch =
    filter === "latest"
      ? production.batchIds.length === 1
        ? project.batches.find((b) => b.id === production.batchIds[0])
        : undefined
      : filter === "all"
        ? currentBatch
        : project.batches.find((b) => b.id === filter);
  const incomplete = project.batches.filter((b) => !b.slideIds.length);
  const style = styles.find((s) => s.id === project.styleId);
  const shown = hosted ? pageResult.slides : pageScope;
  const selectedHidden = selected.filter(
    (sid) => !shown.some((slide) => slide.id === sid),
  ).length;
  const changePageGroup = (group: number) => {
    setPageGroup(group);
    requestAnimationFrame(() => {
      gallery.current?.scrollIntoView({ block: "start", behavior: "instant" });
      gallery.current?.focus({ preventScroll: true });
    });
  };
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
  const journey = projectJourney(project, jobs, !!draft.trim(), [
    ...records.dynamic.records,
    ...records.narration.records,
  ]);
  const primaryAction = projectPrimaryAction("studio", journey);
  const followAction = (action: JourneyAction) => {
    onAreaChange(action.area);
    if (action.area !== "studio") return;
    if (action.target === "stale") {
      setVisualReviewOpen(true);
      return;
    }
    setFilter("all");
    if (
      action.target === "composer" ||
      (!project.slides.length && !project.batches.length)
    ) {
      focusComposer();
      return;
    }
    if (action.target === "proposal") {
      setProposalError("");
      setProposalOpen(true);
      return;
    }
    const target = project.slides.find((slide) =>
      action.target === "missing"
        ? !slide.image && !slide.scene
        : action.target === "stale"
          ? slide.stale
          : action.target === "failed"
            ? slide.status === "error"
            : false,
    );
    if (target) {
      setDetail(target.id);
      return;
    }
    requestAnimationFrame(() => {
      const element = ["jobs", "batches"].includes(action.target)
        ? studioTasks.current
        : gallery.current;
      element?.scrollIntoView({ block: "start", behavior: "instant" });
      element?.focus({ preventScroll: true });
    });
  };
  const composerPanel = (
    <section
      hidden={
        !composerOpen && (!!project.slides.length || !!project.batches.length)
      }
      aria-label="追加讲稿"
      className={`composer ${!project.slides.length ? "first-composer" : ""}`}
    >
      <div className="composer-heading">
        <div>
          <span className="composer-number">
            {String(project.batches.length + 1).padStart(2, "0")}
          </span>
          <h3>
            {project.batches.length ? "继续添加下一段" : "添加第一段逐字稿"}
          </h3>
        </div>
        {!!project.slides.length && (
          <Button variant="ghost" onClick={() => setComposerOpen(false)}>
            收起讲稿输入
          </Button>
        )}
        <span className="draft-state">
          {draftSaveError
            ? "草稿保存失败，请重试"
            : saving
              ? "正在保存草稿…"
              : draft
                ? "草稿已保存"
                : "可以先给一小段，满意后再继续"}
        </span>
      </div>
      {!project.batches.length && !project.slides.length && (
        <div className="composer-onboarding">
          <p>粘贴约 100–500 字准备讲的话即可。</p>
          {!draft.trim() && (
            <Button
              variant="ghost"
              onClick={() => {
                updateDraft(exampleManuscript);
                focusComposer();
              }}
            >
              使用示例文字
            </Button>
          )}
        </div>
      )}
      <textarea
        ref={composer}
        disabled={submitting}
        aria-label="添加逐字稿"
        value={draft}
        onChange={(e) => updateDraft(e.target.value)}
        placeholder={
          project.batches.length
            ? "接下来，你想讲什么？粘贴下一段逐字稿…"
            : "把你准备讲的话放在这里。\n不需要整理格式，也不需要自己分成演示页面。"
        }
        maxLength={200000}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !submitting) {
            e.preventDefault();
            add();
          }
        }}
      />
      {!project.batches.length && !project.slides.length && (
        <p className="composer-save-help">
          草稿已保存不等于已生成，提交后才开始制作。
        </p>
      )}
      {!modelsReady && (
        <p className="composer-model-help">
          {modelStatusUnknown
            ? unknownModelStatus
            : managedModels
              ? "模型由管理员管理，尚未就绪；可继续保存草稿，生成前请联系管理员。"
              : "生成前需连接内容与图片模型；现在可以继续保存草稿。"}
          <Button variant="ghost" onClick={() => void connectModels()}>
            {managedModels ? "查看模型服务状态" : "连接模型"}
          </Button>
        </p>
      )}
      {!generationPersistent && (
        <p className="composer-save-help" role="status">
          无法保存生成请求标识；本次会话可继续使用，但重启后无法识别未确认的提交。若提交结果不明，请先查看项目状态再重试。
        </p>
      )}
      {hosted && (
        <fieldset className="generation-choice" disabled={submitting}>
          <legend>这次怎么制作</legend>
          <label data-selected={generationMode === "preview"}>
            <input
              type="radio"
              name="generation-mode"
              value="preview"
              checked={generationMode === "preview"}
              onChange={() => setGenerationMode("preview")}
            />
            <span>
              <strong>先试一页</strong>
              <small>完整保存并拆页，只生成第一页画面</small>
            </span>
          </label>
          <label data-selected={generationMode === "full"}>
            <input
              type="radio"
              name="generation-mode"
              value="full"
              checked={generationMode === "full"}
              onChange={() => setGenerationMode("full")}
            />
            <span>
              <strong>制作全部页面</strong>
              <small>按讲稿拆页后，逐页生成全部画面</small>
            </span>
          </label>
        </fieldset>
      )}
      {hosted && (
        <p className="composer-quota">
          可用 {credits?.available ?? "待确认"} 张图片额度
          {credits?.held ? ` · ${credits.held} 张正在预留或待核对` : ""}。
          {credits?.available === 0
            ? "请联系管理员补充，草稿仍可正常保存。"
            : generationMode === "preview"
              ? "试做成功使用 1 张，满意后再做剩余页。"
              : "拆页后才确定总张数；建议先试一页。"}
        </p>
      )}
      <div className="composer-footer">
        <span>
          {draft.length.toLocaleString()} 字
          <span className="composer-shortcut">⌘ Enter 提交</span>
        </span>
        <Button
          variant="primary"
          onClick={add}
          disabled={!draft.trim() || (hosted && credits?.available === 0)}
          loading={submitting}
        >
          {hosted
            ? generationMode === "preview"
              ? "生成一页试效果"
              : "提交并制作全部页面"
            : "提交讲稿并制作"}
          <ArrowUp size={17} />
        </Button>
      </div>
    </section>
  );
  const exportScript = async () => {
    setScriptExporting(true);
    try {
      await run(
        () => downloadManuscript(project.id, project.revision),
        "演说稿 Markdown 已开始下载。",
      );
    } finally {
      setScriptExporting(false);
    }
  };
  const secondaryActions = (
    <>
      <Button
        variant="ghost"
        disabled={!project.slides.length}
        onClick={() => setRedesignOpen(true)}
      >
        <ArrowsClockwise size={18} />
        重新设计
      </Button>
      {insertExportAvailable && (
        <Button
          className="insert-first"
          variant="ghost"
          onClick={() => setInsertion({ afterSlideId: null })}
        >
          <Plus size={15} /> 在第一页前插入
        </Button>
      )}
      {project.undo && (
        <Button
          variant="ghost"
          disabled={
            project.undo.replacementIds
              ? project.undo.replacementIds.some(pageBusy)
              : !!busy
          }
          onClick={() =>
            run(() => post("/projects/" + id + "/undo"), "已恢复调整前的页面。")
          }
        >
          <ArrowCounterClockwise size={15} />
          撤销{project.undo.label}
        </Button>
      )}
    </>
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
          <p className="project-metadata">
            {project.batches.length} 段逐字稿<span>·</span>
            {project.slides.length} 页画面<span>·</span>
            {project.slides
              .reduce((n, s) => n + s.notes.trim().length, 0)
              .toLocaleString()}{" "}
            字<span>·</span>母版 r{project.revision}
          </p>
          {(journey.missing.length > 0 ||
            journey.stale > 0 ||
            journey.failed > 0 ||
            journey.working > 0) && (
            <p className="project-alert-summary">
              {[
                journey.missing.length
                  ? `${journey.missing.length} 页缺图`
                  : "",
                journey.stale ? `${journey.stale} 页待核对` : "",
                journey.failed ? `${journey.failed} 页失败` : "",
                journey.working ? `${journey.working} 项制作中` : "",
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          )}
        </div>
      </div>
      <nav className="project-area-nav" aria-label="项目区域">
        {(Object.entries(projectAreas) as [ProjectArea, string][]).map(
          ([key, label]) => (
            <button
              key={key}
              aria-current={area === key ? "page" : undefined}
              onClick={() => onAreaChange(key)}
            >
              {label}
            </button>
          ),
        )}
      </nav>
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
      {area === "overview" && (
        <ProjectOverview journey={journey} onAction={followAction} />
      )}
      {area === "rehearsal" && (
        <RehearsalCenter
          project={project}
          journey={journey}
          records={records}
          capabilities={capabilities}
          selectedCount={selected.length}
          onSpeech={(prepare) => {
            setSpeechInitialPanel(prepare ? "text" : "play");
            setSpeechOpen(true);
          }}
          onMotion={() => setMotionOpen(true)}
          onSettings={onSettings}
          onStudio={() =>
            followAction({
              area: "studio",
              target: "pages",
              label: "返回制作台",
            })
          }
        />
      )}
      {area === "delivery" && (
        <DeliveryCenter
          hosted={hosted}
          project={project}
          journey={journey}
          records={records}
          capabilities={capabilities}
          scriptExporting={scriptExporting}
          onReport={() => setReportOpen(true)}
          onExport={setExportOpen}
          onManuscript={exportScript}
          onRehearsal={() => onAreaChange("rehearsal")}
          onAction={followAction}
          notify={notify}
        />
      )}
      <section
        hidden={area !== "studio"}
        aria-label="制作台"
        className="project-studio"
      >
        <div className="studio-topbar">
          <div>
            <h2>制作台</h2>
            <p>
              {journey.total} 页 ·{" "}
              {
                project.slides.filter(
                  (slide) =>
                    (!slide.image && !slide.scene) ||
                    slide.stale ||
                    slide.status === "error",
                ).length
              }{" "}
              页待处理
            </p>
          </div>
          <div className="studio-topbar-actions">
            {(!!project.slides.length || !!project.batches.length) &&
              !composerOpen &&
              !(previewPage && previewRemaining.length) && (
                <Button
                  variant="primary"
                  onClick={() => followAction(primaryAction)}
                >
                  {primaryAction.label}
                </Button>
              )}
            {(!!project.slides.length || !!project.batches.length) && (
              <Button onClick={focusComposer}>
                <Plus size={17} />
                继续添加讲稿
              </Button>
            )}
          </div>
        </div>
        {!project.slides.length && !project.batches.length && composerPanel}
        <div
          ref={studioTasks}
          className="studio-tasks"
          tabIndex={-1}
          aria-label="制作任务"
        >
          {!busy && previewPage && previewRemaining.length > 0 && (
            <section className="preview-ready" aria-label="一页试做已完成">
              <div>
                <span>先试一页 · 已完成</span>
                <h3>先看效果，再决定是否继续</h3>
                <p>
                  完整讲稿已保存并拆为 {previewBatch?.slideIds.length} 页；其余{" "}
                  {previewRemaining.length} 页尚未生成画面。
                </p>
              </div>
              <div className="preview-ready-actions">
                <Button onClick={() => setDetail(previewPage.id)}>
                  查看试做页
                </Button>
                <Button
                  variant="primary"
                  onClick={() =>
                    void openImageBatch(
                      previewRemaining.map((slide) => slide.id),
                      true,
                    )
                  }
                >
                  满意，生成其余 {previewRemaining.length} 页
                  <ArrowRight size={16} />
                </Button>
              </div>
            </section>
          )}
          {activeJobs.length > 0 && (
            <p>
              后台制作：
              {activeJobs.filter((j) => j.status === "running").length}{" "}
              项进行中，{activeJobs.filter((j) => j.status === "queued").length}{" "}
              项排队。最多同时执行 4 项，可继续修改其他页面。
            </p>
          )}
          {activeJobs.map((busy) => (
            <section
              className="job-task"
              key={busy.id}
              aria-label="本次制作进度"
            >
              <div className="job-banner" role="status">
                <SpinnerGap className="spin" size={22} />
                <div>
                  <strong>
                    {!busy.pageProgress && busy.slideIds?.length === 1
                      ? `第 ${project.slides.findIndex((s) => s.id === busy.slideIds![0]) + 1} 页 · `
                      : ""}
                    {busy.stage}
                  </strong>
                  <span>
                    {busy.status === "queued"
                      ? "正在排队，轮到后自动开始。"
                      : "完成一页就保存一页；失败页先跳过，其余页面继续。"}
                  </span>
                </div>
                {busy.total > 0 && (
                  <span className="job-count">
                    {busy.pageProgress?.phase === "analysis"
                      ? "正在分析内容"
                      : `已处理 ${busy.done} / ${busy.total}`}
                  </span>
                )}
                <Button
                  variant="ghost"
                  onClick={() =>
                    run(() => post("/jobs/" + busy.id + "/cancel"))
                  }
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
              <JobFeedback job={busy} hosted={hosted} />
            </section>
          ))}
          {!busy &&
            lastJob &&
            ["failed", "interrupted", "cancelled"].includes(lastJob.status) && (
              <section className="job-task">
                <div className="inline-notice warm">
                  <WarningCircle size={20} />
                  <div>
                    <strong>{lastJob.stage}</strong>
                    <p>{lastJob.error}</p>
                  </div>
                  <Button onClick={() => retryTask(lastJob)}>
                    {lastJob.uncertain ? "核对后继续" : "继续未完成任务"}
                    <ArrowRight size={16} />
                  </Button>
                </div>
                <JobFeedback job={lastJob} hosted={hosted} />
              </section>
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
                      onClick={() =>
                        retryTask(
                          jobs.find((job) => job.id === b.jobId) ||
                            ({ id: b.jobId } as Job),
                        )
                      }
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
                  {project.proposal.type === "split" ? "拆分" : "合并"}
                  方案已准备好
                </strong>
                <p>
                  预览 {project.proposal.notes.length}{" "}
                  页新方案，确认后再生成画面。
                </p>
              </div>
              <Button
                onClick={() => {
                  setError("");
                  setProposalError("");
                  setProposalOpen(true);
                }}
              >
                查看新方案
                <ArrowRight size={16} />
              </Button>
            </div>
          )}
        </div>
        <div
          ref={gallery}
          className="studio-pages"
          tabIndex={-1}
          aria-label="页面序列"
        >
          {project.slides.length > 0 && (
            <>
              <div className="gallery-toolbar">
                <div className="studio-view-controls">
                  <div
                    className="studio-control-group"
                    role="group"
                    aria-label="内容视图"
                  >
                    <span>内容视图</span>
                    <div className="segmented">
                      <button
                        className={!showScript ? "active" : ""}
                        aria-pressed={!showScript}
                        onClick={() => setShowScript(false)}
                      >
                        页面
                      </button>
                      <button
                        className={showScript ? "active" : ""}
                        aria-pressed={showScript}
                        onClick={() => setShowScript(true)}
                      >
                        <FileText size={15} />
                        演说稿
                      </button>
                    </div>
                  </div>
                  <div
                    className="studio-control-group"
                    role="group"
                    aria-label="范围筛选"
                  >
                    <span>范围筛选</span>
                    <div className="segmented">
                      <button
                        className={filter === "latest" ? "active" : ""}
                        aria-pressed={filter === "latest"}
                        onClick={() => {
                          setFilter("latest");
                          setSelected([]);
                        }}
                      >
                        最近制作 <span>{production.slides.length} 页</span>
                      </button>
                      <button
                        className={filter === "all" ? "active" : ""}
                        aria-pressed={filter === "all"}
                        onClick={() => {
                          setFilter("all");
                          setSelected([]);
                        }}
                      >
                        全部页面 <span>{project.slides.length}</span>
                      </button>
                    </div>
                  </div>
                </div>
                <div className="gallery-actions">
                  <div className="studio-secondary-actions">
                    {secondaryActions}
                  </div>
                  <details className="studio-more-actions">
                    <summary>更多操作</summary>
                    <div>{secondaryActions}</div>
                  </details>

                  {!busy &&
                    !(previewPage && previewRemaining.length) &&
                    pending.some((s) => !(s.image || s.scene)) && (
                      <Button
                        className="fill-missing-pages"
                        onClick={() =>
                          hosted
                            ? void openImageBatch(
                                pending
                                  .filter(
                                    (slide) => !slide.image && !slide.scene,
                                  )
                                  .map((slide) => slide.id),
                              )
                            : run(() =>
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
                  {project.batches.length > 1 && (
                    <select
                      className="batch-select"
                      aria-label="查看段落"
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                    >
                      <option value="latest">最近制作</option>
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
              {hosted && (
                <PageBrowser
                  query={pageQuery}
                  onQuery={setPageQuery}
                  result={pageResult}
                  onPage={changePageGroup}
                  selectedHidden={selectedHidden}
                />
              )}
              {hosted && !shown.length && (
                <div className="page-browser-empty">
                  <p>当前范围没有符合条件的页面。</p>
                  <Button
                    onClick={() => {
                      setPageQuery("");
                      setFilter("all");
                    }}
                  >
                    查看全部页面
                  </Button>
                </div>
              )}
              {showScript ? (
                <div className="manuscript-list">
                  <div className="manuscript-intro">
                    <h2>
                      {hosted && pageResult.pages > 1
                        ? "演说稿 · 分组浏览"
                        : filter === "all"
                          ? "你的完整演说稿"
                          : "所选范围的演说稿"}
                    </h2>
                    <p>
                      按照页面顺序排列。点击任意一段，修改对应页面的讲稿；完整逐字稿可在交付中心下载。
                    </p>
                  </div>
                  {shown.map((s) => (
                    <div key={s.id}>
                      <button
                        key={s.id}
                        className="manuscript-row"
                        onClick={() => setDetail(s.id)}
                      >
                        <span>
                          {String(project.slides.indexOf(s) + 1).padStart(
                            2,
                            "0",
                          )}
                        </span>
                        <p>{s.notes}</p>
                        <PencilSimple size={16} />
                      </button>
                      {insertExportAvailable && (
                        <button
                          className="insert-page"
                          onClick={() => setInsertion({ afterSlideId: s.id })}
                          aria-label={
                            project.slides.indexOf(s) ===
                            project.slides.length - 1
                              ? "在末尾插入一页"
                              : `在第 ${project.slides.indexOf(s) + 1}、${project.slides.indexOf(s) + 2} 页之间插入`
                          }
                          title="在此页后插入一页"
                        >
                          <Plus size={15} />
                        </button>
                      )}
                    </div>
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
                        disabled={pageBusy(s.id)}
                        onClick={() => select(s.id)}
                        aria-label={`选择第 ${project.slides.indexOf(s) + 1} 页`}
                        aria-pressed={selected.includes(s.id)}
                      >
                        {selected.includes(s.id) ? (
                          <CheckSquare size={23} weight="fill" />
                        ) : (
                          <Square size={23} />
                        )}
                      </button>
                      <div className="slide-caption">
                        <span className="page-number">
                          {String(project.slides.indexOf(s) + 1).padStart(
                            2,
                            "0",
                          )}
                        </span>
                        <div>
                          <h3>
                            {s.plan?.title || s.notes.trim().slice(0, 24)}
                          </h3>
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
                          <span className="page-state progress">制作中</span>
                        ) : s.status === "error" ? (
                          <span className="page-state error">制作失败</span>
                        ) : s.stale ? (
                          <span className="page-state warning">
                            讲稿已改 · 待核对
                          </span>
                        ) : s.image || s.scene ? (
                          <CheckCircle className="ready-check" size={17} />
                        ) : (
                          <span className="page-state warning">待制作</span>
                        )}
                      </div>
                      {(s.stale ||
                        s.status === "error" ||
                        (!s.image && !s.scene)) && (
                        <Button
                          className="page-repair"
                          onClick={() => setDetail(s.id)}
                        >
                          {s.status === "error"
                            ? "查看原因并重试"
                            : s.stale
                              ? "核对并更新画面"
                              : "继续制作本页"}
                        </Button>
                      )}
                      {s.error && <p className="card-error">{s.error}</p>}
                      {insertExportAvailable && (
                        <button
                          className="insert-page"
                          onClick={() => setInsertion({ afterSlideId: s.id })}
                          aria-label={
                            project.slides.indexOf(s) ===
                            project.slides.length - 1
                              ? "在末尾插入一页"
                              : `在第 ${project.slides.indexOf(s) + 1}、${project.slides.indexOf(s) + 2} 页之间插入`
                          }
                          title="在此页后插入一页"
                        >
                          <Plus size={15} />
                        </button>
                      )}
                    </article>
                  ))}
                </div>
              )}
              {hosted && (
                <PagePagination result={pageResult} onPage={changePageGroup} />
              )}
            </>
          )}
        </div>
        {(!!project.slides.length || !!project.batches.length) && composerPanel}
        <details className="studio-settings">
          <summary>制作设置 · {style?.name || "选择风格"}</summary>
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
            内容倾向：{project.designOptions?.audience?.description || "未限定"}{" "}
            · 配色：{project.designOptions?.palette?.name || "沿用风格"}。
            新制作使用当前设置，已有画面保持原样。
          </p>
          {style?.deletedAt && (
            <div className="inline-notice warm">
              <WarningCircle size={20} />
              <span>
                当前风格已删除，请在上方选择其他风格。已有页面与备注已保留。
              </span>
            </div>
          )}
          {!modelsReady && (
            <div className="inline-notice">
              <WarningCircle size={20} />
              <span>
                {modelStatusUnknown
                  ? unknownModelStatus
                  : managedModels
                    ? "模型尚未就绪，请等待管理员配置；可以先保存草稿。"
                    : "先连接模型，即可自动分析文稿和生成画面。草稿可以先写下来。"}
              </span>
              <Button onClick={onSettings}>
                {managedModels ? "查看模型服务状态" : "连接模型"}
              </Button>
            </div>
          )}
        </details>
        {sourceBatch && (
          <details className="submitted-manuscript">
            <summary>
              {sourceBatch.label} · 提交时的原文{" "}
              <span>{sourceBatch.text.length} 字</span>
            </summary>
            <p>{sourceBatch.text}</p>
          </details>
        )}
        {selected.length > 0 && (
          <div className="selection-bar">
            <span>已选 {selected.length} 页</span>
            <span className="selection-pages">
              {selectedPages
                .map((s) => project.slides.indexOf(s) + 1)
                .join("、")}
            </span>
            <Button
              disabled={selected.some(pageBusy) || !style || !!style.deletedAt}
              onClick={() => setRedesignOpen(true)}
            >
              <ArrowsClockwise size={17} />
              重新设计所选 {selected.length} 页
            </Button>
            <Button
              disabled={
                selected.length < 2 ||
                selected.some(pageBusy) ||
                activeJobs.some((j) => j.type === "proposal")
              }
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
        {project.slides.length > 0 && (
          <p className="workspace-bottom">
            逐字稿与图片自动关联 · 逐段制作，随时调整 · {dataRootLabel}
          </p>
        )}
      </section>
      {visualReviewOpen && (
        <VisualReview
          project={project}
          onClose={() => setVisualReviewOpen(false)}
          onUpdated={setProject}
          onEdit={(sid) => {
            setVisualReviewOpen(false);
            setDetail(sid);
          }}
        />
      )}
      {speechOpen && (
        <Suspense
          fallback={
            <div className="connection-banner" role="status">
              正在载入演讲播放器…
            </div>
          }
        >
          {hosted && speechInitialPanel === "play" ? (
            <StandardPresentation
              project={project}
              onClose={() => {
                setSpeechOpen(false);
                onAreaChange("rehearsal");
              }}
            />
          ) : (
            <SpeechPresentation
              managed={hosted}
              initialPanel={speechInitialPanel}
              projectId={id}
              onClose={() => {
                setSpeechOpen(false);
                onAreaChange("rehearsal");
              }}
              onSettings={() => {
                setSpeechOpen(false);
                onSettings();
              }}
            />
          )}
        </Suspense>
      )}
      {insertion && (
        <InsertPageDialog
          project={project}
          afterSlideId={insertion.afterSlideId}
          onClose={() => setInsertion(null)}
          onInserted={(p, generated) => {
            setProject(p);
            setInsertion(null);
            setFilter("all");
            notify(
              generated
                ? "新页面已插入，正在后台生成。可以继续编辑其他页面。"
                : "新页面已插入，可继续修改讲稿或生成图片。",
            );
            refresh().catch(() => {});
            onRefresh().catch(() => {});
          }}
        />
      )}
      {redesignOpen && (
        <RedesignDialog
          project={project}
          style={style}
          selected={selected}
          pageBusy={pageBusy}
          onClose={() => setRedesignOpen(false)}
          onSubmitted={(count) => {
            setRedesignOpen(false);
            setSelected([]);
            void run(
              async () => {},
              `已提交 ${count} 页重新设计，旧版本会保留。`,
            );
          }}
        />
      )}
      {motionOpen && (
        <MotionPresentation
          project={project}
          selected={selected}
          onClose={() => {
            setMotionOpen(false);
            onAreaChange("rehearsal");
          }}
        />
      )}
      {exportOpen && (
        <ExportDialog
          hosted={hosted}
          initialFormat={exportOpen}
          bundleAvailable={insertExportAvailable}
          project={project}
          busy={!!busy}
          packageBusy={
            saving ||
            submitting ||
            draft !== project.draft ||
            [...records.narration.records, ...records.dynamic.records].some(
              (d) => active(d.status),
            )
          }
          hasDraft={!!draft.trim()}
          onClose={() => setExportOpen(null)}
          onStudio={() => {
            setExportOpen(null);
            followAction(primaryAction);
          }}
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
            onAreaChange("studio");
            setDetail(sid);
          }}
        />
      )}
      {generationDialog && (
        <Modal
          title={
            generationDialog === "models" || !modelsReady
              ? "草稿可以先保存"
              : "生成前，了解这次模型调用"
          }
          onClose={() => {
            setGenerationDialog(null);
            focusComposer();
          }}
        >
          {generationDialog === "models" || !modelsReady ? (
            <>
              <p>
                {modelStatusUnknown
                  ? unknownModelStatus
                  : managedModels
                    ? "模型尚未就绪，请联系管理员或等待管理员配置。草稿会保留，可以继续编辑和保存。"
                    : "生成前需要连接内容和图片模型。草稿会保留，可以继续编辑和保存。"}
              </p>
              {managedModels && !modelStatusUnknown && (
                <p>
                  {capabilities.localModelSettings.reason ||
                    "模型由管理员管理，请联系管理员配置。"}
                </p>
              )}
              <div className="modal-actions">
                <Button
                  onClick={() => {
                    setGenerationDialog(null);
                    focusComposer();
                  }}
                >
                  继续保存草稿
                </Button>
                <Button variant="primary" onClick={() => void connectModels()}>
                  {managedModels ? "查看模型服务状态" : "连接模型并继续"}
                </Button>
              </div>
            </>
          ) : (
            <>
              <p>
                {generationMode === "preview"
                  ? "完整讲稿会保存并拆页，本次只生成第一页画面；其他页面等你确认效果后再生成。"
                  : "先调用内容模型拆页，再按实际拆分页调用图片模型。具体页数由拆页结果决定。"}
              </p>
              <p>
                {hosted
                  ? generationMode === "preview"
                    ? "成功生成试做页使用 1 张图片额度；内容分析也会调用模型。"
                    : "每张成功图片使用 1 张额度；内容分析也会调用模型。"
                  : "费用由已配置服务商按实际调用收取。"}
              </p>
              <p>返回修改或关闭不会丢失草稿。</p>
              <label className="onboarding-check">
                <input
                  type="checkbox"
                  checked={directGeneration}
                  onChange={(event) =>
                    setDirectGeneration(event.target.checked)
                  }
                />
                以后直接生成
              </label>
              <small>仅适用于提交新讲稿；不影响其他模型操作的确认。</small>
              <div className="modal-actions">
                <Button
                  onClick={() => {
                    setGenerationDialog(null);
                    focusComposer();
                  }}
                >
                  返回修改
                </Button>
                <Button
                  variant="primary"
                  loading={submitting}
                  onClick={() => {
                    if (submitLock.current) return;
                    void submitDraft(directGeneration);
                  }}
                >
                  {hosted && generationMode === "preview"
                    ? "确认，试做一页"
                    : "开始生成"}
                </Button>
              </div>
            </>
          )}
        </Modal>
      )}
      {retryReview && (
        <Modal
          title="先核对这次生成，再决定是否继续"
          onClose={() => !retrying && setRetryReview(null)}
        >
          <p>
            服务可能已经处理了部分请求，但没有返回可用结果。已完成的页面和原稿都会保留。
          </p>
          <p>
            {hosted
              ? "请先联系管理员核对账号中的待确认用量与生成记录。"
              : "请先核对服务商的用量与生成记录。"}
            继续会重新提交未完成部分，可能再次计费。
          </p>
          <label className="consent-line">
            <input
              type="checkbox"
              checked={reviewedRetry}
              onChange={(event) => setReviewedRetry(event.target.checked)}
            />
            我已核对记录，并决定重新提交未完成部分
          </label>
          {retryError && (
            <p role="alert" className="error-text">
              {retryError}
            </p>
          )}
          <div className="modal-actions">
            <Button disabled={retrying} onClick={() => setRetryReview(null)}>
              暂不重试
            </Button>
            <Button
              variant="primary"
              disabled={!reviewedRetry}
              loading={retrying}
              onClick={() => void confirmRetry()}
            >
              重新提交未完成部分
            </Button>
          </div>
        </Modal>
      )}
      {imageBatch && (
        <Modal
          title={imageBatch.preview ? "继续生成其余页面" : "补齐未生成页面"}
          subtitle="沿用当前项目风格与讲稿。"
          onClose={() => !completingPreview && setImageBatch(null)}
        >
          <p>本次生成尚无画面的 {imagePlan.total} 页；已有图片保持原样。</p>
          <p>
            每张成功图片使用 1
            张额度，内容分析也会调用模型。失败后可继续未完成页面。
          </p>
          {hosted && (
            <div className="image-batch-quota" role="status">
              <strong>
                {checkingQuota
                  ? "正在确认可用额度…"
                  : `可用 ${credits?.available ?? "待确认"} 张 · 本次需要 ${imagePlan.total} 张`}
              </strong>
              {!checkingQuota && imagePlan.limited && (
                <p>
                  {imagePlan.affordable > 0
                    ? `可以先按页序生成前 ${imagePlan.affordable} 页，剩余 ${imagePlan.remaining} 页以后继续。`
                    : "请联系管理员补充额度，讲稿与已有图片都已保存。"}
                </p>
              )}
              <p>
                每张成功图片使用 1 张。其他任务可能占用额度，提交时会再次检查。
              </p>
            </div>
          )}
          {imageBatchError && (
            <p role="alert" className="error-text">
              {imageBatchError}
            </p>
          )}
          <div className="modal-actions">
            <Button
              onClick={() => setImageBatch(null)}
              disabled={completingPreview}
            >
              {imageBatch.preview ? "再看看试做页" : "暂不生成"}
            </Button>
            <Button
              variant="primary"
              loading={completingPreview}
              disabled={
                !imagePlan.total ||
                !!busy ||
                checkingQuota ||
                (hosted && (!imagePlan.known || !imagePlan.affordable))
              }
              onClick={() =>
                void completeImageBatch(
                  hosted ? imagePlan.affordable : imagePlan.total,
                )
              }
            >
              {hosted && imagePlan.limited
                ? imagePlan.affordable
                  ? `先生成前 ${imagePlan.affordable} 页`
                  : "额度不足，暂不可生成"
                : `生成${imageBatch.preview ? "其余" : "待制作"} ${imagePlan.total} 页`}
            </Button>
          </div>
        </Modal>
      )}
      {detailSlide && (
        <SlideDetail
          hosted={hosted}
          teaching={
            onboarding.page === "pending" &&
            !!(
              detailSlide.notes.trim() ||
              detailSlide.image ||
              detailSlide.scene
            )
          }
          onTaught={() => onOnboardingChange({ page: "done" })}
          slide={detailSlide}
          index={project.slides.indexOf(detailSlide)}
          total={project.slides.length}
          projectId={id}
          revision={project.revision}
          styles={styles}
          currentStyle={style}
          busy={pageBusy(detailSlide.id)}
          projectBusy={pageBusy(detailSlide.id)}
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
          onDone={async (generating) => {
            setSplit(null);
            await refresh();
            notify(
              generating
                ? "已拆分，图片正在后台制作，可以继续编辑其他空闲页。"
                : "已拆分，可继续修改新页面，准备好后再生成图片。",
            );
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
          {proposalBusy && (
            <p className="generation-style-help" role="status">
              本次调整的原页面仍在制作，请完成或停止该页任务后确认；其他页的任务不影响确认。
            </p>
          )}
          {proposalError && (
            <p className="error-text" role="alert">
              上次提交未成功：{proposalError}
            </p>
          )}
          <div className="modal-actions">
            <Button
              disabled={proposalBusy || proposalSubmitting}
              onClick={() => submitProposal(false)}
            >
              放弃这次调整
            </Button>
            <Button
              variant="primary"
              disabled={proposalBusy}
              loading={proposalSubmitting}
              onClick={() => submitProposal(true)}
            >
              {proposalSubmitting ? "正在提交…" : "确认并生成页面"}
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
function InsertPageDialog({
  project,
  afterSlideId,
  onClose,
  onInserted,
}: {
  project: Project;
  afterSlideId: string | null;
  onClose: () => void;
  onInserted: (project: Project, generated: boolean) => void;
}) {
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const requestId = useRef(crypto.randomUUID());
  const index = project.slides.findIndex((s) => s.id === afterSlideId);
  const submit = async (generate: boolean) => {
    if (busy || !notes.trim()) return;
    setBusy(true);
    setError("");
    try {
      const result = await post<{ project: Project; slideId: string }>(
        `/projects/${project.id}/slides`,
        {
          afterSlideId,
          notes,
          generate,
          requestId: requestId.current,
        },
      );
      onInserted(result.project, generate);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="插入一页"
      subtitle={
        afterSlideId === null
          ? "插入到第一页之前。"
          : `插入到第 ${index + 1} 页之后，后续页码自动顺延。`
      }
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <Field label="新页面逐字稿">
        <textarea
          autoFocus
          aria-label="新页面逐字稿"
          rows={9}
          value={notes}
          disabled={busy}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="填写这一页要讲的完整内容…"
        />
      </Field>
      <p className="detail-help">
        固定新增一页，沿用项目当前风格、内容倾向和配色。系统会提炼上屏文案，完整讲稿保留在备注和逐字稿导出中。
      </p>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      <div className="modal-actions">
        <Button onClick={onClose} disabled={busy}>
          取消
        </Button>
        <Button disabled={busy || !notes.trim()} onClick={() => submit(false)}>
          仅插入，稍后生成
        </Button>
        <Button
          variant="primary"
          disabled={!notes.trim()}
          loading={busy}
          onClick={() => submit(true)}
        >
          插入并生成
        </Button>
      </div>
    </Modal>
  );
}

function ExportDialog({
  hosted,
  initialFormat,
  packageBusy,
  bundleAvailable,
  project,
  busy,
  hasDraft,
  onClose,
  onStudio,
  notify,
}: {
  hosted: boolean;
  project: Project;
  initialFormat: ExportFormat;
  packageBusy: boolean;
  busy: boolean;
  hasDraft: boolean;
  bundleAvailable: boolean;
  onClose: () => void;
  onStudio: () => void;
  notify: (message: string) => void;
}) {
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const [format, setFormat] = useState<ExportFormat>(initialFormat);
  const [confirmedFailed, setConfirmedFailed] = useState("");
  const html = useHtmlExportOptions(project.id);
  const missing = project.slides.flatMap((s, i) =>
    !s.image && !s.scene ? [i + 1] : [],
  );
  const unsegmented = project.batches.filter((b) => !b.slideIds.length).length;
  const stale = project.slides.filter((s) => s.stale).length;
  const failedWithImage = project.slides.flatMap((s, i) =>
    s.status === "error" && (s.image || s.scene) ? [i + 1] : [],
  );
  const failedReviewKey = `${project.revision}:${failedWithImage.join(",")}`;
  const needsFailedReview =
    !!failedWithImage.length && confirmedFailed !== failedReviewKey;
  const blocked =
    busy || !!missing.length || !!unsegmented || !project.slides.length;
  const download = async (manuscriptOnly = false) => {
    if (
      !manuscriptOnly &&
      format !== "project" &&
      (blocked || needsFailedReview)
    )
      return;
    setExporting(true);
    setError("");
    try {
      if (manuscriptOnly)
        await downloadManuscript(project.id, project.revision);
      else if (format === "project")
        await downloadFile(
          `/api/projects/${project.id}/package?revision=${project.revision}`,
          "项目.autoppt.zip",
        );
      else if (format === "html")
        await downloadFile(
          `/api/projects/${project.id}/html?${new URLSearchParams({ revision: String(project.revision), narration: html.narration, notes: html.notes ? "1" : "0", download: "1" })}`,
          "演讲.html",
        );
      else
        await downloadPresentation(
          project.id,
          project.revision,
          !!stale,
          bundleAvailable,
        );
      notify(
        manuscriptOnly
          ? "最新逐字稿已开始下载。"
          : format === "project"
            ? "项目包已开始下载；在另一台电脑的项目首页选择“导入项目包”。"
            : format === "html"
              ? "静态 HTML 已开始下载，可离线放映。"
              : bundleAvailable
                ? "导出包已开始下载，包含 PPTX 和独立的最新逐字稿。"
                : "PPTX 已开始下载，包含逐页讲稿备注。",
      );
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setExporting(false);
    }
  };
  return (
    <Modal
      title="导出演讲"
      subtitle="下载用于放映的文件，或打包项目带到另一台电脑继续编辑。"
      onClose={() => {
        if (!exporting) onClose();
      }}
    >
      <Field label="导出格式">
        <select
          value={format}
          disabled={exporting}
          onChange={(e) => setFormat(e.target.value as ExportFormat)}
        >
          <option value="ppt">
            {bundleAvailable ? "ZIP 交付包 · PPTX 与逐字稿" : "PPTX"}
          </option>
          <option value="html">静态 HTML · 可含口播</option>
          <option value="project">项目迁移包 · 换电脑继续编辑</option>
        </select>
      </Field>
      {format === "html" && (
        <>
          <HtmlExportOptions options={html} disabled={exporting} />
          <p className="detail-help">
            选择已生成且与当前画面、讲稿一致的口播。文件内嵌图片和声音，可离线自动讲述；浏览器拦截出声时，点击一次“开始演讲”。动画
            HTML 请从交付中心的“动态 HTML”下载。
          </p>
        </>
      )}
      {format === "project" ? (
        <p className="detail-help">
          包含保存的讲稿、草稿、图片与历史版本、项目风格、动态演示和口播音频。导入时创建新项目；模型
          API Key 不随包导出，在另一台电脑单独配置。项目素材最多 960 MB。
        </p>
      ) : (
        <div className="ppt-export-summary">
          <h3>{project.title}</h3>
          <p>
            全部 {project.slides.length} 页 · 16:9 宽屏 ·{" "}
            {format === "html"
              ? "离线 HTML 文件"
              : bundleAvailable
                ? "ZIP 内含 PPTX 与逐字稿 Markdown"
                : "PPTX 文件"}
          </p>
          <p>
            图片按原比例完整放入页面，使用适合屏幕播放的高质量
            JPG，减小文件体积。
            {format === "ppt" && "备注使用每页最新保存的完整讲稿。"}
          </p>
          {bundleAvailable && format === "ppt" && (
            <p>
              独立逐字稿按当前页序导出，包含插页及改稿，以版本号命名，不使用提炼后的上屏文案。
            </p>
          )}
        </div>
      )}
      {busy && (
        <p className="export-notice">页面正在制作中，完成或停止后即可导出。</p>
      )}
      {format === "project" && packageBusy && (
        <p className="export-notice">
          草稿正在同步或演示任务进行中，请等待保存、制作完成或停止后再导出项目源文件。
        </p>
      )}
      {!project.slides.length && format !== "project" && (
        <p className="export-notice">
          还没有页面，请先添加讲稿并完成拆页与画面制作。
        </p>
      )}
      {!!unsegmented && format !== "project" && (
        <p className="export-notice">
          还有 {unsegmented} 段逐字稿未完成拆分，请先继续制作。
        </p>
      )}
      {!!missing.length && format !== "project" && (
        <p className="export-notice">
          还有 {missing.length} 页未完成（第 {missing.join("、")}{" "}
          页），请先补齐图片后导出。
        </p>
      )}
      {!!stale && format !== "project" && (
        <p className="export-notice">
          有 {stale}{" "}
          页讲稿已修改，图片尚未更新。本次将使用当前图片，备注采用最新讲稿。
        </p>
      )}
      {!!failedWithImage.length && format !== "project" && (
        <div className="export-notice">
          <p id="failed-export-reason">
            有 {failedWithImage.length} 页生成失败（第{" "}
            {failedWithImage.join("、")} 页），
            仍保留现有画面。本次将使用这些现有画面，请核对后确认继续。
          </p>
          <label className="journey-check">
            <input
              type="checkbox"
              aria-describedby="failed-export-reason"
              checked={!needsFailedReview}
              disabled={exporting}
              onChange={(e) =>
                setConfirmedFailed(e.target.checked ? failedReviewKey : "")
              }
            />
            我已核对失败页，确认使用现有画面继续导出
          </label>
        </div>
      )}
      {hasDraft && format !== "project" && (
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
      {format !== "project" &&
        (blocked ||
          stale ||
          failedWithImage.length ||
          hasDraft ||
          project.proposal) && (
          <Button disabled={exporting} onClick={onStudio}>
            前往制作台处理
          </Button>
        )}
      <div className="modal-actions export-actions">
        <Button onClick={onClose} disabled={exporting}>
          返回
        </Button>
        <Button
          onClick={() => download(true)}
          disabled={exporting || !!unsegmented || !project.slides.length}
        >
          仅下载逐字稿
        </Button>
        <Button
          variant="primary"
          onClick={() => download()}
          loading={exporting}
          aria-label={
            format === "ppt" && bundleAvailable && !exporting
              ? "下载 ZIP 交付包（含 PPTX＋逐字稿）"
              : undefined
          }
          disabled={
            format === "project"
              ? busy || packageBusy
              : blocked || needsFailedReview
          }
        >
          {!exporting && <DownloadSimple size={18} />}
          {exporting
            ? "正在导出…"
            : format === "project"
              ? "下载项目迁移包"
              : format === "html"
                ? "下载静态 HTML"
                : bundleAvailable
                  ? "下载 ZIP 交付包"
                  : "下载 PPTX"}
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
  hosted,
  teaching,
  onTaught,
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
  hosted: boolean;
  teaching: boolean;
  onTaught: () => void;
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
  const [confirmRedesign, setConfirmRedesign] = useState(false);
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
  const finishClose = () => {
    if (teaching) onTaught();
    onClose();
  };
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
    if (teaching) onTaught();
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
      setConfirmRedesign(false);
      setFeedback("");
      setCopyFeedback("");
      notify("修改已提交到后台，可以继续编辑下一页；旧版本会保留。");
    });
  const leave = (action: number | "close") => {
    if (uploading || loading) return;
    if (dirty || attachmentsDirty || feedback.trim() || copyFeedback.trim()) {
      setLeaveAction(action);
      return;
    }
    if (action === "close") finishClose();
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
        {teaching && <PageConcepts onDismiss={onTaught} />}
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
                href={asset(displayed.image) + "?download=screen"}
                download
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
                disabled={loading}
              />
              <textarea
                aria-label="上屏文字调整"
                value={copyFeedback}
                onChange={(e) => setCopyFeedback(e.target.value)}
                placeholder="上屏文字调整：例如只保留核心问题，解释留给口播。留空则复用已提炼文案。"
                disabled={loading}
              />
              <p className="detail-help">
                {busy
                  ? "本页任务正在排队或制作，可以先写修改草稿，完成后再提交。"
                  : "画面和文案分别调整，风格提示词保持原文。"}
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
                onClick={() => {
                  setError("");
                  setConfirmRedesign(true);
                }}
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
                  disabled={loading}
                />
                <div className="notes-footer">
                  <span>
                    {notes.length} 字
                    {dirty
                      ? " · 未保存"
                      : slide.stale
                        ? " · 讲稿已改 · 待核对"
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
                    <RawPromptDetails
                      plan={slide.plan}
                      currentPageNumber={index + 1}
                    />
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
      {confirmRedesign && (
        <Modal
          title="确认重新设计这页"
          onClose={() => !loading && setConfirmRedesign(false)}
        >
          <p>
            {hosted
              ? "重新设计会再次调用模型，并使用管理员提供的图片额度。"
              : "重新设计会再次调用模型，服务商按实际调用收取费用。"}
          </p>
          <p>使用当前讲稿、调整要求和附件重新制作，旧版本会保留。</p>
          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
          <div className="modal-actions">
            <Button
              disabled={loading}
              onClick={() => setConfirmRedesign(false)}
            >
              返回修改
            </Button>
            <Button
              variant="primary"
              loading={loading}
              disabled={busy || uploading}
              onClick={redesign}
            >
              确认重新设计
            </Button>
          </div>
        </Modal>
      )}
      {leaveAction !== null && (
        <Modal
          title="有修改尚未提交"
          subtitle="讲稿、修改要求或附件选择尚未提交，离开后不会应用到页面。"
          onClose={() => setLeaveAction(null)}
        >
          <div className="modal-actions">
            <Button onClick={() => setLeaveAction(null)}>留在此页</Button>
            <Button
              onClick={() => {
                const action = leaveAction;
                setLeaveAction(null);
                if (action === "close") finishClose();
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
  onDone: (generating: boolean) => Promise<void>;
}) {
  const [cuts, setCuts] = useState<number[]>([]),
    [cursor, setCursor] = useState(0),
    [suggestions, setSuggestions] = useState<number[]>([]),
    [busy, setBusy] = useState(false),
    [generate, setGenerate] = useState(true),
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
      await post("/projects/" + projectId + "/slides/" + slide.id + "/split", {
        expectedNotes: slide.notes,
        cuts,
        generate,
      });
      await onDone(generate);
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
          {slide.image && (
            <figure className="split-original">
              <img src={asset(slide.image)} alt="拆分前的原画面" />
              <figcaption>原画面参考；新页面将按各自讲稿重新生成。</figcaption>
            </figure>
          )}
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
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={generate}
          disabled={busy}
          onChange={(e) => setGenerate(e.target.checked)}
        />
        拆分后在后台生成图片（关闭后可先改稿）
      </label>
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
          拆分为 {cuts.length + 1} 页
          <ArrowRight size={17} />
        </Button>
      </div>
    </Modal>
  );
}
