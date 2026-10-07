import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowsOut,
  Pause,
  Play,
  SpeakerHigh,
  X,
} from "@phosphor-icons/react";
import { api, asset, post, active } from "./api";
import { Button, Field } from "./components";
import { SceneView } from "./SceneView";
import type { Project } from "./types";
import {
  SPEECH_DEFAULTS,
  SPEECH_EMOTIONS,
  type SpeechOptions,
} from "../shared/speech.mjs";
import { speakerNotes } from "../shared/manuscript.mjs";
import { VoiceCapture } from "./VoiceCapture";
import {
  speechAudio,
  type Narration,
  type Voice,
  type SpeechConnection,
} from "./speech-types";
import "./speech.css";

const time = (value: number) =>
  `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, "0")}`;
const audioReadError =
  "本页音频已生成，但读取失败。请重试读取已保存音频；此操作不会重新生成或计费。";
export function SpeechPresentation({
  projectId,
  onClose,
  onSettings,
}: {
  projectId: string;
  onClose: () => void;
  onSettings: () => void;
}) {
  const [project, setProject] = useState<Project | null>(null),
    [voices, setVoices] = useState<Voice[]>([]);
  const [config, setConfig] = useState<SpeechConnection | null>(null),
    [history, setHistory] = useState<Narration[]>([]),
    [deck, setDeck] = useState<Narration | null>(null);
  const [options, setOptions] = useState<SpeechOptions>({ ...SPEECH_DEFAULTS }),
    [pageEmotions, setPageEmotions] = useState<Record<string, string>>({});
  const [pageIndex, setPageIndex] = useState(0),
    [clipIndex, setClipIndex] = useState(0),
    [playing, setPlaying] = useState(false);
  const [presenting, setPresenting] = useState(false),
    [notesOpen, setNotesOpen] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false),
    [preview, setPreview] = useState(""),
    [elapsed, setElapsed] = useState(0),
    [duration, setDuration] = useState(0);
  const [audioError, setAudioError] = useState(""),
    [audioLoading, setAudioLoading] = useState(false),
    [audioAttempt, setAudioAttempt] = useState(0);
  const root = useRef<HTMLDivElement>(null),
    audio = useRef<HTMLAudioElement>(null),
    previewAudio = useRef<HTMLAudioElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const polling = !!deck && active(deck.status);
  const pages =
    deck?.pages ||
    project?.slides.map((s, i) => ({
      ...s,
      number: i + 1,
      title: s.plan?.title || `第 ${i + 1} 页`,
      notes: speakerNotes(s),
    })) ||
    [];
  const page = pages[pageIndex];
  const clip = deck?.pages[pageIndex]?.clips[clipIndex];
  const source = clip?.file
    ? speechAudio(clip.file) + (audioAttempt ? `&retry=${audioAttempt}` : "")
    : "";
  const clipKey = `${deck?.id || "manual"}:${pageIndex}:${clipIndex}`;
  const changed =
    !!deck &&
    (JSON.stringify(options) !== JSON.stringify(deck.options) ||
      deck.pages.some(
        (p) => p.emotion !== (pageEmotions[p.id] || options.emotion),
      ));
  const playable = deck?.status === "ready" && !changed;
  const generatedPages =
    deck?.pages.filter((p) => p.clips.length && p.clips.every((c) => c.file))
      .length || 0;
  const totalDuration =
    deck?.pages.reduce(
      (sum, p) =>
        sum + p.clips.reduce((n, c) => n + (c.file ? c.duration || 0 : 0), 0),
      0,
    ) || 0;
  const pageDuration =
    deck?.pages[pageIndex]?.clips.reduce(
      (sum, c) => sum + (c.file ? c.duration || 0 : 0),
      0,
    ) || 0;

  const selectDeck = useCallback((d: Narration | null) => {
    setPlaying(false);
    setPageIndex(0);
    setClipIndex(0);
    setDeck(d);
    setError("");
    setMessage("");
    if (d) {
      setOptions(d.options);
      setPageEmotions(
        Object.fromEntries(
          d.pages
            .filter((p) => p.emotion !== d.options.emotion)
            .map((p) => [p.id, p.emotion]),
        ),
      );
    } else setPageEmotions({});
  }, []);
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api<Project>(`/projects/${projectId}`),
      api<Voice[]>("/speech/voices"),
      api<SpeechConnection>("/settings/speech"),
      api<Narration[]>(`/projects/${projectId}/narration`),
    ])
      .then(([p, v, c, h]) => {
        if (cancelled) return;
        setProject(p);
        setVoices(v);
        setConfig(c);
        setHistory(h);
        selectDeck(
          h.find((d) => active(d.status)) ||
            h.find((d) => d.sourceRevision === p.revision) ||
            null,
        );
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    const focused = document.activeElement as HTMLElement | null;
    closeButton.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      cancelled = true;
      document.body.style.overflow = previousOverflow;
      focused?.focus();
    };
  }, [projectId, selectDeck]);
  useEffect(() => {
    if (!polling || !deck) return;
    let stopped = false,
      timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const d = await api<Narration>(`/narration/${deck.id}`);
        if (!stopped) {
          setDeck(d);
          setHistory((h) => [d, ...h.filter((x) => x.id !== d.id)]);
        }
      } catch (e) {
        if (!stopped) setError((e as Error).message);
      }
      if (!stopped) timer = setTimeout(poll, 1500);
    };
    timer = setTimeout(poll, 700);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [deck?.id, polling]);
  useEffect(() => {
    const el = audio.current;
    if (!el) return;
    let cancelled = false;
    if (playing && source) {
      previewAudio.current?.pause();
      el.play().catch((e: DOMException) => {
        if (cancelled || e.name === "AbortError") return;
        setPlaying(false);
        if (el.error || e.name === "NotSupportedError") {
          setAudioError(audioReadError);
        } else {
          setError(
            e.name === "NotAllowedError"
              ? "浏览器尚未允许播放声音，请再次点击开始口播。"
              : "浏览器未能播放声音，请再次点击开始口播；如仍失败，请检查音频设备。",
          );
        }
      });
    } else el.pause();
    return () => {
      cancelled = true;
      el.pause();
    };
  }, [source, playing, clipKey]);
  useEffect(() => {
    setElapsed(0);
    setDuration(0);
    setAudioError("");
    setAudioLoading(!!source);
  }, [source, clipKey]);
  useEffect(() => {
    const pause = () => {
      if (document.hidden) {
        setPlaying(false);
        previewAudio.current?.pause();
      }
    };
    document.addEventListener("visibilitychange", pause);
    return () => document.removeEventListener("visibilitychange", pause);
  }, []);
  const jump = useCallback(
    (index: number) => {
      if (index < 0 || index >= pages.length) return;
      setPageIndex(index);
      setClipIndex(0);
      setMessage("");
      if (index === pageIndex) {
        if (audio.current) audio.current.currentTime = 0;
      }
    },
    [pages.length, pageIndex],
  );
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        (e.target as HTMLElement)?.closest(
          "input, textarea, select, audio, summary",
        )
      )
        return;
      if (e.key === "ArrowRight" || e.key === "PageDown") {
        e.preventDefault();
        jump(pageIndex + 1);
      }
      if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        jump(pageIndex - 1);
      }
      if (e.code === "Space" && !(e.target as HTMLElement)?.closest("button")) {
        e.preventDefault();
        if (playable) setPlaying((v) => !v);
      }
      if (e.key === "Escape" && !document.fullscreenElement) {
        setPlaying(false);
        if (presenting) setPresenting(false);
        else onClose();
      }
      if (e.key === "Tab") {
        const elements = [
          ...(root.current?.querySelectorAll<HTMLElement>(
            "button:not([disabled]), input:not([disabled]), select:not([disabled]), summary, audio[controls]",
          ) || []),
        ].filter((el) => el.getClientRects().length);
        const first = elements[0],
          last = elements.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [jump, pageIndex, playable, presenting, onClose]);
  async function generate() {
    if (!project) return;
    setBusy(true);
    setError("");
    setPlaying(false);
    previewAudio.current?.pause();
    try {
      const d = await post<Narration>(`/projects/${projectId}/narration`, {
        revision: project.revision,
        options,
        pageEmotions,
      });
      selectDeck(d);
      setHistory((h) => [d, ...h]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function audition() {
    setBusy(true);
    setPlaying(false);
    setError("");
    previewAudio.current?.pause();
    try {
      const data = await post<{ file: string }>("/speech/preview", {
        options: {
          ...options,
          emotion: pageEmotions[page?.id] || options.emotion,
        },
        text: Array.from(
          page?.notes ||
            "大家好，欢迎来到我的演讲。让我们从一个值得思考的问题开始。",
        )
          .slice(0, 180)
          .join(""),
      });
      setPreview(speechAudio(data.file));
      setMessage("试听已生成，请点击音频播放按钮。");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function jobAction(action: string) {
    if (!deck) return;
    setBusy(true);
    setError("");
    try {
      setDeck(await post<Narration>(`/narration/${deck.id}/${action}`));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function refreshProject() {
    try {
      setProject(await api<Project>(`/projects/${projectId}`));
      selectDeck(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function ended() {
    if (!playing || !deck) return;
    if (clipIndex + 1 < deck.pages[pageIndex].clips.length)
      setClipIndex(clipIndex + 1);
    else if (pageIndex + 1 < pages.length) {
      setPageIndex(pageIndex + 1);
      setClipIndex(0);
    } else {
      setPlaying(false);
      setMessage("演讲已结束");
    }
  }
  function start() {
    if (audio.current?.ended) audio.current.currentTime = 0;
    setPresenting(true);
    setPlaying(true);
    setMessage("");
    setError("");
  }
  return (
    <div
      ref={root}
      className={`speech-shell ${presenting ? "is-presenting" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label="播放演讲"
    >
      <header className="speech-header">
        <div>
          <span className="speech-eyebrow">AUTOPPT · 演讲放映</span>
          <h1>{project?.title || "播放演讲"}</h1>
        </div>
        <div className="speech-inline">
          {presenting && (
            <Button
              onClick={() => {
                setPlaying(false);
                setPresenting(false);
              }}
            >
              口播设置
            </Button>
          )}
          <Button
            aria-label="全屏放映"
            onClick={async () => {
              try {
                if (document.fullscreenElement) await document.exitFullscreen();
                else await root.current?.requestFullscreen();
              } catch {
                setError("当前窗口不支持全屏，可使用系统窗口最大化。");
              }
            }}
          >
            <ArrowsOut size={18} />
            全屏
          </Button>
          <button
            ref={closeButton}
            className="speech-icon"
            aria-label="关闭演讲播放器"
            onClick={onClose}
          >
            <X size={22} />
          </button>
        </div>
      </header>
      <div className="speech-body">
        <main className="speech-stage-area">
          <div className="speech-stage">
            {page?.scene ? (
              <SceneView scene={page.scene} label={page.title} />
            ) : page?.image ? (
              <img src={asset(page.image)} alt={page.title} />
            ) : (
              <div className="speech-empty">
                {project ? "先生成 PPT 页面，再开始演讲。" : "正在载入演讲…"}
              </div>
            )}
          </div>
          <div className="speech-transport">
            <Button
              aria-label="上一页"
              disabled={pageIndex === 0}
              onClick={() => jump(pageIndex - 1)}
            >
              <ArrowLeft size={18} />
            </Button>
            <span className="speech-count">
              {pages.length ? pageIndex + 1 : 0} <small>/ {pages.length}</small>
            </span>
            <Button
              aria-label="下一页"
              disabled={pageIndex + 1 >= pages.length}
              onClick={() => jump(pageIndex + 1)}
            >
              <ArrowRight size={18} />
            </Button>
            <div className="speech-transport-gap" />
            {playable && (
              <Button
                variant="primary"
                onClick={() => (playing ? setPlaying(false) : start())}
              >
                {playing ? <Pause size={18} /> : <Play size={18} />}
                {playing ? "暂停口播" : "开始口播"}
              </Button>
            )}
            <Button onClick={() => setNotesOpen((v) => !v)}>
              {notesOpen ? "收起讲稿" : "查看讲稿"}
            </Button>
          </div>
          {source && (
            <div className="speech-timeline">
              <span>{time(elapsed)}</span>
              <input
                aria-label="当前口播片段进度"
                type="range"
                min="0"
                max={duration || 1}
                step="0.1"
                value={Math.min(elapsed, duration || 1)}
                disabled={!duration}
                onChange={(e) => {
                  if (audio.current)
                    audio.current.currentTime = Number(e.target.value);
                  setElapsed(Number(e.target.value));
                }}
              />
              <span>{time(duration || clip?.duration || 0)}</span>
              {(deck?.pages[pageIndex]?.clips.length || 0) > 1 && (
                <small>
                  片段 {clipIndex + 1}/{deck?.pages[pageIndex]?.clips.length}
                </small>
              )}
            </div>
          )}
          {notesOpen && <div className="speech-notes">{page?.notes}</div>}
          {deck && (
            <p className="speech-audio-status" role="status">
              音频已生成 {generatedPages}/{deck.pages.length} 页
              {totalDuration > 0 ? ` · 总时长约 ${time(totalDuration)}` : ""}
              {source
                ? ` · 本页 ${time(pageDuration)}${audioLoading ? " · 正在读取…" : ""}`
                : " · 本页待生成"}
            </p>
          )}
          {deck && (
            <p className="speech-caption">
              <SpeakerHigh size={15} />
              AI 合成口播 · {deck.voiceName} · 保存于项目版本{" "}
              {deck.sourceRevision}
              {changed ? " · 设置已修改，请重新生成" : ""}
            </p>
          )}
          {error && (
            <p role="alert" className="speech-error">
              {error}
            </p>
          )}
          {audioError && (
            <div className="speech-error" role="alert">
              <p>{audioError}</p>
              <Button
                onClick={() => {
                  setPlaying(false);
                  setError("");
                  setAudioAttempt((n) => n + 1);
                }}
              >
                重新读取音频
              </Button>
            </div>
          )}
          {message && (
            <p role="status" className="speech-message">
              {message}
            </p>
          )}
          {!presenting && pages.length > 0 && (
            <nav className="speech-pages" aria-label="选择演讲页面">
              {pages.map((p, i) => (
                <button
                  key={p.id}
                  className={i === pageIndex ? "selected" : ""}
                  aria-current={i === pageIndex ? "page" : undefined}
                  onClick={() => jump(i)}
                  title={p.title}
                >
                  {p.image ? (
                    <img src={asset(p.image)} alt="" loading="lazy" />
                  ) : (
                    <span>{p.title}</span>
                  )}
                  <small>{i + 1}</small>
                </button>
              ))}
            </nav>
          )}
        </main>
        {!presenting && (
          <aside className="speech-setup">
            <h2>让演讲，开始讲述。</h2>
            <p>
              按逐页讲稿口播，讲完自动翻页。选择一个声音，先听听它如何讲你的故事。
            </p>
            {!config?.hasKey && (
              <div className="speech-callout">
                <p>连接语音服务后，即可试听和生成口播。</p>
                <Button onClick={onSettings}>配置语音服务</Button>
              </div>
            )}
            <fieldset disabled={busy || polling || playing}>
              <Field label="演讲声音">
                <select
                  value={options.voiceId}
                  onChange={(e) => {
                    setOptions({ ...options, voiceId: e.target.value });
                    setPreview("");
                  }}
                >
                  {voices.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.custom ? "我的声音 · " : ""}
                      {v.name}
                    </option>
                  ))}
                </select>
              </Field>
              <p className="speech-subtle">
                {voices.find((v) => v.id === options.voiceId)?.description}
              </p>
              <div className="speech-options">
                <Field label="整体情绪">
                  <select
                    value={options.emotion}
                    onChange={(e) =>
                      setOptions({ ...options, emotion: e.target.value })
                    }
                  >
                    {SPEECH_EMOTIONS.map((e) => (
                      <option value={e.id} key={e.id}>
                        {e.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={`语速 · ${options.speed.toFixed(1)}×`}>
                  <input
                    type="range"
                    aria-label="口播语速"
                    min="0.5"
                    max="2"
                    step="0.1"
                    value={options.speed}
                    onChange={(e) =>
                      setOptions({ ...options, speed: Number(e.target.value) })
                    }
                  />
                </Field>
              </div>
              {page && (
                <Field label={`第 ${pageIndex + 1} 页的情绪`}>
                  <select
                    value={pageEmotions[page.id] || ""}
                    onChange={(e) =>
                      setPageEmotions({
                        ...pageEmotions,
                        [page.id]: e.target.value,
                      })
                    }
                  >
                    <option value="">跟随整体设置</option>
                    {SPEECH_EMOTIONS.map((e) => (
                      <option value={e.id} key={e.id}>
                        {e.name}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              <Button disabled={!config?.hasKey} onClick={audition}>
                试听本页开头
              </Button>
            </fieldset>
            {preview && (
              <audio
                ref={previewAudio}
                controls
                src={preview}
                onPlay={() => setPlaying(false)}
                aria-label="合成口播试听"
              />
            )}
            <div className="speech-generate">
              <Button
                variant="primary"
                disabled={
                  busy ||
                  polling ||
                  !config?.hasKey ||
                  !pages.length ||
                  !!(deck && deck.sourceRevision !== project?.revision)
                }
                onClick={generate}
              >
                {busy
                  ? "处理中…"
                  : `生成整场口播 · ${project?.slides.length || 0} 页`}
              </Button>
              <small>
                试听与生成使用语音服务额度。讲稿发送至已配置的服务，已生成音频保存在本机；重复内容自动复用。
              </small>
            </div>
            {deck && (
              <div className="speech-job" role="status">
                <strong>{deck.progress}</strong>
                <span>
                  {deck.pages.filter((p) => p.status === "ready").length} /{" "}
                  {deck.pages.length} 页完成
                </span>
                {polling ? (
                  <Button disabled={busy} onClick={() => jobAction("cancel")}>
                    停止生成
                  </Button>
                ) : (
                  deck.status !== "ready" && (
                    <Button disabled={busy} onClick={() => jobAction("retry")}>
                      继续未完成的页面
                    </Button>
                  )
                )}
              </div>
            )}
            <Button
              disabled={!pages.length}
              onClick={() => {
                setPlaying(false);
                previewAudio.current?.pause();
                setPresenting(true);
              }}
            >
              仅放映 PPT
            </Button>
            {!!history.length && (
              <Field label="已保存的口播">
                <select
                  value={deck?.id || ""}
                  disabled={busy || polling}
                  onChange={(e) =>
                    selectDeck(
                      history.find((d) => d.id === e.target.value) || null,
                    )
                  }
                >
                  <option value="">当前项目 · 未生成口播</option>
                  {history.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.voiceName} · 版本 {d.sourceRevision} ·{" "}
                      {new Date(d.createdAt).toLocaleString("zh-CN")}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {deck && (
              <p className="speech-subtle">
                播放使用生成时的画面与讲稿。
                {deck.sourceRevision !== project?.revision
                  ? "当前项目已更新。"
                  : ""}
                <button disabled={polling || busy} onClick={refreshProject}>
                  载入当前项目
                </button>
              </p>
            )}
            {!!page?.stale && (
              <p className="speech-callout">
                本页画面早于当前讲稿，请检查内容是否一致。
              </p>
            )}
            <VoiceCapture
              onRecordingStart={() => {
                setPlaying(false);
                previewAudio.current?.pause();
              }}
              disabled={busy || polling || !config?.hasKey}
              onVoices={(v) => {
                setVoices(v);
                const newest = v.at(-1);
                if (newest) setOptions((o) => ({ ...o, voiceId: newest.id }));
              }}
            />
          </aside>
        )}
      </div>
      <audio
        key={`${clipKey}:${audioAttempt}`}
        ref={audio}
        src={source || undefined}
        preload="auto"
        onEnded={ended}
        onTimeUpdate={() => setElapsed(audio.current?.currentTime || 0)}
        onLoadedMetadata={() =>
          setDuration(
            Number.isFinite(audio.current?.duration)
              ? audio.current!.duration
              : 0,
          )
        }
        onCanPlay={() => {
          setAudioLoading(false);
          setAudioError("");
        }}
        onError={() => {
          if (source) {
            setPlaying(false);
            setAudioLoading(false);
            setAudioError(audioReadError);
          }
        }}
      />
    </div>
  );
}
