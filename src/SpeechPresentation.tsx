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
import { api, asset, post, active, downloadFile } from "./api";
import {
  prepareSpeechText,
  SPEECH_TEXT_VERSION,
} from "../shared/speech-text.mjs";
import { Button, Field } from "./components";
import { SceneView } from "./SceneView";
import { failureAdvice } from "../shared/job-feedback.mjs";
import type { Project } from "./types";
import {
  SPEECH_DEFAULTS,
  SPEECH_EMOTIONS,
  type SpeechOptions,
} from "../shared/speech.mjs";
import { speakerNotes } from "../shared/manuscript.mjs";
import {
  speechAudio,
  type Narration,
  type Voice,
  type SpeechConnection,
} from "./speech-types";
import "./speech.css";
import { PresenterOverlay } from "./PresenterOverlay";
import { SpeechPerformance } from "./SpeechPerformance";
import { SpeechPreview } from "./SpeechPreview";
import {
  performanceMatches,
  supportsDeliverySounds,
  type SpeechPerformance as Performance,
} from "../shared/speech-performance.mjs";

const time = (value: number) =>
  `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, "0")}`;
const performanceNow = () => window.performance.now();
const audioReadError =
  "本页音频已生成，但读取失败。请重试读取已保存音频；此操作不会重新生成或计费。";
