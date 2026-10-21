import { useState } from "react";
import { ArrowLeft, ArrowRight, ArrowSquareOut } from "@phosphor-icons/react";
import { STYLE_SHOWCASE } from "../shared/style-showcase.mjs";
import {
  STYLE_SAMPLE_PAGES,
  STYLE_SAMPLE_VERSION,
} from "../shared/style-sample-suite.mjs";
import { BUILTIN_STYLE_COVERS } from "../shared/styles.mjs";
import { asset } from "./api";
import { Button, Modal } from "./components";
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

export function StyleGallery({
  style,
  onClose,
  initialExampleId,
  onUse,
}: {
  style: Style;
  initialExampleId?: string;
  onClose: () => void;
  onUse: () => void;
}) {
  const examples = styleExamples(style);
  const standardSuite =
    examples.length === 8 &&
    examples.every((example) => example.number && example.notes);
  const [index, setIndex] = useState(() =>
    Math.max(
      0,
      examples.findIndex((e) => e.id === initialExampleId),
    ),
  );
  const current = examples[Math.min(index, examples.length - 1)];
  const step = (delta: number) =>
    setIndex((index + delta + examples.length) % examples.length);
  return (
    <Modal
      wide
      className="style-gallery-modal"
      title={style.name}
      subtitle={styleDescription(style)}
      onClose={onClose}
    >
      <div className="style-gallery-body">
        <div className="style-gallery-intro">
          <h3>
            {standardSuite
              ? "一篇产品介绍，八种页面表达"
              : "同一种风格，不同的表达"}
          </h3>
          <p>
            {examples.length > 1
              ? standardSuite
                ? "从封面到行动，用完整的「讲好」介绍，看看这个风格怎样讲完一场演讲。"
                : `${examples.length} 个效果示例 · 点击缩略图，看看不同内容怎样呈现。`
              : "先看看整体视觉，更多页面样例正在准备中。"}
          </p>
        </div>
        {current ? (
          <>
            <figure className="style-gallery-stage">
              <a
                href={current.src}
                target="_blank"
                rel="noreferrer"
                aria-label={`查看大图：${current.title}`}
              >
                <img src={current.src} alt={current.title} />
                <span>
                  <ArrowSquareOut size={16} /> 查看大图
                </span>
              </a>
              <figcaption aria-live="polite">
                <div>
                  <span>
                    {current.number && `${current.number} · `}
                    {current.expression}
                  </span>
                  <strong>{current.title}</strong>
                </div>
                <span>
                  {index + 1} / {examples.length}
                </span>
              </figcaption>
            </figure>
            {examples.length > 1 && (
              <>
                <div className="style-gallery-navigation">
                  <Button onClick={() => step(-1)}>
                    <ArrowLeft size={16} /> 上一个示例
                  </Button>
                  <Button onClick={() => step(1)}>
                    下一个示例 <ArrowRight size={16} />
                  </Button>
                </div>
                <div
                  className="style-gallery-thumbnails"
                  aria-label="风格效果示例"
                >
                  {examples.map((example, i) => (
                    <button
                      key={example.id}
                      aria-pressed={index === i}
                      onClick={() => setIndex(i)}
                    >
                      <img
                        src={example.thumbnail}
                        alt={example.title}
                        loading="lazy"
                      />
                      <span>
                        {example.number && `${example.number} `}
                        {example.expression}
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}
            {current.notes && (
              <details className="style-gallery-manuscript">
                <summary>阅读本页讲稿</summary>
                <p>{current.notes}</p>
              </details>
            )}
          </>
        ) : (
          <div className="style-gallery-empty">
            这个风格的效果示例正在准备中。
          </div>
        )}
      </div>
      <footer className="style-gallery-footer">
        <p>画面会随你的内容重新设计。</p>
        <Button
          variant="primary"
          disabled={!style.canUse && !style.rules?.trim()}
          onClick={onUse}
        >
          使用这个风格 <ArrowRight size={18} />
        </Button>
      </footer>
    </Modal>
  );
}
