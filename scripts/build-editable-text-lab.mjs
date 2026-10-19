// Local, explicitly supplied assets only; never imports the store or model clients.
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { textRemoval } from "../server/motion/pixels.mjs";

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const configPath = path.resolve(process.argv[2] || "");
if (!process.argv[2])
  throw new Error(
    "Usage: node scripts/build-editable-text-lab.mjs /absolute/path/case.json",
  );
const config = JSON.parse(await fs.readFile(configPath, "utf8"));
const root = path.dirname(configPath);
const originalPath = path.resolve(root, config.original);
const generatedPath = path.resolve(root, config.generated);
const out = path.resolve(root, config.output || "output");
if (out === path.dirname(originalPath) || out === path.dirname(generatedPath))
  throw new Error("Use a separate output directory");
await fs.mkdir(out, { recursive: true });
const original = await fs.readFile(originalPath);
const before = crypto.createHash("sha256").update(original).digest("hex");
const { data, info } = await sharp(original)
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
const { width, height } = info;
const repair = await sharp(generatedPath)
  .resize(width, height, { fit: "fill" })
  .ensureAlpha()
  .raw()
  .toBuffer();
const pixels = Buffer.from(data);
const mask = new Uint8Array(width * height);
for (const l of config.layers) {
  if (
    !Number.isFinite(l.x + l.y + l.w + l.h + l.fontSize) ||
    l.x < 0 ||
    l.y < 0 ||
    l.w <= 0 ||
    l.h <= 0 ||
    l.x + l.w > width ||
    l.y + l.h > height ||
    !/^#[\da-f]{6}$/i.test(l.color)
  )
    throw new Error("Invalid layer geometry or color");
  const removal = textRemoval(data, width, height, l);
  const b = removal.box;
  for (let y = 0; y < b.height; y++)
    for (let x = 0; x < b.width; x++)
      if (removal.mask[y * b.width + x])
        mask[(b.top + y) * width + b.left + x] = 1;
}
let editedPixels = 0,
  outsideDifferences = 0;
for (let i = 0; i < mask.length; i++) {
  if (mask[i]) {
    editedPixels++;
    repair.copy(pixels, i * 4, i * 4, i * 4 + 4);
  } else if (
    !data.subarray(i * 4, i * 4 + 4).equals(pixels.subarray(i * 4, i * 4 + 4))
  )
    outsideDifferences++;
}
const background = await sharp(pixels, { raw: info })
  .removeAlpha()
  .png()
  .toBuffer();
await fs.writeFile(path.join(out, "background.png"), background);
const pkg = path.join(repo, "node_modules/@fontsource-variable/noto-serif-sc");
let css = await fs.readFile(path.join(pkg, "index.css"), "utf8");
for (const url of [
  ...new Set([...css.matchAll(/url\(([^)]+)\)/g)].map((m) => m[1])),
]) {
  const font = await fs.readFile(path.resolve(pkg, url.replace(/['"]/g, "")));
  css = css.replaceAll(
    `url(${url})`,
    `url(data:font/woff2;base64,${font.toString("base64")})`,
  );
}
const deck = {
  width,
  height,
  layers: config.layers,
  original: `data:image/png;base64,${original.toString("base64")}`,
  background: `data:image/png;base64,${background.toString("base64")}`,
};
let html = await fs.readFile(
  path.join(repo, "site/editable-text-lab/index.template.html"),
  "utf8",
);
const script = await fs.readFile(
  path.join(repo, "site/editable-text-lab/editor.js"),
  "utf8",
);
html = html
  .replace("__FONT_CSS__", () => css)
  .replaceAll("__WIDTH__", String(width))
  .replaceAll("__HEIGHT__", String(height))
  .replace("__DECK__", () => JSON.stringify(deck).replaceAll("<", "\\u003c"))
  .replace("__SCRIPT__", () => script);
await fs.writeFile(path.join(out, "index.html"), html);
await fs.copyFile(
  path.join(pkg, "LICENSE"),
  path.join(out, "FONT-LICENSE.txt"),
);
await fs.writeFile(
  path.join(out, "layers.json"),
  JSON.stringify({ width, height, layers: config.layers }, null, 2),
);
const after = crypto
  .createHash("sha256")
  .update(await fs.readFile(originalPath))
  .digest("hex");
if (before !== after) throw new Error("Source changed during generation");
const report = {
  width,
  height,
  sourceSha256: before,
  sourceUnchanged: before === after,
  editableTextLayers: config.layers.length,
  repairMaskPixels: editedPixels,
  repairMaskRatio: editedPixels / (width * height),
  unchangedPixels: width * height - editedPixels,
  outsideMaskDifferences: outsideDifferences,
  scope:
    "Manually measured single-page prototype; not an automatic extraction or full-project acceptance",
};
await fs.writeFile(
  path.join(root, "verification.json"),
  JSON.stringify(report, null, 2),
);
console.log(
  JSON.stringify({ output: path.join(out, "index.html"), ...report }, null, 2),
);
