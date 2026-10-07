import { useCallback, useEffect, useRef, useState } from "react";
import type { Narration } from "./speech-types";
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
};
type Deck = {
  id: string;
  title: string;
  sourceRevision: number;
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
  ready: "已转换",
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
  onClose,
}: {
  project: Project;
  selected: string[];
  onClose: () => void;
}) {
  const [decks, setDecks] = useState<Deck[]>([]),
    [deckId, setDeckId] = useState(""),
    [deck, setDeck] = useState<Deck | null>(null);
  const [creating, setCreating] = useState(false),
    [scope, setScope] = useState(selected.length ? "selected" : "all"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [pageId, setPageId] = useState(""),
    [notes, setNotes] = useState(false);
  const [draft, setDraft] = useState<Layer[] | null>(null),
    [baseRevision, setBaseRevision] = useState(0),
    [layerId, setLayerId] = useState(""),
    [compare, setCompare] = useState(true);
  const [previewHtml, setPreviewHtml] = useState<string | undefined>(undefined);
  const [narrations, setNarrations] = useState<Narration[]>([]),
    [narration, setNarration] = useState("");
  useEffect(() => {
    api<Narration[]>(`/projects/${project.id}/narration`)
      .then((list) => setNarrations(list.filter((n) => n.status === "ready")))
      .catch(() => {});
  }, [project.id]);
  const frame = useRef<HTMLIFrameElement>(null),
    dirty = useRef(false);
  const refresh = useCallback(async () => {
    const data = await api<Deck[]>(`/projects/${project.id}/motion`);
    setDecks(data);
    const current =
      data.find((d) => d.id === deckId) || (!deckId ? data[0] : null);
    setDeck(current || null);
    if (!deckId && current) setDeckId(current.id);
    if (!data.length) setCreating(true);
  }, [project.id, deckId]);
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
    !!draft && JSON.stringify(draft) !== JSON.stringify(page?.layers);
  dirty.current = dirtyValue;
  useEffect(() => {
    if (!draft || !deck || !page) {
      setPreviewHtml(undefined);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/motion/${deck.id}/pages/${page.id}/preview`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ layers: draft }),
            signal: controller.signal,
          },
        );
        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || "预览失败");
        }
        const html = await response.text();
        if (!controller.signal.aborted) setPreviewHtml(html);
      } catch (e) {
        if (!controller.signal.aborted) setError((e as Error).message);
      }
    }, 450);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [draft, deck?.id, page?.id]);

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
        e.data?.type === "motion-select"
      )
        setLayerId(e.data.id);
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, []);
  const changePage = (id: string) => {
    if (dirtyValue) {
      setError("请先保存当前校准，或点击撤销修改，再切换页面。");
      return;
    }
    setPageId(id);
    setDraft(null);
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
  const missing = chosen.filter((s) => !s.image && !s.scene);
  const ready = deck?.pages.filter((p) => p.status === "ready").length || 0;
  const layers = draft || page?.layers || [];
  const current =
    layers.find((l) => l.id === layerId) ||
    layers.find((l) => l.type === "text") ||
    layers[0];
  const update = (value: Partial<Layer>) => {
    if (!current || !deck) return;
    if (!draft) setBaseRevision(deck.revision);
    const next = layers.map((l) =>
      l.id === current.id ? { ...l, ...value } : l,
    );
    setDraft(next);
    frame.current?.contentWindow?.postMessage(
      { type: "motion-update", layers: next },
      "*",
    );
  };
  const close = () => {
    if (dirtyValue) {
      setError("有尚未保存的校准，请先保存或撤销修改后关闭。");
      return;
    }
    onClose();
  };
  const playerUrl = deck
    ? `/api/motion/${deck.id}/html?notes=${notes ? "1" : "0"}&narration=${encodeURIComponent(narration)}`
    : "";
  const previewUrl =
    deck && page
      ? `/api/motion/${deck.id}/html?preview=1&pageId=${page.id}&revision=${deck.revision}`
      : "";
  const save = () =>
    run(async () => {
      if (!deck || !page) return;
      const next = await patch<Deck>(`/motion/${deck.id}/pages/${page.id}`, {
        revision: draft ? baseRevision : deck.revision,
        layers,
        reviewed: true,
      });
      setDeck(next);
      setDraft(null);
    });
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
      title="动态 HTML 演示"
      subtitle="分离文字与画面，让讲述按自己的节奏展开。转换结果独立保存。"
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
            <Field label="已保存的演示">
              <select
                aria-label="已保存的动态演示"
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
                    {d.pages.length} 页 · {statuses[d.status] || d.status}
                  </option>
                ))}
                <option value="new">创建新的演示</option>
              </select>
            </Field>
          )}
          {!creating && (
            <Button
              disabled={dirtyValue || active(deck)}
              onClick={() => setCreating(true)}
            >
              <Plus />
              新建转换
            </Button>
          )}
        </div>
        {creating ? (
          <section className="motion-create">
            <div className="motion-intro">
              <FilmStrip size={36} />
              <h3>把已经完成的画面，变成可讲述的网页</h3>
              <p>
                保留原图构图，文字还原为
                HTML；可分离的照片、插图和图形独立出现，复杂交叠元素留作背景。
              </p>
            </div>
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
                每页调用一次视觉分析；复杂背景可能再调用一次图片编辑。费用由当前模型服务收取，转换可停止并继续。播放、调整动效与下载不调用模型。
              </p>
              <p>
                字号、字重、颜色和位置从原图估计，内嵌字体保证离线显示一致。特殊字体可导入
                WOFF2；生成后请对照原图校对，再用于正式演讲。
              </p>
            </div>
            {missing.length > 0 && (
              <p className="error-text">
                所选范围有 {missing.length}{" "}
                页没有图片。请补齐，或关闭窗口后只勾选已完成的页面。
              </p>
            )}
            {chosen.some((s) => s.stale) && (
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
                转换 {chosen.length} 页
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
                      <img src={asset(p.source.image)} alt="" />
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
                        <label>
                          <input
                            type="checkbox"
                            checked={compare}
                            onChange={(e) => setCompare(e.target.checked)}
                          />
                          原图对照
                        </label>
                      </div>
                      <div
                        className={`motion-previews ${compare ? "split" : ""}`}
                      >
                        {compare && (
                          <figure>
                            <figcaption>原图</figcaption>
                            <img
                              src={asset(page.source.image)}
                              alt="转换前的原始画面"
                            />
                          </figure>
                        )}
                        <figure>
                          <figcaption>
                            HTML 还原 · 点击文字可选中校准
                          </figcaption>
                          <iframe
                            key={`${deck.id}-${page.id}`}
                            ref={frame}
                            src={previewUrl}
                            srcDoc={previewHtml}
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
                    <fieldset disabled={busy || active(deck)}>
                      {current.type === "text" && (
                        <>
                          <Field label="文字">
                            <textarea
                              value={current.text}
                              onChange={(e) => update({ text: e.target.value })}
                            />
                          </Field>
                          <Field label="字体">
                            <select
                              value={current.font}
                              onChange={(e) => update({ font: e.target.value })}
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
                          <p className="detail-help">
                            开启时按原图边界匹配宽高。手动调字号时会关闭拟合。
                          </p>
                          <div className="motion-fields">
                            <Field label="字号">
                              <input
                                type="number"
                                min="4"
                                max={page.height}
                                value={current.fontSize}
                                onChange={(e) =>
                                  update({
                                    fontSize: Number(e.target.value),
                                    fit: false,
                                  })
                                }
                              />
                            </Field>
                            {numeric("字重", "fontWeight", 100, 900, 100)}
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
                      <div className="motion-fields">
                        {numeric("横坐标", "x", 0, page.width)}
                        {numeric("纵坐标", "y", 0, page.height)}
                        {numeric("宽度", "w", 1, page.width)}
                        {numeric("高度", "h", 1, page.height)}
                      </div>
                      <p className="detail-help">
                        移动图层不会重修底图；底图清理范围以初次识别为准。
                      </p>
                      <Field label="出场动效">
                        <select
                          value={current.effect}
                          onChange={(e) => update({ effect: e.target.value })}
                        >
                          {Object.entries(effects).map(([v, t]) => (
                            <option key={v} value={v}>
                              {t}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <div className="motion-fields">
                        {numeric("讲述步骤", "step", 0, 30)}
                        {numeric("延迟 ms", "delay", 0, 3000, 50)}
                        {numeric("时长 ms", "duration", 100, 3000, 50)}
                      </div>
                      <Button variant="primary" loading={busy} onClick={save}>
                        <CheckCircle />
                        保存并标记已校对
                      </Button>
                      {dirtyValue && (
                        <Button
                          onClick={() => {
                            setDraft(null);
                            setError("");
                            if (frame.current) frame.current.src = previewUrl;
                          }}
                        >
                          撤销修改
                        </Button>
                      )}
                    </fieldset>
                  </aside>
                )}
              </div>
              <div className="motion-footer">
                <div>
                  <label className="motion-check">
                    <input
                      type="checkbox"
                      checked={notes}
                      onChange={(e) => setNotes(e.target.checked)}
                    />
                    HTML 包含演讲备注
                  </label>
                  <Field label="HTML 口播版本">
                    <select
                      value={narration}
                      onChange={(e) => setNarration(e.target.value)}
                    >
                      <option value="">仅画面，不包含口播</option>
                      {narrations.map((n) => (
                        <option key={n.id} value={n.id}>
                          {n.voiceName} · 项目版本 {n.sourceRevision} ·{" "}
                          {new Date(n.createdAt).toLocaleString("zh-CN")}
                        </option>
                      ))}
                    </select>
                  </Field>
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
                  <Button
                    disabled={!page || page.status !== "ready" || dirtyValue}
                    onClick={() =>
                      window.open(
                        playerUrl + `&pageId=${page?.id}`,
                        "_blank",
                        "noopener",
                      )
                    }
                  >
                    播放本页
                  </Button>
                  <Button
                    disabled={ready !== deck.pages.length || dirtyValue}
                    onClick={() => window.open(playerUrl, "_blank", "noopener")}
                  >
                    <Play />
                    播放全部
                  </Button>
                  <Button
                    variant="primary"
                    loading={busy}
                    disabled={ready !== deck.pages.length || dirtyValue}
                    onClick={() =>
                      run(() =>
                        downloadFile(
                          playerUrl + "&download=1",
                          "动态演示.html",
                        ),
                      )
                    }
                  >
                    <DownloadSimple />
                    下载 HTML
                  </Button>
                </div>
              </div>
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
