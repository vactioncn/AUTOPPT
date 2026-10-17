// Semantic content stays in the storyboard. Each composition is styled separately
// for both template families in deck.css; illustration is optional and attributed.
export function renderVisual(s, deck) {
  const e = (value = "") =>
    String(value).replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  const l = (value) => e(value).replaceAll("\n", "<br>");
  const reveal = (n) => `data-reveal="${n}"`;
  const photo = (name = "hero", extra = "") => {
    const key = s[name];
    const asset = deck.assets?.[key];
    if (!asset?.src?.match(/^data:image\/(png|jpeg|webp);base64,/)) return "";
    return `<figure class="scene-photo ${extra}"><button class="image-open" data-image="${e(key)}" aria-label="查看${e(asset.alt)}"><img src="${e(asset.src)}" alt="${e(asset.alt)}" decoding="sync"></button><figcaption>${e(asset.caption)}</figcaption></figure>`;
  };
  const label = (t) => `<p class="small-label">${e(t)}</p>`;
  const title = (t, cls = "") => `<h2 class="${cls}">${l(t)}</h2>`;
  const designs = {
    cover: () =>
      `${photo()}<div class="cover-main"><p class="cover-kicker">${e(s.subtitle)}</p><h1>${l(s.title)}</h1><div class="cover-rule"></div><p class="cover-aside">${e(s.aside)}</p></div><div class="cover-window" aria-hidden="true"><i></i><i></i><i></i><i></i></div>`,
    compare: () =>
      `<div class="composition-title">${title(s.title)}</div><div class="compare-scene"><article class="compare-pane before">${label(s.left.label)}<h3>${l(s.left.title)}</h3><div class="single-scope" aria-hidden="true"><i></i><b></b><i></i></div></article><div class="bridge" aria-hidden="true"><span>↗</span></div><article class="compare-pane after" ${reveal(1)}>${label(s.right.label)}<h3>${l(s.right.title)}</h3><div class="scope-grid">${(s.contextItems || []).map((x, i) => `<span><small>0${i + 1}</small>${e(x)}</span>`).join("")}</div></article></div><p class="conclusion" ${reveal(2)}>${e(s.conclusion)}</p>`,
    network: () =>
      `<div class="network-title">${title(s.title)}<p class="subtitle">${e(s.subtitle)}</p></div><div class="network-map"><svg class="network-lines" viewBox="0 0 1000 760" aria-hidden="true"><circle cx="500" cy="380" r="260" class="orbit"/><circle cx="500" cy="380" r="158" class="inner-orbit"/>${["M500 380 Q340 380 210 175", "M500 380 Q660 380 790 175", "M500 380 Q340 380 210 585", "M500 380 Q660 380 790 585"].map((d, i) => `<path d="${d}" pathLength="1" ${reveal(i < 2 ? 1 : 2)}/>`).join("")}</svg><div class="network-center"><span>${e(s.center)}</span></div>${s.items.map((x, i) => `<div class="network-node node-${i}" ${reveal(i < 2 ? 1 : 2)}><small>0${i + 1}</small><strong>${e(x)}</strong></div>`).join("")}</div>`,
    question: () =>
      `<div class="question-watermark" aria-hidden="true">?</div><div class="question-main"><p class="question-stem">${e(s.title)}</p><h2>${l(s.question)}</h2><div class="question-line" aria-hidden="true"><i></i><b></b></div><p class="question-close" ${reveal(1)}><span>${e(s.conclusion)}</span></p></div>`,
    scenario: () =>
      `${photo()}<div class="scenario-shade" aria-hidden="true"></div><div class="scenario-intro">${label(s.label)}${title(s.title)}</div><div class="scenario-year"><span class="year">${e(s.year)}</span><p>${e(s.subtitle)}</p></div><div class="budget" ${reveal(1)}><div class="budget-rule"></div><div class="amount">${e(s.budget)}<span>${e(s.unit)}</span></div><p>${e(s.condition)}</p></div>`,
    flow: () =>
      `<div class="composition-title flow-title">${title(s.title)}<p class="subtitle">${e(s.subtitle)}</p></div><div class="flow-track"><svg class="flow-path" viewBox="0 0 1696 400" preserveAspectRatio="none" aria-hidden="true"><path class="track-base" d="M50 220 C225 220 290 90 465 90 S650 220 770 220 S890 310 1010 310 S1210 90 1374 90 S1550 220 1646 220"/><path class="track-active" pathLength="1" d="M50 220 C225 220 290 90 465 90 S650 220 770 220 S890 310 1010 310 S1210 90 1374 90 S1550 220 1646 220"/></svg>${s.items.map((x, i) => `<div class="flow-node flow-${i} focus-item" data-focus="${Math.floor(i / 2)}"><span class="node-no">0${i + 1}</span><div class="node-dot"></div><strong>${e(x)}</strong></div>`).join("")}</div><div class="flow-group-index" aria-hidden="true"><span data-focus="0">01 / 02</span><span data-focus="1">03 / 04</span><span data-focus="2">05 / 06</span></div>`,
    lenses: () =>
      `<div class="lenses-heading">${title(s.title)}<p class="subtitle">${e(s.subtitle)}</p></div><div class="lens-strip">${s.items.map((x, i) => `<div class="lens focus-item" data-focus="${i}"><span class="lens-index">0${i + 1}</span><div class="lens-symbol symbol-${i}" aria-hidden="true"><i></i><i></i><i></i><i></i></div><strong>${e(x)}</strong><span class="lens-focus" aria-hidden="true">↗</span></div>`).join("")}</div>`,
    agenda: () =>
      `<div class="agenda-title">${title(s.title)}</div><div class="agenda-list">${s.items.map((x, i) => `<div class="agenda-row focus-item" data-focus="${i}"><span class="agenda-number">0${i + 1}</span><strong>${e(x.title)}</strong><p>${e(x.text)}</p><span class="agenda-arrow" aria-hidden="true">↗</span></div>`).join("")}</div>`,
    statement: () =>
      `${photo()}<div class="statement-frame" aria-hidden="true"></div><div class="statement-main"><p class="prelude">${e(s.title)}</p><h2 ${reveal(1)}>${l(s.statement)}</h2><p class="subtitle" ${reveal(1)}>${e(s.subtitle)}</p></div>`,
  };
  return designs[s.type]();
}
