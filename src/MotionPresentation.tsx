import { useCallback, useEffect, useRef, useState } from "react";
import {
  HtmlExportOptions,
  useHtmlExportOptions,
  motionHtmlUrl,
  downloadMotionHtml,
} from "./HtmlExportOptions";
import {
  Play,
  DownloadSimple,
  ArrowsClockwise,
  Stop,
  CheckCircle,
  FilmStrip,
  Plus,
} from "@phosphor-icons/react";
import { api, asset, patch, post, downloadFile } from "./api";
import { Button, Field, Modal } from "./components";
import type { Project } from "./types";
import "./motion.css";
import { CHOREOGRAPHIES } from "../shared/motion/choreography.mjs";

type Layer = {
  id: string;
  type: "text" | "image";
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  step: number;
  delay: number;
  duration: number;
  effect: string;
  rotation: number;
  text?: string;
  font?: string;
  fontSize?: number;
  fontWeight?: number;
  color?: string;
  letterSpacing?: number;
  lineHeight?: number;
  fit?: boolean;
  asset?: string;
  align?: string;
};
type MotionPage = {
  id: string;
  number: number;
  title: string;
  status: string;
  source: { image: string; notes: string; stale: boolean };
  width: number;
  height: number;
  layers: Layer[];
  warnings?: string[];
  error?: string;
  reviewed?: boolean;
  summary?: string;
  usedRepair?: boolean;
  background?: string;
  playbackMode?: string;
  choreography?: string;
  history?: unknown[];
};
type Deck = {
  id: string;
  title: string;
  sourceRevision: number;
  sourceMode?: string;
  revision: number;
  createdAt: string;
  status: string;
  progress: string;
  pages: MotionPage[];
  customFont: { name: string } | null;
};
const active = (d: Deck | null) =>
  !!d && ["queued", "running"].includes(d.status);
const statuses: Record<string, string> = {
  pending: "待转换",
  running: "转换中",
  ready: "已完成",
  failed: "失败",
  partial: "部分完成",
  queued: "排队中",
  cancelled: "已停止",
  interrupted: "已中断",
};
const effects: Record<string, string> = {
  rise: "轻盈上浮",
  fade: "淡入",
  wipe: "横向揭示",
  zoom: "轻推近",
  draw: "线条展开",
  none: "静止",
};

