import { DeleteItem } from "./DeleteItem";
import { useEffect, useState, useRef } from "react";
import {
  Plus,
  ArrowRight,
  UploadSimple,
  Image as ImageIcon,
  Palette,
  SpinnerGap,
  CheckCircle,
  ArrowClockwise,
  X,
  FloppyDisk,
  Trash,
  LinkSimple,
  TextT,
  ArrowSquareOut,
} from "@phosphor-icons/react";
import type { Style, Job } from "./types";
import { api, post, patch, asset, active } from "./api";
import { Button, Modal, Field, StylePreview, Status } from "./components";
import { StyleStudio } from "./StyleStudio";
import { StyleVersions } from "./StyleVersions";
import { DEFAULT_STYLE_ID } from "../shared/styles.mjs";
export function StyleLibrary({
  urlImportAvailable,
  styles,
  jobs,
  refresh,
  notify,
  onUse,
}: {
  urlImportAvailable: boolean;
  styles: Style[];
  jobs: Job[];
  refresh: () => Promise<void>;
  notify: (s: string) => void;
  onUse: (id: string) => void;
}) {
  const [deleting, setDeleting] = useState<Style | null>(null);
  const [create, setCreate] = useState(false),
    [studio, setStudio] = useState<string | null>(null),
    [detail, setDetail] = useState<string | null>(null);
  const visibleStyles = styles.filter((s) => !s.deletedAt);
  const selected = visibleStyles.find((s) => s.id === detail);
  const studioStyle = visibleStyles.find((s) => s.id === studio);
  if (studioStyle)
    return (
      <StyleStudio
        key={studioStyle.id}
        style={studioStyle}
        onBack={() => setStudio(null)}
        refreshStyles={refresh}
        notify={notify}
      />
    );
  return (
    <div className="page styles-page">
      {deleting && (
        <DeleteItem
          kind="style"
          id={deleting.id}
          name={deleting.name}
          onClose={() => setDeleting(null)}
          onDeleted={refresh}
        />
      )}
      <div className="page-heading">
        <div>
          <h1>把喜欢的，变成你的风格。</h1>
          <p>
            填写提示词，或从参考图中提炼视觉语言，让不同内容拥有一致的表达。
          </p>
        </div>
        <Button variant="primary" onClick={() => setCreate(true)}>
          <Plus size={18} />
          创建风格
        </Button>
      </div>
      <div className="styles-explainer">
        <div className="reference-mini">
          <div />
          <div />
          <div>
            <Palette size={28} weight="light" />
          </div>
        </div>
        <div>
          <h2>用提示词、图片或网址，建立自己的风格库</h2>
          <p>
            配色、字体、图形画法与留白，成为适用于不同内容的设计规范。
            <br />
            用真实内容试做图片，打磨构图、字体和图形细节。
          </p>
        </div>
        <Button onClick={() => setCreate(true)}>
          <UploadSimple size={17} />
          添加风格
        </Button>
      </div>
      <div className="section-heading">
        <div>
          <h2>
            全部风格{" "}
            <span>{String(visibleStyles.length).padStart(2, "0")}</span>
          </h2>
        </div>
        <span className="muted">跨项目使用，持续积累</span>
      </div>
      <div className="style-library-grid">
        {visibleStyles.map((s) => (
          <article className="style-card" key={s.id}>
            <button
              className="card-delete"
              aria-label={`删除风格：${s.name}`}
              onClick={() => setDeleting(s)}
            >
              <Trash size={16} />
              删除
            </button>
            <button
              className="style-cover-button"
              onClick={() => setDetail(s.id)}
            >
              <StylePreview style={s} />
            </button>
            <div className="style-card-info">
              <div>
                <h3>{s.name}</h3>
                <span>
                  {s.id === DEFAULT_STYLE_ID
                    ? "默认风格"
                    : s.builtin
                      ? "内置起始风格"
                      : s.refs.length
                        ? `${s.refs.length} 张参考图`
                        : "提示词风格"}
                </span>
              </div>
              <p>{s.description}</p>
              <div className="style-card-bottom">
                <div className="swatches">
                  {s.colors.map((c, i) => (
                    <span key={i} style={{ background: c }} title={c} />
                  ))}
                </div>
                {s.status === "analyzing" ? (
                  <Status>
                    <SpinnerGap className="spin" size={14} />
                    正在提炼
                  </Status>
                ) : s.status === "error" ? (
                  <Status tone="warm">提炼未完成</Status>
                ) : (
                  <Button variant="ghost" onClick={() => setDetail(s.id)}>
                    查看风格
                    <ArrowRight size={15} />
                  </Button>
                )}
              </div>
            </div>
          </article>
        ))}
      </div>
      {create && (
        <CreateStyle
          urlImportAvailable={urlImportAvailable}
          onClose={() => setCreate(false)}
          onDone={async (s) => {
            setCreate(false);
            await refresh();
            setDetail(s.id);
            notify(
              s.status === "ready"
                ? "风格提示词已原样保存，可以直接试做。"
                : "参考图已保存，正在提炼视觉风格。",
            );
          }}
        />
      )}
      {selected && (
        <StyleDetail
          key={selected.id}
          style={selected}
          onClose={() => setDetail(null)}
          refresh={refresh}
          notify={notify}
          analyzing={
            jobs.some(
              (j) =>
                j.type === "style" &&
                j.styleId === selected.id &&
                active(j.status),
            ) || selected.status === "analyzing"
          }
          onUse={() => {
            setDetail(null);
            onUse(selected.id);
          }}
          onTest={() => {
            setDetail(null);
            setStudio(selected.id);
          }}
        />
      )}
    </div>
  );
}
function CreateStyle({
  urlImportAvailable,
  onClose,
  onDone,
}: {
  urlImportAvailable: boolean;
  onClose: () => void;
  onDone: (s: Style) => Promise<void>;
}) {
  const [name, setName] = useState(""),
    [source, setSource] = useState<"upload" | "url" | "prompt">("upload"),
    [rules, setRules] = useState(""),
    [url, setUrl] = useState(""),
    [fetching, setFetching] = useState(false),
    [imported, setImported] = useState<{
      id: string;
      url: string;
      title: string;
      skipped: number;
      truncated: boolean;
      images: { id: string; preview: string; width: number; height: number }[];
    } | null>(null),
    [selected, setSelected] = useState<string[]>([]),
    [files, setFiles] = useState<File[]>([]),
    [previews, setPreviews] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const fetchImages = async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setFetching(true);
    setError("");
    setImported(null);
    setSelected([]);
    try {
      const result = await api("/style-imports", {
        method: "POST",
        body: JSON.stringify({ url: url.trim() }),
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setImported(result);
      setName((current) =>
        current.trim() ? current : result.title.slice(0, 60),
      );
    } catch (e) {
      if (!controller.signal.aborted) setError((e as Error).message);
    } finally {
      if (request.current === controller) {
        setFetching(false);
        request.current = null;
      }
    }
  };
  const changeSource = (value: "upload" | "url" | "prompt") => {
    request.current?.abort();
    setFetching(false);
    setError("");
    setSource(value);
  };
  useEffect(() => {
    const urls = files.map((f) => URL.createObjectURL(f));
    setPreviews(urls);
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [files]);
  const add = (items: File[]) => {
    const supported = items.filter(
      (f) =>
        ["image/png", "image/jpeg", "image/webp"].includes(f.type) &&
        f.size <= 12 * 1024 * 1024,
    );
    if (supported.length !== items.length)
      setError("仅支持 12 MB 以内的 PNG、JPG 和 WebP 图片。");
    setFiles((old) => [...old, ...supported].slice(0, 12));
  };
  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      let data;
      if (source === "prompt") {
        data = await post("/styles", { name, rules });
      } else if (source === "url") {
        data = await post("/styles/from-url", {
          name,
          importId: imported?.id,
          imageIds: selected,
        });
      } else {
        const form = new FormData();
        form.append("name", name);
        files.forEach((f) => form.append("images", f));
        data = await api("/styles", { method: "POST", body: form });
      }
      await onDone(data.style);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <Modal
      title="创建你的视觉风格"
      subtitle="直接填写风格提示词，或选择参考图提炼。"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <Field label="风格名称">
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={60}
          placeholder="例如：克制的杂志感 / 大字与留白"
        />
      </Field>
      <div
        className="style-source-switch"
        role="group"
        aria-label="风格创建方式"
      >
        <button
          disabled={busy}
          aria-pressed={source === "prompt"}
          onClick={() => changeSource("prompt")}
        >
          <TextT size={17} />
          手动填写
        </button>
        <button
          disabled={busy}
          aria-pressed={source === "upload"}
          onClick={() => changeSource("upload")}
        >
          <UploadSimple size={17} />
          上传图片
        </button>
        <button
          disabled={busy || !urlImportAvailable}
          aria-pressed={source === "url"}
          onClick={() => changeSource("url")}
        >
          <LinkSimple size={17} />
          从网址获取
        </button>
      </div>
      {!urlImportAvailable && (
        <p className="url-import-hint">
          网址导入需要更新本地服务后启用，当前生成任务不受影响。
        </p>
      )}
      {source === "prompt" ? (
        <Field
          label="风格提示词"
          hint="无需参考图。提示词原样保存，不会自动改写；保存后可直接试做，后续修改保留版本。"
        >
          <textarea
            aria-label="风格提示词"
            className="rules-editor create-rules-editor"
            value={rules}
            onChange={(e) => setRules(e.target.value)}
            disabled={busy}
            maxLength={30000}
            placeholder="粘贴或填写你的完整风格提示词…"
          />
        </Field>
      ) : source === "url" ? (
        <div className="url-import">
          <Field
            label="作品网址"
            hint="支持公开作品页或图片链接。网页需要登录、验证时，可改用图片链接或上传图片。"
          >
            <div className="url-import-input">
              <input
                aria-label="作品网址"
                type="url"
                value={url}
                disabled={fetching || busy}
                placeholder="https://www.zcool.com.cn/work/…"
                onChange={(e) => {
                  setUrl(e.target.value);
                  setImported(null);
                  setSelected([]);
                  setError("");
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && url.trim() && !fetching && !busy) {
                    e.preventDefault();
                    void fetchImages();
                  }
                }}
              />
              <Button
                onClick={fetchImages}
                disabled={!url.trim() || busy}
                loading={fetching}
              >
                获取图片
              </Button>
            </div>
          </Field>
          {fetching && (
            <div className="url-import-progress" role="status">
              <span>正在读取作品和下载预览，通常需要几十秒…</span>
              <Button
                variant="ghost"
                onClick={() => {
                  request.current?.abort();
                  setFetching(false);
                }}
              >
                取消获取
              </Button>
            </div>
          )}
          {imported && (
            <>
              <a
                className="url-import-source"
                href={imported.url}
                target="_blank"
                rel="noreferrer"
              >
                {imported.title}
                <ArrowSquareOut size={16} />
              </a>
              <div className="url-import-selection">
                <strong>找到 {imported.images.length} 张图片</strong>
                <span role="status">已选 {selected.length} / 12 张</span>
              </div>
              <p className="url-import-hint">
                点击勾选要参考的图片。建议选择 3–5 张不同构图、同一风格的页面。
              </p>
              {(imported.skipped > 0 || imported.truncated) && (
                <p className="url-import-hint">
                  {imported.skipped > 0 &&
                    `已略过 ${imported.skipped} 张重复、过小或无法读取的图片。`}
                  {imported.truncated && "本次最多读取前 36 张作品图片。"}
                </p>
              )}
              <div
                className="url-import-grid"
                role="group"
                aria-label="选择风格参考图"
              >
                {imported.images.map((image, i) => (
                  <label
                    key={image.id}
                    className={selected.includes(image.id) ? "selected" : ""}
                  >
                    <img src={image.preview} alt={`作品参考图 ${i + 1}`} />
                    <span>
                      <input
                        type="checkbox"
                        aria-label={`选择第 ${i + 1} 张参考图`}
                        checked={selected.includes(image.id)}
                        disabled={
                          busy ||
                          (!selected.includes(image.id) &&
                            selected.length >= 12)
                        }
                        onChange={(e) =>
                          setSelected((current) =>
                            e.target.checked
                              ? [...current, image.id]
                              : current.filter((id) => id !== image.id),
                          )
                        }
                      />
                      <span>第 {i + 1} 张</span>
                      <small>
                        {image.width} × {image.height}
                      </small>
                    </span>
                  </label>
                ))}
              </div>
              {selected.length === 12 && (
                <p className="url-import-hint" role="status">
                  已选满 12 张，取消一张后可以更换。
                </p>
              )}
            </>
          )}
        </div>
      ) : (
        <>
          <input
            ref={input}
            className="visually-hidden"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            onChange={(e) => add(Array.from(e.target.files || []))}
          />
          <button
            className={`upload-zone ${dragging ? "dragging" : ""}`}
            onClick={() => input.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              add(Array.from(e.dataTransfer.files));
            }}
          >
            <UploadSimple size={30} weight="light" />
            <strong>拖入参考图片，或点击选择</strong>
            <span>PNG、JPG、WebP · 每张最多 12 MB · 最多 12 张</span>
          </button>
          {files.length > 0 && (
            <div className="upload-previews">
              {files.map((f, i) => (
                <div key={f.name + i}>
                  <img src={previews[i]} alt={f.name} />
                  <button
                    aria-label={`移除 ${f.name}`}
                    onClick={() => setFiles(files.filter((_, n) => n !== i))}
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      <div className="modal-actions">
        <Button onClick={onClose} disabled={busy}>
          取消
        </Button>
        <Button
          variant="primary"
          onClick={submit}
          loading={busy}
          disabled={
            !name.trim() ||
            fetching ||
            (source === "prompt"
              ? !rules.trim()
              : source === "url"
                ? !imported || !selected.length
                : !files.length)
          }
        >
          {source === "prompt" ? "保存风格" : "保存并提炼风格"}
          <ArrowRight size={17} />
        </Button>
      </div>
    </Modal>
  );
}
function StyleDetail({
  style,
  onClose,
  refresh,
  notify,
  onUse,
  analyzing,
  onTest,
}: {
  style: Style;
  onClose: () => void;
  refresh: () => Promise<void>;
  notify: (s: string) => void;
  onUse: () => void;
  analyzing: boolean;
  onTest: () => void;
}) {
  const [rules, setRules] = useState(style.rules),
    [feedback, setFeedback] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [editing, setEditing] = useState(false),
    [editBase, setEditBase] = useState(style.versionToken),
    [confirmDelete, setConfirmDelete] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!editing) setRules(style.rules);
  }, [style.rules, editing]);
  const act = async (fn: () => Promise<unknown>, message: string) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      await refresh();
      notify(message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      wide
      title={style.name}
      subtitle={
        style.builtin
          ? "内置起始规则，可以加入自己的参考图继续调试。"
          : style.refs.length
            ? `${style.refs.length} 张参考图 · 可用于你的所有演讲项目`
            : "提示词风格 · 无需参考图，可直接试做或用于演讲"
      }
      onClose={onClose}
    >
      <div className="style-detail-layout">
        <div>
          <StylePreview style={style} />
          {style.refs.length > 0 && (
            <div className="reference-grid">
              {style.refs.map((r, i) => (
                <a key={r} href={asset(r)} target="_blank" rel="noreferrer">
                  <img src={asset(r)} alt={`参考图 ${i + 1}`} />
                </a>
              ))}
            </div>
          )}
          {style.source && (
            <a
              className="url-import-source"
              href={style.source.url}
              target="_blank"
              rel="noreferrer"
            >
              参考来源：{style.source.title}
              <ArrowSquareOut size={16} />
            </a>
          )}
          <input
            ref={input}
            className="visually-hidden"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            onChange={(e) => {
              const files = Array.from(e.target.files || []);
              if (!files.length) return;
              const form = new FormData();
              files.forEach((f) => form.append("images", f));
              act(
                () =>
                  api("/styles/" + style.id + "/references", {
                    method: "POST",
                    body: form,
                  }),
                "新参考图已保存，点击重新提炼以更新规则。",
              );
            }}
          />
          <Button
            className="add-reference"
            onClick={() => input.current?.click()}
            disabled={busy || analyzing || style.refs.length >= 12}
          >
            <Plus size={17} />
            补充参考图片
          </Button>
          <div className="style-feedback">
            <h3>把风格再调近一点</h3>
            <textarea
              aria-label="风格调整要求"
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="例如：留白再多一些，减少装饰图形，数字页的对比更强。"
              disabled={analyzing}
            />
            <Button
              onClick={() =>
                act(
                  () => post("/styles/" + style.id + "/analyze", { feedback }),
                  "正在结合参考图和反馈重新提炼。",
                )
              }
              loading={busy || analyzing}
              disabled={!style.refs.length}
            >
              <ArrowClockwise size={17} />
              {analyzing ? "正在提炼风格…" : "重新提炼风格"}
            </Button>
            {!style.refs.length && (
              <p className="detail-help">
                可直接手动调整提示词。需要根据图片重新提炼时，再补充参考图片。
              </p>
            )}
          </div>
        </div>
        <div className="style-rules">
          <label className="detail-help">
            <input
              type="checkbox"
              checked={style.compositionMode === "content-led"}
              disabled={busy || analyzing || editing}
              onChange={(event) => {
                const compositionMode = event.target.checked
                  ? "content-led"
                  : "direct";
                void act(
                  () =>
                    patch("/styles/" + style.id, {
                      compositionMode,
                      expectedVersion: style.versionToken,
                    }),
                  "当前风格的构图方式已保存，下次制作时使用。",
                );
              }}
            />
            按内容构思（仅当前风格）
          </label>
          <p className="detail-help">
            开启后，每页增加一次内容模型调用，比较不同表达并做五维构思自检；批量制作参考附近页面的构图描述。方案可查看，并包含在完整提示词中。关闭则直接使用风格原文与内容出图。
          </p>
          <div className="style-rules-heading">
            <h3>{style.refs.length ? "提炼出的设计语言" : "风格提示词"}</h3>
            {!!style.rules && (
              <Button
                variant="ghost"
                onClick={() => {
                  if (!editing) setEditBase(style.versionToken);
                  setEditing(!editing);
                }}
                disabled={analyzing || busy}
              >
                {editing ? "取消编辑" : "手动调整"}
              </Button>
            )}
          </div>
          {analyzing && (
            <div className="analyzing-style">
              <SpinnerGap size={24} className="spin" />
              <p>正在观察配色、字体、构图和留白…</p>
              <span>完成后，设计规则会自动出现在这里。</span>
            </div>
          )}
          {style.error && <p className="error-text">{style.error}</p>}
          {editing ? (
            <>
              <textarea
                className="rules-editor"
                aria-label="风格设计规则"
                value={rules}
                onChange={(e) => setRules(e.target.value)}
              />
              {editBase !== style.versionToken && (
                <div>
                  <p className="error-text">
                    正式提示词已有更新，你的输入仍保留。请在下方版本记录中比较，再确认继续编辑。
                  </p>
                  <Button
                    disabled={busy}
                    onClick={() => {
                      setEditBase(style.versionToken);
                      setError("");
                    }}
                  >
                    已比较，继续编辑
                  </Button>
                </div>
              )}
              <Button
                onClick={() =>
                  act(async () => {
                    try {
                      await patch("/styles/" + style.id, {
                        rules,
                        expectedVersion: editBase,
                      });
                    } catch (error) {
                      await refresh();
                      throw error;
                    }
                    setEditing(false);
                  }, "风格规则已保存，上一版可在提示词版本中恢复。")
                }
                loading={busy}
              >
                <FloppyDisk size={16} />
                保存规则
              </Button>
            </>
          ) : style.rules ? (
            <div className="rules-text">{style.rules}</div>
          ) : (
            !analyzing && (
              <p className="muted">
                参考图已保存。点击“重新提炼风格”获取设计规则。
              </p>
            )
          )}
          <StyleVersions
            style={style}
            disabled={editing || busy || analyzing}
            blockedReason={
              editing ? "先保存或取消当前编辑，再恢复历史版本。" : undefined
            }
            onRestored={async (_saved, changed) => {
              await refresh();
              notify(
                changed
                  ? "已恢复并保存为新版本。"
                  : "当前内容已一致，无需恢复。",
              );
            }}
          />
        </div>
      </div>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {!!style.rules && (
        <p className="detail-help">
          保存后的设计语言将原文用于出图；只有主动重新提炼才会改写。
        </p>
      )}
      <div className="modal-actions">
        <Button
          variant="ghost"
          disabled={busy || analyzing}
          onClick={() => setConfirmDelete(!confirmDelete)}
        >
          <Trash size={17} />
          删除风格
        </Button>
        <Button disabled={!style.rules || analyzing || busy} onClick={onUse}>
          用此风格新建项目
        </Button>
        <Button
          variant="primary"
          disabled={!style.rules || analyzing || busy}
          onClick={onTest}
        >
          打开风格试做
          <ArrowRight size={17} />
        </Button>
      </div>
      {confirmDelete && (
        <div className="inline-notice warm delete-style-confirm">
          <div>
            <strong>删除「{style.name}」？</strong>
            <p>
              会从风格库移除。已有页面、讲稿和历史版本保留；使用它的项目需另选风格才能继续制作。
            </p>
          </div>
          <Button disabled={busy} onClick={() => setConfirmDelete(false)}>
            取消
          </Button>
          <Button
            variant="danger"
            loading={busy}
            onClick={() =>
              act(async () => {
                await api("/styles/" + style.id, { method: "DELETE" });
                onClose();
              }, "风格已删除，已有页面和历史版本已保留。")
            }
          >
            确认删除风格
          </Button>
        </div>
      )}
    </Modal>
  );
}
