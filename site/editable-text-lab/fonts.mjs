import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

// Fixed, licensed packages; never resolve a user-supplied URL or system font.
export const FONT_CATALOG = [
  {
    id: "sans",
    family: "Noto Sans SC Variable",
    label: "思源黑体",
    usage: "简洁正文、现代标题",
    package: "@fontsource-variable/noto-sans-sc",
    entries: ["index.css"],
    weights: [100, 200, 300, 400, 500, 600, 700, 800, 900],
    variable: true,
  },
  {
    id: "serif",
    family: "Noto Serif SC Variable",
    label: "思源宋体",
    usage: "文学、书卷与杂志",
    package: "@fontsource-variable/noto-serif-sc",
    entries: ["index.css"],
    weights: [200, 300, 400, 500, 600, 700, 800, 900],
    variable: true,
  },
  {
    id: "wenkai",
    family: "LXGW WenKai",
    label: "霞鹜文楷",
    usage: "叙事、亲切的手写感",
    package: "@fontsource/lxgw-wenkai",
    entries: ["500.css"],
    weights: [500],
  },
  {
    id: "xiaowei",
    family: "ZCOOL XiaoWei",
    label: "站酷小薇体",
    usage: "有笔锋的短标题",
    package: "@fontsource/zcool-xiaowei",
    entries: ["index.css"],
    weights: [400],
  },
  {
    id: "huangyou",
    family: "ZCOOL QingKe HuangYou",
    label: "站酷庆科黄油体",
    usage: "圆润、紧凑的短标题",
    package: "@fontsource/zcool-qingke-huangyou",
    entries: ["index.css"],
    weights: [400],
  },
];

export function normalizeFont(id = "serif", weight = 400) {
  const font = FONT_CATALOG.find((f) => f.id === id);
  if (!font) throw new Error(`Unknown embedded font: ${id}`);
  if (!Number.isFinite(weight) || weight < 100 || weight > 900)
    throw new Error("Invalid font weight");
  return {
    font: id,
    fontWeight: font.variable
      ? Math.max(font.weights[0], Math.min(font.weights.at(-1), weight))
      : font.weights.reduce((a, b) =>
          Math.abs(b - weight) < Math.abs(a - weight) ? b : a,
        ),
  };
}

export async function embeddedFontLibrary() {
  let css = "";
  const fonts = [],
    licenses = [];
  for (const spec of FONT_CATALOG) {
    const dir = path.dirname(require.resolve(`${spec.package}/index.css`));
    const pkg = JSON.parse(
      await fs.readFile(path.join(dir, "package.json"), "utf8"),
    );
    const license = await fs.readFile(path.join(dir, "LICENSE"), "utf8");
    if (pkg.license !== "OFL-1.1") throw new Error("Unreviewed font license");
    const files = new Map();
    for (const entry of spec.entries) {
      const source = await fs.readFile(path.join(dir, entry), "utf8");
      for (const face of source.match(/@font-face\s*\{[^}]+\}/g) || []) {
        const url = [...face.matchAll(/url\(([^)]+)\)/g)]
          .map((m) => m[1].replace(/['"]/g, ""))
          .find((url) => url.endsWith(".woff2"));
        if (!url || !url.startsWith("./files/") || url.includes(".."))
          throw new Error("Expected bundled WOFF2");
        const bytes = await fs.readFile(path.resolve(dir, url));
        files.set(url, {
          name: path.basename(url),
          sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
          bytes: bytes.length,
        });
        css +=
          face
            .replace(
              /src:[^;]+;/,
              `src:url(data:font/woff2;base64,${bytes.toString("base64")}) format('woff2');`,
            )
            .replace("font-display: swap", "font-display: block") + "\n";
      }
    }
    const { entries, ...font } = spec;
    fonts.push({
      ...font,
      version: pkg.version,
      license: pkg.license,
      files: [...files.values()],
    });
    licenses.push({ font: spec.family, package: spec.package, text: license });
  }
  return { css, fonts, licenses };
}
