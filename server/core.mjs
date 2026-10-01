import { styleRecipes } from "../shared/image-style.mjs";
import { createHash } from "node:crypto";

// Compiler revisions invalidate derived language, not the user's approved style record.
export const STYLE_LANGUAGE_VERSION = 4;
export const styleLanguageKey = (style) =>
  `language-v${STYLE_LANGUAGE_VERSION}-` + styleStamp(style).fingerprint;

// Store the exact style version used for a plan/image, independently of project selection.
export function styleStamp(style, plan = null) {
  return {
    id: style.id,
    name: style.name,
    fingerprint: createHash("sha256")
      .update(
        JSON.stringify([
          5,
          style.id,
          style.name,
          style.rules,
          style.colors,
          styleRecipes(style),
          ...(style.compositionMode === "content-led"
            ? ["content-led-v1"]
            : []),
        ]),
      )
      .digest("hex"),
    updatedAt: style.updatedAt,
    designRefs: [],
    renderer: "image-rules-v1",
    // Style reference images stay in analysis. Content attachments are tracked on the plan.
    imageRefs: [],
  };
}

/** Source boundaries are UTF-16 offsets, matching the browser's selectionStart. */
export function sentences(text) {
  const parts =
    text.match(
      /[^。！？!?\n]+[。！？!?]+[”’」』）)]*\s*|[^\n]+\n+|[^\n]+$/gu,
    ) || [];
  if (parts.join("") !== text) {
    const pieces = [];
    let from = 0;
    for (let i = 0; i < text.length; i++)
      if (/[。！？!?\n]/.test(text[i])) {
        let end = i + 1;
        while (
          end < text.length &&
          /[。！？!?\n\r\t ”’」』）)]/.test(text[end])
        )
          end++;
        pieces.push(text.slice(from, end));
        from = end;
        i = end - 1;
      }
    if (from < text.length) pieces.push(text.slice(from));
    return pieces;
  }
  return parts;
}
export function splitAt(text, cuts) {
  if (!Array.isArray(cuts) || cuts.length < 1)
    throw new Error("请至少插入一个分界。");
  const sorted = [...cuts].sort((a, b) => a - b);
  if (
    sorted.some(
      (n, i) =>
        !Number.isInteger(n) ||
        n <= 0 ||
        n >= text.length ||
        (i && n === sorted[i - 1]) ||
        (/[\uD800-\uDBFF]/.test(text[n - 1]) &&
          /[\uDC00-\uDFFF]/.test(text[n])),
    )
  )
    throw new Error("分界位置无效，请重新选择。");
  const ends = [0, ...sorted, text.length];
  const parts = ends.slice(0, -1).map((a, i) => text.slice(a, ends[i + 1]));
  if (parts.some((p) => !p.trim()))
    throw new Error("每页都需要有讲稿，不能只包含空格。");
  if (parts.join("") !== text) throw new Error("分界校验失败，原文未修改。");
  return parts;
}
export function unitsFromEnds(parts, ends) {
  if (
    !Array.isArray(ends) ||
    !ends.length ||
    ends.at(-1) !== parts.length ||
    ends.some(
      (v, i) =>
        !Number.isInteger(v) ||
        v < 1 ||
        v > parts.length ||
        (i > 0 && v <= ends[i - 1]),
    )
  )
    throw new Error("模型返回的内容分界不完整，请重试；原文已保存。");
  let start = 0;
  return ends.map((end) => {
    const raw = parts.slice(start, end).join("");
    start = end;
    return raw;
  });
}
export function orderedSelection(slides, ids) {
  if (!Array.isArray(ids) || ids.length < 2 || new Set(ids).size !== ids.length)
    throw new Error("请至少选择两页。");
  const indexes = ids
    .map((id) => slides.findIndex((s) => s.id === id))
    .sort((a, b) => a - b);
  if (
    indexes[0] < 0 ||
    indexes.some((n, i) => i > 0 && n !== indexes[i - 1] + 1)
  )
    throw new Error("请选择相邻页面合并，以保持演讲原文的顺序。");
  return indexes.map((i) => slides[i]);
}
export function checkPlan(raw) {
  if (
    !raw ||
    typeof raw.title !== "string" ||
    !raw.title.trim() ||
    typeof raw.layout !== "string" ||
    !raw.layout.trim() ||
    !Array.isArray(raw.displayText) ||
    raw.displayText.some((x) => typeof x !== "string")
  )
    throw new Error("画面方案格式不完整，请重试。");
  return {
    title: raw.title,
    displayText: raw.displayText,
    layout: raw.layout,
    visual: String(raw.visual || ""),
    rationale: String(raw.rationale || ""),
  };
}
export function snapshot(slide) {
  return {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    notes: slide.notes,
    attachments: slide.attachments || [],
    manuscriptVersion: slide.manuscriptVersion,
    plan: slide.plan,
    image: slide.image,
    scene: slide.scene,
    styleId: slide.styleId,
    planStyle: slide.planStyle,
    imageStyle: slide.imageStyle,
    review: slide.review,
    reviewError: slide.reviewError,
    stale: !!slide.stale,
  };
}
