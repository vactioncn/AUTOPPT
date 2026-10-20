import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { create } from "fontkit";
import { decompress } from "wawoff2";

const require = createRequire(import.meta.url);
const families = new Map(),
  faces = new Map(),
  decoded = new Map();
const inRange = (cp, range) =>
  range.split(",").some((part) => {
    const [a, b = a] = part.trim().replace(/^U\+/i, "").split("-");
    return (
      cp >= parseInt(a.replaceAll("?", "0"), 16) &&
      cp <= parseInt(b.replaceAll("?", "f"), 16)
    );
  });
async function fontFaces(family) {
  if (!families.has(family))
    families.set(
      family,
      (async () => {
        const entry = require.resolve(
          `@fontsource-variable/noto-${family === "serif" ? "serif" : "sans"}-sc/index.css`,
        );
        const css = await readFile(entry, "utf8");
        return [...css.matchAll(/@font-face\s*\{([^}]+)\}/g)].map(
          ([, body]) => ({
            range: body.match(/unicode-range:\s*([^;]+);/)?.[1] || "U+0-10FFFF",
            file: path.resolve(
              path.dirname(entry),
              body.match(/url\(([^)]+)\)/)[1].replace(/['"]/g, ""),
            ),
          }),
        );
      })(),
    );
  return families.get(family);
}
// Measure the exact bundled web fonts, without depending on installed system fonts.
export async function textMetrics(text, family, weight) {
  const entries = await fontFaces(family),
    runs = [];
  for (const char of text) {
    const entry = entries.find((f) => inRange(char.codePointAt(0), f.range));
    if (!entry) throw new Error(`内置字体不支持字符：${char}`);
    const key = entry.file + ":" + weight;
    if (!decoded.has(entry.file))
      decoded.set(
        entry.file,
        readFile(entry.file)
          .then(decompress)
          .then((b) => create(Buffer.from(b))),
      );
    if (!faces.has(key))
      faces.set(
        key,
        decoded
          .get(entry.file)
          .then((font) => font.getVariation({ wght: weight })),
      );
    const font = await faces.get(key);
    if (!font.hasGlyphForCodePoint(char.codePointAt(0)))
      throw new Error(`内置字体缺少字符：${char}`);
    if (runs.at(-1)?.font === font) runs.at(-1).text += char;
    else runs.push({ font, text: char });
  }
  let advance = 0,
    minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const { font, text: value } of runs) {
    const run = font.layout(value),
      unit = font.unitsPerEm;
    run.glyphs.forEach((g, i) => {
      const p = run.positions[i],
        b = g.bbox;
      if (b.maxX > b.minX && b.maxY > b.minY) {
        minX = Math.min(minX, advance + (p.xOffset + b.minX) / unit);
        maxX = Math.max(maxX, advance + (p.xOffset + b.maxX) / unit);
        minY = Math.min(minY, (p.yOffset + b.minY) / unit);
        maxY = Math.max(maxY, (p.yOffset + b.maxY) / unit);
      }
      advance += p.xAdvance / unit;
    });
  }
  const f = runs[0]?.font;
  if (!f || !Number.isFinite(minX)) throw new Error("文字层没有可显示字形");
  return {
    minX,
    maxX,
    minY,
    maxY,
    advance,
    ascent: f.ascent / f.unitsPerEm,
    descent: -f.descent / f.unitsPerEm,
  };
}

// Freeze a natural-size line in the original ink box. Later edits retain this
// geometry instead of shrinking every new string back into the old rectangle.
export async function calibrateText(layer, width, height) {
  const weights = layer.font === "serif" ? [400, 600] : [300, 400, 700];
  const fontWeight = weights.reduce((a, b) =>
    Math.abs(b - layer.fontWeight) < Math.abs(a - layer.fontWeight) ? b : a,
  );
  const m = await textMetrics(layer.text, layer.font, fontWeight);
  const count = [...layer.text].length;
  // Generated lettering can be condensed. Forcing its height onto a wider
  // bundled face with extreme negative tracking makes Chinese strokes collide.
  // Fit the natural glyphs once within the original ink area, then freeze that
  // size for editing; keep their vertical centre and the surrounding artwork.
  const fontSize = Math.min(
    layer.h / (m.maxY - m.minY),
    layer.w / Math.max(0.1, m.maxX - m.minX - Math.max(0, count - 1) * 0.04),
  );
  const spacing =
    count > 1 ? (layer.w - (m.maxX - m.minX) * fontSize) / (count - 1) : 0;
  const letterSpacing = Math.min(spacing, fontSize * 0.3);
  // Include the font's ascent/descent in the editing box; a shorter CSS line
  // box reports false overflow even when the visible ink fits exactly.
  const lineHeight = Math.max(1.2, m.ascent + m.descent);
  const baseline = (lineHeight - m.ascent - m.descent) / 2 + m.ascent;
  const inkHeight = (m.maxY - m.minY) * fontSize;
  const x = Math.max(0, layer.x - m.minX * fontSize),
    y = Math.max(
      0,
      layer.y + (layer.h - inkHeight) / 2 - (baseline - m.maxY) * fontSize,
    );
  return {
    ...layer,
    x,
    y,
    w: Math.min(
      width - x,
      Math.max(layer.w, m.advance * fontSize + count * letterSpacing) + 3,
    ),
    h: Math.min(height - y, fontSize * lineHeight + 2),
    fontSize,
    fontWeight,
    letterSpacing,
    lineHeight,
    align: "left",
    fit: false,
  };
}
