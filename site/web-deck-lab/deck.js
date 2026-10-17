(() => {
  const deck = validateDeck(
    JSON.parse(document.getElementById("deck-data").textContent),
  );
  const timeline = buildTimeline(deck);
  const $ = (id) => document.getElementById(id);
  const esc = (value = "") =>
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
  const lines = (value) => esc(value).replaceAll("\n", "<br>");
  const marked = (value, accent) =>
    accent && value.includes(accent)
      ? lines(value).replace(lines(accent), `<mark>${lines(accent)}</mark>`)
      : lines(value);
  const label = (text) => `<p class="small-label">${esc(text)}</p>`;
  const reveal = (phase) => `data-reveal="${phase}"`;
  const renderers = {
    cover: (s) =>
      `<div class="cover-main"><h1>${marked(s.title, s.accent)}</h1><p class="subtitle">${esc(s.subtitle)}</p></div><div class="cover-index" aria-hidden="true">↗</div><p class="cover-aside">${esc(s.aside)}</p>`,
    compare: (s) =>
      `<h2 class="section-title">${lines(s.title)}</h2><div class="compare-grid"><div class="compare-column">${label(s.left.label)}<h3>${lines(s.left.title)}</h3></div><div class="compare-column new" ${reveal(1)}>${label(s.right.label)}<h3>${lines(s.right.title)}</h3></div></div><p class="conclusion" ${reveal(2)}>${esc(s.conclusion)}</p>`,
    network: (s) =>
      `<div class="network-layout"><div><h2>${lines(s.title)}</h2><p class="subtitle">${esc(s.subtitle)}</p></div><div class="network-map">${s.items.map((item, i) => `<div class="network-node" ${reveal(i < 2 ? 1 : 2)}>${esc(item)}</div>`).join("")}<div class="network-center">${esc(s.center)}</div></div></div>`,
    question: (s) =>
      `<div class="question-main"><p class="question-stem">${esc(s.title)}</p><h2>${lines(s.question)}</h2><p class="question-close" ${reveal(1)}><span>${esc(s.conclusion)}</span></p></div>`,
    scenario: (s) =>
      `<div class="scenario-layout"><div><h2>${lines(s.title)}</h2><div class="year">${esc(s.year)}</div><p class="small-label">${esc(s.subtitle)}</p><div class="experiment">${esc(s.label)}</div></div><div class="budget" ${reveal(1)}><div class="amount">${esc(s.budget)}<span>${esc(s.unit)}</span></div><p class="condition">${esc(s.condition)}</p></div></div>`,
    flow: (s) =>
      `<h2 class="section-title">${lines(s.title)}</h2><div class="flow-track">${s.items.map((item, i) => `<div class="flow-node focus-item" ${reveal(Math.floor(i / 2))} data-focus="${Math.floor(i / 2)}"><span class="node-no">0${i + 1}</span><strong>${esc(item)}</strong></div>`).join("")}</div><p class="subtitle">${esc(s.subtitle)}</p>`,
    lenses: (s) =>
      `<div class="lenses-layout"><div><h2>${lines(s.title)}</h2><p class="subtitle">${esc(s.subtitle)}</p></div><div class="lens-list">${s.items.map((item, i) => `<div class="lens focus-item" data-focus="${i}"><span>0${i + 1}</span><strong>${esc(item)}</strong></div>`).join("")}</div></div>`,
    agenda: (s) =>
      `<div class="agenda-layout"><h2>${lines(s.title)}</h2><div class="agenda-list">${s.items.map((item, i) => `<div class="agenda-row focus-item" data-focus="${i}"><span>0${i + 1}</span><strong>${esc(item.title)}</strong><p>${esc(item.text)}</p></div>`).join("")}</div></div>`,
    statement: (s) =>
      `<div class="statement-main"><p class="prelude">${esc(s.title)}</p><h2 ${reveal(1)}>${lines(s.statement)}</h2><p class="subtitle" ${reveal(1)}>${esc(s.subtitle)}</p></div>`,
  };
  $("stage").innerHTML = deck.slides
    .map(
      (s, i) =>
        `<section class="slide ${s.type} ${["question", "statement"].includes(s.type) ? "dark" : ""}" data-slide-id="${i + 1}" aria-label="第 ${i + 1} 页：${esc(s.title.replaceAll("\n", ""))}" hidden><div class="slide-head"><span class="chapter">${esc(s.chapter)}</span><span>${esc(deck.source.title)}</span></div>${renderers[s.type](s)}<div class="slide-foot"><span>${esc(s.chapter)}</span><span class="folio">${String(i + 1).padStart(2, "0")} / ${String(deck.slides.length).padStart(2, "0")}</span></div></section>`,
    )
    .join("");
  const pages = [...document.querySelectorAll(".slide")];
  const storageKey = `web-deck-lab:${deck.id}:v1`;
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(storageKey) || "{}");
  } catch {
    /* Private mode can deny storage. */
  }
  const validTheme = (value) => ["swiss", "architecture"].includes(value);
  let theme =
    new URLSearchParams(location.search).get("theme") || saved.theme || "swiss";
  if (!validTheme(theme)) theme = "swiss";
  let index = indexFromHash(location.hash, timeline);
  if (index < 0)
    index = Number.isInteger(saved.index)
      ? moveIndex(saved.index, 0, timeline)
      : 0;
  let dialogReturnFocus = null;
  let previousPage = -1;
  let settleTimer;

  function persist() {
    const { page, phase } = timeline[index];
    try {
      localStorage.setItem(storageKey, JSON.stringify({ index, theme }));
    } catch {
      /* Navigation remains usable. */
    }
    try {
      const url = new URL(location.href);
      url.searchParams.set("theme", theme);
      url.hash = `${page + 1}.${phase}`;
      history.replaceState(null, "", url);
    } catch {
      /* Some file viewers restrict history. */
    }
  }
  function fit() {
    const viewport = $("viewport");
    const compact = viewport.clientWidth < 680;
    viewport.classList.toggle("compact", compact);
    if (!compact) {
      const scale = Math.min(
        viewport.clientWidth / 1920,
        viewport.clientHeight / 1080,
      );
      Object.assign($("stage").style, {
        transform: `scale(${scale})`,
        left: `${(viewport.clientWidth - 1920 * scale) / 2}px`,
        top: `${(viewport.clientHeight - 1080 * scale) / 2}px`,
      });
    }
  }
  function render() {
    clearTimeout(settleTimer);
    $("stage").dataset.settled = "false";
    const { page, phase } = timeline[index];
    const s = deck.slides[page];
    pages.forEach((el, i) => {
      el.hidden = i !== page;
      el.inert = i !== page;
    });
    pages[page].dataset.phase = phase;
    pages[page].querySelectorAll("[data-reveal]").forEach((el) => {
      const visible = Number(el.dataset.reveal) <= phase;
      el.classList.toggle("not-yet", !visible);
      el.classList.toggle("is-shown", visible);
      el.setAttribute("aria-hidden", String(!visible));
    });
    pages[page]
      .querySelectorAll("[data-focus]")
      .forEach((el) =>
        el.classList.toggle("is-current", Number(el.dataset.focus) === phase),
      );
    document.documentElement.dataset.theme = theme;
    $("theme").value = theme;
    $("page-number").textContent =
      `${String(page + 1).padStart(2, "0")} / ${String(pages.length).padStart(2, "0")}`;
    $("page-title").textContent = s.patternName;
    $("step-number").textContent = `${index + 1} / ${timeline.length} 步`;
    $("previous").disabled = index === 0;
    $("next").disabled = index === timeline.length - 1;
    $("next").textContent =
      index === timeline.length - 1
        ? "已到最后"
        : phase < s.cues.length - 1
          ? "下一步 →"
          : "下一页 →";
    $("step-progress").innerHTML = s.cues
      .map(
        (cue, n) =>
          `<button aria-label="本页第 ${n + 1} 步：${esc(cue)}" aria-current="${n === phase ? "step" : "false"}" data-phase="${n}"><i></i></button>`,
      )
      .join("");
    $("total-progress").style.width =
      `${((index + 1) / timeline.length) * 100}%`;
    $("live-status").textContent =
      `第 ${page + 1} 页，本页第 ${phase + 1} 步。${s.cues[phase]}`;
    if (page !== previousPage) $("viewport").scrollTop = 0;
    previousPage = page;
    persist();
    fit();
    settleTimer = setTimeout(
      () => {
        $("stage").dataset.settled = "true";
      },
      theme === "architecture" ? 650 : 370,
    );
  }
  function move(delta) {
    index = moveIndex(index, delta, timeline);
    render();
  }
  function jump(page, phase = 0) {
    const next = timeline.findIndex(
      (s) => s.page === page && s.phase === phase,
    );
    if (next >= 0) {
      index = next;
      render();
    }
  }
  function openDialog(title, body) {
    dialogReturnFocus = document.activeElement;
    $("dialog-title").textContent = title;
    $("dialog-body").innerHTML = body;
    $("detail").showModal();
  }
  $("overview").onclick = () =>
    openDialog(
      "页面目录",
      `<p class="hint">${deck.slides.length} 页 · ${timeline.length} 步。选择一页，从该页第一步开始。左右键逐步推进，B 暂时黑屏。</p><div class="outline">${deck.slides.map((s, i) => `<button data-jump="${i}" aria-current="${i === timeline[index].page ? "page" : "false"}"><small>${String(i + 1).padStart(2, "0")} · ${esc(s.patternName)}</small><b>${lines(s.title)}</b><small>${s.cues.length} 个讲述步骤</small></button>`).join("")}</div>`,
    );
  $("notes").onclick = () => {
    const s = deck.slides[timeline[index].page];
    const styleDescription =
      theme === "swiss"
        ? "继承强势黑体、黑白反差、局部荧光黄绿与清晰网格；对比、关系与流程按内容组织。"
        : "继承低饱和灰阶、轻字重、较宽留白与细线；重点改用细线或明暗层级，缩小信息组以增加呼吸感。";
    openDialog(
      "讲稿与来源",
      `<p class="notes-meta">${esc(deck.source.title)} · ${esc(deck.source.version || "")}<br>取材页码：${s.sources.map(esc).join("、")}。上屏文字为节选提炼，原文保留在下方。</p><section class="notes-section"><h3>${esc(s.pattern)} · ${esc(s.patternName)}</h3><p>${styleDescription}</p><ol>${s.cues.map((cue) => `<li>${esc(cue)}</li>`).join("")}</ol></section><section class="notes-section"><h3>对应原稿</h3>${s.sources.map((n) => `<h4>原稿第 ${esc(n)} 页</h4><div class="original">${esc(deck.source.pages[String(n)])}</div>`).join("")}</section><p class="notes-meta">独立 H5 试作。两款模板已人工适配，本页不调用模型。尚未接入文档上传、任意模板自动适配或正式生成入口。</p>`,
    );
  };
  $("close-dialog").onclick = () => $("detail").close();
  $("detail").addEventListener("close", () => dialogReturnFocus?.focus());
  $("dialog-body").onclick = (event) => {
    const button = event.target.closest("[data-jump]");
    if (button) {
      jump(Number(button.dataset.jump));
      $("detail").close();
    }
  };
  $("step-progress").onclick = (event) => {
    const button = event.target.closest("[data-phase]");
    if (button) jump(timeline[index].page, Number(button.dataset.phase));
  };
  $("previous").onclick = () => move(-1);
  $("next").onclick = () => move(1);
  $("theme").onchange = (event) => {
    if (validTheme(event.target.value)) {
      theme = event.target.value;
      render();
    }
  };
  $("phone").onclick = () => {
    const enabled = document
      .querySelector(".workspace")
      .classList.toggle("phone-preview");
    $("phone").setAttribute("aria-pressed", String(enabled));
    $("phone").textContent = enabled ? "返回大屏" : "手机预览";
    fit();
  };
  $("fullscreen").onclick = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (document.documentElement.requestFullscreen)
        await document.documentElement.requestFullscreen();
      else
        $("live-status").textContent =
          "此浏览器不支持网页全屏，请使用浏览器全屏菜单。";
    } catch {
      $("live-status").textContent = "全屏未开启，可继续在当前窗口演讲。";
    }
  };
  document.addEventListener("fullscreenchange", () => {
    $("fullscreen").textContent = document.fullscreenElement
      ? "退出全屏"
      : "全屏";
    fit();
  });
  document.addEventListener("keydown", (event) => {
    if (
      $("detail").open ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      event.target.closest("select,input,textarea,[contenteditable=true]")
    )
      return;
    if (
      event.key.toLowerCase() === "b" ||
      (event.key === "Escape" && !$("blackout").hidden)
    ) {
      event.preventDefault();
      $("blackout").hidden = !$("blackout").hidden;
      return;
    }
    if (!$("blackout").hidden || event.repeat) return;
    const onButton = event.target.closest("button");
    if (
      ["ArrowRight", "ArrowDown", "PageDown"].includes(event.key) ||
      (!onButton && [" ", "Enter"].includes(event.key))
    ) {
      event.preventDefault();
      move(1);
    }
    if (["ArrowLeft", "ArrowUp", "PageUp"].includes(event.key)) {
      event.preventDefault();
      move(-1);
    }
    if (event.key === "Home") {
      event.preventDefault();
      jump(0);
    }
    if (event.key === "End") {
      event.preventDefault();
      index = timeline.length - 1;
      render();
    }
  });
  window.addEventListener("hashchange", () => {
    const next = indexFromHash(location.hash, timeline);
    if (next >= 0) {
      index = next;
      render();
    }
  });
  new ResizeObserver(fit).observe($("viewport"));
  document.fonts.ready.then(fit);
  render();
})();
