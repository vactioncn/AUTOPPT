// Local, explicitly supplied assets only; never imports the store or model clients.
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { textRemoval } from "../server/motion/pixels.mjs";
import {
  embeddedFontLibrary,
  normalizeFont,
} from "../site/editable-text-lab/fonts.mjs";

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
if (!process.argv[2])
  throw new Error(
    "Usage: node scripts/build-editable-text-lab.mjs /absolute/path/case.json",
  );
const configPath = path.resolve(process.argv[2]);
const config = JSON.parse(await fs.readFile(configPath, "utf8"));
const root = path.dirname(configPath);
const out = path.resolve(root, config.output || "output");
const paths = config.cases?.map((p) => path.resolve(root, p)) || [configPath];
const ids = new Set(),
  pages = [],
  reports = [];
await fs.mkdir(out, { recursive: true });
for (const [index, p] of paths.entries()) {
  const c = JSON.parse(await fs.readFile(p, "utf8")),
    dir = path.dirname(p);
  const originalPath = path.resolve(dir, c.original),
    generatedPath = path.resolve(dir, c.generated);
  if (out === path.dirname(originalPath) || out === path.dirname(generatedPath))
    throw new Error("Use a separate output directory");
  const id = c.id || `case-${index + 1}`;
  if (!/^[a-z0-9-]+$/.test(id) || ids.has(id))
    throw new Error("Invalid or repeated case ID");
  ids.add(id);
  const originalBytes = await fs.readFile(originalPath),
    before = crypto.createHash("sha256").update(originalBytes).digest("hex");
  const { data, info } = await sharp(originalBytes)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const generatedMeta = await sharp(generatedPath).metadata();
  if (
    Math.abs(generatedMeta.width / generatedMeta.height - width / height) > 0.03
  )
    throw new Error("Repair changed aspect ratio");
  const repair = await sharp(generatedPath)
    .resize(width, height, { fit: "fill" })
    .ensureAlpha()
    .raw()
    .toBuffer();
  const pixels = Buffer.from(data),
    mask = new Uint8Array(width * height);
  if (!Array.isArray(c.layers) || !c.layers.length)
    throw new Error("Case needs text layers");
  const layerIds = new Set();
  for (const l of c.layers) {
    if (
      !/^[\w-]+$/.test(l.id) ||
      layerIds.has(l.id) ||
      typeof l.text !== "string" ||
      !l.text.length ||
      ![l.x, l.y, l.w, l.h, l.fontSize, l.maxWidth, l.fontWeight].every(
        Number.isFinite,
      ) ||
      l.fontSize <= 0 ||
      l.maxWidth <= 0 ||
      l.fontWeight < 100 ||
      l.fontWeight > 900 ||
      l.x < 0 ||
      l.y < 0 ||
      l.w <= 0 ||
      l.h <= 0 ||
      l.x + l.w > width ||
      l.y + l.h > height ||
      !/^#[\da-f]{6}$/i.test(l.color)
    )
      throw new Error("Invalid layer geometry, type or color");
    layerIds.add(l.id);
    Object.assign(l, normalizeFont(l.font, l.fontWeight));
    l.originalTypography = {
      font: l.font,
      fontWeight: l.fontWeight,
      layout: "matched",
    };
    const removal = textRemoval(data, width, height, l),
      b = removal.box;
    for (let y = 0; y < b.height; y++)
      for (let x = 0; x < b.width; x++)
        if (removal.mask[y * b.width + x])
          mask[(b.top + y) * width + b.left + x] = 1;
  }
  let editedPixels = 0;
  for (let i = 0; i < mask.length; i++)
    if (mask[i]) {
      editedPixels++;
      repair.copy(pixels, i * 4, i * 4, i * 4 + 4);
    }
  const background = await sharp(pixels, { raw: info })
    .removeAlpha()
    .png()
    .toBuffer();
  const encoded = await sharp(background).ensureAlpha().raw().toBuffer();
  let outsideDifferences = 0;
  for (let i = 0; i < mask.length; i++)
    if (
      !mask[i] &&
      !data
        .subarray(i * 4, i * 4 + 4)
        .equals(encoded.subarray(i * 4, i * 4 + 4))
    )
      outsideDifferences++;
  if (outsideDifferences)
    throw new Error("Encoded background changed pixels outside mask");
  await fs.writeFile(path.join(out, `${id}-background.png`), background);
  const originalPng = await sharp(originalBytes).png().toBuffer();
  pages.push({
    id,
    title: c.title || "先讲故事",
    styleName: c.styleName || "水墨书卷",
    description:
      c.description ||
      `${c.layers.length} 个独立文字层，保留原图艺术字与装饰。`,
    sample: c.sample || {
      id: c.layers[0].id,
      text: c.layers[0].text.replace("一分钟", "两分钟"),
    },
    width,
    height,
    layers: c.layers,
    original: `data:image/png;base64,${originalPng.toString("base64")}`,
    background: `data:image/png;base64,${background.toString("base64")}`,
  });
  const after = crypto
    .createHash("sha256")
    .update(await fs.readFile(originalPath))
    .digest("hex");
  if (before !== after) throw new Error("Source changed during build");
  reports.push({
    id,
    width,
    height,
    sourceSha256: before,
    sourceUnchanged: true,
    editableTextLayers: c.layers.length,
    repairMaskPixels: editedPixels,
    repairMaskRatio: editedPixels / (width * height),
    unchangedPixels: width * height - editedPixels,
    outsideMaskDifferences: outsideDifferences,
  });
}
const { css, fonts, licenses } = await embeddedFontLibrary();
const deck = {
  pages,
  fonts,
  fontLicenses: licenses,
  activePageId: config.activePageId || pages[0].id,
};
const script = await fs.readFile(
  path.join(repo, "site/editable-text-lab/editor.js"),
  "utf8",
);
let html = await fs.readFile(
  path.join(repo, "site/editable-text-lab/index.template.html"),
  "utf8",
);
html = html
  .replace("__FONT_CSS__", () => css)
  .replaceAll("__WIDTH__", String(pages[0].width))
  .replaceAll("__HEIGHT__", String(pages[0].height))
  .replace("__DECK__", () => JSON.stringify(deck).replaceAll("<", "\\u003c"))
  .replace("__SCRIPT__", () => script);
await fs.writeFile(path.join(out, "index.html"), html);
await fs.writeFile(
  path.join(out, "FONT-LICENSE.txt"),
  licenses.map((l) => `${l.font}\n${l.text}`).join("\n\n"),
);
await fs.writeFile(
  path.join(out, "font-manifest.json"),
  JSON.stringify(fonts, null, 2),
);
await fs.writeFile(
  path.join(out, "layers.json"),
  JSON.stringify(
    { pages: pages.map(({ original, background, ...p }) => p) },
    null,
    2,
  ),
);
await fs.writeFile(
  path.join(root, "verification.json"),
  JSON.stringify(
    {
      cases: reports,
      scope:
        "Manually measured examples; not automatic extraction or whole-project acceptance",
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify(
    { output: path.join(out, "index.html"), cases: reports },
    null,
    2,
  ),
);
