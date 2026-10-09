import { useEffect, useRef, useState } from "react";
import { api, asset } from "./api";
import { Button, Field, Status } from "./components";
import type { Project } from "./types";
import "./project-presenter.css";
import { PresenterGeneration } from "./PresenterGeneration";

type Setup = {
  avatarId: string;
  narrationId: string;
  placement: string;
  size: string;
};
type Avatar = { id: string; name: string; previewAsset: string };
type State = {
  hasKey: boolean;
  generationAvailable: boolean;
  savedAt: string | null;
  setup: Setup;
  avatars: Avatar[];
  narrations: {
    id: string;
    title: string;
    voiceName: string;
    sourceRevision: number;
    available: boolean;
    reason: string;
  }[];
};
const positions = {
  "top-left": "左上角",
  "top-right": "右上角",
  "bottom-left": "左下角",
  "bottom-right": "右下角",
};
const sizes = { small: "小", medium: "中", large: "大" };

export function ProjectPresenter({
  project,
  onSpeech,
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
  const endpoint = `/projects/${encodeURIComponent(project.id)}/presenter`;
  const draftKey = "autoppt-presenter-project-draft:" + project.id;
  const [state, setState] = useState<State | null>(null);
  const [selection, setSelection] = useState<Setup | null>(null);
  const [open, setOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const lock = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  useEffect(() => {
    let alive = true;
    api<State>(endpoint + "/setup")
      .then((value) => {
        if (!alive) return;
        setState(value);
        if (selectionRef.current) return;
        let draft: Setup | null = null;
        try {
          const saved = JSON.parse(localStorage.getItem(draftKey) || "null");
          if (
            saved &&
            ["avatarId", "narrationId", "placement", "size"].every(
              (k) => typeof saved[k] === "string",
            ) &&
            Object.hasOwn(positions, saved.placement) &&
            Object.hasOwn(sizes, saved.size)
          )
            draft = saved;
        } catch {
          /* A damaged browser draft never replaces saved project configuration. */
        }
        setSelection(draft || value.setup);
        setDirty(!!draft);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [endpoint, draftKey, project.revision, narrationKey]);
  useEffect(() => {
    if (!selection || !dirty) return;
    try {
      localStorage.setItem(draftKey, JSON.stringify(selection));
    } catch {
      /* The explicit save remains available. */
    }
  }, [selection, dirty, draftKey]);

  function choose(key: keyof Setup, value: string) {
    setSelection((before) => before && { ...before, [key]: value });
    setDirty(true);
    setMessage("");
    setError("");
  }
  async function mutate(action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const avatar = state?.avatars.find((a) => a.id === selection?.avatarId);
  const narration = state?.narrations.find(
    (n) => n.id === selection?.narrationId,
  );
  const invalidSelection =
    (!!selection?.avatarId && !avatar) ||
    (!!selection?.narrationId && !narration?.available);
  const slide = project.slides.find((s) => s.image);

  return (
    <section
      className="journey-secondary project-presenter"
      aria-label="数字人讲解员"
      id="project-presenter"
    >
      <div className="project-presenter-heading">
        <h3>
          数字人讲解员 <span>可选增强</span>
        </h3>
        <Status tone={state?.hasKey ? "good" : "warm"}>
          {state?.hasKey ? "可以生成数字人口型" : "待配置 HeyGen Key"}
        </Status>
      </div>
      <p>
        为本项目选择头像、已完成口播及显示位置。项目配置与全局 API Key
        分别保存。
      </p>
      <div className="project-presenter-actions">
        <Button
          aria-expanded={open}
          aria-controls="project-presenter-form"
          onClick={() => setOpen(!open)}
        >
          {open ? "收起数字人配置" : "配置数字人讲解员"}
        </Button>
        <Button onClick={onSettings}>
          {state?.hasKey ? "查看 HeyGen API 设置" : "配置 HeyGen API Key"}
        </Button>
      </div>
      <p className="journey-warning">
        {state?.hasKey ? "HeyGen 密钥已保存。" : ""}
        保存头像和口播版本后，在下方“生成数字人口型”中先试一页，再生成整场。
      </p>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {open && !state && <p role="status">正在读取项目数字人配置…</p>}
      {open && state && selection && (
        <div id="project-presenter-form" className="project-presenter-form">
          <div className="project-presenter-fields">
            <Field label="数字人头像">
              <select
                value={selection.avatarId}
                disabled={busy}
                onChange={(e) => choose("avatarId", e.target.value)}
              >
                <option value="">选择头像</option>
                {!!selection.avatarId && !avatar && (
                  <option value={selection.avatarId} disabled>
                    原头像不可用，请重新选择
                  </option>
                )}
                {state.avatars.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="数字人口播版本">
              <select
                value={selection.narrationId}
                disabled={busy}
                onChange={(e) => choose("narrationId", e.target.value)}
              >
                <option value="">选择已完成口播</option>
                {!!selection.narrationId && !narration && (
                  <option value={selection.narrationId} disabled>
                    原口播不可用，请重新选择
                  </option>
                )}
                {state.narrations.map((n) => (
                  <option key={n.id} value={n.id} disabled={!n.available}>
                    {n.voiceName} · 母版 r{n.sourceRevision}
                    {n.available ? "" : " · 需更新"}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="数字人位置">
              <select
                value={selection.placement}
                disabled={busy}
                onChange={(e) => choose("placement", e.target.value)}
              >
                {Object.entries(positions).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="数字人大小">
              <select
                value={selection.size}
                disabled={busy}
                onChange={(e) => choose("size", e.target.value)}
              >
                {Object.entries(sizes).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          {!state.narrations.some((n) => n.available) && (
            <div>
              <p>
                请先在 AI
                口播中完成与当前画面和讲稿匹配的口播版本，已有头像与位置可先保存。
              </p>
              {!!project.slides.length && (
                <Button onClick={onSpeech}>前往制作 AI 口播</Button>
              )}
            </div>
          )}
          {narration && !narration.available && (
            <p className="journey-warning">{narration.reason}</p>
          )}
          <details
            open={!state.avatars.length}
            className="project-presenter-upload"
          >
            <summary>添加头像</summary>
            <Field label="新头像名称">
              <input
                value={name}
                maxLength={80}
                disabled={busy}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field label="头像图片">
              <input
                ref={fileInput}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                disabled={busy}
                onChange={(e) => {
                  setFile(e.target.files?.[0] || null);
                  setError("");
                }}
              />
            </Field>
            <p>
              JPEG、PNG 或 WebP，最大 8 MB。选择正面清晰照片；头像只保存到本机。
            </p>
            <Button
              disabled={busy || !file || !name.trim()}
              onClick={() =>
                void mutate(async () => {
                  const body = new FormData();
                  body.set("name", name);
                  body.set("image", file!);
                  const added = await api<Avatar>(endpoint + "/avatars", {
                    method: "POST",
                    body,
                  });
                  setState(
                    (before) =>
                      before && {
                        ...before,
                        avatars: [...before.avatars, added],
                      },
                  );
                  choose("avatarId", added.id);
                  setName("");
                  setFile(null);
                  if (fileInput.current) fileInput.current.value = "";
                  setMessage(
                    "头像已保存到本机；点击下方按钮保存本项目的选择。",
                  );
                })
              }
            >
              保存头像
            </Button>
          </details>
          <figure className="project-presenter-preview">
            <figcaption>位置示意（静态）</figcaption>
            <div className="project-presenter-canvas">
              {slide?.image ? (
                <img src={asset(slide.image)} alt="项目画面位置示意" />
              ) : (
                <span>页面位置示意</span>
              )}
              {avatar && (
                <img
                  className="project-presenter-avatar"
                  data-placement={selection.placement}
                  data-size={selection.size}
                  src={asset(avatar.previewAsset)}
                  alt={avatar.name + " · 头像位置示意"}
                />
              )}
            </div>
            <p>这里展示头像的位置和大小；生成后可在演讲播放器中随口播显示。</p>
          </figure>
          <div className="project-presenter-actions">
            <Button
              variant="primary"
              disabled={busy || !dirty || invalidSelection}
              onClick={() =>
                void mutate(async () => {
                  const saved = await api<State>(endpoint + "/setup", {
                    method: "PUT",
                    body: JSON.stringify(selection),
                  });
                  setState(saved);
                  setSelection(saved.setup);
                  setDirty(false);
                  try {
                    localStorage.removeItem(draftKey);
                  } catch {
                    /* Saved configuration is authoritative. */
                  }
                  setMessage(
                    "本项目的数字人配置已保存，可在下方生成数字人口型。",
                  );
                })
              }
            >
              保存本项目数字人配置
            </Button>
            <span>
              {dirty
                ? "有未保存的项目选择"
                : state.savedAt
                  ? "本项目配置已保存"
                  : "尚未保存项目配置"}
            </span>
          </div>
          {invalidSelection && (
            <p className="journey-warning">
              请重新选择可用头像和口播版本，或清空不可用的选择后保存。
            </p>
          )}
          {busy && <p role="status">正在保存，请稍候…</p>}
          {message && <p role="status">{message}</p>}
          <PresenterGeneration
            projectId={project.id}
            narrationId={state.setup.narrationId}
            enabled={
              !!(
                state.hasKey &&
                state.savedAt &&
                state.setup.avatarId &&
                state.setup.narrationId &&
                !dirty &&
                !busy &&
                !invalidSelection
              )
            }
            onSpeech={onPlayback}
          />
        </div>
      )}
    </section>
  );
}
