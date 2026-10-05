import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(import.meta.url);
function matches(range, points) {
  return range.split(",").some((part) => {
    const [a, b] = part.trim().replace(/^U\+/i, "").split("-");
    const lo = parseInt(a.replace(/\?/g, "0"), 16),
      hi = parseInt((b || a).replace(/\?/g, "f"), 16);
    return points.some((c) => c >= lo && c <= hi);
  });
}
export async function embeddedFonts(pages, customFont) {
  let css = "",
    licenses = [];
  for (const [font, pkg] of [
    ["sans", "noto-sans-sc"],
    ["serif", "noto-serif-sc"],
  ]) {
    const content = pages
      .flatMap((p) => p.layers)
      .filter(
        (l) =>
          l.type === "text" &&
          (l.font === font || (l.font === "custom" && !customFont)),
      )
      .map((l) => l.text)
      .join("");
    if (!content) continue;
    const points = [...new Set([...content].map((c) => c.codePointAt(0)))];
    const entry = require.resolve(`@fontsource-variable/${pkg}/index.css`),
      dir = path.dirname(entry);
    const source = await readFile(entry, "utf8");
    for (const face of source.match(/@font-face\s*\{[^}]+\}/g) || []) {
      const range = face.match(/unicode-range:\s*([^;]+);/)?.[1];
      if (range && !matches(range, points)) continue;
      const url = face.match(/url\(([^)]+)\)/)?.[1]?.replace(/['"]/g, "");
      if (!url) continue;
      const bytes = await readFile(path.resolve(dir, url));
      css +=
        face
          .replace(
            /url\([^)]+\)/,
            `url(data:font/woff2;base64,${bytes.toString("base64")})`,
          )
          .replace("font-display: swap", "font-display: block") + "\n";
    }
    licenses.push(await readFile(path.join(dir, "LICENSE"), "utf8"));
  }
  if (customFont)
    css += `@font-face{font-family:'Presentation Custom';src:url(data:font/woff2;base64,${customFont.data});font-weight:100 900;font-display:block}`;
  return { css, licenses: [...new Set(licenses)].join("\n") };
}
