import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { product } from "../site/intro/content.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "dist", "intro");
mkdirSync(out, { recursive: true });
const esc = (s) =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const extraShot = (s) =>
  s
    ? `<button class="extra-shot" type="button" data-zoom="screenshots/${s.name}.webp" data-caption="${esc(s.caption)}">${esc(s.label)} ↗</button>`
    : "";
const tabs = product.features
  .map(
    (f, i) =>
      `<button id="tab-${f.id}" type="button" role="tab" data-feature="${f.id}" aria-selected="${i === 0}" aria-controls="panel-${f.id}" tabindex="${i === 0 ? 0 : -1}">${f.label}</button>`,
  )
  .join("");
const panels = product.features
  .map(
    (f, i) =>
      `<section class="feature-panel" id="panel-${f.id}" role="tabpanel" aria-labelledby="tab-${f.id}" ${i ? "hidden" : ""}><div class="feature-main"><div class="feature-copy"><h3>${esc(f.title)}</h3><p>${esc(f.description)}</p><ul class="capabilities">${f.capabilities.map((c) => `<li>${esc(c)}</li>`).join("")}</ul><p class="feature-note">${esc(f.note)}</p>${extraShot(f.extraShot)}</div><figure class="feature-visual"><button class="shot-button" data-zoom="screenshots/${f.shot}.webp" data-caption="${esc(f.alt)}" aria-label="放大${f.label}截图"><img src="screenshots/${f.shot}.webp" alt="${esc(f.alt)}" loading="lazy" width="1440" height="1040"></button><figcaption><span>实际界面 · 演示资料</span><span>点击放大 ↗</span></figcaption></figure></div><details class="how-to"><summary>具体怎么用？展开操作步骤</summary><ol>${f.steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol></details></section>`,
  )
  .join("");
const setup = product.setup
  .map(
    (s, i) =>
      `<article class="setup-step"><span>0${i + 1}</span><h3>${esc(s.title)}</h3><p>${esc(s.text)}</p>${extraShot(s.extraShot)}${s.code ? `<div class="code-box"><button class="copy-code" type="button">复制命令</button><pre><code>${esc(s.code)}</code></pre></div>` : ""}</article>`,
  )
  .join("");
const faq = product.faqs
  .map(
    ([q, a]) =>
      `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`,
  )
  .join("");
let html = readFileSync(
  path.join(root, "site/intro/index.template.html"),
  "utf8",
);
for (const [key, value] of Object.entries({
  TABS: tabs,
  PANELS: panels,
  SETUP: setup,
  FAQ: faq,
}))
  html = html.replace(`{{${key}}}`, value);
writeFileSync(path.join(out, "index.html"), html);
for (const file of ["intro.css", "intro.js"])
  copyFileSync(path.join(root, "site/intro", file), path.join(out, file));
const md = [
  "# AutoPPT 功能与快速使用指南",
  "",
  product.description,
  "",
  "## 第一次使用",
  "",
  ...product.setup.flatMap((s, i) => [
    `### ${i + 1}. ${s.title}`,
    "",
    s.text,
    "",
    ...(s.code ? ["```sh", s.code, "```", ""] : []),
  ]),
  "## 功能与操作",
  "",
  ...product.features.flatMap((f) => [
    `### ${f.label}`,
    "",
    f.description,
    "",
    ...f.capabilities.map((c) => `- ${c}`),
    "",
    "操作步骤：",
    "",
    ...f.steps.map((s, i) => `${i + 1}. ${s}`),
    "",
    f.note,
    "",
  ]),
  "## 常见问题",
  "",
  ...product.faqs.flatMap(([q, a]) => [`### ${q}`, "", a, ""]),
  "完整说明：https://github.com/vactioncn/AUTOPPT/blob/main/docs/同事安装与使用说明.md",
  "",
].join("\n");
writeFileSync(path.join(out, "guide.md"), md);
console.log("Built standalone introduction and Markdown guide: dist/intro/");
