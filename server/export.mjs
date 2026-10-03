import pptxgen from "pptxgenjs";
import JSZip from "jszip";
import sharp from "sharp";
import { readFile } from "node:fs/promises";
import { assetPath } from "./store.mjs";
import { renderSceneSvg } from "../shared/slides.mjs";
import { speakerNotes, exportManuscript } from "./manuscript.mjs";

const WIDTH = 40 / 3;
const HEIGHT = 7.5;

export function exportFilename(title) {
  const name = String(title || "")
    .replace(/[\x00-\x1f\x7f<>:"/\\|?*]/g, "_")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, 100);
  return `${name || "演讲"}.pptx`;
}

export { exportManuscript } from "./manuscript.mjs";

export async function exportBundle(project, options) {
  const ppt = await exportPresentation(project, options);
  const zip = new JSZip();
  const stem = exportFilename(project.title).slice(0, -5);
  zip.file(`${stem}.pptx`, ppt, { compression: "STORE" });
  zip.file(
    `${stem}-逐字稿-v${project.revision ?? 0}.md`,
    exportManuscript(project),
  );
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

async function pageImage(page) {
  // Match preview source priority. Retained web scenes are flattened once.
  let data = page.scene
    ? await sharp(
        Buffer.from(
          renderSceneSvg(page.scene).replace(
            'width="100%" height="100%"',
            'width="1600" height="900"',
          ),
        ),
      )
        .png()
        .toBuffer()
    : await readFile(assetPath(page.image));
  let meta = await sharp(data).metadata();
  // Preserve original PNG/JPEG bytes and resolution. Convert WebP and bake
  // in EXIF rotation for compatibility with PowerPoint and Keynote.
  if (
    !["png", "jpeg"].includes(meta.format) ||
    (meta.orientation && meta.orientation !== 1)
  ) {
    data = await sharp(data).rotate().png().toBuffer();
    meta = await sharp(data).metadata();
  }
  if (!meta.width || !meta.height) throw new Error("无法读取图片尺寸");
  return { data, ...meta };
}

export async function exportPresentation(project, { allowStale = false } = {}) {
  const unsegmented = project.batches?.filter((b) => !b.slideIds?.length) || [];
  if (unsegmented.length)
    throw new Error(
      `还有 ${unsegmented.length} 段逐字稿尚未完成内容拆分，请先继续这些段落，避免导出时遗漏原文。`,
    );
  if (!project.slides.length)
    throw new Error("先添加一段逐字稿，生成页面后再导出。");
  const missing = project.slides.flatMap((s, i) =>
    !s.scene && !s.image ? [i + 1] : [],
  );
  if (missing.length)
    throw new Error(
      `还有 ${missing.length} 页未完成（第 ${missing.join("、")} 页），请先完成制作再导出。`,
    );
  if (!allowStale && project.slides.some((s) => s.stale))
    throw Object.assign(
      new Error(
        "部分页面的讲稿已修改，图片尚未更新。请在导出窗口确认使用当前图片与最新备注。",
      ),
      { status: 409 },
    );

  const pptx = new pptxgen();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "AutoPPT";
  pptx.title = project.title;
  pptx.subject = "整页图片与逐字稿备注逐页对应";
  pptx.lang = "zh-CN";
  for (const [index, page] of project.slides.entries()) {
    let image;
    try {
      image = await pageImage(page);
    } catch {
      throw new Error(
        `第 ${index + 1} 页的图片无法读取，请检查图片文件或重新制作这一页后再导出。`,
      );
    }
    const slide = pptx.addSlide();
    slide.background = { color: "FFFFFF" };
    const scale = Math.min(WIDTH / image.width, HEIGHT / image.height);
    const w = image.width * scale,
      h = image.height * scale;
    slide.addImage({
      data: `image/${image.format};base64,${image.data.toString("base64")}`,
      x: (WIDTH - w) / 2,
      y: (HEIGHT - h) / 2,
      w,
      h,
      altText: page.plan?.title || `第 ${index + 1} 页`,
      objectName: `整页图片 ${index + 1}`,
    });
    slide.addNotes(speakerNotes(page));
  }
  return pptx.write({ outputType: "nodebuffer", compression: true });
}