export function MotionPresentation({
  project,
  selected,
  initialMode = "extract",
  initialDeckId = "",
  onClose,
}: {
  project: Project;
  selected: string[];
  initialMode?: "extract" | "layered";
  initialDeckId?: string;
  onClose: (deckId?: string) => void;
}) {
  const [decks, setDecks] = useState<Deck[]>([]),
    [deckId, setDeckId] = useState(initialDeckId),
    [deck, setDeck] = useState<Deck | null>(null);
  const [sourceMode, setSourceMode] = useState(initialMode);
  const [sequenceDraft, setSequenceDraft] = useState<string | null>(null);
  const [inspectorTab, setInspectorTab] = useState<"text" | "motion">("text");
  const [auditioning, setAuditioning] = useState(false);
  const [canvasReady, setCanvasReady] = useState(false);
  const saveAction = useRef<() => void>(() => {});
  const [modeDraft, setModeDraft] = useState<string | null>(null);
  const [layoutCheck, setLayoutCheck] = useState<{
    pageId: string;
    layers: string;
    issues: string[];
  } | null>(null);
  const player = useRef<Window | null>(null);
  const [editingPlayback, setEditingPlayback] = useState(false);
  const [creating, setCreating] = useState(false),
    [scope, setScope] = useState(selected.length ? "selected" : "all"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [pageId, setPageId] = useState("");
  const [draft, setDraft] = useState<Layer[] | null>(null),
    [baseRevision, setBaseRevision] = useState(0),
    [layerId, setLayerId] = useState(""),
    [compare, setCompare] = useState(initialMode !== "layered");
  const html = useHtmlExportOptions(project.id);
  const frame = useRef<HTMLIFrameElement>(null),
    dirty = useRef(false);
  const refresh = useCallback(async () => {
    const data = await api<Deck[]>(`/projects/${project.id}/motion`);
    setDecks(data);
    const current =
      data.find((d) => d.id === deckId) ||
      (!deckId
        ? data.find((d) => (d.sourceMode || "extract") === initialMode)
        : null);
    setDeck(current || null);
    if (!deckId && current) setDeckId(current.id);
    if (!current) setCreating(true);
  }, [project.id, deckId, initialMode]);
  useEffect(() => {
    let alive = true;
    const poll = () => {
      if (alive) refresh().catch((e) => setError(e.message));
    };
    poll();
    const t = setInterval(poll, 2000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [refresh]);
  const page = deck?.pages.find((p) => p.id === pageId) || deck?.pages[0];
  const dirtyValue =
    (!!draft && JSON.stringify(draft) !== JSON.stringify(page?.layers)) ||
    (modeDraft !== null && modeDraft !== (page?.playbackMode || "natural")) ||
    (sequenceDraft !== null &&
      sequenceDraft !== (page?.choreography || "custom"));
  dirty.current = dirtyValue;

  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => {
      if (dirty.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", before);
    return () => window.removeEventListener("beforeunload", before);
  }, []);
  useEffect(() => {
    const listener = (e: MessageEvent) => {
      if (
        e.source === frame.current?.contentWindow &&
        e.data?.type === "motion-check"
      )
        setLayoutCheck(e.data);
      if (
        e.source === player.current &&
        e.origin === location.origin &&
        e.data?.type === "motion-edit" &&
        e.data.deckId === deck?.id
      ) {
        if (dirty.current) {
          setError("播放已暂停。请先保存或撤销当前输入，再选择播放中的页面。");
          return;
        }
        setPageId(e.data.pageId);
        setDraft(null);
        setModeDraft(null);
        setSequenceDraft(null);
        setEditingPlayback(true);
      }
      if (e.source === frame.current?.contentWindow) {
        if (e.data?.type === "motion-select") setLayerId(e.data.id);
        if (e.data?.type === "motion-audition") setAuditioning(e.data.playing);
        if (
          e.data?.type === "motion-ready" &&
          page &&
          e.data.pageId === page.id
        ) {
          setCanvasReady(true);
          frame.current?.contentWindow?.postMessage(
            {
              type: "motion-update",
              layers: draft || page.layers,
              choreography: sequenceDraft || page.choreography || "custom",
            },
            "*",
          );
        }
        if (e.data?.type === "motion-save-request") saveAction.current();
        if (
          e.data?.type === "motion-canvas-edit" &&
          page &&
          e.data.pageId === page.id &&
          deck &&
          !busy &&
          !active(deck)
        ) {
          if (!dirty.current) setBaseRevision(deck.revision);
          setDraft(
            e.data.layers.map((l: Layer) => ({
              ...l,
              ...(l.type === "image"
                ? { asset: page.layers.find((old) => old.id === l.id)?.asset }
                : {}),
            })),
          );
        }
      }
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, [deck?.id, deck?.revision, page?.id, draft, sequenceDraft, busy]);
  const changePage = (id: string) => {
    if (dirtyValue) {
      setError("请先保存当前校准，或点击撤销修改，再切换页面。");
      return;
    }
    setPageId(id);
    setDraft(null);
    setModeDraft(null);
    setSequenceDraft(null);
    setCanvasReady(false);
    setAuditioning(false);
    setLayerId("");
    setError("");
  };
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const chosen =
    scope === "selected"
      ? project.slides.filter((s) => selected.includes(s.id))
      : project.slides;
  const missing =
    sourceMode === "layered" ? [] : chosen.filter((s) => !s.image && !s.scene);
  const ready = deck?.pages.filter((p) => p.status === "ready").length || 0;
  const layers = draft || page?.layers || [];
  const layered = deck?.sourceMode === "layered";
  const sequence = sequenceDraft || page?.choreography || "custom";
  useEffect(() => {
    frame.current?.contentWindow?.postMessage(
      { type: "motion-update", layers, choreography: sequence },
      "*",
    );
  }, [layers, sequence]);
  useEffect(() => {
    frame.current?.contentWindow?.postMessage(
      { type: "motion-lock", locked: busy || active(deck) },
      "*",
    );
  }, [busy, deck?.status]);
  useEffect(() => {
    frame.current?.contentWindow?.postMessage(
      { type: "motion-select-layer", id: layerId },
      "*",
    );
  }, [layerId]);
  const signature = JSON.stringify(layers.map(({ asset: _asset, ...l }) => l));
  const checkReady =
    !!layoutCheck &&
    layoutCheck.pageId === page?.id &&
    layoutCheck.layers === signature;
  const overflow = checkReady && layoutCheck ? layoutCheck.issues : [];
  const openPlayer = (onePage = false) => {
    if (!deck) return;
    player.current = window.open(
      playerUrl + "&edit=1" + (onePage ? `&pageId=${page?.id}` : ""),
      `jianghao-play-${deck.id}`,
    );
    setEditingPlayback(false);
  };
  const current =
    layers.find((l) => l.id === layerId) ||
    layers.find((l) => l.type === "text") ||
    layers[0];
  const update = (value: Partial<Layer>) => {
    if (!current || !deck) return;
    if (!dirtyValue) setBaseRevision(deck.revision);
    const next = layers.map((l) =>
      l.id === current.id ? { ...l, ...value } : l,
    );
    setDraft(next);
  };
  const close = () => {
    if (dirtyValue) {
      setError("有尚未保存的校准，请先保存或撤销修改后关闭。");
      return;
    }
    onClose(deck?.sourceMode === "layered" ? deck.id : undefined);
  };
  const playerUrl = deck
    ? motionHtmlUrl(deck.id, html.notes, html.narration)
    : "";
  const previewUrl =
    deck && page
      ? `/api/motion/${deck.id}/html?preview=1&pageId=${page.id}&revision=${deck.revision}`
      : "";
  const save = () =>
    run(async () => {
      if (!deck || !page) return;
      if (layered && (!checkReady || overflow.length))
        throw new Error(
          overflow.length
            ? "文字超出了文本框，请缩短内容、调大文本框或手动调整字号。"
            : "正在核对排版，请稍后保存。",
        );
      const next = await patch<Deck>(`/motion/${deck.id}/pages/${page.id}`, {
        revision: dirtyValue ? baseRevision : deck.revision,
        layers,
        playbackMode: modeDraft || page.playbackMode || "natural",
        choreography: sequence,
        reviewed: true,
      });
      setDeck(next);
      setDraft(null);
      setModeDraft(null);
      setSequenceDraft(null);
      const saved = next.pages.find((p) => p.id === page.id)!;
      player.current?.postMessage(
        {
          type: "motion-saved",
          deckId: next.id,
          pageId: page.id,
          layers: saved.layers,
          playbackMode: saved.playbackMode,
          choreography: saved.choreography,
        },
        location.origin,
      );
      if (editingPlayback) setEditingPlayback(false);
    });
  saveAction.current = () => {
    if (!busy && checkReady && !overflow.length) void save();
  };
  const numeric = (
    label: string,
    key: keyof Layer,
    min: number,
    max: number,
    step = 1,
  ) => (
    <Field label={label}>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={(current?.[key] as number) ?? 0}
        onChange={(e) => update({ [key]: Number(e.target.value) })}
      />
    </Field>
  );
  return (
    <Modal
      title="编辑 PPT · 文字与动效"
      subtitle="在画面上直接改字，调整排版与动效。保存后，到演练中心开始讲。"
      wide
      onClose={close}
    >
      <div className="motion-studio">
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <div className="motion-topbar">
          {decks.length > 0 && (
            <Field label="已保存的 PPT 版本">
              <select
                aria-label="已保存的 PPT 版本"
                value={creating ? "new" : deckId}
                disabled={dirtyValue}
                onChange={(e) => {
                  if (e.target.value === "new") {
                    setCreating(true);
                    return;
                  }
                  setDeckId(e.target.value);
                  setPageId("");
                  setDraft(null);
                  setCreating(false);
                }}
              >
                {decks.map((d) => (
                  <option key={d.id} value={d.id}>
                    {new Date(d.createdAt).toLocaleString("zh-CN")} ·{" "}
                    {d.pages.length} 页 ·{" "}
                    {d.sourceMode === "layered" ? "可编辑文字" : "旧版提取"} ·{" "}
                    {statuses[d.status] || d.status}
                  </option>
                ))}
                <option value="new">创建新的演示</option>
              </select>
            </Field>
          )}
          {!creating && (
            <div className="motion-topbar-actions">
              <Button
                disabled={dirtyValue || active(deck)}
                onClick={() => setCreating(true)}
              >
                <Plus />
                新建演示
              </Button>
              {deck && (
                <>
                  <Button
                    disabled={!page || page.status !== "ready" || dirtyValue}
                    onClick={() => openPlayer(true)}
                  >
                    播放本页
                  </Button>
                  <Button
                    disabled={ready !== deck?.pages.length || dirtyValue}
                    onClick={() => openPlayer()}
                  >
                    <Play />
                    播放全部
                  </Button>
                </>
              )}
            </div>
          )}
        </div>
        {creating ? (
          <section className="motion-create">
            <div className="motion-intro">
              <FilmStrip size={36} />
              <h3>
                {sourceMode === "layered"
                  ? "制作可编辑的 PPT"
                  : "把已经完成的画面，变成可讲述的网页"}
              </h3>
              <p>
                {sourceMode === "layered"
                  ? "按当前讲稿和风格制作底图与独立文字，完成后可直接改字、调整动效。已有图片页不会自动转换；本次另存为可编辑版本。"
                  : "保留原图构图，识别文字与可动元素，复杂交叠元素留作背景。"}
              </p>
            </div>
            <Field label="制作方式">
              <select
                value={sourceMode}
                onChange={(e) =>
                  setSourceMode(e.target.value as "layered" | "extract")
                }
              >
                <option value="layered">底图 + 可编辑文字（试用）</option>
                <option value="extract">从已有图片分离图层</option>
              </select>
            </Field>
            <div className="motion-scope" role="group" aria-label="转换范围">
              <button
                className={scope === "all" ? "chosen" : ""}
                onClick={() => setScope("all")}
              >
                <strong>整个项目</strong>
                <span>{project.slides.length} 页 · 按原页序</span>
              </button>
              <button
                className={scope === "selected" ? "chosen" : ""}
                disabled={!selected.length}
                onClick={() => setScope("selected")}
              >
                <strong>选中的页面</strong>
                <span>{selected.length} 页 · 在工作台勾选页面</span>
              </button>
            </div>
            <div className="motion-explain">
              <p>
                <strong>转换与校准</strong>{" "}
                {sourceMode === "layered"
                  ? "每页先提炼文案和设计版式，再生成无字底图并检查。使用当前配置的内容与图片模型，会产生模型费用；支持停止和继续。"
                  : "每页调用视觉分析，复杂背景可能调用图片编辑。使用当前模型服务，转换可停止并继续。"}{" "}
                改字、调整动效与下载不调用模型。
              </p>
              <p>
                {sourceMode === "layered"
                  ? "内置黑体与宋体，固定字号和文字位置。长文字会提示溢出，请校对后用于正式演讲。首次使用建议只选一页测试。"
                  : "原图字体只能估计，特殊字体可导入 WOFF2；生成后请对照校对。"}
              </p>
            </div>
            {missing.length > 0 && (
              <p className="error-text">
                所选范围有 {missing.length}{" "}
                页没有图片。请补齐，或关闭窗口后只勾选已完成的页面。
              </p>
            )}
            {sourceMode !== "layered" && chosen.some((s) => s.stale) && (
              <p className="export-notice">
                部分讲稿修改后图片尚未更新。本次会转换当前保存的图片。
              </p>
            )}
            <div className="dialog-actions">
              {decks.length > 0 && (
                <Button onClick={() => setCreating(false)}>返回演示</Button>
              )}
              <Button
                variant="primary"
                loading={busy}
                disabled={!chosen.length || !!missing.length || active(deck)}
                onClick={() =>
                  run(async () => {
                    const d = await post<Deck>(
                      `/projects/${project.id}/motion`,
                      {
                        revision: project.revision,
                        sourceMode,
                        slideIds: chosen.map((s) => s.id),
                      },
                    );
                    setDeckId(d.id);
                    setDeck(d);
                    setPageId("");
                    setDraft(null);
                    setCreating(false);
                  })
                }
              >
                {sourceMode === "layered" ? "制作" : "转换"} {chosen.length} 页
              </Button>
            </div>
          </section>
        ) : (
          deck && (
            <>
              <div className="motion-progress">
                <div>
                  <strong>{deck.progress}</strong>
                  <span>
                    {ready} / {deck.pages.length} 页完成 · 原项目 v
                    {deck.sourceRevision}
                  </span>
                </div>
                {active(deck) ? (
                  <Button
                    loading={busy}
                    onClick={() => run(() => post(`/motion/${deck.id}/cancel`))}
                  >
                    <Stop />
                    停止
                  </Button>
                ) : (
                  ready < deck.pages.length && (
                    <Button
                      loading={busy}
                      onClick={() =>
                        run(() => post(`/motion/${deck.id}/retry`))
                      }
                    >
                      <ArrowsClockwise />
                      继续未完成页面
                    </Button>
                  )
                )}
              </div>
              {project.revision !== deck.sourceRevision && (
                <p className="detail-help">
                  这是转换时保存的项目快照。原项目后续修改不会自动改变这份演示。
                </p>
              )}
              <div className="motion-workbench">
                <nav className="motion-pages" aria-label="动态演示页面">
                  {deck.pages.map((p) => (
                    <button
                      key={p.id}
                      className={p.id === page?.id ? "chosen" : ""}
                      onClick={() => changePage(p.id)}
                    >
                      {(p.source.image || p.background) && (
                        <img
                          src={asset(p.source.image || p.background!)}
                          alt=""
                        />
                      )}
                      <span>
                        第 {p.number} 页{" "}
                        <small>
                          {p.reviewed
                            ? "已校对"
                            : statuses[p.status] || p.status}
                        </small>
                      </span>
                    </button>
                  ))}
                </nav>
                <section className="motion-canvas">
                  {page?.status === "ready" ? (
                    <>
                      <div className="motion-canvas-heading">
                        <strong>
                          第 {page.number} 页 · {page.title}
                        </strong>
                        {page.source.image && (
                          <label>
                            <input
                              type="checkbox"
                              checked={compare}
                              onChange={(e) => setCompare(e.target.checked)}
                            />
                            原图对照
                          </label>
                        )}
                      </div>
                      <div
                        className={`motion-previews ${compare ? "split" : ""}`}
                      >
                        {compare && page.source.image && (
                          <figure>
                            <figcaption>原图</figcaption>
                            <img
                              src={asset(page.source.image)}
                              alt="转换前的原始画面"
                            />
                          </figure>
                        )}
                        <figure>
                          <figcaption className="motion-edit-caption">
                            <span>
                              {layered
                                ? "点文字直接编辑 · 拖动手柄调整位置与范围"
                                : "点击选择要调整的图层"}
                            </span>
                            {layered && (
                              <button
                                type="button"
                                disabled={
                                  !canvasReady ||
                                  busy ||
                                  !draft ||
                                  JSON.stringify(draft) ===
                                    JSON.stringify(page.layers)
                                }
                                title="也可在画面内按 ⌘Z / Ctrl+Z"
                                onClick={() =>
                                  frame.current?.contentWindow?.postMessage(
                                    { type: "motion-undo" },
                                    "*",
                                  )
                                }
                              >
                                撤销一步
                              </button>
                            )}
                            <button
                              type="button"
                              disabled={!canvasReady || busy}
                              onClick={() =>
                                frame.current?.contentWindow?.postMessage(
                                  {
                                    type: auditioning
                                      ? "motion-stop"
                                      : "motion-replay",
                                  },
                                  "*",
                                )
                              }
                            >
                              {auditioning ? "停止试播" : "试播动效"}
                            </button>
                          </figcaption>
                          <iframe
                            key={`${deck.id}-${page.id}`}
                            ref={frame}
                            src={previewUrl}
                            title="动态页面预览"
                            sandbox="allow-scripts"
                            allow="fullscreen"
                          />
                        </figure>
                      </div>
                      <p className="detail-help">
                        {page.summary} ·{" "}
                        {layers.filter((l) => l.type === "text").length}{" "}
                        个文字层 /{" "}
                        {layers.filter((l) => l.type === "image").length}{" "}
                        个图像层
                      </p>
                      {!!page.warnings?.length && (
                        <details className="motion-warnings">
                          <summary>校对提示（{page.warnings.length}）</summary>
                          {page.warnings.map((w, i) => (
                            <p key={i}>{w}</p>
                          ))}
                        </details>
                      )}
                    </>
                  ) : (
                    <div className="motion-pending">
                      <img
                        src={page ? asset(page.source.image) : ""}
                        alt="待转换画面"
                      />
                      <strong>{page?.error || deck.progress}</strong>
                      {page?.status === "failed" && !active(deck) && (
                        <Button
                          onClick={() =>
                            run(() =>
                              post(`/motion/${deck.id}/retry`, {
                                pageIds: [page.id],
                              }),
                            )
                          }
                        >
                          只重试这一页
                        </Button>
                      )}
                    </div>
                  )}
                </section>
                {page?.status === "ready" && current && (
                  <aside className="motion-inspector">
                    <div
                      className="motion-inspector-tabs"
                      role="group"
                      aria-label="编辑选项"
                    >
                      <button
                        type="button"
                        aria-pressed={inspectorTab === "text"}
                        onClick={() => setInspectorTab("text")}
                      >
                        文字排版
                      </button>
                      <button
                        type="button"
                        aria-pressed={inspectorTab === "motion"}
                        onClick={() => setInspectorTab("motion")}
                      >
                        页面动效
                      </button>
                    </div>
                    <Field label="图层">
                      <select
                        aria-label="选择动态图层"
                        value={current.id}
                        onChange={(e) => setLayerId(e.target.value)}
                      >
                        {layers.map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.type === "text" ? "文字" : "图像"} ·{" "}
                            {(l.text || l.label || l.id).slice(0, 26)}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <div className="motion-fields-scroll">
                      {inspectorTab === "motion" && (
                        <>
                          <Field label="页面动效编排">
                            <select
                              aria-label="页面动效编排"
                              value={sequence}
                              disabled={busy || active(deck)}
                              onChange={(e) => {
                                if (!dirtyValue) setBaseRevision(deck.revision);
                                setSequenceDraft(e.target.value);
                              }}
                            >
                              {CHOREOGRAPHIES.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.name}
                                </option>
                              ))}
                            </select>
                          </Field>
                          <Field label="播放方式">
                            <select
                              value={
                                modeDraft || page.playbackMode || "natural"
                              }
                              disabled={busy || active(deck)}
                              onChange={(e) => {
                                if (!dirtyValue) setBaseRevision(deck.revision);
                                setModeDraft(e.target.value);
                              }}
                            >
                              <option value="natural">自然出场</option>
                              <option value="steps">
                                逐步讲述 · 点击下一步
                              </option>
                              <option value="whole">整页静态</option>
                            </select>
                          </Field>
                          <p className="detail-help">
                            {
                              CHOREOGRAPHIES.find((p) => p.id === sequence)
                                ?.description
                            }
                          </p>
                          <p className="detail-help">
                            按内容选择编排。试播会完整展示本页；正式播放可选择逐步讲述。
                          </p>
                        </>
                      )}
                      <fieldset
                        hidden={inspectorTab !== "text"}
                        disabled={busy || active(deck)}
                      >
                        {current.type === "text" && (
                          <>
                            {!layered && (
                              <Field label="文字">
                                <textarea
                                  value={current.text}
                                  onChange={(e) =>
                                    update({ text: e.target.value })
                                  }
                                />
                              </Field>
                            )}
                            <Field label="字体">
                              <select
                                value={current.font}
                                onChange={(e) =>
                                  update({
                                    font: e.target.value,
                                    fontWeight:
                                      e.target.value === "serif"
                                        ? current.fontWeight! >= 600
                                          ? 600
                                          : 400
                                        : current.fontWeight! >= 600
                                          ? 700
                                          : current.fontWeight === 300
                                            ? 300
                                            : 400,
                                  })
                                }
                              >
                                <option value="sans">
                                  思源黑体 / Noto Sans SC
                                </option>
                                <option value="serif">
                                  思源宋体 / Noto Serif SC
                                </option>
                                {deck.customFont && (
                                  <option value="custom">
                                    原稿字体 · {deck.customFont.name}
                                  </option>
                                )}
                              </select>
                            </Field>
                            {!layered && (
                              <label className="motion-check">
                                <input
                                  type="checkbox"
                                  checked={!!current.fit}
                                  onChange={(e) =>
                                    update({ fit: e.target.checked })
                                  }
                                />
                                按原图字形边界拟合
                              </label>
                            )}
                            <p className="detail-help">
                              {layered
                                ? "正文使用固定字号。超出边界时提示，不会自动缩小或拉伸。"
                                : "开启时按原图边界匹配宽高。手动调字号时会关闭拟合。"}
                            </p>
                            <div className="motion-fields">
                              <Field label="字号">
                                <input
                                  type="number"
                                  min="4"
                                  max={page.height}
                                  value={Number(current.fontSize?.toFixed(1))}
                                  onChange={(e) =>
                                    update({
                                      fontSize: Number(e.target.value),
                                      fit: false,
                                    })
                                  }
                                />
                              </Field>
                              {layered ? (
                                <Field label="字重">
                                  <select
                                    value={current.fontWeight}
                                    onChange={(e) =>
                                      update({
                                        fontWeight: Number(e.target.value),
                                      })
                                    }
                                  >
                                    {(current.font === "serif"
                                      ? [400, 600]
                                      : [300, 400, 700]
                                    ).map((w) => (
                                      <option key={w} value={w}>
                                        {w === 300
                                          ? "纤细"
                                          : w === 400
                                            ? "常规"
                                            : "加粗"}
                                      </option>
                                    ))}
                                  </select>
                                </Field>
                              ) : (
                                numeric("字重", "fontWeight", 100, 900, 100)
                              )}
                              <Field label="颜色">
                                <input
                                  type="color"
                                  value={current.color}
                                  onChange={(e) =>
                                    update({ color: e.target.value })
                                  }
                                />
                              </Field>
                              {numeric("字距", "letterSpacing", -20, 100, 0.1)}
                            </div>
                          </>
                        )}
                        <details className="motion-advanced">
                          <summary>位置与出场顺序</summary>
                          <div className="motion-fields">
                            {numeric("横坐标", "x", 0, page.width)}
                            {numeric("纵坐标", "y", 0, page.height)}
                            {numeric("宽度", "w", 1, page.width)}
                            {numeric("高度", "h", 1, page.height)}
                          </div>
                          <p className="detail-help">
                            移动文字只调整排版，底图保持不变。
                          </p>
                          {sequence === "custom" && (
                            <Field label="出场动效">
                              <select
                                value={current.effect}
                                onChange={(e) =>
                                  update({ effect: e.target.value })
                                }
                              >
                                {Object.entries(effects).map(([v, t]) => (
                                  <option key={v} value={v}>
                                    {t}
                                  </option>
                                ))}
                              </select>
                            </Field>
                          )}
                          <div className="motion-fields">
                            {numeric("讲述步骤", "step", 0, 30)}
                            {sequence === "custom" &&
                              numeric("延迟 ms", "delay", 0, 3000, 50)}
                            {sequence === "custom" &&
                              numeric("时长 ms", "duration", 100, 3000, 50)}
                          </div>
                        </details>
                      </fieldset>
                    </div>
                    <div className="motion-save-actions">
                      {overflow.length > 0 && (
                        <p className="error-text" role="alert">
                          文字超出边界：{overflow.join("、")}
                          。请缩短内容、扩大文本框或调整字号。
                        </p>
                      )}
                      {editingPlayback && (
                        <p className="detail-help" role="status">
                          播放已暂停。保存后回到播放窗口继续；讲稿与已有口播保持原样。
                        </p>
                      )}
                      <Button
                        variant="primary"
                        loading={busy}
                        disabled={
                          busy ||
                          active(deck) ||
                          (layered && (!checkReady || !!overflow.length))
                        }
                        onClick={save}
                      >
                        <CheckCircle />
                        {editingPlayback
                          ? "保存并更新播放页"
                          : dirtyValue
                            ? "保存修改"
                            : "保存并标记已校对"}
                      </Button>
                      {dirtyValue && (
                        <Button
                          onClick={() => {
                            setDraft(null);
                            setModeDraft(null);
                            setSequenceDraft(null);
                            setError("");
                            if (frame.current) frame.current.src = previewUrl;
                          }}
                        >
                          撤销修改
                        </Button>
                      )}
                      {!!page.history?.length && !dirtyValue && (
                        <Button
                          onClick={() =>
                            run(async () => {
                              const next = await post<Deck>(
                                `/motion/${deck.id}/pages/${page.id}/undo`,
                                { revision: deck.revision },
                              );
                              setDeck(next);
                            })
                          }
                        >
                          撤销上次保存
                        </Button>
                      )}
                    </div>
                  </aside>
                )}
              </div>
              <div className="motion-footer">
                <div>
                  <HtmlExportOptions options={html} disabled={busy} />
                  <small>
                    内嵌图片、字体与所选口播，断网可播放。选择与此动画画面和讲稿一致的音频；讲完一页自动翻页。浏览器拦截声音时，点击一次开始。
                  </small>
                </div>
                <div className="motion-footer-actions">
                  <label className="btn motion-font">
                    导入原稿字体
                    <input
                      type="file"
                      accept=".woff2"
                      disabled={busy || active(deck) || dirtyValue}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f)
                          run(async () => {
                            if (f.size > 8 * 1024 * 1024)
                              throw new Error("字体最多 8 MB");
                            try {
                              await new FontFace(
                                "Motion Upload Check",
                                await f.arrayBuffer(),
                              ).load();
                            } catch {
                              throw new Error(
                                "浏览器无法读取这个字体，请换用有效的 WOFF2 文件",
                              );
                            }
                            const body = new FormData();
                            body.append("font", f);
                            body.append("revision", String(deck.revision));
                            await api(`/motion/${deck.id}/font`, {
                              method: "POST",
                              body,
                            });
                          });
                        e.target.value = "";
                      }}
                    />
                  </label>
                  {layered && (
                    <Button
                      loading={busy}
                      disabled={ready !== deck.pages.length || dirtyValue}
                      onClick={() =>
                        run(() =>
                          downloadFile(
                            `/motion/${deck.id}/pptx`,
                            "讲好-可编辑.pptx",
                          ),
                        )
                      }
                    >
                      下载可编辑 PPTX
                    </Button>
                  )}
                  <Button
                    variant="primary"
                    loading={busy}
                    disabled={ready !== deck.pages.length || dirtyValue}
                    onClick={() =>
                      run(() =>
                        downloadMotionHtml(deck.id, html.notes, html.narration),
                      )
                    }
                  >
                    <DownloadSimple />
                    下载 HTML
                  </Button>
                </div>
              </div>
              {layered && (
                <p className="detail-help">
                  PPTX 保留底图、可编辑文字与内嵌字体；这一版动效在 HTML
                  中播放。画面文字与讲稿分别保存，改字不会自动重录口播。
                </p>
              )}
              <p className="detail-help">
                {
                  deck.pages.filter((p) => p.status === "ready" && !p.reviewed)
                    .length
                }{" "}
                页尚未标记校对。播放支持方向键、空格、触控滑动和全屏；可切换整页播放或逐步讲述。导入字体前请确认拥有嵌入与分享授权。
              </p>
            </>
          )
        )}
      </div>
    </Modal>
  );
}
