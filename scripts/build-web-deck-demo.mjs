import { readFile, writeFile, mkdir } from "node:fs/promises";
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
  const dir = path.join(root, "site/web-deck-lab");
  const [template, css, js, model, fontCss] = await Promise.all([
    readFile(path.join(dir, "index.template.html"), "utf8"),
    readFile(path.join(dir, "deck.css"), "utf8"),
    readFile(path.join(dir, "deck.js"), "utf8"),
    readFile(path.join(dir, "model.mjs"), "utf8"),
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
    JS: `${model.replace(/^export /gm, "")}\n${js}`,
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
