import { readFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { assetPath } from "../store.mjs";
import { embeddedFonts } from "./fonts.mjs";
import { pageImage } from "../export.mjs";
import { readExportAudio, matchNarrationPage } from "../speech/export.mjs";
const escape = (str) =>
  String(str).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export async function* motionHtmlChunks(
  deck,
  {
    preview = false,
    pageId = null,
    includeNotes = true,
    compare = false,
    narration = null,
    staticMode = false,
  } = {},
) {
  const selected = pageId
    ? deck.pages.filter((p) => p.id === pageId)
    : deck.pages;
  if (!selected.length || selected.some((p) => p.status !== "ready"))
    throw new Error("所选页面尚未全部转换完成，请完成或重试后导出");
  const json = (value) =>
    JSON.stringify(value)
      .replace(/</g, "\\u003c")
      .replace(/\u2028/g, "\\u2028")
      .replace(/\u2029/g, "\\u2029");
  const [runtime, css, fonts] = await Promise.all([
    readFile(new URL("../../shared/motion/player.js", import.meta.url), "utf8"),
    readFile(
      new URL("../../shared/motion/player.css", import.meta.url),
      "utf8",
    ),
    embeddedFonts(
      staticMode ? selected.map(() => ({ layers: [] })) : selected,
      deck.customFont,
    ),
  ]);
  const payload = json({
    title: deck.title,
    pages: [],
    preview,
    staticMode,
    narration: narration ? { voiceName: narration.voiceName } : null,
    audio: {},
  });
  yield `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; media-src data: blob:; font-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; base-uri 'none'; form-action 'none'"><title>${escape(deck.title)}</title><style>${fonts.css}\n${css}</style></head><body class="${preview ? "preview" : ""}"><main id="viewport" aria-label="演讲画面"><div id="stage"></div></main><img id="original" hidden alt="原图对照"><div id="blackout" hidden></div><aside id="notes" hidden aria-label="演讲备注"></aside><nav id="overview" hidden aria-label="页面总览"><button id="close-overview">关闭总览</button></nav><nav id="toolbar" aria-label="播放控制"><button id="previous" title="← ↑ Page Up">上一页</button><span id="counter" aria-live="polite"></span><button id="next" title="→ ↓ 空格 Page Down">下一页</button><button id="replay" title="R">重播</button><button id="steps" aria-pressed="false">整页播放</button><button id="autoplay" aria-pressed="false" title="P">自动播放</button><select id="interval" aria-label="自动播放间隔"><option value="5">5 秒</option><option value="10" selected>10 秒</option><option value="20">20 秒</option><option value="30">30 秒</option></select><button id="motion" class="secondary" aria-pressed="true">动效</button><button id="show-overview" class="secondary" title="G">总览</button><button id="show-notes" class="secondary" title="N" ${includeNotes ? "" : "hidden"}>备注</button><button id="compare" class="secondary" ${compare ? "" : "hidden"}>原图</button><button id="fullscreen" title="F">全屏</button></nav><div id="speech-status" role="status" hidden></div><div id="speech-gate" hidden><div><h1>开始这场演讲</h1><p id="speech-gate-message">点击一次后，口播将自动播放并翻页。</p><button id="speech-start">开始演讲</button></div></div><audio id="speech-audio" preload="auto"></audio><div id="progress"></div><div id="loading">正在加载画面与字体…</div><script type="application/json" id="deck-data">${payload}</script>`;
  const assets = new Map(),
    audio = {};
  let sequence = 0;
  async function* embed(key, read) {
    if (assets.has(key)) return;
    const reference = `media-${sequence++}`;
    const { data, mime } = await read();
    assets.set(key, `asset:${reference}`);
    yield `<script type="application/octet-stream" id="${reference}">data:${mime};base64,`;
    yield data.toString("base64");
    yield "</script>";
  }
  const image = (name) =>
    embed(`image:${name}`, async () => ({
      data: await readFile(assetPath(name)),
      mime: "image/png",
    }));
  for (const p of selected) {
    const n = narration ? matchNarrationPage(narration, p, !staticMode) : null;
    const still = staticMode ? await pageImage(p) : null;
    let background;
    if (still) {
      // Conversion/rotation follows PPT export, retaining original PNG/JPEG
      // bytes. Hold only the current page's pixels, never all pages' base64.
      const key = p.scene ? `scene:${p.id}` : `still:${p.image}`;
      yield* embed(key, async () => ({
        data: still.data,
        mime: `image/${still.format === "jpeg" ? "jpeg" : "png"}`,
      }));
      background = assets.get(key);
    } else {
      yield* image(p.background);
      background = assets.get(`image:${p.background}`);
    }
    if (compare) yield* image(p.source.image);
    const layers = [];
    if (!staticMode)
      for (const l of p.layers) {
        if (l.type === "image") {
          yield* image(l.asset);
          layers.push({ ...l, asset: assets.get(`image:${l.asset}`) });
        } else layers.push(l);
      }
    const page = {
      id: p.id,
      number: p.number,
      title: p.title,
      original: compare ? assets.get(`image:${p.source.image}`) : null,
      notes: includeNotes
        ? (n?.spokenText ?? (staticMode ? p.notes : p.source.notes))
        : "",
      width: still?.width || p.width,
      height: still?.height || p.height,
      background,
      layers,
      clips: n
        ? n.clips.map(({ file, duration, pauseAfter }) => ({
            file,
            duration,
            pauseAfter,
          }))
        : [],
      silentDuration: n?.silentDuration || 3,
    };
    yield `<script type="application/json" class="deck-page">${json(page)}</script>`;
    for (const clip of n?.clips || []) {
      const key = `audio:${clip.file}`;
      yield* embed(key, async () => ({
        data: await readExportAudio(clip, n.number),
        mime: "audio/mpeg",
      }));
      audio[clip.file] = assets.get(key);
    }
  }
  yield `<script type="application/json" id="deck-audio">${json(audio)}</script>`;
  yield `<script>${runtime}</script><template id="font-licenses">${escape(fonts.licenses)}</template></body></html>`;
}

// Small in-memory previews/test callers only. Download routes always spool to
// disk: the complete offline file may exceed V8's maximum string length.
export async function renderMotionHtml(deck, options) {
  const chunks = [];
  for await (const chunk of motionHtmlChunks(deck, options)) chunks.push(chunk);
  return chunks.join("");
}
export async function writeMotionHtml(
  deck,
  options,
  filename,
  { signal } = {},
) {
  await pipeline(
    Readable.from(motionHtmlChunks(deck, options)),
    createWriteStream(filename, { flags: "wx", mode: 0o600 }),
    { signal },
  );
}
