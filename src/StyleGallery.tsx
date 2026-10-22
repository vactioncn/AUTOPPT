import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowSquareOut,
  CaretDown,
} from "@phosphor-icons/react";
import { STYLE_SHOWCASE } from "../shared/style-showcase.mjs";
import {
  STYLE_SAMPLE_PAGES,
  STYLE_SAMPLE_VERSION,
} from "../shared/style-sample-suite.mjs";
import { BUILTIN_STYLE_COVERS } from "../shared/styles.mjs";
import { asset } from "./api";
import { Button } from "./components";
import type { Style } from "./types";
import "./style-gallery.css";

export function styleDescription(style: Style) {
  return (
    STYLE_SHOWCASE.find(
      (item) => item.styleId === (style.catalogSourceId || style.id),
    )?.description ||
    (/提示词|提炼|参考图/.test(style.description)
      ? "浏览效果示例，看看是否适合你的演讲。"
      : style.description)
  );
}

type GalleryExample = {
  id: string;
  pageId?: string;
  title: string;
  expression: string;
  src: string;
  thumbnail: string;
  number?: string;
  notes?: string;
};
export function styleExamples(style: Style): GalleryExample[] {
  const showcase = STYLE_SHOWCASE.find(
    (item) => item.styleId === (style.catalogSourceId || style.id),
  );
  // A partial administrator suite is browsable too. Keep canonical page
  // numbers and manuscripts even when a middle page has not finished yet.
  const published = style.examples || [];
  const standardPages = STYLE_SAMPLE_PAGES.filter((page) =>
    published.some((example) => example.pageId === page.id),
  );
  const examples: GalleryExample[] = standardPages.length
    ? standardPages.map((page) => {
        const example = published.find(
          (example) => example.pageId === page.id,
        )!;
        return {
          id: example.id,
          pageId: page.id,
          title: page.title,
          expression: page.type,
          number: page.number,
          notes: page.notes,
          src: asset(example.image),
          thumbnail: asset(example.image),
        };
      })
    : published.length
      ? published.map((example) => ({
          ...example,
          src: asset(example.image),
          thumbnail: asset(example.image),
        }))
      : showcase && !style.catalogSourceId
        ? STYLE_SAMPLE_PAGES.map((page) => ({
            id: `${showcase.id}-${page.id}`,
            pageId: page.id,
            title: page.title,
            expression: page.type,
            number: page.number,
            notes: page.notes,
            src: `/style-samples-v${STYLE_SAMPLE_VERSION}/${showcase.id}-${page.id}.webp`,
            thumbnail: `/style-samples-v${STYLE_SAMPLE_VERSION}/${showcase.id}-${page.id}-small.webp`,
          }))
        : [];
  if (!examples.length) {
    const cover = style.cover
      ? asset(style.cover)
      : BUILTIN_STYLE_COVERS[style.catalogSourceId || style.id];
    if (cover)
      examples.push({
        id: "cover",
        title: style.name,
        expression: "风格封面",
        src: cover,
        thumbnail: cover,
      });
  }
  return examples;
}

const shortPageNames: Record<string, string> = {
  封面页: "封面",
  核心观点页: "观点",
  多要点框架页: "框架",
  数据图表页: "数据",
  流程步骤页: "流程",
  对比分析页: "对比",
  案例故事页: "故事",
  总结行动页: "行动",
};
const shortStyleNames: Record<string, string> = {
  克制儿童摄影杂志风: "儿童摄影",
  先锋酸性色彩编辑风: "先锋",
  日系现代建筑提案风: "日系现代",
  "当代 Neo-Swiss": "当代 NEO",
};

