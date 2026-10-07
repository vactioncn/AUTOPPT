// Compare manuscript history; this does not infer whether an image is correct.
export function visualReviewReason(slide) {
  const previous = [...(slide.versions || [])]
    .reverse()
    .find(
      (v) =>
        !v.stale &&
        (slide.image
          ? v.image === slide.image
          : v.scene && JSON.stringify(v.scene) === JSON.stringify(slide.scene)),
    );
  if (!previous)
    return {
      kind: "unknown",
      before: null,
      reason:
        "讲稿曾被修改，缺少画面生成时的可比原稿。请对照当前画面和讲稿人工核对。",
    };
  const normalize = (s) =>
    String(s || "").replace(/\*\*|__|[\s\u200b\ufeff]/g, "");
  const formatting = normalize(previous.notes) === normalize(slide.notes);
  return {
    kind: formatting ? "formatting" : "content",
    before: previous.notes,
    reason: formatting
      ? "仅检测到换行、空格或加粗格式变化，通常可以保留当前画面。"
      : "讲稿文字有变化。请确认画面中的观点、数字和文字是否仍然适用。",
  };
}
