import { readFile } from "node:fs/promises";
import { assetPath } from "../store.mjs";
import { embeddedFonts } from "./fonts.mjs";
const escape = (str) =>
  String(str).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export async function renderMotionHtml(
  deck,
  { preview = false, pageId = null, includeNotes = true, compare = false } = {},
) {
  const selected = pageId
    ? deck.pages.filter((p) => p.id === pageId)
    : deck.pages;
  if (!selected.length || selected.some((p) => p.status !== "ready"))
    throw new Error("所选页面尚未全部转换完成，请完成或重试后导出");
  const dataImage = async (name) =>
    `data:image/png;base64,${(await readFile(assetPath(name))).toString("base64")}`;
  const pages = [];
  for (const p of selected)
    pages.push({
      ...p,
      source: undefined,
      regions: undefined,
      original: compare ? await dataImage(p.source.image) : null,
      notes: includeNotes ? p.source.notes : "",
      background: await dataImage(p.background),
      layers: await Promise.all(
        p.layers.map(async (l) =>
          l.type === "image" ? { ...l, asset: await dataImage(l.asset) } : l,
        ),
      ),
    });
  const [runtime, css, fonts] = await Promise.all([
    readFile(new URL("../../shared/motion/player.js", import.meta.url), "utf8"),
    readFile(
      new URL("../../shared/motion/player.css", import.meta.url),
      "utf8",
    ),
    embeddedFonts(pages, deck.customFont),
  ]);
  const payload = JSON.stringify({ title: deck.title, pages, preview })
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; base-uri 'none'; form-action 'none'"><title>${escape(deck.title)}</title><style>${fonts.css}\n${css}</style></head><body class="${preview ? "preview" : ""}"><main id="viewport" aria-label="演讲画面"><div id="stage"></div></main><img id="original" hidden alt="原图对照"><div id="blackout" hidden></div><aside id="notes" hidden aria-label="演讲备注"></aside><nav id="overview" hidden aria-label="页面总览"><button id="close-overview">关闭总览</button></nav><nav id="toolbar" aria-label="播放控制"><button id="previous" title="← ↑ Page Up">上一页</button><span id="counter" aria-live="polite"></span><button id="next" title="→ ↓ 空格 Page Down">下一页</button><button id="replay" title="R">重播</button><button id="steps" aria-pressed="false">整页播放</button><button id="autoplay" aria-pressed="false" title="P">自动播放</button><select id="interval" aria-label="自动播放间隔"><option value="5">5 秒</option><option value="10" selected>10 秒</option><option value="20">20 秒</option><option value="30">30 秒</option></select><button id="motion" class="secondary" aria-pressed="true">动效</button><button id="show-overview" class="secondary" title="G">总览</button><button id="show-notes" class="secondary" title="N" ${includeNotes ? "" : "hidden"}>备注</button><button id="compare" class="secondary" ${compare ? "" : "hidden"}>原图</button><button id="fullscreen" title="F">全屏</button></nav><div id="progress"></div><div id="loading">正在加载画面与字体…</div><script type="application/json" id="deck-data">${payload}</script><script>${runtime}</script><template id="font-licenses">${escape(fonts.licenses)}</template></body></html>`;
}