export function StyleGallery({
  style,
  onClose,
  initialExampleId,
  onExampleChange,
  onUse,
  onManage,
  onTest,
}: {
  style: Style;
  initialExampleId?: string;
  onExampleChange?: (pageId: string) => void;
  onClose: () => void;
  onUse?: () => void;
  onManage?: () => void;
  onTest?: () => void;
}) {
  const examples = styleExamples(style);
  const [selectedId, setSelectedId] = useState(() => {
    const initial =
      examples.find(
        (example) =>
          example.id === initialExampleId ||
          example.pageId === initialExampleId,
      ) || examples[0];
    return initial?.pageId || initial?.id;
  });
  const currentIndex = Math.max(
    0,
    examples.findIndex(
      (example) => (example.pageId || example.id) === selectedId,
    ),
  );
  const current = examples[currentIndex];
  const currentKey = current?.pageId || current?.id;
  useEffect(() => {
    if (currentKey) onExampleChange?.(currentKey);
  }, [currentKey, onExampleChange]);
  const strip = useRef<HTMLDivElement>(null);
  const back = useRef<HTMLButtonElement>(null);
  const title = shortStyleNames[style.name] || style.name;
  const canUse = !!(style.canUse || style.rules?.trim());
  const step = (delta: number) => {
    if (examples.length > 1) {
      const next =
        examples[(currentIndex + delta + examples.length) % examples.length];
      setSelectedId(next.pageId || next.id);
    }
  };

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
    back.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const container = strip.current;
    const selected = container?.querySelector<HTMLElement>(
      '[aria-pressed="true"]',
    );
    if (!container || !selected) return;
    const item = selected.getBoundingClientRect();
    const area = container.getBoundingClientRect();
    // Scroll only this horizontal strip, never pull the main preview off screen.
    if (item.left < area.left) container.scrollLeft += item.left - area.left;
    else if (item.right > area.right)
      container.scrollLeft += item.right - area.right;
  }, [currentIndex]);

  return (
    <section
      className="style-gallery-page"
      aria-label={`风格详情：${style.name}`}
      onKeyDown={(event) => {
        if (
          event.altKey ||
          event.ctrlKey ||
          event.metaKey ||
          event.shiftKey ||
          (event.target as HTMLElement).closest(
            "input, textarea, select, [contenteditable=true]",
          )
        )
          return;
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault();
          step(event.key === "ArrowLeft" ? -1 : 1);
        }
      }}
    >
      <button className="style-gallery-back" ref={back} onClick={onClose}>
        <ArrowLeft size={20} /> 返回风格库
      </button>
      <div className="style-gallery-layout">
        <div className="style-gallery-viewer">
          {current ? (
            <>
              <figure className="style-gallery-stage">
                <a
                  href={current.src}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`查看大图：${current.title}`}
                >
                  <img
                    key={current.src}
                    src={current.src}
                    alt={current.title}
                  />
                  <span>
                    <ArrowSquareOut size={16} /> 查看大图
                  </span>
                </a>
              </figure>
              <div className="style-gallery-caption">
                <p aria-live="polite" aria-atomic="true">
                  <strong>
                    {current.number ||
                      String(currentIndex + 1).padStart(2, "0")}{" "}
                    · {current.expression}
                  </strong>
                  <span className="style-gallery-sr-only">
                    ，{current.title}
                  </span>
                </p>
                <div className="style-gallery-navigation" aria-label="样例翻页">
                  <Button
                    variant="ghost"
                    onClick={() => step(-1)}
                    disabled={examples.length < 2}
                    aria-label="上一个示例"
                    title="上一个示例（左方向键）"
                  >
                    <ArrowLeft size={20} />
                  </Button>
                  <span>
                    {String(currentIndex + 1).padStart(2, "0")} /{" "}
                    {String(examples.length).padStart(2, "0")}
                  </span>
                  <Button
                    variant="ghost"
                    onClick={() => step(1)}
                    disabled={examples.length < 2}
                    aria-label="下一个示例"
                    title="下一个示例（右方向键）"
                  >
                    <ArrowRight size={20} />
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <div className="style-gallery-empty">
              这个风格的效果示例正在准备中。
            </div>
          )}
        </div>
        <aside className="style-gallery-info">
          <h1>{title}</h1>
          {title !== style.name && (
            <p className="style-gallery-full-name">{style.name}</p>
          )}
          <p className="style-gallery-description">{styleDescription(style)}</p>
          {style.samplePreview && (
            <p className="style-gallery-use-hint" role="status">
              已生成 {examples.length} / 8 页样例，可直接浏览。
              {style.catalogAvailable
                ? "发布后客户才会看到这些样例。"
                : "已有页面会保留，其他页面完成后自动出现。"}
            </p>
          )}
          <Button
            variant="primary"
            className="style-gallery-use"
            disabled={!onUse}
            onClick={onUse}
          >
            使用这个风格 <ArrowRight size={20} />
          </Button>
          <p className="style-gallery-use-hint">
            {onUse
              ? style.samplePreview
                ? "新项目使用已发布版本；当前新样例仅供管理员预览。"
                : "画面会随你的内容重新设计。"
              : onManage
                ? "发布后才能用于新项目，可在高级设置中继续完善。"
                : "这个风格暂不可用于新项目，请选择已发布风格。"}
          </p>
          {current?.notes && (
            <details className="style-gallery-manuscript" key={current.id}>
              <summary>
                阅读本页讲稿 <CaretDown size={18} />
              </summary>
              <p>{current.notes}</p>
            </details>
          )}
          {(onManage || onTest) && (
            <div className="style-gallery-admin">
              {onManage && (
                <Button variant="ghost" onClick={onManage}>
                  高级设置
                </Button>
              )}
              {onTest && (
                <Button variant="ghost" disabled={!canUse} onClick={onTest}>
                  试做一页
                </Button>
              )}
            </div>
          )}
        </aside>
        {examples.length > 1 && (
          <div
            className="style-gallery-thumbnails"
            ref={strip}
            role="group"
            aria-label="风格效果示例"
          >
            {examples.map((example, i) => (
              <button
                key={example.id}
                aria-pressed={currentIndex === i}
                aria-label={`${example.number || String(i + 1).padStart(2, "0")} ${example.expression}：${example.title}`}
                title={example.title}
                onClick={() => setSelectedId(example.pageId || example.id)}
              >
                <img src={example.thumbnail} alt="" loading="lazy" />
                <span>
                  <span>
                    {example.number || String(i + 1).padStart(2, "0")}
                  </span>
                  {shortPageNames[example.expression] || example.expression}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