export function SpeechPresentation({
  projectId,
  onClose,
  onSettings,
  initialPanel = "play",
  managed = false,
}: {
  projectId: string;
  onClose: () => void;
  onSettings: () => void;
  initialPanel?: "play" | "text";
  managed?: boolean;
}) {
  const [project, setProject] = useState<Project | null>(null),
    [voices, setVoices] = useState<Voice[]>([]);
  const [config, setConfig] = useState<SpeechConnection | null>(null),
    [history, setHistory] = useState<Narration[]>([]),
    [deck, setDeck] = useState<Narration | null>(null);
  const [options, setOptions] = useState<SpeechOptions>({ ...SPEECH_DEFAULTS }),
    [pageEmotions, setPageEmotions] = useState<Record<string, string>>({});
  const [editPageId, setEditPageId] = useState("");
  const [panel, setPanel] = useState<"play" | "text" | "expression" | "voice">(
    initialPanel,
  );
  const [playbackRate, setPlaybackRate] = useState(1);
  const [hasPresenter, setHasPresenter] = useState(false);
  const [showPresenter, setShowPresenter] = useState(true);
  const [pendingDeck, setPendingDeck] = useState<Narration | null>(null);
  const [pageTexts, setPageTexts] = useState<Record<string, string>>({});
  const [performance, setPerformance] = useState<Performance | null>(null);
  const [usePerformance, setUsePerformance] = useState(false);
  const [performanceBusy, setPerformanceBusy] = useState(false);
  const [inPause, setInPause] = useState(false);
  const pauseRemaining = useRef(0);
  const [textReviewed, setTextReviewed] = useState(false),
    [textFeedback, setTextFeedback] = useState<{
      error?: boolean;
      text: string;
    } | null>(null);
  const [pageIndex, setPageIndex] = useState(0),
    [clipIndex, setClipIndex] = useState(0),
    [playing, setPlaying] = useState(false);
  const [presenting, setPresenting] = useState(false),
    [notesOpen, setNotesOpen] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [actionBusy, setBusy] = useState(false),
    [previewBusy, setPreviewBusy] = useState(false),
    [elapsed, setElapsed] = useState(0),
    [duration, setDuration] = useState(0);
  const [audioError, setAudioError] = useState(""),
    [audioLoading, setAudioLoading] = useState(false),
    [audioAttempt, setAudioAttempt] = useState(0);
  const root = useRef<HTMLDivElement>(null),
    audio = useRef<HTMLAudioElement>(null),
    previewAudio = useRef<HTMLAudioElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const busy = actionBusy || previewBusy;
  const job = pendingDeck || deck;
  const polling = !!job && active(job.status);
  const draftPages =
    project?.slides.map((s, i) => ({
      ...s,
      number: i + 1,
      title: s.plan?.title || `第 ${i + 1} 页`,
      notes: speakerNotes(s),
    })) || [];
  const pages = deck?.pages || draftPages;
  const page = pages[pageIndex];
  const scriptPage =
    draftPages.find((p) => p.id === (editPageId || page?.id)) ||
    draftPages[0] ||
    page;
  const textFor = (p: { id: string; notes: string }) =>
    pageTexts[p.id] ?? prepareSpeechText(p.notes).text;
  const spokenText = scriptPage ? textFor(scriptPage) : "";
  const performancePages = draftPages.map((p) => ({
    id: p.id,
    text: textFor(p),
  }));
  const performanceValid = performanceMatches(performance, performancePages);
  const performanceBlocked =
    usePerformance &&
    (!performanceValid ||
      (!supportsDeliverySounds(config?.model || "") &&
        performance?.pages.some((p) => p.units.some((u) => u.sound))));
  const removed = prepareSpeechText(scriptPage?.notes || "").removed;
  const clip = deck?.pages[pageIndex]?.clips[clipIndex];
  const source = clip?.file
    ? speechAudio(clip.file) + (audioAttempt ? `&retry=${audioAttempt}` : "")
    : "";
  const clipKey = `${deck?.id || "manual"}:${pageIndex}:${clipIndex}`;
  const textChanged =
    !!deck &&
    deck.pages.some(
      (p) =>
        textFor(p) !== (p.spokenText ?? p.clips.map((c) => c.text).join("")),
    );
  const changed =
    !!deck &&
    (deck.sourceRevision !== project?.revision ||
      JSON.stringify(options) !== JSON.stringify(deck.options) ||
      deck.pages.some(
        (p) => p.emotion !== (pageEmotions[p.id] || options.emotion),
      ) ||
      textChanged);
  // Draft edits never invalidate saved audio.
  const playable = deck?.status === "ready";
  const generatedPages =
    deck?.pages.filter(
      (p) => p.status === "ready" && p.clips.every((c) => c.file),
    ).length || 0;
  const totalDuration =
    deck?.pages.reduce(
      (sum, p) =>
        sum +
        (p.clips.length
          ? p.clips.reduce(
              (n, c) =>
                n + (c.file ? (c.duration || 0) + (c.pauseAfter || 0) : 0),
              0,
            )
          : p.silentDuration || 3),
      0,
    ) || 0;
  const pageDuration =
    deck?.pages[pageIndex]?.clips.reduce(
      (sum, c) => sum + (c.file ? (c.duration || 0) + (c.pauseAfter || 0) : 0),
      0,
    ) || 0;

  const selectDeck = useCallback((d: Narration | null, loadDraft = true) => {
    setPlaying(false);
    setPageIndex(0);
    setClipIndex(0);
    setInPause(false);
    pauseRemaining.current = 0;
    setDeck(d);
    setError("");
    setMessage("");
    setTextReviewed(false);
    setTextFeedback(null);
    if (!loadDraft) return;
    if (d) {
      setPageTexts(
        Object.fromEntries(
          d.pages.map((p) => [
            p.id,
            p.spokenText ?? p.clips.map((c) => c.text).join(""),
          ]),
        ),
      );
      setOptions(d.options);
      setPageEmotions(
        Object.fromEntries(
          d.pages
            .filter((p) => p.emotion !== d.options.emotion)
            .map((p) => [p.id, p.emotion]),
        ),
      );
    } else {
      setPageEmotions({});
      setPageTexts({});
    }
  }, []);
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api<Project>(`/projects/${projectId}`),
      api<Voice[]>("/speech/voices"),
      api<SpeechConnection>("/settings/speech"),
      api<Narration[]>(`/projects/${projectId}/narration`),
      api<{
        pages: { id: string; text: string; edited?: boolean }[];
        performance: Performance | null;
        performanceTask: { status: string } | null;
      }>(`/projects/${projectId}/speech-script`),
      managed
        ? Promise.resolve(null)
        : api<{ setup: { narrationId: string } }>(
            `/projects/${projectId}/presenter/setup`,
          ).catch(() => null),
      api<{ plan: { voiceId: string; emotion: string; speed: number } }>(
        `/projects/${projectId}/rehearsal`,
      ).catch(() => null),
    ])
      .then(([p, v, c, h, script, presenter, rehearsal]) => {
        if (cancelled) return;
        setProject(p);
        setPerformance(script.performance);
        setUsePerformance(!managed && !!script.performance);
        setPerformanceBusy(
          !managed &&
            !!script.performanceTask &&
            active(script.performanceTask.status),
        );
        setVoices(v);
        setConfig(c);
        setHistory(h);
        const selected =
          h.find(
            (d) =>
              d.id === presenter?.setup.narrationId && d.status === "ready",
          ) ||
          h.find(
            (d) => d.status === "ready" && d.sourceRevision === p.revision,
          ) ||
          h.find((d) => d.status === "ready") ||
          h[0] ||
          null;
        setPendingDeck(h.find((d) => active(d.status)) || null);
        selectDeck(selected, selected?.sourceRevision === p.revision);
        if (!selected && rehearsal?.plan.voiceId)
          setOptions({
            voiceId: rehearsal.plan.voiceId,
            emotion: rehearsal.plan.emotion,
            speed: rehearsal.plan.speed,
          });
        if (
          !selected ||
          selected.sourceRevision !== p.revision ||
          (!active(selected.status) && script.pages.some((p) => p.edited))
        )
          setPageTexts(
            Object.fromEntries(script.pages.map((p) => [p.id, p.text])),
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
    if (!performanceBusy || panel === "expression") return;
    let stopped = false;
    const timer = setInterval(() => {
      api<{
        performance: Performance | null;
        performanceTask: { status: string } | null;
      }>(`/projects/${projectId}/speech-script`)
        .then((s) => {
          if (!stopped) {
            setPerformance(s.performance);
            setPerformanceBusy(
              !!s.performanceTask && active(s.performanceTask.status),
            );
          }
        })
        .catch((e) => {
          if (!stopped) setError(e.message);
        });
    }, 1500);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [performanceBusy, panel, projectId]);
  useEffect(() => {
    if (!polling || !job) return;
    let stopped = false,
      timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const d = await api<Narration>(`/narration/${job.id}`);
        if (!stopped) {
          setPendingDeck(d);
          if (!deck || deck.status !== "ready") setDeck(d);
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
  }, [job?.id, polling, deck?.status]);
  useEffect(() => {
    const el = audio.current;
    if (!el) return;
    let cancelled = false;
    if (playing && source && !inPause) {
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
  }, [source, playing, clipKey, inPause]);
  useEffect(() => {
    if (!playing || !inPause) return;
    const started = performanceNow();
    const timer = setTimeout(
      () => {
        pauseRemaining.current = 0;
        advanceClip();
        setInPause(false);
      },
      (pauseRemaining.current * 1000) / playbackRate,
    );
    return () => {
      clearTimeout(timer);
      pauseRemaining.current = Math.max(
        0,
        pauseRemaining.current -
          ((performanceNow() - started) / 1000) * playbackRate,
      );
    };
  }, [playing, inPause, playbackRate, clipKey]);
  useEffect(() => {
    if (audio.current) {
      audio.current.playbackRate = playbackRate;
      audio.current.preservesPitch = true;
    }
  }, [playbackRate, source, clipKey, audioAttempt]);
  useEffect(() => {
    if (!playing || !playable || source || !deck) return;
    const timer = setTimeout(
      ended,
      ((deck.pages[pageIndex].silentDuration || 3) * 1000) / playbackRate,
    );
    return () => clearTimeout(timer);
  }, [playing, playable, source, deck, pageIndex, clipIndex, playbackRate]);
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
      setEditPageId("");
      setClipIndex(0);
      setInPause(false);
      pauseRemaining.current = 0;
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
            "button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), summary, audio[controls]",
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
  async function saveTexts(advance: boolean) {
    setBusy(true);
    setTextFeedback(null);
    try {
      await api(`/projects/${projectId}/speech-script`, {
        method: "PUT",
        body: JSON.stringify({
          revision: project?.revision,
          pageTexts: Object.fromEntries(
            draftPages.map((p) => [p.id, textFor(p)]),
          ),
        }),
      });
      setTextReviewed(true);
      setTextFeedback({
        text: "口播文本已保存，原稿保持不变。已有音频不会随文本修改；请生成新的口播版本以应用修改。",
      });
      if (advance) setPanel(managed ? "voice" : "expression");
    } catch (e) {
      setTextFeedback({ error: true, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }
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
        ...(usePerformance ? { performanceId: performance?.id } : {}),
        pageEmotions,
        pageTexts: Object.fromEntries(
          draftPages.map((p) => [p.id, textFor(p)]),
        ),
      });
      setPendingDeck(d);
      if (!playable) setDeck(d);
      setHistory((h) => [d, ...h]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function jobAction(action: string) {
    if (!job) return;
    setBusy(true);
    setError("");
    try {
      setPendingDeck(await post<Narration>(`/narration/${job.id}/${action}`));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function refreshProject() {
    try {
      const [p, script] = await Promise.all([
        api<Project>(`/projects/${projectId}`),
        api<{ pages: { id: string; text: string }[] }>(
          `/projects/${projectId}/speech-script`,
        ),
      ]);
      setProject(p);
      setTextFeedback({
        text: "已载入当前项目的口播文本。已保存音频仍可播放；新文字需要生成新口播版本。",
      });
      setPageTexts(Object.fromEntries(script.pages.map((p) => [p.id, p.text])));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function ended() {
    if (playing && clip?.pauseAfter) {
      pauseRemaining.current = clip.pauseAfter;
      setInPause(true);
      return;
    }
    advanceClip();
  }
  function advanceClip() {
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
    if (audio.current?.ended && !inPause) audio.current.currentTime = 0;
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
              返回演播台
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
            {!managed && deck && page && (
              <PresenterOverlay
                projectId={projectId}
                narrationId={deck.id}
                pageId={page.id}
                clipIndex={clipIndex}
                audio={audio}
                enabled={showPresenter}
                onAvailable={setHasPresenter}
              />
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
            {hasPresenter && (
              <label className="speech-presenter-toggle">
                <input
                  type="checkbox"
                  checked={showPresenter}
                  onChange={(e) => setShowPresenter(e.target.checked)}
                />
                显示数字人
              </label>
            )}
            <label className="speech-rate">
              播放倍速
              <select
                aria-label="实时播放倍速"
                value={playbackRate}
                onChange={(e) => setPlaybackRate(Number(e.target.value))}
              >
                {[0.75, 1, 1.25, 1.5, 1.75, 2].map((rate) => (
                  <option key={rate} value={rate}>
                    {rate}×
                  </option>
                ))}
              </select>
            </label>
            {
              <Button
                disabled={!playable}
                variant="primary"
                onClick={() => (playing ? setPlaying(false) : start())}
              >
                {playing ? <Pause size={18} /> : <Play size={18} />}
                {playing ? "暂停口播" : "开始口播"}
              </Button>
            }
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
                  setInPause(false);
                  pauseRemaining.current = 0;
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
          {!playable && (
            <p className="speech-subtle">
              {polling
                ? "口播正在生成，完成后即可播放。"
                : "尚未选择可播放的口播。可选择已保存版本，或制作新口播。"}
            </p>
          )}
          {notesOpen && <div className="speech-notes">{page?.notes}</div>}
          {deck && (
            <p className="speech-audio-status" role="status">
              音频已生成 {generatedPages}/{deck.pages.length} 页
              {totalDuration > 0 ? ` · 总时长约 ${time(totalDuration)}` : ""}
              {source
                ? ` · 本页 ${time(pageDuration)}${audioLoading ? " · 正在读取…" : ""}`
                : deck.pages[pageIndex]?.status === "ready"
                  ? " · 本页无口播，停留 3 秒"
                  : " · 本页待生成"}
            </p>
          )}
          {deck && (
            <p className="speech-caption">
              <SpeakerHigh size={15} />
              AI 合成口播 · {deck.voiceName} · 保存于项目版本{" "}
              {deck.sourceRevision}
              {deck.performance ? " · 已应用演绎编排" : ""}
              {inPause ? " · 表达停顿中" : ""}
              {changed ? " · 播放已保存音频，草稿修改尚未生成" : ""}
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
            <div className="speech-panel-heading">
              <h2>
                {panel === "play"
                  ? "准备好，开始讲述。"
                  : panel === "text"
                    ? "只念你要说的话。"
                    : panel === "expression"
                      ? "为正文安排表达。"
                      : "试听，再生成口播。"}
              </h2>
            </div>
            <div className="speech-tabs" role="tablist" aria-label="演播工作区">
              {(
                [
                  ["play", "放映"],
                  ["text", "1 · 口播文本"],
                  ...(!managed
                    ? [["expression", "2 · 演讲表达"] as const]
                    : []),
                  ["voice", managed ? "2 · 声音制作" : "3 · 声音制作"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  role="tab"
                  aria-selected={panel === id}
                  onClick={() => setPanel(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            {panel === "play" && (
              <div className="speech-play-guide">
                <h3>{playable ? "已有口播，随时开播" : "先制作一份口播"}</h3>
                <p>
                  {playable
                    ? "点击画面下方“开始口播”，讲完自动翻页。倍速在播放中随时可调，无需重新生成。"
                    : managed
                      ? "先检查口播正文，选择声音并试听，再生成整场。"
                      : "按三个步骤完成：检查正文、选择演讲表达、试听并生成声音。也可以先仅放映画面。"}
                </p>
                <Button onClick={() => setPanel("text")}>
                  检查或重新识别口播文本
                </Button>
                <p className="speech-subtle">
                  ← → 翻页 · 空格播放/暂停 · Esc 返回
                </p>
              </div>
            )}
            {panel !== "play" && (
              <p className="speech-subtle">
                {panel === "text"
                  ? textReviewed
                    ? "正文已保存或重新识别，请核对后继续。"
                    : "已从原稿提取正文，先检查各页是否只包含要说的话。"
                  : panel === "expression"
                    ? "选择 AI 编排或普通口播，完成后进入声音制作。"
                    : "先试听本页，满意后生成整场口播；完成后切换到放映。"}
              </p>
            )}
            {panel === "voice" && !config?.hasKey && (
              <div className="speech-callout">
                <p>
                  {managed
                    ? "请联系管理员连接 MiniMax 语音服务。已生成音频仍可播放。"
                    : "连接语音服务后，即可试听和生成口播。"}
                </p>
                {!managed && <Button onClick={onSettings}>配置语音服务</Button>}
              </div>
            )}
            {panel === "voice" && performanceBusy && (
              <p role="status" className="speech-callout">
                演绎编排进行中，请到“2 · 演讲表达”查看进度或停止。
              </p>
            )}
            <fieldset hidden={panel === "play"} disabled={busy || polling}>
              {panel === "text" && scriptPage && (
                <section className="speech-text-review">
                  <Field label="查看口播页">
                    <select
                      value={scriptPage.id}
                      onChange={(e) => setEditPageId(e.target.value)}
                    >
                      {draftPages.map((p) => (
                        <option value={p.id} key={p.id}>
                          第 {p.number} 页 · {p.title}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <h3>实际口播文本</h3>
                  <p className="speech-subtle">
                    过滤主副标题、菜单、章节和动作提示；保留正文。请检查后生成；留空表示本页不口播，停留
                    3 秒。
                  </p>
                  <textarea
                    aria-label="实际口播文本"
                    rows={7}
                    value={spokenText}
                    onChange={(e) => {
                      setPageTexts((t) => ({
                        ...t,
                        [scriptPage.id]: e.target.value,
                      }));
                      setTextReviewed(false);
                      setTextFeedback(null);
                    }}
                  />
                  <details>
                    <summary>查看原稿与过滤说明（{removed.length} 处）</summary>
                    <div className="speech-notes">{scriptPage?.notes}</div>
                    {removed.map((r, i) => (
                      <p key={i} className="speech-subtle">
                        {r.reason}：{r.text}
                      </p>
                    ))}
                  </details>
                  <div className="speech-inline">
                    <Button
                      onClick={() => {
                        const results = draftPages.map((p) => ({
                          id: p.id,
                          before: textFor(p),
                          ...prepareSpeechText(p.notes),
                        }));
                        const firstChanged = results.findIndex(
                          (p) => p.text !== p.before,
                        );
                        if (firstChanged >= 0) {
                          const index = pages.findIndex(
                            (p) => p.id === results[firstChanged].id,
                          );
                          if (index >= 0) jump(index);
                          setEditPageId(results[firstChanged].id);
                        }
                        const updated = results.filter(
                          (p) => p.text !== p.before,
                        ).length;
                        const omitted = results.reduce(
                          (n, p) => n + p.removed.length,
                          0,
                        );
                        setPageTexts(
                          Object.fromEntries(
                            results.map((p) => [p.id, p.text]),
                          ),
                        );
                        previewAudio.current?.pause();
                        setTextReviewed(true);
                        setTextFeedback({
                          text: `已重新识别 ${draftPages.length} 页，过滤 ${omitted} 处非口播内容。${updated ? `已更新 ${updated} 页文本，请逐页检查后保存或生成口播。` : "当前文本与识别结果一致，无需修改。"} 本次仅处理文本，不生成音频、不计费。`,
                        });
                      }}
                    >
                      重新识别整场口播
                    </Button>
                    <Button variant="ghost" onClick={() => saveTexts(false)}>
                      保存口播文本
                    </Button>
                  </div>
                  {textFeedback && (
                    <p
                      role={textFeedback.error ? "alert" : "status"}
                      className={
                        textFeedback.error ? "speech-error" : "speech-callout"
                      }
                    >
                      {textFeedback.text}
                    </p>
                  )}
                  {deck?.pages.some(
                    (p) => (p.speechTextVersion || 0) < SPEECH_TEXT_VERSION,
                  ) && (
                    <p className="speech-callout">
                      {textReviewed || textChanged
                        ? "当前音频仍是旧版。检查口播文本后，前往“3 · 声音制作”生成新版本，才能更新声音；生成会使用语音服务额度。"
                        : "这是旧版音频。点击“重新识别整场口播”并检查文本后，生成新的口播版本，才能去除已录入声音的提示文字。"}
                    </p>
                  )}
                  <Button variant="primary" onClick={() => saveTexts(true)}>
                    {managed
                      ? "保存并继续 · 选择声音"
                      : "保存并继续 · 选择演讲表达"}
                  </Button>
                  <p className="speech-subtle">
                    {managed
                      ? "文本识别与保存不调用模型。下一步试听并生成口播。"
                      : "文本识别与保存不调用模型。下一步可选 AI 编排，或直接使用普通口播。"}
                  </p>
                </section>
              )}
              {panel === "expression" && project && scriptPage && (
                <section>
                  <Field label="查看演绎页">
                    <select
                      value={scriptPage.id}
                      onChange={(e) => setEditPageId(e.target.value)}
                    >
                      {draftPages.map((p) => (
                        <option value={p.id} key={p.id}>
                          第 {p.number} 页 · {p.title}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <SpeechPerformance
                    projectId={projectId}
                    revision={project.revision}
                    pages={performancePages}
                    pageId={scriptPage.id}
                    model={config?.model || ""}
                    plan={performance}
                    enabled={usePerformance}
                    disabled={busy || polling}
                    onPlan={setPerformance}
                    onEnabled={setUsePerformance}
                    onWorking={setPerformanceBusy}
                    onTexts={setPageTexts}
                    onNext={() => setPanel("voice")}
                  />
                </section>
              )}
              {panel === "voice" && (
                <>
                  <Field label="演讲声音">
                    <select
                      value={options.voiceId}
                      onChange={(e) => {
                        setOptions({ ...options, voiceId: e.target.value });
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
                  <div
                    className={`speech-options ${usePerformance ? "speech-options-single" : ""}`}
                  >
                    <div hidden={usePerformance}>
                      <Field label="整体情绪">
                        <select
                          disabled={usePerformance}
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
                    </div>
                    <Field label={`生成语速 · ${options.speed.toFixed(1)}×`}>
                      <input
                        type="range"
                        aria-label="生成口播语速"
                        min="0.5"
                        max="2"
                        step="0.1"
                        value={options.speed}
                        onChange={(e) =>
                          setOptions({
                            ...options,
                            speed: Number(e.target.value),
                          })
                        }
                      />
                    </Field>
                  </div>
                  {scriptPage && !usePerformance && (
                    <Field
                      label={`第 ${draftPages.findIndex((p) => p.id === scriptPage.id) + 1} 页的情绪`}
                    >
                      <select
                        disabled={usePerformance}
                        value={pageEmotions[scriptPage.id] || ""}
                        onChange={(e) =>
                          setPageEmotions({
                            ...pageEmotions,
                            [scriptPage.id]: e.target.value,
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
                </>
              )}
            </fieldset>
            {panel === "voice" && (
              <>
                <p className="speech-callout">
                  {usePerformance
                    ? "情绪、停顿与重点表达由 AI 演绎方案接管。"
                    : "当前使用普通口播，情绪与语速由下方设置决定。"}{" "}
                  {!managed && (
                    <button onClick={() => setPanel("expression")}>
                      调整演讲表达
                    </button>
                  )}
                </p>
                <SpeechPreview
                  body={{
                    projectId,
                    pageId: scriptPage?.id,
                    options: {
                      ...options,
                      emotion: pageEmotions[scriptPage?.id] || options.emotion,
                    },
                    prepared: true,
                    text: usePerformance
                      ? spokenText
                      : Array.from(spokenText).slice(0, 180).join(""),
                    ...(usePerformance
                      ? {
                          performanceId: performance?.id,
                        }
                      : {}),
                  }}
                  disabledReason={
                    actionBusy
                      ? "正在处理其他操作，请稍候。"
                      : polling
                        ? "整场口播正在生成，完成后可试听。"
                        : !config?.hasKey
                          ? "请先配置语音服务，再试听。"
                          : !spokenText.trim()
                            ? "本页没有口播正文，请先在口播文本中检查。"
                            : performanceBusy
                              ? "演绎编排进行中，完成后可试听。"
                              : performanceBlocked
                                ? "演绎方案尚未就绪、正文已改变或模型不支持辅助声音，请回到“2 · 演讲表达”检查。"
                                : ""
                  }
                  audioRef={previewAudio}
                  onBusy={setPreviewBusy}
                  onStart={() => setPlaying(false)}
                />
                <p className="speech-subtle">
                  生成语速决定新音频的表达。放映时可用左侧“播放倍速”即时调整。
                </p>
                {!managed && (
                  <Button variant="ghost" onClick={onSettings} disabled={busy}>
                    管理声音与采集 → 设置
                  </Button>
                )}
              </>
            )}
            <div className="speech-generate" hidden={panel !== "voice"}>
              <Button
                variant="primary"
                disabled={
                  busy ||
                  polling ||
                  performanceBusy ||
                  !!performanceBlocked ||
                  !config?.hasKey ||
                  !draftPages.length
                }
                onClick={generate}
              >
                {actionBusy
                  ? "处理中…"
                  : `生成整场口播 · ${project?.slides.length || 0} 页`}
              </Button>
              <small>
                试听与生成使用语音服务额度。讲稿发送至已配置的服务，已生成音频保存在本机；重复内容自动复用。
              </small>
            </div>
            {panel === "play" && playable && deck && (
              <Button
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    await downloadFile(
                      `/api/narration/${deck.id}/html?download=1`,
                      "口播演示.html",
                    );
                    setMessage("静态 HTML 已下载，内嵌音频，可离线自动讲述。");
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                导出此版本 HTML · 含口播
              </Button>
            )}
            {job && (polling || job.status !== "ready" || pendingDeck) && (
              <div className="speech-job" role="status">
                <strong>{job.progress}</strong>
                <span>
                  {job.pages.filter((p) => p.status === "ready").length} /{" "}
                  {job.pages.length} 页完成
                </span>
                <p className="speech-subtle">
                  {polling
                    ? "已生成片段会立即保存；任务正在处理，无需再次提交。明确限流会显示等待与有限重试。"
                    : job.status !== "ready"
                      ? "任务已停止，不会自动继续。检查原因后点击继续，已完成片段不重发。"
                      : "新口播已保存，选择后即可放映。"}
                </p>
                {job.pages.some((p) => p.error) && (
                  <details>
                    <summary>查看未完成页的原因</summary>
                    {job.pages.flatMap((p, i) =>
                      p.error
                        ? [
                            <div key={p.id}>
                              <strong>
                                第 {i + 1} 页 · {failureAdvice(p.error).reason}
                              </strong>
                              <p>{failureAdvice(p.error).action}</p>
                              <p className="job-raw-error">{p.error}</p>
                            </div>,
                          ]
                        : [],
                    )}
                  </details>
                )}
                {polling ? (
                  <Button disabled={busy} onClick={() => jobAction("cancel")}>
                    停止生成
                  </Button>
                ) : job.status !== "ready" ? (
                  <Button disabled={busy} onClick={() => jobAction("retry")}>
                    继续未完成的页面
                  </Button>
                ) : (
                  pendingDeck && (
                    <Button
                      onClick={() => {
                        selectDeck(pendingDeck, false);
                        setPendingDeck(null);
                        setPanel("play");
                      }}
                    >
                      使用新口播版本
                    </Button>
                  )
                )}
              </div>
            )}
            <Button
              hidden={panel !== "play"}
              disabled={!pages.length}
              onClick={() => {
                setPlaying(false);
                previewAudio.current?.pause();
                setPresenting(true);
              }}
            >
              仅放映 PPT
            </Button>
            {panel === "play" && !!history.length && (
              <Field label="已保存的口播">
                <select
                  value={deck?.id || ""}
                  disabled={busy || polling}
                  onChange={(e) => {
                    selectDeck(
                      history.find((d) => d.id === e.target.value) || null,
                      false,
                    );
                  }}
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
            {panel !== "play" && deck && (
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
        onLoadedMetadata={() => {
          if (audio.current) audio.current.playbackRate = playbackRate;
          setDuration(
            Number.isFinite(audio.current?.duration)
              ? audio.current!.duration
              : 0,
          );
        }}
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
