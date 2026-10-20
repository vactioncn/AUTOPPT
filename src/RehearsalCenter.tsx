import { useEffect, useRef, useState } from "react";
import { api, asset, post, ApiError } from "./api";
import { Button, Field, Modal, SlideImage, Status } from "./components";
import { RehearsalResourceSettings } from "./RehearsalResourceSettings";
import { RehearsalPlayer } from "./RehearsalPlayer";
import { PresenterJobs, usePresenterJobs } from "./PresenterJobs";
import { PresenterPlayer } from "./PresenterPlayer";
import { matchesRehearsalRun } from "../shared/rehearsal-playback.mjs";
import { HostedRehearsalControls } from "./HostedRehearsalControls";
import { SPEECH_EMOTIONS } from "../shared/speech.mjs";
import type { Project } from "./types";
import type { PresentationRecord } from "./project-journey";
import { Play, PencilSimple } from "@phosphor-icons/react";
import type { Capabilities } from "../shared/diagnostics.mjs";
import type {
  PresenterGeneration,
  PresenterStudioState,
} from "./presenter-types";
import type {
  RehearsalContext,
  RehearsalPlan,
  RehearsalRun,
  RehearsalResources,
} from "./rehearsal-types";
import "./rehearsal-center.css";
import "./project-presenter.css";
const labels = { self: "自己讲", voice: "AI 口播", digital: "数字人讲解" };
const planBody = (p: RehearsalPlan) =>
  Object.fromEntries(
    [
      "actor",
      "visual",
      "avatarId",
      "voiceId",
      "emotion",
      "expression",
      "speed",
      "placement",
      "size",
      "narrationId",
      "pageId",
      "slideIds",
    ].map((k) => [k, p[k as keyof RehearsalPlan]]),
  );
