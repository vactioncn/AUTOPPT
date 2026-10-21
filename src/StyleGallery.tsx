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
  // A complete published suite replaces the built-in suite, never appends to it.
  const published = style.examples || [];
  const complete = STYLE_SAMPLE_PAGES.every((page) =>
    published.some((example) => example.pageId === page.id),
  );
  const examples: GalleryExample[] = complete
    ? STYLE_SAMPLE_PAGES.map((page) => {
        const example = published.find(
          (example) => example.pageId === page.id,
        )!;
        return {
          id: example.id,
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
  onUse,
  onManage,
  onTest,
}: {
  style: Style;
  initialExampleId?: string;
  onClose: () => void;
  onUse: () => void;
  onManage?: () => void;
  onTest?: () => void;
}) {
  const examples = styleExamples(style);
  const [index, setIndex] = useState(() =>
    Math.max(
      0,
      examples.findIndex((example) => example.id === initialExampleId),
    ),
  );
  const currentIndex = Math.min(index, Math.max(0, examples.length - 1));
  const current = examples[currentIndex];
  const strip = useRef<HTMLDivElement>(null);
  const back = useRef<HTMLButtonElement>(null);
  const title = shortStyleNames[style.name] || style.name;
  const canUse = !!(style.canUse || style.rules?.trim());
  const step = (delta: number) => {
    if (examples.length > 1)
      setIndex((currentIndex + delta + examples.length) % examples.length);
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
          <Button
            variant="primary"
            className="style-gallery-use"
            disabled={!canUse}
            onClick={onUse}
          >
            使用这个风格 <ArrowRight size={20} />
          </Button>
          <p className="style-gallery-use-hint">
            {canUse
              ? "画面会随你的内容重新设计。"
              : "这个风格尚未准备好，请先查看其他风格。"}
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
                onClick={() => setIndex(i)}
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
