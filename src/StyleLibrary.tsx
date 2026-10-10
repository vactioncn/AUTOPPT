import { PageNumberHelp } from "./PageNumberHelp";
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
import type { Style, Job, StyleContext } from "./types";
import { api, post, patch, asset, active } from "./api";
import { Button, Modal, Field, StylePreview, Status } from "./components";
import { StyleStudio } from "./StyleStudio";
import { StyleVersions } from "./StyleVersions";
import { StyleAnalysis } from "./StyleAnalysis";
import { StyleContextFields } from "./StyleContextFields";
import { StylePromptResults } from "./StylePromptResults";
import { DEFAULT_STYLE_ID } from "../shared/styles.mjs";
import "./style-detail.css";
export function StyleLibrary({
  promptRepair = false,
  onReturn,
  urlImportAvailable,
  styles,
  jobs,
  refresh,
  notify,
  onUse,
}: {
  promptRepair?: boolean;
  onReturn?: (styleId?: string) => void;
  urlImportAvailable: boolean;
  styles: Style[];
  jobs: Job[];
  refresh: () => Promise<void>;
  notify: (s: string) => void;
  onUse: (id: string) => void;
}) {
  const [deleting, setDeleting] = useState<Style | null>(null);
  const [repairedStyle, setRepairedStyle] = useState<string>();
  const [create, setCreate] = useState(promptRepair),
    [studio, setStudio] = useState<string | null>(null),
    [detail, setDetail] = useState<string | null>(null);
  useEffect(() => {
    setCreate(promptRepair);
    if (!promptRepair) setRepairedStyle(undefined);
  }, [promptRepair]);
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
      {onReturn && (
        <Button onClick={() => onReturn(repairedStyle)}>返回新建演讲</Button>
      )}
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
            分析参考图背后的设计系统，生成同源但不同形的完整提示词；不同风格分别提炼。
            <br />
            用现成示例或自己的内容试做；使用统一文案单独生成风格封面。
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
      {!visibleStyles.length && (
        <section className="onboarding-card" aria-label="风格库空状态">
          <h2>从第一个风格开始</h2>
          <p>
            打开创建表单，填写风格提示词并保存即可使用；无需先调用模型。也可以按需上传参考图。
          </p>
          <Button variant="primary" onClick={() => setCreate(true)}>
            创建第一个风格
          </Button>
        </section>
      )}
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
          initialSource={
            promptRepair || !styles.some((s) => !s.deletedAt && s.rules?.trim())
              ? "prompt"
              : "upload"
          }
          urlImportAvailable={urlImportAvailable}
          onClose={() => setCreate(false)}
          onDone={async (s) => {
            setCreate(false);
            await refresh();
            if (promptRepair && onReturn) setRepairedStyle(s.id);
            else if (promptRepair) onUse(s.id);
            else setDetail(s.id);
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
          analysisStage={
            jobs.find(
              (j) =>
                j.type === "style" &&
                j.styleId === selected.id &&
                active(j.status),
            )?.stage
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
  initialSource,
  urlImportAvailable,
  onClose,
  onDone,
}: {
  urlImportAvailable: boolean;
  onClose: () => void;
  onDone: (s: Style) => Promise<void>;
  initialSource: "upload" | "prompt";
}) {
  const [name, setName] = useState(""),
    [source, setSource] = useState<"upload" | "url" | "prompt">(initialSource),
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
  const [context, setContext] = useState<StyleContext>({});
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
          analysisContext: context,
        });
      } else {
        const form = new FormData();
        form.append("name", name);
        form.append("analysisContext", JSON.stringify(context));
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
      subtitle="上传参考图，提炼设计系统，再用完整提示词创作新的页面。也可手动填写。"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <Field
        label={
          source === "prompt" ? "风格名称" : "风格名称（可选，留空自动命名）"
        }
      >
        <input
          autoFocus
          value={name}
          disabled={busy}
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
      {source !== "prompt" && (
        <p className="detail-help">
          先逐图分析，再判断共同视觉
          DNA、页面类型与风格分组，为每组生成完整提示词。可继续追加图片，或上传含多页缩略图的展示图。
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
            disabled={busy}
          />
          <button
            className={`upload-zone ${dragging ? "dragging" : ""}`}
            disabled={busy}
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
                    disabled={busy}
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
      {source !== "prompt" && (
        <>
          <StyleContextFields
            value={context}
            onChange={setContext}
            disabled={busy}
          />
          <p className="detail-help">
            分析将调用一次视觉模型，再为每组调用一次内容模型生成提示词，费用由所配置服务商计算。不会自动生成图片；完成后可主动试做。
          </p>
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
            (source === "prompt" && !name.trim()) ||
            fetching ||
            (source === "prompt"
              ? !rules.trim()
              : source === "url"
                ? !imported || !selected.length
                : !files.length)
          }
        >
          {source === "prompt" ? "保存风格" : "分析视觉风格"}
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
  analysisStage,
  onTest,
}: {
  style: Style;
  onClose: () => void;
  refresh: () => Promise<void>;
  notify: (s: string) => void;
  onUse: () => void;
  analyzing: boolean;
  analysisStage?: string;
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
  const [context, setContext] = useState<StyleContext>(
    style.analysisContext || {},
  );
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
      className="style-detail-modal"
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
      <div className="style-detail-content">
        <div className="style-detail-layout">
          <div
            className="style-reference-panel"
            role="region"
            aria-label="参考图与风格调整"
            tabIndex={0}
          >
            {style.refs.length === 1 && !style.cover && !style.builtin ? (
              <a
                className="style-reference-open"
                href={asset(style.refs[0])}
                target="_blank"
                rel="noreferrer"
                aria-label="查看参考图 1 大图"
              >
                <StylePreview style={style} />
                <span>
                  查看大图 <ArrowSquareOut size={14} />
                </span>
              </a>
            ) : (
              <StylePreview style={style} />
            )}
            {(style.refs.length > 1 ||
              (style.builtin && style.refs.length > 0) ||
              (style.cover && style.cover !== style.refs[0])) && (
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
              <StyleContextFields
                value={context}
                onChange={setContext}
                disabled={busy || analyzing}
              />
              {!style.refs.length && (
                <p className="detail-help">
                  可直接手动调整提示词。需要根据图片重新提炼时，再补充参考图片。
                </p>
              )}
              {!!style.refs.length && (
                <p className="detail-help">
                  重新分析会调用视觉与内容模型，不会自动生成图片。原提示词保留版本，失败时保留当前规则。
                </p>
              )}
            </div>
          </div>
          <div
            className="style-rules"
            role="region"
            aria-label="风格提示词与分析"
            tabIndex={0}
          >
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
                <p>{analysisStage || "正在逐图分析视觉特点…"}</p>
                <span>判断图片关系后，将为每个独立风格生成完整提示词。</span>
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
              </>
            ) : style.rules ? (
              style.styleAnalysis?.styles?.length ? (
                <StylePromptResults
                  style={style}
                  disabled={busy || analyzing}
                  notify={notify}
                  onApply={(candidate) =>
                    void act(
                      () =>
                        patch(`/styles/${style.id}`, {
                          analysisStyleId: candidate.id,
                          analysisId: style.styleAnalysis?.id,
                          expectedVersion: style.versionToken,
                        }),
                      "这组完整提示词已保存为当前风格，上一版可恢复。",
                    )
                  }
                />
              ) : (
                <>
                  <Button
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(style.rules);
                        notify("提示词已复制。");
                      } catch {
                        notify("无法访问剪贴板，请选中文字复制。");
                      }
                    }}
                  >
                    复制完整提示词
                  </Button>
                  <div className="rules-text">{style.rules}</div>
                </>
              )
            ) : (
              !analyzing && (
                <p className="muted">
                  参考图已保存。点击“重新提炼风格”获取设计规则。
                </p>
              )
            )}
            <StyleAnalysis style={style} />
            <PageNumberHelp rules={editing ? rules : style.rules || ""} />
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
      </div>
      <div className="style-detail-footer">
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
          <div className="style-detail-secondary-actions">
            <Button
              variant="ghost"
              disabled={busy || analyzing}
              onClick={() => setConfirmDelete(!confirmDelete)}
            >
              <Trash size={17} />
              删除风格
            </Button>
            {editing ? (
              <Button
                variant="primary"
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
                disabled={
                  analyzing || !rules.trim() || editBase !== style.versionToken
                }
              >
                <FloppyDisk size={16} />
                保存规则
              </Button>
            ) : (
              <Button
                onClick={() =>
                  act(
                    () =>
                      post("/styles/" + style.id + "/analyze", {
                        feedback,
                        analysisContext: context,
                      }),
                    "正在结合参考图和反馈重新提炼。",
                  )
                }
                loading={busy || analyzing}
                disabled={!style.refs.length}
              >
                <ArrowClockwise size={17} />
                {analyzing ? "正在提炼风格…" : "重新提炼风格"}
              </Button>
            )}
          </div>
          <div className="style-detail-primary-actions">
            <Button
              disabled={!style.rules || analyzing || busy || editing}
              onClick={onUse}
            >
              用此风格新建项目
            </Button>
            <Button
              variant={editing ? "secondary" : "primary"}
              disabled={!style.rules || analyzing || busy || editing}
              onClick={onTest}
            >
              生成一页 demo / 调试风格
              <ArrowRight size={17} />
            </Button>
          </div>
        </div>
      </div>
      {confirmDelete && (
        <Modal
          title={`删除「${style.name}」？`}
          onClose={() => setConfirmDelete(false)}
        >
          <div>
            <p>
              会从风格库移除。已有页面、讲稿和历史版本保留；使用它的项目需另选风格才能继续制作。
            </p>
          </div>
          <div className="modal-actions">
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
        </Modal>
      )}
    </Modal>
  );
}
