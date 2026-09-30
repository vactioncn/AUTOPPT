import pptxgen from "pptxgenjs";
import sharp from "sharp";
import { assetPath } from "./store.mjs";
import { validateScene } from "../shared/slides.mjs";
const inch = (v) => v / 120;
const color = (v) => v.replace("#", "");
export async function exportPresentation(project) {
  const unsegmented = project.batches?.filter((b) => !b.slideIds?.length) || [];
  if (unsegmented.length)
    throw new Error(
      `还有 ${unsegmented.length} 段逐字稿尚未完成内容拆分，请先继续这些段落，避免导出时遗漏原文。`,
    );
  if (!project.slides.length)
    throw new Error("先添加一段逐字稿，生成页面后再导出。");
  const missing = project.slides.filter((s) => !s.scene && !s.image);
  if (missing.length)
    throw new Error(`还有 ${missing.length} 页未完成，请先完成制作再导出。`);
  const pptx = new pptxgen();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "AutoPPT";
  pptx.title = project.title;
  pptx.subject = "可编辑页面与逐字稿逐页对应";
  pptx.lang = "zh-CN";
  for (const page of project.slides) {
    const slide = pptx.addSlide();
    if (page.scene) {
      const scene = validateScene(page.scene);
      slide.background = { color: color(scene.background) };
      for (const e of scene.elements) {
        const box = {
          x: inch(e.x),
          y: inch(e.y),
          w: inch(e.w),
          h: inch(e.h),
          objectName: e.id,
        };
        if (e.type === "text")
          slide.addText(e.lines.join("\n"), {
            ...box,
            fontFace: e.fontFace,
            fontSize: e.fontSize * 0.6,
            bold: e.bold,
            color: color(e.color),
            align: e.align,
            margin: 0,
            breakLine: false,
            paraSpaceAfter: 0,
            lineSpacingMultiple: 1.22,
            valign: "top",
            isTextBox: true,
          });
        else if (e.type === "chart")
          slide.addChart(
            e.chartType === "line" ? pptx.ChartType.line : pptx.ChartType.bar,
            [{ name: e.unit || "数值", labels: e.labels, values: e.values }],
            {
              ...box,
              catAxisLabelFontFace: e.fontFace,
              catAxisLabelFontSize: 14,
              valAxisLabelFontSize: 12,
              chartColors: [color(e.color)],
              showLegend: false,
              showValue: true,
              showTitle: false,
              showCatName: false,
              dataLabelFormatCode: e.unit
                ? `0.##"${e.unit.replaceAll('"', "")}"`
                : "0.##",
              catAxisLabelColor: color(e.foreground),
              valAxisLabelColor: color(e.foreground),
              dataLabelColor: color(e.foreground),
              dataLabelPosition: "outEnd",
              showBorder: false,
              showMarker: true,
              lineSize: 2,
            },
          );
        else
          slide.addShape(
            e.type === "ellipse"
              ? pptx.ShapeType.ellipse
              : e.type === "line"
                ? pptx.ShapeType.line
                : e.radius
                  ? pptx.ShapeType.roundRect
                  : pptx.ShapeType.rect,
            {
              ...box,
              rectRadius: inch(e.radius || 0),
              flipH: !!e.flipH,
              fill: e.fill
                ? { color: color(e.fill) }
                : { color: color(scene.background), transparency: 100 },
              line: {
                color: color(e.stroke),
                width: e.strokeWidth * 0.6,
                transparency: e.strokeWidth ? 0 : 100,
                ...(e.arrow ? { endArrowType: "triangle" } : {}),
              },
            },
          );
      }
    } else {
      const image = assetPath(page.image),
        meta = await sharp(image).metadata(),
        ratio = meta.width / meta.height;
      let w = 13.333333,
        h = 7.5;
      if (ratio > 16 / 9) h = w / ratio;
      else w = h * ratio;
      slide.addImage({
        path: image,
        x: (13.333333 - w) / 2,
        y: (7.5 - h) / 2,
        w,
        h,
      });
    }
    slide.addNotes(page.notes);
  }
  return pptx.write({ outputType: "nodebuffer" });
}
