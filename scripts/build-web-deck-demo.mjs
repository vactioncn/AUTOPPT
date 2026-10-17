import { readFile, writeFile, mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { validateDeck, buildTimeline } from "../site/web-deck-lab/model.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const esc = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

export async function buildWebDeck(input, output) {
  const deck = validateDeck(JSON.parse(await readFile(input, "utf8")));
  // Illustrative assets are explicitly supplied by the storyboard author.
  // Keep the single-file output self-contained and restrict it to local raster images.
  const sourceRoot = await realpath(path.dirname(input));
  for (const [id, asset] of Object.entries(deck.assets || {})) {
    if (!asset.file || path.isAbsolute(asset.file))
      throw new Error(`素材 ${id} 需要分镜目录内的相对路径。`);
    const source = await realpath(path.resolve(sourceRoot, asset.file));
    if (!source.startsWith(sourceRoot + path.sep))
      throw new Error(`素材 ${id} 超出分镜目录。`);
    const mime = {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".webp": "image/webp",
    }[path.extname(source).toLowerCase()];
    if (!mime) throw new Error(`素材 ${id} 仅支持 PNG、JPEG 或 WebP。`);
    const bytes = await readFile(source);
    if (bytes.length > 10 * 1024 * 1024)
      throw new Error(`素材 ${id} 超过 10 MB。`);
    deck.assets[id] = {
      alt: asset.alt || "视觉示意",
      caption: asset.caption || "",
      src: `data:${mime};base64,${bytes.toString("base64")}`,
    };
  }
  const dir = path.join(root, "site/web-deck-lab");
  const [template, css, js, model, design, fontCss] = await Promise.all([
    readFile(path.join(dir, "index.template.html"), "utf8"),
    readFile(path.join(dir, "deck.css"), "utf8"),
    readFile(path.join(dir, "deck.js"), "utf8"),
    readFile(path.join(dir, "model.mjs"), "utf8"),
    readFile(path.join(dir, "design.mjs"), "utf8"),
    readFile(path.join(root, "public/brand/type.css"), "utf8"),
  ]);
  // All fonts travel with the file. No CDN, runtime fetch, API key or user database.
  const license = await readFile(
    path.join(root, "public/brand/FONT-LICENSE.txt"),
    "utf8",
  );
  let fonts = `/* Embedded font license:\n${license.replaceAll("*/", "* /")}\n*/\n${fontCss}`;
  for (const match of fontCss.matchAll(/url\(\.\/fonts\/([^\s)]+)\)/g)) {
    const bytes = await readFile(
      path.join(root, "public/brand/fonts", match[1]),
    );
    fonts = fonts.replace(
      match[0],
      `url(data:font/woff2;base64,${bytes.toString("base64")})`,
    );
  }
  const data = JSON.stringify(deck)
    .replaceAll("<", "\\u003c")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
  const values = {
    TITLE: esc(deck.title),
    CSS: css,
    FONTS: fonts,
    DATA: data,
    JS: `${model.replace(/^export /gm, "")}\n${design.replace(/^export /gm, "")}\n${js}`,
  };
  const html = template.replace(
    /__(TITLE|CSS|FONTS|DATA|JS)__/g,
    (_, key) => values[key],
  );
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, html);
  return {
    output,
    pages: deck.slides.length,
    steps: buildTimeline(deck).length,
    bytes: Buffer.byteLength(html),
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) {
    console.error(
      "用法：node scripts/build-web-deck-demo.mjs <storyboard.json> <output/index.html>",
    );
    process.exitCode = 1;
  } else
    console.log(
      JSON.stringify(
        await buildWebDeck(path.resolve(input), path.resolve(output)),
        null,
        2,
      ),
    );
}
