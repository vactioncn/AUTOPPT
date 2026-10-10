import { useEffect, useRef, useState } from "react";
import { api, asset, post, ApiError } from "./api";
import { Button, Field, Modal, SlideImage, Status } from "./components";
import { RehearsalResourceSettings } from "./RehearsalResourceSettings";
import { RehearsalPlayer } from "./RehearsalPlayer";
import { PresenterJobs, usePresenterJobs } from "./PresenterJobs";
import { PresenterPlayer } from "./PresenterPlayer";
import { SPEECH_EMOTIONS } from "../shared/speech.mjs";
import type { Project } from "./types";
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
}: {
  project: Project;
  capabilities: Capabilities;
  onSpeech: (prepare?: boolean) => void;
  onMotion: () => void;
  onSettings: () => void;
  onStudio: () => void;
  journey?: unknown;
  records?: unknown;
  selectedCount?: number;
}) {
  const endpoint = `/projects/${project.id}/rehearsal`;
  const [resources, setResources] = useState<RehearsalResources | null>(null),
    [plan, setPlan] = useState<RehearsalPlan | null>(null),
    [texts, setTexts] = useState<Record<string, string>>({});
  const [runs, setRuns] = useState<RehearsalRun[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [saved, setSaved] = useState("");
  const [settings, setSettings] = useState<"speech" | "avatar" | null>(null),
    [trialLength, setTrialLength] = useState<"short" | "page">("short");
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
  const old = usePresenterJobs(`/projects/${project.id}/presenter/generations`);
  async function load() {
    const [context, studio, state] = await Promise.all([
      api<RehearsalContext>(endpoint),
      api<PresenterStudioState>("/presenter/studio"),
      api<{ narrations: RehearsalResources["narrations"] }>(
        `/projects/${project.id}/presenter/setup`,
      ),
    ]);
    setResources({ context, studio, narrations: state.narrations });
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
    if (!capabilities.localModelSettings.enabled) return;
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
  }, [endpoint]);
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
  const trial = runs.find(
    (r) =>
      r.scope === "trial" &&
      r.status === "ready" &&
      r.compatible &&
      plan &&
      [
        "actor",
        "visual",
        "avatarId",
        "voiceId",
        "emotion",
        "speed",
        "narrationId",
        "pageId",
      ].every(
        (k) =>
          r.plan[k as keyof RehearsalPlan] === plan[k as keyof RehearsalPlan],
      ) &&
      (!r.speechModel || r.speechModel === resources?.context.speech.model) &&
      (!!plan.narrationId ||
        (r.pages[0]?.fullText || r.pages[0]?.text) === texts[plan.pageId]),
  );
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
  if (!capabilities.localModelSettings.enabled)
    return (
      <section className="journey-panel" aria-label="演练中心">
        <h2>看一遍画面，准备放映</h2>
        <p>
          共 {project.slides.length} 页。打开后可手动翻页，按需查看逐页讲稿。
        </p>
        <Button
          variant="primary"
          disabled={
            !project.slides.length || !capabilities.standardPresentation.enabled
          }
          onClick={() => onSpeech(false)}
        >
          普通放映
        </Button>
      </section>
    );
  return (
    <section className="journey-panel rehearsal-center" aria-label="演练中心">
      <header className="rehearsal-heading">
        <div>
          <h2>把这场演讲试好，再生成整场</h2>
          <p>先预览讲稿、声音和画面，确认后再生成整场。</p>
        </div>
        <Button variant="ghost" onClick={() => onSpeech(false)}>
          普通放映
        </Button>
      </header>
      <ol className="rehearsal-steps" aria-label="演练流程">
        <li data-current={!runs.length}>1 · 准备本场演讲</li>
        <li data-current={!!runs.length && !trial}>2 · 先试效果</li>
        <li data-current={!!trial}>3 · 生成整场</li>
      </ol>
      {!plan || !resources ? (
        <p role="status">正在读取你的声音、头像与本场选择…</p>
      ) : (
        <>
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
                选择页面查看布局。试播后，在下面播放实际声音、嘴型和动态效果。
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
              </fieldset>
              <fieldset disabled={busy || !!request.current}>
                <legend>画面怎么呈现？</legend>
                <div className="rehearsal-choice">
                  {(["original", "motion"] as const).map((v) => (
                    <button
                      key={v}
                      type="button"
                      aria-pressed={plan.visual === v}
                      onClick={() => choose("visual", v)}
                    >
                      {v === "original" ? "原画面" : "动态演示"}
                    </button>
                  ))}
                </div>
              </fieldset>
              {plan.visual === "motion" && (
                <p className="rehearsal-note">
                  先转换当前一页；生成整场时复用与当前画面一致的动态页。转换期间可先听声音。
                </p>
              )}
              {plan.actor !== "self" && (
                <>
                  <Field label="口播来源">
                    <select
                      value={plan.narrationId}
                      disabled={busy}
                      onChange={(e) => choose("narrationId", e.target.value)}
                    >
                      <option value="">按当前口播正文生成新版本</option>
                      {resources.narrations.map((n) => (
                        <option key={n.id} value={n.id} disabled={!n.available}>
                          沿用已有口播 · {n.voiceName}
                          {n.available ? "" : "（页面已变）"}
                        </option>
                      ))}
                    </select>
                  </Field>
                  {chosenNarration ? (
                    <p className="rehearsal-note">
                      沿用“{chosenNarration.voiceName}
                      ”的原音频和表达。数字人只同步嘴型；不会重新配音。试播使用本页完整音频。
                    </p>
                  ) : (
                    <>
                      <div className="rehearsal-field-heading">
                        <strong>本场声音 · MiniMax</strong>
                        <Button
                          variant="ghost"
                          onClick={() => setSettings("speech")}
                        >
                          管理声音 / 服务
                        </Button>
                      </div>
                      <Field label="选择本场声音">
                        <select
                          value={plan.voiceId}
                          disabled={busy}
                          onChange={(e) => choose("voiceId", e.target.value)}
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
                          先在设置连接
                          MiniMax。完成后返回这里，选择与正文都会保留。
                        </p>
                      )}
                      <div className="rehearsal-inline-fields">
                        <Field label="表达">
                          <select
                            value={plan.emotion}
                            onChange={(e) => choose("emotion", e.target.value)}
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
                          onChange={(e) => choose("placement", e.target.value)}
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
                <Button
                  variant="primary"
                  disabled={
                    busy ||
                    active ||
                    !ready ||
                    !page ||
                    (!page.image && !page.scene)
                  }
                  onClick={() =>
                    plan.actor === "self" && plan.visual === "original"
                      ? onSpeech(false)
                      : openConfirm("trial")
                  }
                >
                  {plan.actor === "self" && plan.visual === "original"
                    ? "试播当前画面"
                    : "先试当前页"}
                </Button>
                <Button disabled={busy} onClick={() => void save()}>
                  保存本场选择
                </Button>
              </div>
              <p className="rehearsal-caption">
                服务已配置不代表额度充足。试播与生成会使用相应服务额度，金额以账号账单为准。
              </p>
              {saved && <p role="status">{saved}</p>}
            </div>
          </div>
          <section className="rehearsal-whole">
            <div>
              <h3>试满意后，生成整场</h3>
              <p>
                {trial
                  ? "已有完成试播，可继续整场。"
                  : "建议先试当前页，核对自己的声音、形象和节奏。"}
                修改正文或声音会生成新版本，旧素材继续保留。
              </p>
            </div>
            <Button
              variant="primary"
              disabled={busy || active || !ready || !!request.current}
              onClick={() =>
                plan.actor === "self" && plan.visual === "original"
                  ? onSpeech(false)
                  : openConfirm(plan.slideIds.length ? "selected" : "all")
              }
            >
              {plan.slideIds.length
                ? `生成所选 ${plan.slideIds.length} 页`
                : "生成整场"}
            </Button>
          </section>
          <section
            className="rehearsal-results"
            aria-label="本场生成与试播记录"
          >
            <h3>效果与进度</h3>
            {!runs.length && <p>先试一页，实际声音和效果会出现在这里。</p>}
            {runs.map((run) => {
              const audio = run.pages
                  .flatMap((p) => p.clips)
                  .filter((c) => c.audioFile),
                video = run.pages.flatMap((p) => p.clips).filter((c) => c.file),
                dynamic =
                  run.motion?.pages.filter((p) => p.status === "ready") || [];
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
          <details className="rehearsal-history">
            <summary>已有版本与高级调整</summary>
            <p>
              原口播、数字人和动态演示记录仍然保留。高级演绎和图层校准可继续使用。
            </p>
            <div className="rehearsal-actions">
              <Button onClick={() => onSpeech(true)}>
                已有口播 / 高级演绎
              </Button>
              <Button
                disabled={!capabilities.motionPresentation.enabled}
                onClick={onMotion}
              >
                动态版本 / 图层校准
              </Button>
              <Button onClick={onSettings}>打开全局设置</Button>
            </div>
            <PresenterJobs
              jobs={old.jobs}
              endpoint={`/projects/${project.id}/presenter/generations`}
              onUpdate={(j) =>
                old.setJobs((a) => [j, ...a.filter((v) => v.id !== j.id)])
              }
              onPlay={setOldPlaying}
            />
          </details>
        </>
      )}
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
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
              {plan.visual === "motion" ? "动态演示" : "原画面"}
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
            已完成音频、视频和动态页保持不变。查询已提交的嘴型任务不会重新提交；未生成的声音和失败的动态页将继续生成，可能产生费用。
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
