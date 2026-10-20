import pptxgen from "pptxgenjs";
import JSZip from "jszip";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { assetPath } from "../store.mjs";
import { validateLayers } from "../../shared/motion/schema.mjs";

const xml = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[c],
  );
const relType =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
export function nativeFace(layer) {
  const weight = layer.fontWeight;
  if (layer.font === "sans" && [300, 400, 700].includes(weight))
    return {
      family: weight === 300 ? "Jianghao Sans Light" : "Jianghao Sans",
      slot: weight === 700 ? "bold" : "regular",
    };
  if (layer.font === "serif" && [400, 600].includes(weight))
    return {
      family: "Jianghao Serif",
      slot: weight === 600 ? "bold" : "regular",
    };
  throw new Error(
    "PPTX 字体内嵌支持黑体 300/400/700、宋体 400/600。请调整字重；自定义字体暂不支持内嵌。",
  );
}

export async function exportLayeredPptx(
  deck,
  fontDir = process.env.AUTOPPT_PPTX_FONT_DIR,
) {
  if (!fontDir)
    throw new Error(
      "尚未配置完整 PPTX 字体包。请按说明准备字体并设置 AUTOPPT_PPTX_FONT_DIR；HTML 导出可正常使用。",
    );
  if (
    deck.sourceMode !== "layered" ||
    !deck.pages.length ||
    deck.pages.some((p) => p.status !== "ready")
  )
    throw new Error("请先完成分层页面制作");
  const pack = JSON.parse(
    await readFile(path.join(fontDir, "manifest.json"), "utf8"),
  );
  if (pack.version !== 1) throw new Error("字体包版本无效");
  const ppt = new pptxgen();
  ppt.layout = "LAYOUT_WIDE";
  ppt.author = "讲好";
  ppt.subject = "底图与可编辑文字；动效请使用 HTML 播放";
  ppt.title = deck.title;
  const used = new Map();
  for (const p of deck.pages) {
    const slide = ppt.addSlide();
    slide.addImage({
      path: assetPath(p.background),
      x: 0,
      y: 0,
      w: 40 / 3,
      h: 7.5,
    });
    const k = 7.5 / p.height;
    for (const l of validateLayers(p.layers, p.width, p.height)) {
      const box = {
        x: (l.x / p.width) * (40 / 3),
        y: l.y * k,
        w: (l.w / p.width) * (40 / 3),
        h: l.h * k,
        rotate: l.rotation,
      };
      if (l.type === "image") {
        slide.addImage({ ...box, path: assetPath(l.asset) });
        continue;
      }
      if (l.fit)
        throw new Error("PPTX 分层导出使用自然字号，请关闭字形拉伸拟合");
      const face = nativeFace(l),
        key = `${face.family}:${face.slot}`;
      const record = pack.fonts.find(
        (f) => f.family === face.family && f.slot === face.slot,
      );
      if (
        !record ||
        !/^font-\d+\.fntdata$/.test(record.file) ||
        !record.license?.includes("SIL OPEN FONT LICENSE")
      )
        throw new Error("字体包缺少授权或字体：" + key);
      const chars = new Set(record.characters);
      const missing = [
        ...new Set(
          [...l.text].filter(
            (c) => !/\s/.test(c) && !chars.has(c.codePointAt(0)),
          ),
        ),
      ];
      if (missing.length)
        throw new Error("内嵌字体缺少这些字符：" + missing.join(""));
      used.set(key, record);
      slide.addText(l.text, {
        ...box,
        fontFace: face.family,
        bold: face.slot === "bold",
        fontSize: l.fontSize * k * 72,
        color: l.color.slice(1),
        align: l.align,
        valign: "top",
        margin: 0,
        breakLine: false,
        lineSpacingMultiple: l.lineHeight,
        charSpacing: l.letterSpacing * k * 72,
        paraSpaceAfter: 0,
        isTextBox: true,
        objectName: l.id,
      });
    }
    slide.addNotes(p.source.notes || "");
  }
  const zip = await JSZip.loadAsync(
    await ppt.write({ outputType: "nodebuffer" }),
  );
  let relationships = await zip
    .file("ppt/_rels/presentation.xml.rels")
    .async("string");
  const groups = new Map();
  let counter = 0,
    licenses = "";
  for (const record of used.values()) {
    const bytes = await readFile(path.join(fontDir, record.file));
    if (createHash("sha256").update(bytes).digest("hex") !== record.sha256)
      throw new Error("字体包校验失败，请重新准备");
    if (
      bytes.length < 100 ||
      bytes.readUInt32LE(0) !== bytes.length ||
      bytes.readUInt16LE(34) !== 0x504c
    )
      throw new Error("字体包格式错误");
    const rid = `rIdLayeredFont${++counter}`,
      file = `fonts/jianghao-${counter}.fntdata`;
    zip.file(`ppt/${file}`, bytes);
    relationships = relationships.replace(
      "</Relationships>",
      `<Relationship Id="${rid}" Type="${relType}/font" Target="${file}"/></Relationships>`,
    );
    groups.set(
      record.family,
      (groups.get(record.family) || "") + `<p:${record.slot} r:id="${rid}"/>`,
    );
    licenses += `<font family="${xml(record.family)}">${xml(record.license)}</font>`;
  }
  relationships = relationships.replace(
    "</Relationships>",
    `<Relationship Id="rIdLayeredLicense" Type="${relType}/customXml" Target="customXml/jianghao-font-licenses.xml"/></Relationships>`,
  );
  zip.file("ppt/_rels/presentation.xml.rels", relationships);
  zip.file(
    "ppt/customXml/jianghao-font-licenses.xml",
    `<fontLicenses xmlns="urn:jianghao:embedded-fonts:v1">${licenses}</fontLicenses>`,
  );
  const entries = [...groups]
    .map(
      ([family, faces]) =>
        `<p:embeddedFont><p:font typeface="${xml(family)}"/>${faces}</p:embeddedFont>`,
    )
    .join("");
  let presentation = await zip.file("ppt/presentation.xml").async("string");
  presentation = presentation.replace(/<p:presentation\b[^>]*>/, (root) =>
    root
      .replace(/\s+(?:embedTrueTypeFonts|saveSubsetFonts)="[^"]*"/g, "")
      .replace(
        /<p:presentation\b/,
        '<p:presentation embedTrueTypeFonts="1" saveSubsetFonts="0"',
      ),
  );
  presentation = presentation.replace(
    /(?=<p:(?:custShowLst|photoAlbum|custDataLst|kinsoku|defaultTextStyle|modifyVerifier|extLst)\b|<\/p:presentation>)/,
    `<p:embeddedFontLst>${entries}</p:embeddedFontLst>`,
  );
  zip.file("ppt/presentation.xml", presentation);
  zip.file(
    "[Content_Types].xml",
    (await zip.file("[Content_Types].xml").async("string")).replace(
      "</Types>",
      '<Default Extension="fntdata" ContentType="application/x-fontdata"/></Types>',
    ),
  );
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
