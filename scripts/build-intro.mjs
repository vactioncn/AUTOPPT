import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import sharp from "sharp";
import { product } from "../site/intro/content.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Deployment builds into a fresh temporary directory without touching the
// running application's dist/ or any user data.
const out = process.env.AUTOPPT_INTRO_OUTPUT_DIR
  ? path.resolve(process.env.AUTOPPT_INTRO_OUTPUT_DIR)
  : path.join(root, "dist", "intro");
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
      (
        f,
      ) => `<section class="feature-panel" id="panel-${f.id}" aria-labelledby="feature-${f.id}">
    <p class="feature-label">${esc(f.label)}</p>
    <div class="feature-main">
      <div class="feature-copy" data-reveal><h3 id="feature-${f.id}">${esc(f.title).replaceAll("\n", "<br>")}</h3><p>${esc(f.description)}</p>
        <ul class="capabilities">${f.capabilities.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>${extraShot(f.extraShot)}</div>
      <figure class="feature-visual" data-reveal><button class="shot-button" data-zoom="screenshots/${f.shot}.webp" data-caption="${esc(f.alt)}" aria-label="放大${f.label}截图"><img src="screenshots/${f.shot}.webp" alt="${esc(f.alt)}" loading="lazy" width="1440" height="1040"></button><figcaption><span>真实界面 · 演示资料</span><span>点击放大 ↗</span></figcaption></figure>
    </div>
    <div class="how-to"><h4>这样开始</h4><ol>${f.steps.map((step) => `<li>${esc(step)}</li>`).join("")}</ol></div><p class="feature-note">${esc(f.note)}</p>
  </section>`,
    )
    .join("");
const overview = product.modules
  .map(
    (m) =>
      `<a class="module-card" href="#${m.id}"><h3>${esc(m.label)} <span aria-hidden="true">›</span></h3><p>${esc(m.summary)}</p></a>`,
  )
  .join("");
const firstStyle = product.gallery[0];
const gallery = `<div class="gallery">
  <figure><button class="shot-button gallery-stage" id="gallery-zoom" data-zoom="artwork/${firstStyle.file}.webp" data-caption="${esc(firstStyle.label)} · 内置风格封面" aria-label="放大当前风格封面"><img id="gallery-image" src="artwork/${firstStyle.file}.webp" alt="${esc(firstStyle.label)}封面" width="1440" height="810" loading="lazy"></button>
  <figcaption class="gallery-caption" aria-live="polite"><h3 id="gallery-title">${esc(firstStyle.label)}</h3><p id="gallery-description">${esc(firstStyle.detail)}</p></figcaption></figure>
  <div class="gallery-controls" role="group" aria-label="选择要预览的内置风格">${product.gallery.map((style, i) => `<button class="style-choice" type="button" aria-pressed="${i === 0}" aria-label="预览${esc(style.label)}" data-style-src="artwork/${style.file}.webp" data-style-label="${esc(style.label)}" data-style-detail="${esc(style.detail)}"><img src="artwork/${style.file}.webp" alt="" width="1440" height="810" loading="lazy"><span>${esc(style.short)}</span></button>`).join("")}</div>
  <p class="image-note">13 套内置风格中的 6 套展示 · 封面为已生成作品，后续画面依内容与模型而定</p>
</div>`;
const copyStory = `<div class="copy-story" data-reveal>
  <div class="copy-paper"><span>你写下的</span><p>今天，我想聊聊一次演讲里最重要的事。<strong>让观众记住的，往往不是我们讲了多少，而是有没有把一个关键观点讲清楚。</strong>具体的例子和展开，可以留给现场讲述。</p></div>
  <div class="copy-arrow" aria-hidden="true">›</div>
  <div class="copy-paper copy-result"><span>观众看到的重点</span><p>把一个关键观点，<br><span>讲清楚。</span></p><small>完整的展开，留在你的逐页讲稿里。</small></div>
  <p class="copy-story-note">文案提炼示意，非模型实时生成。实际结果可在工作台查看和调整。</p>
</div>`;
const features = product.modules
  .map(
    (
      m,
    ) => `<section class="product-module ${m.id === "speech-making" ? "speech-module" : ""}" id="${m.id}" aria-labelledby="heading-${m.id}">
  <div class="section-heading wrap" data-reveal><p class="eyebrow">${esc(m.label)}</p><h2 id="heading-${m.id}">${esc(m.title)}</h2><p>${esc(m.description)}</p><div class="module-path">${esc(m.sequence)}</div></div>
  <div class="wrap">${m.id === "style-making" ? gallery : copyStory}${panels(m.featureIds.map((id) => product.features.find((f) => f.id === id)))}</div>
</section>`,
  )
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
// Small, reproducible web derivatives of the approved public covers. The
// original product covers stay untouched; no model calls or private data.
mkdirSync(path.join(out, "artwork"), { recursive: true });
await Promise.all(
  product.gallery.map((style) =>
    sharp(path.join(root, "public/style-covers", `${style.file}.png`))
      .resize({ width: 1440, withoutEnlargement: true })
      .webp({ quality: 85 })
      .toFile(path.join(out, "artwork", `${style.file}.webp`)),
  ),
);
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
console.log(`Built introduction and Markdown guide: ${out}`);
