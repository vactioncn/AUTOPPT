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
const panels = (features) =>
  features
    .map(
      (f) =>
        `<section class="feature-panel" id="panel-${f.id}" aria-labelledby="feature-${f.id}"><p class="feature-label" id="feature-${f.id}">${esc(f.label)}</p><div class="feature-main"><div class="feature-copy"><h3>${esc(f.title)}</h3><p>${esc(f.description)}</p><ul class="capabilities">${f.capabilities.map((c) => `<li>${esc(c)}</li>`).join("")}</ul><p class="feature-note">${esc(f.note)}</p>${extraShot(f.extraShot)}</div><figure class="feature-visual"><button class="shot-button" data-zoom="screenshots/${f.shot}.webp" data-caption="${esc(f.alt)}" aria-label="放大${f.label}截图"><img src="screenshots/${f.shot}.webp" alt="${esc(f.alt)}" loading="lazy" width="1440" height="1040"></button><figcaption><span>实际界面 · 演示资料</span><span>点击放大 ↗</span></figcaption></figure></div><div class="how-to"><h4>具体怎么用</h4><ol>${f.steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol></div></section>`,
    )
    .join("");
const overview = product.modules
  .map(
    (m, i) =>
      `<a class="module-card" href="#${m.id}"><span class="module-number">0${i + 1}</span><h3>${esc(m.label)} <span aria-hidden="true">↗</span></h3><p>${esc(m.summary)}</p><span class="module-sequence">${esc(m.sequence)}</span></a>`,
  )
  .join("");
const features = product.modules
  .map((m, i) => {
    const items = m.featureIds.map((id) =>
      product.features.find((f) => f.id === id),
    );
    return `<section class="product-module" id="${m.id}" aria-labelledby="heading-${m.id}"><div class="section-heading"><div><p class="eyebrow">0${i + 1} / ${esc(m.label)}</p><h2 id="heading-${m.id}">${esc(m.title)}</h2></div><p>${esc(m.description)}</p></div><p class="module-path">${esc(m.sequence)}</p>${panels(items)}</section>`;
  })
  .join("");
const setup = product.setup
  .map(
    (s, i) =>
      `<article class="setup-step"><span>0${i + 1}</span><h3>${esc(s.title)}</h3><p>${esc(s.text)}</p>${extraShot(s.extraShot)}${s.code ? `<div class="code-box"><button class="copy-code" type="button">复制命令</button><pre><code>${esc(s.code)}</code></pre></div>` : ""}</article>`,
  )
  .join("");
const faq = product.faqs
  .map(([q, a]) => `<article><h3>${esc(q)}</h3><p>${esc(a)}</p></article>`)
  .join("");
let html = readFileSync(
  path.join(root, "site/intro/index.template.html"),
  "utf8",
);
for (const [key, value] of Object.entries({
  MODULE_OVERVIEW: overview,
  FEATURES: features,
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
  ...product.modules.flatMap((m) => [
    `## ${m.label}`,
    "",
    m.description,
    "",
    m.sequence,
    "",
    ...m.featureIds.flatMap((id) => {
      const f = product.features.find((f) => f.id === id);
      return [
        `### ${f.label}`,
        "",
        f.description,
        "",
        ...f.capabilities.map((c) => `- ${c}`),
        "",
        "操作步骤：",
        "",
        ...f.steps.map((step, i) => `${i + 1}. ${step}`),
        "",
        f.note,
        "",
      ];
    }),
  ]),
  "## 常见问题",
  "",
  ...product.faqs.flatMap(([q, a]) => [`### ${q}`, "", a, ""]),
  "完整说明：https://github.com/vactioncn/AUTOPPT/blob/main/docs/同事安装与使用说明.md",
  "",
].join("\n");
writeFileSync(path.join(out, "guide.md"), md);
console.log("Built standalone introduction and Markdown guide: dist/intro/");