export function RehearsalCenter({
  project,
  capabilities,
  onSpeech,
  onMotion,
  onSettings,
  onStudio,
  editablePpt,
  pptLoading,
  pptError,
  hasEditableHistory,
  onStart,
  onOriginal,
  onEditPpt,
}: {
  project: Project;
  capabilities: Capabilities;
  onSpeech: (prepare?: boolean) => void;
  onMotion: () => void;
  onSettings: () => void;
  onStudio: () => void;
  editablePpt?: PresentationRecord;
  pptLoading: boolean;
  pptError: string;
  hasEditableHistory: boolean;
  onStart: () => void;
  onOriginal: () => void;
  onEditPpt?: () => void;
  journey?: unknown;
  records?: unknown;
  selectedCount?: number;
}) {
  const endpoint = `/projects/${project.id}/rehearsal`;
  const managed = !capabilities.localModelSettings.enabled;
  const [resources, setResources] = useState<RehearsalResources | null>(null),
    [plan, setPlan] = useState<RehearsalPlan | null>(null),
    [texts, setTexts] = useState<Record<string, string>>({});
  const [runs, setRuns] = useState<RehearsalRun[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [saved, setSaved] = useState("");
  const [settings, setSettings] = useState<"speech" | "avatar" | null>(null),
    [trialLength, setTrialLength] = useState<"short" | "page">("short");
  const [stopping, setStopping] = useState("");
  const [resumeConfirm, setResumeConfirm] = useState<RehearsalRun | null>(null);
  const [confirm, setConfirm] = useState<"trial" | "all" | "selected" | null>(
      null,
    ),
    [playing, setPlaying] = useState<RehearsalRun | null>(null),
    [oldPlaying, setOldPlaying] = useState<PresenterGeneration | null>(null);
  const choice = useRef(plan),
    draftTexts = useRef(texts),
    lock = useRef(false),
    request = useRef<{
      requestId: string;
      scope: string;
      trialLength: string;
      revision: number;
    } | null>(null);
  choice.current = plan;
  draftTexts.current = texts;
  const old = usePresenterJobs(
    `/projects/${project.id}/presenter/generations`,
    !managed,
  );
  async function load() {
    const [context, studio, state] = await Promise.all([
      api<RehearsalContext>(endpoint),
      managed
        ? Promise.resolve({
            avatars: [],
            defaultAvatarId: "",
            hasKey: false,
          } as unknown as PresenterStudioState)
        : api<PresenterStudioState>("/presenter/studio"),
      managed
        ? Promise.resolve(null)
        : api<{ narrations: RehearsalResources["narrations"] }>(
            `/projects/${project.id}/presenter/setup`,
          ),
    ]);
    setResources({
      context,
      studio,
      narrations: state?.narrations || context.narrations || [],
    });
    if (choice.current) {
      setPlan((p) =>
        p
          ? {
              ...p,
              avatarId: p.avatarId || studio.defaultAvatarId,
              voiceId: p.voiceId || context.plan.voiceId,
            }
          : p,
      );
    }
    if (!choice.current) {
      let draft: RehearsalPlan | null = null;
      try {
        draft = JSON.parse(
          localStorage.getItem("autoppt-rehearsal:" + project.id) || "null",
        );
      } catch {
        /* Saved plan remains available. */
      }
      setPlan({
        ...context.plan,
        ...draft,
        ...(managed
          ? {
              actor:
                draft?.actor === "digital"
                  ? "voice"
                  : draft?.actor || context.plan.actor,
              visual: "original",
              avatarId: "",
              voiceId: context.voices.some((v) => v.id === draft?.voiceId)
                ? draft!.voiceId
                : context.plan.voiceId,
            }
          : {}),
        pageId: project.slides.some(
          (s) => s.id === (draft?.pageId || context.plan.pageId),
        )
          ? draft?.pageId || context.plan.pageId
          : project.slides[0]?.id || "",
      });
      setTexts(
        Object.fromEntries(context.script.pages.map((p) => [p.id, p.text])),
      );
    }
  }
  useEffect(() => {
    let alive = true;
    void load().catch((e) => {
      if (alive) setError(e.message);
    });
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const data = await api<RehearsalRun[]>(endpoint + "/runs");
        if (alive) {
          setRuns(data);
          setStopping((id) =>
            data.some((r) => r.id === id && r.status === "running") ? id : "",
          );
          if (
            request.current &&
            data.some((r) => r.id === request.current?.requestId)
          ) {
            request.current = null;
            setConfirm(null);
          }
          setPlaying((before) =>
            before ? data.find((r) => r.id === before.id) || before : null,
          );
        }
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
      if (alive) timer = setTimeout(poll, 2500);
    };
    void poll();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [endpoint, managed]);
  useEffect(() => {
    if (plan)
      try {
        localStorage.setItem(
          "autoppt-rehearsal:" + project.id,
          JSON.stringify(plan),
        );
      } catch {
        /* Saved before generation. */
      }
  }, [plan, project.id]);
  const page = project.slides.find((s) => s.id === plan?.pageId),
    avatar = resources?.studio.avatars.find((a) => a.id === plan?.avatarId),
    voice = resources?.context.voices.find((v) => v.id === plan?.voiceId);
  const chosenNarration = resources?.narrations.find(
    (n) => n.id === plan?.narrationId && n.available,
  );
  const active = runs.some((r) => r.status === "running") || old.active;
  function choose<K extends keyof RehearsalPlan>(
    key: K,
    value: RehearsalPlan[K],
  ) {
    setPlan((p) => (p ? { ...p, [key]: value } : p));
    setSaved("");
    setError("");
  }
  async function saveChoices() {
    if (!choice.current) throw new Error("正在读取演练选择，请稍候。");
    const latest = await api<RehearsalContext>(endpoint);
    const changed = latest.script.pages.some(
      (p) => draftTexts.current[p.id] !== p.text,
    );
    if (changed)
      await api(`/projects/${project.id}/speech-script`, {
        method: "PUT",
        body: JSON.stringify({
          revision: project.revision,
          pageTexts: draftTexts.current,
        }),
      });
    const result = await api<RehearsalPlan>(endpoint, {
      method: "PUT",
      body: JSON.stringify(planBody(choice.current)),
    });
    setResources((r) =>
      r
        ? {
            ...r,
            context: {
              ...r.context,
              script: {
                ...r.context.script,
                pages: r.context.script.pages.map((p) => ({
                  ...p,
                  text: draftTexts.current[p.id],
                })),
              },
            },
          }
        : r,
    );
    setSaved("本场选择和口播正文已保存。原逐字稿保持完整。");
    return result;
  }
  async function save() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await saveChoices();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function generate() {
    if (lock.current || !confirm || !plan) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      if (!request.current) {
        await saveChoices();
        request.current = {
          requestId: crypto.randomUUID(),
          scope: confirm,
          trialLength: chosenNarration ? "page" : trialLength,
          revision: project.revision,
        };
      }
      const run = await post<RehearsalRun>(endpoint + "/runs", {
        ...request.current,
        confirmed: true,
      });
      request.current = null;
      setRuns((before) => [run, ...before.filter((r) => r.id !== run.id)]);
      setConfirm(null);
    } catch (e) {
      if (e instanceof ApiError && e.status < 500) request.current = null;
      setError((e as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function act(run: RehearsalRun, action: "resume" | "stop") {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const r = await post<RehearsalRun>(
        endpoint + "/runs/" + run.id + "/" + action,
        { confirmed: true },
      );
      if (action === "resume")
        setRuns((a) => a.map((j) => (j.id === r.id ? r : j)));
      else setStopping(run.id);
      setResumeConfirm(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function openConfirm(scope: "trial" | "all" | "selected") {
    setError("");
    setConfirm(scope);
  }
  const wholePages = project.slides.filter(
    (s) => !plan?.slideIds.length || plan.slideIds.includes(s.id),
  );
  const matches = (run: RehearsalRun) =>
    matchesRehearsalRun(run, plan, {
      texts,
      model: resources?.context.speech.model,
      pageIds: wholePages.map((s) => s.id),
      trialLength: chosenNarration ? "page" : trialLength,
    });
  const trial = runs.find(
    (r) => r.scope === "trial" && r.status === "ready" && matches(r),
  );
  const whole = runs.find(
    (r) => r.scope !== "trial" && r.status === "ready" && matches(r),
  );
  const currentRun =
    runs.find((r) => r.status === "running") || runs.find(matches);
  const clips = currentRun?.pages.flatMap((p) => p.clips) || [];
  const completedClips = clips.filter((c) => c.audioFile).length;
  const missingPages = wholePages.filter((s) => !s.image && !s.scene);
  const blankPages = wholePages.filter((s) => !texts[s.id]?.trim());
  const wholeBlocked =
    managed &&
    (!wholePages.length ||
      !!missingPages.length ||
      (plan?.actor !== "self" && !chosenNarration && !!blankPages.length));
  const trialBlank =
    managed &&
    plan?.actor !== "self" &&
    !chosenNarration &&
    !texts[plan?.pageId || ""]?.trim();
  const ready =
    plan &&
    resources &&
    (plan.actor === "self" ||
      !!chosenNarration ||
      (resources.context.speech.hasKey && !!voice)) &&
    (plan.actor !== "digital" || (resources.studio.hasKey && !!avatar));
  const selected = project.slides.filter((s) =>
    confirm === "trial"
      ? s.id === plan?.pageId
      : confirm === "selected"
        ? plan?.slideIds.includes(s.id)
        : true,
  );
  const words = selected.reduce((n, s) => n + (texts[s.id]?.length || 0), 0);
  const trialAction = plan && (
    <Button
      variant={managed && whole ? "secondary" : "primary"}
      disabled={
        managed && trial
          ? false
          : busy ||
            active ||
            !ready ||
            !page ||
            (!page.image && !page.scene) ||
            trialBlank
      }
      onClick={() =>
        managed && trial
          ? setPlaying(trial)
          : plan.actor === "self" && plan.visual === "original"
            ? onSpeech(false)
            : openConfirm("trial")
      }
    >
      {managed && trial
        ? "播放试播"
        : plan.actor === "self" && plan.visual === "original"
          ? "试播当前画面"
          : managed &&
              currentRun?.scope === "trial" &&
              currentRun.status === "running"
            ? "正在准备试播…"
            : "先试当前页"}
    </Button>
  );
  const wholeAction = plan && (
    <Button
      variant={managed && !whole ? "secondary" : "primary"}
      disabled={
        managed && whole
          ? false
          : busy || active || !ready || !!request.current || wholeBlocked
      }
      onClick={() =>
        managed && whole
          ? setPlaying(whole)
          : plan.actor === "self" && plan.visual === "original"
            ? onSpeech(false)
            : openConfirm(plan.slideIds.length ? "selected" : "all")
      }
    >
      {managed && whole
        ? plan.slideIds.length
          ? "播放所选页面"
          : "播放整场"
        : managed &&
            currentRun?.scope !== "trial" &&
            currentRun?.status === "running"
          ? "正在生成整场…"
          : plan.slideIds.length
            ? `生成所选 ${plan.slideIds.length} 页`
            : "生成整场"}
    </Button>
  );
  const webDock = managed && plan && (
    <div
      className="rehearsal-web-dock"
      role="region"
      aria-label="试播与整场操作"
    >
      <div className="rehearsal-web-dock-row">
        <div className="rehearsal-web-dock-context">
          <strong>
            第 {project.slides.findIndex((s) => s.id === plan.pageId) + 1} 页 ·{" "}
            {plan.actor === "self"
              ? "自己讲"
              : chosenNarration || trialLength === "page"
                ? "完整一页试播"
                : "短片段试播"}
          </strong>
          <span>
            {trial ? "试播已就绪，点击播放" : "先试听，再生成整场"} ·{" "}
            {plan.slideIds.length
              ? `整场范围 ${plan.slideIds.length} 页`
              : `整场 ${project.slides.length} 页`}{" "}
            · 已有素材保留
          </span>
        </div>
        <div className="rehearsal-actions">
          {trialAction}
          {wholeAction}
        </div>
      </div>
      {currentRun && plan.actor === "voice" && (
        <div className="rehearsal-web-feedback">
          <div
            className="rehearsal-web-feedback-copy"
            role="status"
            aria-live="polite"
          >
            <strong>
              {currentRun.scope === "trial"
                ? `第 ${currentRun.pages[0]?.number} 页试播`
                : `${currentRun.pages.length} 页口播`}{" "}
              ·{" "}
              {currentRun.status === "running"
                ? "正在生成"
                : currentRun.status === "ready"
                  ? "已就绪"
                  : "尚未完成"}
            </strong>
            <span>
              {currentRun.voiceName} · {completedClips} / {clips.length} 段完成
              {currentRun.scope === "trial" &&
              currentRun.trialLength === "short"
                ? " · 开头短片段"
                : ""}
            </span>
            {currentRun.status !== "ready" && (
              <span>
                {stopping === currentRun.id
                  ? "正在停止后续生成，已完成声音会保留。"
                  : currentRun.message}
              </span>
            )}
          </div>
          <div className="rehearsal-actions">
            {currentRun.status !== "ready" && completedClips > 0 && (
              <Button onClick={() => setPlaying(currentRun)}>
                先听已完成部分
              </Button>
            )}
            {currentRun.status === "running" ? (
              <Button
                disabled={busy || stopping === currentRun.id}
                onClick={() => void act(currentRun, "stop")}
              >
                {stopping === currentRun.id ? "正在停止…" : "停止后续生成"}
              </Button>
            ) : currentRun.status !== "ready" ? (
              <Button
                disabled={busy || active || !currentRun.compatible}
                onClick={() => {
                  setError("");
                  setResumeConfirm(currentRun);
                }}
              >
                继续未完成部分
              </Button>
            ) : (
              <Button
                variant="ghost"
                disabled={busy || active}
                onClick={() =>
                  openConfirm(
                    currentRun.scope === "trial"
                      ? "trial"
                      : plan.slideIds.length
                        ? "selected"
                        : "all",
                  )
                }
              >
                {currentRun.scope === "trial" ? "重新试播" : "重新生成"}
              </Button>
            )}
          </div>
          {currentRun.status === "running" && (
            <progress
              aria-label="口播生成进度"
              value={completedClips}
              max={Math.max(1, clips.length)}
            />
          )}
        </div>
      )}
      {wholeBlocked && plan.actor === "voice" && (
        <p className="rehearsal-web-guidance">
          {missingPages.length ? (
            <>
              整场还有 {missingPages.length} 页缺少画面，当前页仍可试播。
              <Button variant="ghost" onClick={onStudio}>
                去完成画面
              </Button>
            </>
          ) : (
            `所选范围有 ${blankPages.length} 页口播正文为空，请填写后再生成整场。`
          )}
        </p>
      )}
      {trialBlank && <p role="status">填写当前页口播正文后，即可试播。</p>}
      {!currentRun && runs.length > 0 && plan.actor === "voice" && (
        <p className="rehearsal-caption">
          当前页面、声音或正文已与已有录音不同，请重新试播；旧录音保留在历史记录中。
        </p>
      )}
      {saved && !currentRun && <p role="status">{saved}</p>}
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
    </div>
  );
  if (!project.slides.length)
    return (
      <section className="journey-panel journey-empty">
        <h2>先写讲稿，生成至少一页</h2>
        <Button variant="primary" onClick={onStudio}>
          先写讲稿 / 生成至少一页
        </Button>
        {capabilities.localModelSettings.enabled && (
          <details>
            <summary>准备声音与实验室素材</summary>
            <Button onClick={() => setSettings("avatar")}>
              实验室 · 数字人工作室
            </Button>
            <Button onClick={() => setSettings("speech")}>
              管理声音 / 服务
            </Button>
          </details>
        )}
        {settings && (
          <RehearsalResourceSettings
            kind={settings}
            onClose={() => setSettings(null)}
          />
        )}
      </section>
    );
  return (
    <section
      className={`journey-panel rehearsal-center${managed ? " rehearsal-managed" : ""}`}
      aria-label="演练中心"
    >
      <header className="rehearsal-heading">
        <div>
          <h2>准备好了，就开始讲</h2>
          <p>按自己的节奏翻页，练习表达、停顿与翻页节奏。</p>
        </div>
      </header>
      <div className="rehearsal-start">
        <div
          className="rehearsal-cover"
          role="img"
          aria-label="本次演练的 PPT 首页"
        >
          {editablePpt ? (
            <iframe
              title="本次演练的 PPT 首页"
              src={`/api/motion/${encodeURIComponent(editablePpt.id)}/html?preview=1&pageId=${encodeURIComponent(editablePpt.pages[0].id)}&revision=${editablePpt.revision || 0}`}
              tabIndex={-1}
              inert
              aria-hidden="true"
            />
          ) : (
            <SlideImage slide={project.slides[0]} />
          )}
        </div>
        <div className="rehearsal-start-copy">
          <h3>{project.title}</h3>
          <p>
            {project.slides.length} 页 ·{" "}
            {editablePpt ? "使用已保存的文字与动效" : "使用制作台现有画面"}
          </p>
          <p className="rehearsal-start-help">
            自己现场讲，点击即可开始。需要改字或调整动效时，回制作台修改。
          </p>
          {hasEditableHistory && !editablePpt && !pptLoading && !pptError && (
            <p className="rehearsal-note">
              可编辑版本尚未全部完成，或与当前页序、内容不一致。本次将播放项目画面；请到制作台核对可编辑版本。
            </p>
          )}
          {pptError && (
            <p className="error-text" role="alert">
              暂时无法核对已保存的 PPT，请稍后重试。也可以先放映项目画面。
            </p>
          )}
          <div className="rehearsal-actions">
            <Button
              variant="primary"
              disabled={pptLoading || !!pptError}
              onClick={onStart}
            >
              <Play size={19} />
              {pptLoading ? "正在读取 PPT…" : "开始演练"}
            </Button>
            <Button onClick={onEditPpt || onStudio}>
              <PencilSimple size={18} />
              {onEditPpt ? "编辑文字与动效" : "返回制作台"}
            </Button>
            {pptError && <Button onClick={onOriginal}>先放映项目画面</Button>}
          </div>
          <p className="rehearsal-caption">
            演练直接使用已保存的页面，无需生成口播。
          </p>
        </div>
      </div>
      <details className="rehearsal-optional">
        <summary>
          AI 口播与配音（可选）
          {active
            ? " · 有任务进行中"
            : runs.length
              ? ` · ${runs.length} 份记录`
              : ""}
        </summary>
        <p className="rehearsal-optional-intro">
          想让 AI 代讲时，在这里准备口播稿、选择声音并试听。口播稿与 PPT
          上的文字分别保存。
        </p>
        {!plan || !resources ? (
          <p role="status">
            {managed
              ? "正在读取声音与本场选择…"
              : "正在读取你的声音、头像与本场选择…"}
          </p>
        ) : (
          <>
            {webDock}
            <div className="rehearsal-workbench">
              <div className="rehearsal-preview">
                <div className="rehearsal-preview-label">
                  <strong>
                    第 {project.slides.indexOf(page!) + 1} 页 ·{" "}
                    {page?.plan?.title || "当前页"}
                  </strong>
                  <Status>布局预览 · 不生成</Status>
                </div>
                <div className="project-presenter-canvas rehearsal-stage">
                  {page && <SlideImage slide={page} />}
                  {plan.actor === "digital" && avatar && (
                    <img
                      className="project-presenter-avatar"
                      src={asset(avatar.previewAsset)}
                      alt={avatar.name + " · 布局预览"}
                      data-placement={plan.placement}
                      data-size={plan.size}
                    />
                  )}
                </div>
                <p className="rehearsal-caption">
                  {managed
                    ? "选择页面查看画面和正文；声音准备好后，直接点击上方“播放试播”。"
                    : "选择页面查看布局。试播后，在下面播放实际声音、嘴型和动态效果。"}
                </p>
                <div className="rehearsal-pages" aria-label="选择试播页">
                  {project.slides.map((s, i) => (
                    <button
                      key={s.id}
                      aria-pressed={s.id === plan.pageId}
                      onClick={() => choose("pageId", s.id)}
                    >
                      <SlideImage slide={s} />
                      <span>
                        {i + 1} · {s.plan?.title || "页面"}
                      </span>
                    </button>
                  ))}
                </div>
                <details className="rehearsal-range" aria-label="整场范围">
                  <summary>
                    整场范围 ·{" "}
                    {plan.slideIds.length
                      ? `已选 ${plan.slideIds.length} 页`
                      : "默认整个项目"}
                  </summary>
                  <p>
                    在这里选页面，无需返回制作台。未选页面的生成结果也会保留。
                  </p>
                  <div>
                    {project.slides.map((s, i) => (
                      <label key={s.id}>
                        <input
                          type="checkbox"
                          checked={plan.slideIds.includes(s.id)}
                          onChange={(e) =>
                            choose(
                              "slideIds",
                              e.target.checked
                                ? [...plan.slideIds, s.id]
                                : plan.slideIds.filter((id) => id !== s.id),
                            )
                          }
                        />
                        {i + 1} · {s.plan?.title || "页面"}
                        {!s.image && !s.scene ? "（缺少画面）" : ""}
                      </label>
                    ))}
                  </div>
                </details>
              </div>
              {managed ? (
                <HostedRehearsalControls
                  plan={plan}
                  resources={resources}
                  busy={busy || active || !!request.current}
                  text={texts[plan.pageId] || ""}
                  onText={(text) => {
                    setTexts((t) => ({ ...t, [plan.pageId]: text }));
                    setSaved("");
                  }}
                  choose={choose}
                  trialLength={trialLength}
                  onTrialLength={setTrialLength}
                  onSave={() => void save()}
                />
              ) : (
                <div className="rehearsal-controls">
                  <fieldset disabled={busy || !!request.current}>
                    <legend>这场演讲，谁来讲？</legend>
                    <div className="rehearsal-choice">
                      {(["self", "voice"] as const).map((a) => (
                        <button
                          key={a}
                          type="button"
                          aria-pressed={plan.actor === a}
                          onClick={() => choose("actor", a)}
                        >
                          {labels[a]}
                        </button>
                      ))}
                    </div>
                    {!managed && (
                      <details
                        className="rehearsal-lab"
                        open={plan.actor === "digital"}
                      >
                        <summary>实验室 · 数字人讲解</summary>
                        <p className="detail-help">
                          实验功能，生成效果和等待时间仍在优化。先试一页，已有视频保留。
                        </p>
                        <Button
                          aria-pressed={plan.actor === "digital"}
                          onClick={() => choose("actor", "digital")}
                        >
                          {labels.digital}
                        </Button>
                      </details>
                    )}
                  </fieldset>
                  {!managed && (
                    <fieldset disabled={busy || !!request.current}>
                      <details className="rehearsal-legacy-visual">
                        <summary>
                          旧版画面兼容设置
                          {plan.visual === "motion" ? " · 已选图片提取" : ""}
                        </summary>
                        <p className="rehearsal-caption">
                          仅用于旧版配音流程。当前 PPT
                          的文字与动效，请在制作台编辑。
                        </p>
                        <div className="rehearsal-choice">
                          {(["original", "motion"] as const).map((v) => (
                            <button
                              key={v}
                              type="button"
                              aria-pressed={plan.visual === v}
                              onClick={() => choose("visual", v)}
                            >
                              {v === "original"
                                ? "使用项目图片"
                                : "从旧图片提取动效"}
                            </button>
                          ))}
                        </div>
                        {plan.visual === "motion" && (
                          <p className="rehearsal-note">
                            这一旧版流程会另建图片提取版本，可能使用模型额度。直接演练当前
                            PPT 无需此步骤。
                          </p>
                        )}
                      </details>
                    </fieldset>
                  )}
                  {plan.actor !== "self" && (
                    <>
                      <Field label="口播来源">
                        <select
                          value={plan.narrationId}
                          disabled={busy}
                          onChange={(e) =>
                            choose("narrationId", e.target.value)
                          }
                        >
                          <option value="">按当前口播正文生成新版本</option>
                          {resources.narrations.map((n) => (
                            <option
                              key={n.id}
                              value={n.id}
                              disabled={!n.available}
                            >
                              沿用已有口播 · {n.voiceName}
                              {n.available ? "" : "（页面已变）"}
                            </option>
                          ))}
                        </select>
                      </Field>
                      {chosenNarration ? (
                        <p className="rehearsal-note">
                          沿用“{chosenNarration.voiceName}
                          ”的原音频和表达。试播使用本页完整音频。
                        </p>
                      ) : (
                        <>
                          <div className="rehearsal-field-heading">
                            <strong>本场声音 · MiniMax</strong>
                            {!managed && (
                              <Button
                                variant="ghost"
                                onClick={() => setSettings("speech")}
                              >
                                管理声音 / 服务
                              </Button>
                            )}
                          </div>
                          <Field label="选择本场声音">
                            <select
                              value={plan.voiceId}
                              disabled={busy}
                              onChange={(e) =>
                                choose("voiceId", e.target.value)
                              }
                            >
                              <option value="">请选择声音</option>
                              {resources.context.voices.map((v) => (
                                <option key={v.id} value={v.id}>
                                  {v.name}
                                  {v.custom ? " · 我的声音" : ""}
                                </option>
                              ))}
                            </select>
                          </Field>
                          {!resources.context.speech.hasKey && (
                            <p>
                              {managed
                                ? "管理员尚未连接 MiniMax 语音服务，请联系管理员。已保存的音频仍可播放。"
                                : "先在设置连接 MiniMax。完成后返回这里，选择与正文都会保留。"}
                            </p>
                          )}
                          <div className="rehearsal-inline-fields">
                            <Field label="表达">
                              <select
                                value={plan.emotion}
                                onChange={(e) =>
                                  choose("emotion", e.target.value)
                                }
                              >
                                {SPEECH_EMOTIONS.map((e) => (
                                  <option value={e.id} key={e.id}>
                                    {e.name}
                                  </option>
                                ))}
                              </select>
                            </Field>
                            <Field label="语速">
                              <select
                                value={plan.speed}
                                onChange={(e) =>
                                  choose("speed", Number(e.target.value))
                                }
                              >
                                {[0.75, 1, 1.1, 1.25, 1.5].map((s) => (
                                  <option key={s} value={s}>
                                    {s} 倍
                                  </option>
                                ))}
                              </select>
                            </Field>
                          </div>
                          <Field
                            label="当前页口播正文"
                            hint="只保存口播版本，保留原逐字稿。"
                          >
                            <textarea
                              rows={5}
                              value={texts[plan.pageId] || ""}
                              onChange={(e) =>
                                setTexts((t) => ({
                                  ...t,
                                  [plan.pageId]: e.target.value,
                                }))
                              }
                            />
                          </Field>
                        </>
                      )}
                    </>
                  )}
                  {plan.actor === "digital" && (
                    <>
                      <div className="rehearsal-field-heading">
                        <strong>
                          本场数字人{" "}
                          <span className="experimental-label">实验</span>
                        </strong>
                        <Button
                          variant="ghost"
                          onClick={() => setSettings("avatar")}
                        >
                          管理 / 创建头像
                        </Button>
                      </div>
                      <div className="rehearsal-avatars">
                        {resources.studio.avatars.map((a) => (
                          <button
                            key={a.id}
                            aria-pressed={a.id === plan.avatarId}
                            onClick={() => choose("avatarId", a.id)}
                          >
                            <img src={asset(a.previewAsset)} alt="" />
                            <span>{a.name}</span>
                          </button>
                        ))}
                      </div>
                      {!avatar && (
                        <p>
                          先在实验室的数字人工作室保存头像，可上传本人照片或生成职业照、卡通等风格。头像可以先准备，无需先有口播。
                        </p>
                      )}
                      {!resources.studio.hasKey && (
                        <p>
                          数字人服务待配置。声音继续沿用
                          MiniMax，嘴型服务只接收选定音频。
                        </p>
                      )}
                      <details>
                        <summary>本场位置与大小</summary>
                        <div className="rehearsal-inline-fields">
                          <Field label="位置">
                            <select
                              value={plan.placement}
                              onChange={(e) =>
                                choose("placement", e.target.value)
                              }
                            >
                              {Object.entries({
                                "top-left": "左上角",
                                "top-right": "右上角",
                                "bottom-left": "左下角",
                                "bottom-right": "右下角",
                              }).map(([v, l]) => (
                                <option key={v} value={v}>
                                  {l}
                                </option>
                              ))}
                            </select>
                          </Field>
                          <Field label="大小">
                            <select
                              value={plan.size}
                              onChange={(e) => choose("size", e.target.value)}
                            >
                              {Object.entries({
                                small: "小",
                                medium: "中",
                                large: "大",
                              }).map(([v, l]) => (
                                <option key={v} value={v}>
                                  {l}
                                </option>
                              ))}
                            </select>
                          </Field>
                        </div>
                      </details>
                    </>
                  )}
                  {plan.actor !== "self" && !chosenNarration && (
                    <Field label="试播长度">
                      <select
                        value={trialLength}
                        onChange={(e) =>
                          setTrialLength(e.target.value as "short" | "page")
                        }
                      >
                        <option value="short">开头短片段 · 最多 100 字</option>
                        <option value="page">当前完整一页 · 整场可复用</option>
                      </select>
                    </Field>
                  )}
                  <div className="rehearsal-actions">
                    {plan.actor === "self" ? (
                      <Button
                        disabled={pptLoading || !!pptError}
                        onClick={onStart}
                      >
                        自己讲，直接开始演练
                      </Button>
                    ) : (
                      trialAction
                    )}
                    <Button disabled={busy} onClick={() => void save()}>
                      保存本场选择
                    </Button>
                  </div>
                  {plan.actor !== "self" && (
                    <p className="rehearsal-caption">
                      {managed
                        ? "试播与生成使用 MiniMax 语音预算，不扣图片张数。播放和复用已有音频不重新合成。"
                        : "服务已配置不代表额度充足。试播与生成会使用相应服务额度，金额以账号账单为准。"}
                    </p>
                  )}
                  {saved && <p role="status">{saved}</p>}
                </div>
              )}
            </div>
            {!managed && plan.actor !== "self" && (
              <section className="rehearsal-whole">
                <div>
                  <h3>试满意后，生成整场</h3>
                  <p>
                    {trial
                      ? "已有完成试播，可继续整场。"
                      : managed
                        ? "建议先试当前页，核对声音和节奏。"
                        : "建议先试当前页，核对自己的声音、形象和节奏。"}
                    修改正文或声音会生成新版本，旧素材继续保留。
                  </p>
                </div>
                {wholeAction}
              </section>
            )}
            <details
              className="rehearsal-records"
              open={managed ? undefined : true}
            >
              <summary>
                {managed ? `历史试播与生成记录 · ${runs.length}` : "效果与进度"}
              </summary>
              <section
                className="rehearsal-results"
                aria-label="本场生成与试播记录"
              >
                {!runs.length && (
                  <p>试播和整场生成后的声音会自动保存在这里。</p>
                )}
                {runs.map((run) => {
                  const audio = run.pages
                      .flatMap((p) => p.clips)
                      .filter((c) => c.audioFile),
                    video = run.pages
                      .flatMap((p) => p.clips)
                      .filter((c) => c.file),
                    dynamic =
                      run.motion?.pages.filter((p) => p.status === "ready") ||
                      [];
                  const failed = run.presenter?.recovery === "new-task";
                  return (
                    <article key={run.id} className="rehearsal-result">
                      <div className="rehearsal-result-heading">
                        <strong>
                          {run.scope === "trial"
                            ? run.trialLength === "short"
                              ? "短片段试播"
                              : "完整页试播"
                            : run.scope === "all"
                              ? "整场生成"
                              : "所选页面生成"}{" "}
                          · {labels[run.plan.actor]}
                        </strong>
                        <span>
                          {new Date(run.createdAt).toLocaleString("zh-CN")}
                        </span>
                      </div>
                      <p>
                        {run.voiceName || "自己讲"} · {run.pages.length} 页
                      </p>
                      <div className="rehearsal-progress">
                        <span>声音 {audio.length} 段完成</span>
                        {run.plan.actor === "digital" && (
                          <span>嘴型 {video.length} 段完成</span>
                        )}
                        {run.motion && (
                          <span>
                            动态 {dynamic.length}/{run.motion.pages.length} 页
                          </span>
                        )}
                      </div>
                      <p role="status">
                        {run.presenter?.message ||
                          run.motion?.progress ||
                          run.message}
                      </p>
                      {run.status === "running" && (
                        <progress
                          aria-label="本场生成进度"
                          value={audio.length + video.length + dynamic.length}
                          max={Math.max(
                            1,
                            run.pages.flatMap((p) => p.clips).length *
                              (run.plan.actor === "digital"
                                ? 2
                                : run.plan.actor === "voice"
                                  ? 1
                                  : 0) +
                              (run.motion?.pages.length || 0),
                          )}
                        />
                      )}
                      {run.scope === "trial" && run.trialLength === "short" && (
                        <p>这是开头短片段；整场不会将它当作完整页复用。</p>
                      )}
                      {!run.compatible && (
                        <p>
                          母版已改变。这份结果保留供核对，生成新版本以使用当前画面。
                        </p>
                      )}
                      {failed && (
                        <p className="journey-warning">
                          嘴型服务已明确失败。已生成的 MiniMax
                          音频保留可听；处理服务额度后，重新确认生成可复用音频。
                        </p>
                      )}
                      <div className="rehearsal-actions">
                        <Button
                          disabled={
                            !audio.length && !video.length && !dynamic.length
                          }
                          onClick={() => setPlaying(run)}
                        >
                          {video.length
                            ? "播放数字人效果"
                            : audio.length
                              ? "试听已完成声音"
                              : "预览已完成画面"}
                        </Button>
                        {run.status === "running" ? (
                          <Button
                            disabled={busy}
                            onClick={() => void act(run, "stop")}
                          >
                            停止后续生成
                          </Button>
                        ) : (
                          run.status !== "ready" &&
                          (failed ? (
                            <Button
                              disabled={busy || active}
                              onClick={() => {
                                choose("pageId", run.pages[0].id);
                                openConfirm(run.scope);
                              }}
                            >
                              处理后重新生成
                            </Button>
                          ) : (
                            <Button
                              disabled={busy || active || !run.compatible}
                              onClick={() => {
                                setError("");
                                setResumeConfirm(run);
                              }}
                            >
                              继续已有任务
                            </Button>
                          ))
                        )}
                      </div>
                    </article>
                  );
                })}
              </section>
            </details>
            <details className="rehearsal-history">
              <summary>已有版本与高级调整</summary>
              <p>
                {managed
                  ? "已保存的口播版本可继续播放，或导出含声音的离线 HTML。语音服务由管理员配置，本场声音、语速和正文在这里调整。"
                  : "原口播、数字人和动态演示记录仍然保留。高级演绎和图层校准可继续使用。"}
              </p>
              <div className="rehearsal-actions">
                <Button onClick={() => onSpeech(true)}>
                  {managed ? "已有口播 / 播放与导出" : "已有口播 / 高级演绎"}
                </Button>
                {!managed && (
                  <Button
                    disabled={!capabilities.motionPresentation.enabled}
                    onClick={onMotion}
                  >
                    查看旧版提取记录
                  </Button>
                )}
                {!managed && <Button onClick={onSettings}>打开全局设置</Button>}
              </div>
              {!managed && (
                <PresenterJobs
                  jobs={old.jobs}
                  endpoint={`/projects/${project.id}/presenter/generations`}
                  onUpdate={(j) =>
                    old.setJobs((a) => [j, ...a.filter((v) => v.id !== j.id)])
                  }
                  onPlay={setOldPlaying}
                />
              )}
            </details>
          </>
        )}
        {error && (!managed || !plan || !resources) && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
      </details>
      {confirm && plan && (
        <Modal
          title={confirm === "trial" ? "确认当前页试播" : "确认生成整场"}
          subtitle="完成后回到本场演讲。已有结果保留，匹配的完整片段会复用。"
          onClose={() => !busy && setConfirm(null)}
        >
          <dl className="rehearsal-summary">
            <dt>讲述方式</dt>
            <dd>
              {labels[plan.actor]} ·{" "}
              {plan.visual === "motion"
                ? "旧图片提取动效（独立生成）"
                : "项目图片"}
            </dd>
            <dt>声音</dt>
            <dd>
              {chosenNarration?.voiceName || voice?.name || "自己讲"}
              {chosenNarration ? " · 沿用已有音频" : " · MiniMax"}
            </dd>
            {plan.actor === "digital" && (
              <>
                <dt>头像</dt>
                <dd>{avatar?.name}</dd>
              </>
            )}
            <dt>范围</dt>
            <dd>
              {selected.map((s) => project.slides.indexOf(s) + 1).join("、")} 页
              ·{" "}
              {confirm === "trial" &&
              trialLength === "short" &&
              !chosenNarration
                ? "开头最多 100 字"
                : `${words} 字口播正文`}
            </dd>
          </dl>
          <p>
            {chosenNarration
              ? "已有音频会直接复用。"
              : "MiniMax 按本次实际生成计费；缓存匹配的声音会复用。"}
            {plan.actor === "digital"
              ? "头像和选定音频将发送至 HeyGen，同步嘴型按服务规则计费。"
              : ""}
            {plan.visual === "motion"
              ? "动态画面调用内容分析和图片服务，一致的已完成动态页会复用。"
              : ""}
            具体金额以账号账单为准。
          </p>
          {!trial && confirm !== "trial" && (
            <p>还没有完成试播。建议取消并先试当前页；也可以确认直接生成。</p>
          )}
          {error && (
            <p role="alert" className="error-text">
              {error}
            </p>
          )}
          <div className="rehearsal-actions">
            <Button disabled={busy} onClick={() => setConfirm(null)}>
              返回调整
            </Button>
            <Button
              variant="primary"
              loading={busy}
              onClick={() => void generate()}
            >
              {request.current ? "查询上次提交结果" : "确认并开始生成"}
            </Button>
          </div>
        </Modal>
      )}
      {resumeConfirm && (
        <Modal
          title="继续已有任务"
          onClose={() => !busy && setResumeConfirm(null)}
        >
          <p>
            {managed
              ? "已完成的声音保留，只继续合成未完成的部分。新的合成会使用 MiniMax 语音预算。"
              : "已完成音频、视频和动态页保持不变。查询已提交的嘴型任务不会重新提交；未生成的声音和失败的动态页将继续生成，可能产生费用。"}
          </p>
          {error && <p role="alert">{error}</p>}
          <Button
            loading={busy}
            variant="primary"
            onClick={() => void act(resumeConfirm, "resume")}
          >
            确认继续已有任务
          </Button>
        </Modal>
      )}
      {settings && (
        <RehearsalResourceSettings
          kind={settings}
          onClose={() => {
            setSettings(null);
            void load().catch((e) => setError(e.message));
          }}
        />
      )}
      {playing && (
        <RehearsalPlayer
          project={project}
          layout={plan || undefined}
          run={playing}
          autoStart={managed}
          onClose={() => setPlaying(null)}
        />
      )}
      {oldPlaying && (
        <PresenterPlayer
          project={project}
          job={oldPlaying}
          onClose={() => setOldPlaying(null)}
        />
      )}
    </section>
  );
}
