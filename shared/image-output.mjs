export const IMAGE_OUTPUT_SIZE = "2560x1440";
export const IMAGE_CANVAS_PROMPT =
  "【成品画幅】\n生成横向 16:9 演讲幻灯片，宽 2560、高 1440 像素。画布比例是交付要求；风格中的书页、封面或海报意象在横向画布内重新构图，不能把成品改为竖图或方图。";

export function isSlideAspect(width, height) {
  return (
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    width > 0 &&
    height > 0 &&
    Math.abs(width / height / (16 / 9) - 1) <= 0.01
  );
}
