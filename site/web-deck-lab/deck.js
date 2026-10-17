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
  $("stage").innerHTML = deck.slides
    .map(
      (s, i) =>
        `<section class="slide ${s.type} ${["question", "statement"].includes(s.type) ? "dark" : ""}" data-slide-id="${i + 1}" data-visual="${Boolean(s.hero && deck.assets?.[s.hero])}" aria-label="第 ${i + 1} 页：${esc(s.title.replaceAll("\n", ""))}" hidden><div class="slide-head"><span class="chapter">${esc(s.chapter)}</span><span>${esc(deck.source.title)}</span></div>${renderVisual(s, deck)}<div class="slide-foot"><span>${esc(s.chapter)}</span><span class="folio">${String(i + 1).padStart(2, "0")} / ${String(deck.slides.length).padStart(2, "0")}</span></div></section>`,
    )
    .join("");
  const pages = [...document.querySelectorAll(".slide")];
  const storageKey = `web-deck-lab:${deck.id}:v2`;
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
    const compact = viewport.clientWidth < 760;
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
    const pageChanged = page !== previousPage;
    pages[page].dataset.phase = phase;
    if (pageChanged) {
      pages[page].classList.remove("scene-enter");
      void pages[page].offsetWidth;
      pages[page].classList.add("scene-enter");
    }
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
    if (!pageChanged && $("viewport").classList.contains("compact")) {
      pages[page].querySelector(".is-current")?.scrollIntoView({
        block: "center",
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
      });
    }
    settleTimer = setTimeout(
      () => {
        $("stage").dataset.settled = "true";
      },
      pageChanged ? 1150 : theme === "architecture" ? 1000 : 850,
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
      `<p class="notes-meta">${esc(deck.source.title)} · ${esc(deck.source.version || "")}<br>取材页码：${s.sources.map(esc).join("、")}。上屏文字为节选提炼，原文保留在下方。</p><section class="notes-section"><h3>${esc(s.pattern)} · ${esc(s.patternName)}</h3><p>${styleDescription}</p><ol>${s.cues.map((cue) => `<li>${esc(cue)}</li>`).join("")}</ol></section><section class="notes-section"><h3>对应原稿</h3>${s.sources.map((n) => `<h4>原稿第 ${esc(n)} 页</h4><div class="original">${esc(deck.source.pages[String(n)])}</div>`).join("")}</section><p class="notes-meta">独立 H5 试作。两款模板已人工适配；配图如标注“AI 视觉示意”，仅用于营造概念场景，不代表真实门店。本页播放不调用模型。尚未接入文档上传、任意模板自动适配或正式生成入口。</p>`,
    );
  };
  $("stage").addEventListener("click", (event) => {
    const button = event.target.closest("[data-image]");
    const asset = deck.assets?.[button?.dataset.image];
    if (!asset?.src?.match(/^data:image\/(png|jpeg|webp);base64,/)) return;
    openDialog(
      "概念视觉",
      `<figure class="image-detail"><img src="${esc(asset.src)}" alt="${esc(asset.alt)}"><figcaption>${esc(asset.caption)}</figcaption></figure>`,
    );
  });
  function setPresentation(enabled) {
    document.body.classList.toggle("presenting", enabled);
    $("exit-present").hidden = !enabled;
    fit();
  }
  $("present").onclick = () => setPresentation(true);
  $("exit-present").onclick = () => setPresentation(false);
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
    if (
      event.key === "Escape" &&
      document.body.classList.contains("presenting")
    ) {
      setPresentation(false);
      return;
    }
    if (event.key.toLowerCase() === "f") {
      event.preventDefault();
      setPresentation(!document.body.classList.contains("presenting"));
      return;
    }
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
