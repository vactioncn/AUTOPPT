import { useState } from "react";
import { ArrowLeft, ArrowRight, ArrowSquareOut } from "@phosphor-icons/react";
import { STYLE_SHOWCASE } from "../shared/style-showcase.mjs";
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

export function styleExamples(style: Style) {
  const showcase = STYLE_SHOWCASE.find(
    (item) => item.styleId === (style.catalogSourceId || style.id),
  );
  const examples =
    showcase?.pages.map((page) => ({
      ...page,
      src: `/style-showcase/${page.id}.webp`,
      thumbnail: `/style-showcase/${page.id}-small.webp`,
    })) || [];
  // Only explicitly published examples belong in the customer gallery.
  // References and private trials may contain unfinished or private material.
  for (const example of style.examples || [])
    examples.push({
      ...example,
      src: asset(example.image),
      thumbnail: asset(example.image),
    });
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
          <h3>同一种风格，不同的表达</h3>
          <p>
            {examples.length > 1
              ? `${examples.length} 个效果示例 · 点击缩略图，看看不同内容怎样呈现。`
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
                  <span>{current.expression}</span>
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
                      <span>{example.expression}</span>
                    </button>
                  ))}
                </div>
              </>
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
