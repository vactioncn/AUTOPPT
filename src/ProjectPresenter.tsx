import { useEffect, useRef, useState } from "react";
import { api, asset, post } from "./api";
import { Button, Field, Modal, Status } from "./components";
import type { Project } from "./types";
import type {
  PresenterStudioState,
  PresenterGeneration,
} from "./presenter-types";
import { PresenterJobs, usePresenterJobs } from "./PresenterJobs";
import { PresenterPlayer } from "./PresenterPlayer";
import "./project-presenter.css";
import "./presenter-studio.css";
type Setup = {
  avatarId: string;
  narrationId: string;
  placement: string;
  size: string;
  sourceMode?: string;
};
type State = {
  setup: Setup;
  sourceMode?: string;
  narrations: { id: string; voiceName: string; available: boolean }[];
};
const positions = {
    "top-left": "左上角",
    "top-right": "右上角",
    "bottom-left": "左下角",
    "bottom-right": "右下角",
  },
  sizes = { small: "小", medium: "中", large: "大" };
export function ProjectPresenter({
  project,
  onPlayback,
  onSettings,
  narrationKey,
}: {
  project: Project;
  onSpeech: () => void;
  onPlayback: () => void;
  onSettings: () => void;
  narrationKey: string;
}) {
  const endpoint = `/projects/${encodeURIComponent(project.id)}/presenter`,
    draftKey = "autoppt-presenter-project-draft:" + project.id;
  const [state, setState] = useState<State | null>(null),
    [studio, setStudio] = useState<PresenterStudioState | null>(null),
    [selection, setSelection] = useState<Setup | null>(null);
  const [mode, setMode] = useState<"text" | "audio">("text"),
    [pageId, setPageId] = useState(
      project.slides.find((s) => s.notes.trim())?.id || "",
    ),
    [confirmation, setConfirmation] = useState<"page" | "all" | null>(null),
    [playing, setPlaying] = useState<PresenterGeneration | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const lock = useRef(false),
    choice = useRef(selection),
    request = useRef<{
      requestId: string;
      scope: "page" | "all";
      pageId?: string;
      mode: string;
      setup: Setup;
    } | null>(null);
  choice.current = selection;
  const {
    jobs,
    error: jobsError,
    setJobs,
    active,
  } = usePresenterJobs(endpoint + "/generations");
  useEffect(() => {
    let alive = true;
    Promise.all([
      api<State>(endpoint + "/setup"),
      api<PresenterStudioState>("/presenter/studio"),
    ])
      .then(([s, l]) => {
        if (!alive) return;
        setState(s);
        setStudio(l);
        if (choice.current) return;
        let draft: Setup | null = null;
        try {
          const value = JSON.parse(localStorage.getItem(draftKey) || "null");
          if (
            value &&
            ["avatarId", "narrationId", "placement", "size"].every(
              (k) => typeof value[k] === "string",
            ) &&
            Object.hasOwn(positions, value.placement) &&
            Object.hasOwn(sizes, value.size)
          )
            draft = value;
        } catch {
          /* Saved configuration remains authoritative. */
        }
        const config = draft || s.setup;
        setSelection({
          ...config,
          avatarId: config.avatarId || l.defaultAvatarId,
        });
        setMode(s.sourceMode === "audio" ? "audio" : "text");
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [endpoint, draftKey, project.revision, narrationKey]);
  useEffect(() => {
    if (selection)
      try {
        localStorage.setItem(draftKey, JSON.stringify(selection));
      } catch {
        /* Selection is also saved when generating. */
      }
  }, [selection, draftKey]);
  function choose(key: keyof Setup, value: string) {
    setSelection((before) => before && { ...before, [key]: value });
    setError("");
  }
  function settings() {
    sessionStorage.setItem("autoppt-settings-focus", "presenter-settings");
    onSettings();
  }
  const avatar = studio?.avatars.find((a) => a.id === selection?.avatarId),
    eligiblePages = project.slides.filter((s) => s.notes.trim());
  const ready =
    !!studio?.hasKey &&
    !!avatar &&
    (mode === "text"
      ? avatar.ready
      : !!state?.narrations.some(
          (n) => n.id === selection?.narrationId && n.available,
        ));
  const selectedPages =
    confirmation === "all"
      ? eligiblePages
      : eligiblePages.filter((s) => s.id === pageId);
  async function submit() {
    if (lock.current || !confirmation || !selection) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      request.current ||= {
        requestId: crypto.randomUUID(),
        scope: confirmation,
        ...(confirmation === "page" ? { pageId } : {}),
        mode,
        setup: { ...selection, sourceMode: mode },
      };
      const pending = request.current;
      await api(endpoint + "/setup", {
        method: "PUT",
        body: JSON.stringify(pending.setup),
      });
      const job = (await post(endpoint + "/generations", {
        requestId: pending.requestId,
        scope: pending.scope,
        pageId: pending.pageId,
        mode: pending.mode,
        confirmed: true,
      })) as PresenterGeneration;
      request.current = null;
      setJobs((before) => [job, ...before.filter((j) => j.id !== job.id)]);
      setConfirmation(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <section
      className="journey-secondary project-presenter"
      aria-label="数字人讲解"
      id="project-presenter"
    >
      <div className="project-presenter-heading">
        <div>
          <h3>数字人讲解</h3>
          <p>选一个已准备好的数字人，直接用逐页讲稿生成讲解。</p>
        </div>
        <Status tone={ready ? "good" : "warm"}>
          {ready
            ? "可以生成讲解"
            : !studio?.hasKey
              ? "待连接 HeyGen"
              : !avatar?.ready
                ? "待准备数字人"
                : "待选择口播"}
        </Status>
      </div>
      {!studio?.avatars.length ? (
        <div className="presenter-actions">
          <p>先到数字人工作室保存头像和声音，输入文字试播。</p>
          <Button onClick={settings}>前往数字人工作室</Button>
        </div>
      ) : (
        selection && (
          <>
            <div className="presenter-project-choice">
              {avatar && (
                <img
                  src={asset(avatar.previewAsset)}
                  alt={avatar.name + "头像"}
                />
              )}
              <Field label="使用哪个数字人">
                <select
                  value={selection.avatarId}
                  disabled={busy || active || !!request.current}
                  onChange={(e) => choose("avatarId", e.target.value)}
                >
                  <option value="">选择数字人</option>
                  {studio.avatars.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} · {a.voiceName}
                    </option>
                  ))}
                </select>
              </Field>
              <Button onClick={settings}>管理数字人 / 试播</Button>
            </div>
            {(!studio.hasKey || (mode === "text" && !avatar?.ready)) && (
              <p>
                到数字人工作室
                {!studio.hasKey ? "连接 HeyGen" : "为这个数字人保存中文声音"}
                ，回来即可生成。
              </p>
            )}
            <div className="presenter-project-generate">
              <Field label="讲解页面">
                <select
                  value={pageId}
                  disabled={busy || active || !!request.current}
                  onChange={(e) => setPageId(e.target.value)}
                >
                  {!eligiblePages.length && (
                    <option value="">还没有逐页讲稿</option>
                  )}
                  {eligiblePages.map((s) => (
                    <option key={s.id} value={s.id}>
                      第 {project.slides.indexOf(s) + 1} 页 ·{" "}
                      {s.plan?.title || "页面"}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="presenter-actions">
                <Button
                  variant="primary"
                  disabled={!ready || busy || active || !pageId}
                  onClick={() =>
                    setConfirmation(request.current?.scope || "page")
                  }
                >
                  {active
                    ? "正在生成…"
                    : request.current
                      ? "查询上次提交结果"
                      : "生成本页讲解"}
                </Button>
                <Button
                  disabled={
                    !ready ||
                    busy ||
                    active ||
                    !eligiblePages.length ||
                    !!request.current
                  }
                  onClick={() => setConfirmation("all")}
                >
                  生成整场讲解
                </Button>
              </div>
            </div>
            {!eligiblePages.length && (
              <p>先在稿件中添加逐页讲稿，文字会直接交给数字人讲述。</p>
            )}
            <details className="presenter-style-tools">
              <summary>显示位置与其他方式</summary>
              <div className="project-presenter-fields">
                <Field label="数字人位置">
                  <select
                    value={selection.placement}
                    disabled={busy || active || !!request.current}
                    onChange={(e) => choose("placement", e.target.value)}
                  >
                    {Object.entries(positions).map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="数字人大小">
                  <select
                    value={selection.size}
                    disabled={busy || active || !!request.current}
                    onChange={(e) => choose("size", e.target.value)}
                  >
                    {Object.entries(sizes).map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="讲解来源">
                  <select
                    value={mode}
                    disabled={busy || active || !!request.current}
                    onChange={(e) =>
                      setMode(e.target.value as "text" | "audio")
                    }
                  >
                    <option value="text">直接使用逐页讲稿</option>
                    <option value="audio">沿用已有 AI 口播</option>
                  </select>
                </Field>
                {mode === "audio" && (
                  <Field label="已有口播版本">
                    <select
                      value={selection.narrationId}
                      disabled={busy || active || !!request.current}
                      onChange={(e) => choose("narrationId", e.target.value)}
                    >
                      <option value="">选择已完成口播</option>
                      {state?.narrations.map((n) => (
                        <option key={n.id} value={n.id} disabled={!n.available}>
                          {n.voiceName}
                          {n.available ? "" : " · 需更新"}
                        </option>
                      ))}
                    </select>
                  </Field>
                )}
              </div>
            </details>
          </>
        )
      )}
      {(error || jobsError) && (
        <p role="alert" className="error-text">
          {error || jobsError}
        </p>
      )}
      <PresenterJobs
        jobs={jobs}
        endpoint={endpoint + "/generations"}
        onUpdate={(job) =>
          setJobs((before) => [job, ...before.filter((j) => j.id !== job.id)])
        }
        onPlay={(job) => (job.mode === "text" ? setPlaying(job) : onPlayback())}
      />
      {confirmation && (
        <Modal
          title={
            confirmation === "all" ? "生成整场数字人讲解" : "生成本页数字人讲解"
          }
          onClose={() => !busy && setConfirmation(null)}
        >
          <p>
            {avatar?.name} ·{" "}
            {mode === "text" ? avatar?.voiceName : "沿用所选口播声音"} ·{" "}
            {selectedPages.length} 页
          </p>
          {mode === "text" && (
            <blockquote className="presenter-confirm-text">
              {selectedPages[0]?.notes}
            </blockquote>
          )}
          <p>
            {mode === "text" ? "头像和所选页面的讲稿" : "头像和所选口播音频"}
            将发送到 HeyGen，按 API 规则计费。已完成的相同片段会优先复用。
          </p>
          <div className="presenter-actions">
            <Button
              variant="primary"
              loading={busy}
              onClick={() => void submit()}
            >
              确认生成
            </Button>
            <Button disabled={busy} onClick={() => setConfirmation(null)}>
              取消
            </Button>
          </div>
        </Modal>
      )}
      {playing && (
        <PresenterPlayer
          project={project}
          job={playing}
          onClose={() => setPlaying(null)}
        />
      )}
    </section>
  );
}
