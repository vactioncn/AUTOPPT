/* Standalone runtime: no imports, remote requests, eval, or framework dependency. */
(async function () {
  "use strict";
  const deck = JSON.parse(document.getElementById("deck-data").textContent);
  const stage = document.getElementById("stage"),
    viewport = document.getElementById("viewport");
  const toolbar = document.getElementById("toolbar"),
    counter = document.getElementById("counter");
  const notes = document.getElementById("notes"),
    overview = document.getElementById("overview");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const fonts = {
    sans: "Noto Sans SC Variable",
    serif: "Noto Serif SC Variable",
    custom: "Presentation Custom",
  };
  let index = 0,
    step = 0,
    incremental = false,
    timer = null,
    current = null,
    animations = [],
    hideTimer,
    touch = null,
    motion = !deck.staticMode;
  const audio = document.getElementById("speech-audio"),
    speechStatus = document.getElementById("speech-status"),
    speechGate = document.getElementById("speech-gate");
  let narrating = false,
    clipIndex = 0,
    audioKey = "",
    speechTicket = 0,
    silentTimer = null,
    finished = false;
  let gapRemaining = 0,
    gapStarted = 0;
  function waitSpeechGap() {
    gapStarted = performance.now();
    speechProgress("表达停顿中…");
    silentTimer = setTimeout(() => {
      gapRemaining = 0;
      gapStarted = 0;
      speechEnded(true);
    }, gapRemaining);
  }
  const stamp = (seconds) =>
    `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
  function speechProgress(message = "") {
    if (!deck.narration) return;
    speechStatus.hidden = false;
    speechStatus.textContent =
      message ||
      `AI 合成口播 · ${deck.narration.voiceName} · 第 ${index + 1} 页 · ${deck.pages[index].clips.length ? stamp(audio.currentTime || 0) + " / " + stamp(Number.isFinite(audio.duration) ? audio.duration : 0) : "本页无口播，停留 3 秒"}`;
  }
  function speechEnded(afterPause = false) {
    if (!narrating) return;
    const gap = deck.pages[index].clips[clipIndex]?.pauseAfter || 0;
    if (!afterPause && gap > 0) {
      gapRemaining = gap * 1000;
      waitSpeechGap();
      return;
    }
    if (clipIndex + 1 < deck.pages[index].clips.length) {
      clipIndex++;
      void playSpeech();
    } else if (!go(index + 1)) {
      stop();
      finished = true;
      speechProgress("演讲已结束 · 点击开始口播可从头重播");
    }
  }
  async function playSpeech() {
    if (!narrating) return;
    clearTimeout(silentTimer);
    const ticket = ++speechTicket;
    if (gapRemaining > 0) {
      waitSpeechGap();
      return;
    }
    const p = deck.pages[index],
      clip = p.clips[clipIndex];
    speechProgress();
    if (!clip) {
      audio.pause();
      silentTimer = setTimeout(speechEnded, (p.silentDuration || 3) * 1000);
      return;
    }
    const key = `${index}:${clipIndex}`;
    if (audioKey !== key || audio.ended) {
      audioKey = key;
      audio.src = deck.audio[clip.file];
      audio.load();
    }
    try {
      await audio.play();
      if (ticket === speechTicket) speechGate.hidden = true;
    } catch (error) {
      if (ticket !== speechTicket || error.name === "AbortError") return;
      stop();
      if (error.name === "NotAllowedError") {
        speechGate.hidden = false;
        document.getElementById("speech-gate-message").textContent =
          "浏览器需要一次点击才能播放声音。点击后将自动讲述并翻页。";
      } else
        speechProgress(
          "音频无法播放，请点击开始口播重试，或使用其他浏览器打开此文件。",
        );
      showControls();
    }
  }
  audio.addEventListener("ended", () => speechEnded());
  audio.addEventListener("timeupdate", () => speechProgress());
  audio.addEventListener("error", () => {
    if (!deck.narration || !audio.src) return;
    stop();
    speechProgress("本页音频无法读取，请点击开始口播重试。");
    audioKey = "";
    showControls();
  });
  document.getElementById("speech-start").addEventListener("click", () => {
    speechGate.hidden = true;
    play();
  });
  if (deck.narration) {
    document.getElementById("interval").hidden = true;
    document.getElementById("steps").hidden = true;
    document.getElementById("autoplay").textContent = "开始口播";
  }
  if (deck.staticMode) {
    document.getElementById("motion").hidden = true;
    document.getElementById("steps").hidden = true;
  }
  const canvas = document.createElement("canvas"),
    ctx = canvas.getContext("2d");
  const button = (id, fn) =>
    document.getElementById(id).addEventListener("click", fn);
  function fit() {
    const p = deck.pages[index];
    if (!p) return;
    stage.style.width = p.width + "px";
    stage.style.height = p.height + "px";
    stage.style.transform = `translate(-50%,-50%) scale(${Math.min(viewport.clientWidth / p.width, viewport.clientHeight / p.height)})`;
  }
  function cancelAnimations() {
    animations.forEach((a) => a.cancel());
    animations = [];
  }
  function allSteps() {
    return [...new Set(deck.pages[index].layers.map((l) => l.step))].sort(
      (a, b) => a - b,
    );
  }
  function maxStep() {
    return Math.max(0, ...deck.pages[index].layers.map((l) => l.step));
  }
  function updateCounter() {
    counter.textContent = `${index + 1} / ${deck.pages.length}${incremental ? " · " + allSteps().filter((s) => s <= step).length + " / " + allSteps().length + " 步" : ""}`;
    document.getElementById("previous").disabled = index === 0 && step === 0;
    document.getElementById("next").disabled =
      index === deck.pages.length - 1 && (!incremental || step >= maxStep());
  }
  function frames(effect) {
    if (effect === "rise")
      return [
        { opacity: 0, transform: "translateY(24px)" },
        { opacity: 1, transform: "translateY(0)" },
      ];
    if (effect === "zoom")
      return [
        { opacity: 0, transform: "scale(.94)" },
        { opacity: 1, transform: "scale(1)" },
      ];
    if (effect === "wipe" || effect === "draw")
      return [
        { opacity: 0, clipPath: "inset(0 100% 0 0)" },
        { opacity: 1, clipPath: "inset(0 0 0 0)" },
      ];
    return [{ opacity: 0 }, { opacity: 1 }];
  }
  function reveal() {
    cancelAnimations();
    current.querySelectorAll(".layer").forEach((node, i) => {
      const l = deck.pages[index].layers[i],
        visible = !incremental || l.step <= step;
      node.hidden = !visible;
      if (!visible || l.effect === "none" || !motion || reduced.matches) return;
      if (incremental && l.step < step) return;
      const order = allSteps().indexOf(l.step);
      animations.push(
        node.querySelector(".content").animate(frames(l.effect), {
          duration: l.duration,
          delay: l.delay + (incremental ? 0 : Math.max(0, order) * 430),
          easing: "cubic-bezier(.22,1,.36,1)",
          fill: "backwards",
        }),
      );
    });
    updateCounter();
  }
  function renderText(l, content) {
    const span = document.createElement("span");
    span.className = "text";
    span.textContent = l.text;
    Object.assign(span.style, {
      fontFamily: `"${fonts[l.font]}","${fonts.sans}",sans-serif`,
      fontWeight: String(l.fontWeight),
      fontSize: l.fontSize + "px",
      color: l.color,
      letterSpacing: l.letterSpacing + "px",
      lineHeight: String(l.lineHeight),
      textAlign: l.align,
    });
    content.append(span);
    if (l.fit && !l.text.includes("\n")) {
      // Match the detected ink box, including fonts whose ascenders leave top whitespace.
      ctx.font = `${l.fontWeight} ${l.fontSize}px "${fonts[l.font]}"`;
      ctx.letterSpacing = l.letterSpacing + "px";
      const m = ctx.measureText(l.text),
        inkHeight = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
      const inkWidth = m.actualBoundingBoxLeft + m.actualBoundingBoxRight;
      const sx = l.w / (inkWidth || l.w),
        sy = l.h / (inkHeight || l.h);
      const baseline =
        (l.fontSize * l.lineHeight -
          ((m.fontBoundingBoxAscent || l.fontSize * 0.88) +
            (m.fontBoundingBoxDescent || l.fontSize * 0.12))) /
          2 +
        (m.fontBoundingBoxAscent || l.fontSize * 0.88);
      span.style.whiteSpace = "pre";
      span.style.width = "max-content";
      span.style.transformOrigin = "0 0";
      span.style.transform = `scale(${sx},${sy}) translate(${m.actualBoundingBoxLeft}px,${m.actualBoundingBoxAscent - baseline}px)`;
      span.dataset.scale = `${sx.toFixed(3)},${sy.toFixed(3)}`;
    } else {
      span.style.width = l.w + "px";
      span.style.whiteSpace = "pre-wrap";
    }
  }
  function render(animate = true, direction = 1) {
    cancelAnimations();
    const p = deck.pages[index];
    if (current) {
      current.remove();
      current = null;
    }
    const scene = document.createElement("section");
    scene.className = "scene";
    scene.setAttribute("aria-label", p.title || `第 ${index + 1} 页`);
    const bg = document.createElement("img");
    bg.className = "background";
    bg.src = p.background;
    bg.alt = "";
    scene.append(bg);
    for (const [i, l] of p.layers.entries()) {
      const outer = document.createElement("div");
      outer.className = "layer";
      outer.dataset.id = l.id;
      Object.assign(outer.style, {
        left: l.x + "px",
        top: l.y + "px",
        width: l.w + "px",
        height: l.h + "px",
        transform: `rotate(${l.rotation}deg)`,
      });
      const content = document.createElement("div");
      content.className = "content";
      outer.append(content);
      if (l.type === "text") renderText(l, content);
      else {
        const img = document.createElement("img");
        img.src = l.asset;
        img.alt = l.label || "";
        img.draggable = false;
        content.append(img);
      }
      if (deck.preview)
        outer.addEventListener("click", () =>
          parent.postMessage({ type: "motion-select", id: l.id }, "*"),
        );
      scene.append(outer);
    }
    stage.append(scene);
    current = scene;
    fit();
    notes.textContent = p.notes || "本页没有演讲备注。";
    const original = document.getElementById("original");
    original.src = p.original || "";
    reveal();
    if (animate && motion && !reduced.matches)
      animations.push(
        scene.animate(
          [
            { opacity: 0, transform: `translateX(${direction * 24}px)` },
            { opacity: 1, transform: "translateX(0)" },
          ],
          { duration: 420, easing: "ease-out" },
        ),
      );
    document.title = `${index + 1} / ${deck.pages.length} · ${deck.title}`;
    document.getElementById("progress").style.width =
      ((index + 1) / deck.pages.length) * 100 + "%";
  }
  function go(next) {
    if (next < 0 || next >= deck.pages.length) return false;
    const direction = next >= index ? 1 : -1;
    audio.pause();
    clearTimeout(silentTimer);
    speechTicket++;
    clipIndex = 0;
    gapRemaining = 0;
    gapStarted = 0;
    audioKey = "";
    finished = false;
    index = next;
    step = incremental ? 0 : maxStep();
    render(true, direction);
    speechProgress();
    if (narrating) void playSpeech();
    return true;
  }
  function advance() {
    if (incremental && step < maxStep()) {
      step = allSteps().find((s) => s > step);
      reveal();
      return true;
    }
    return go(index + 1);
  }
  function back() {
    if (incremental && step > 0) {
      step = [0, ...allSteps()].filter((s) => s < step).pop() || 0;
      reveal();
      return;
    }
    if (go(index - 1) && incremental) {
      step = maxStep();
      reveal();
    }
  }
  function stop() {
    clearInterval(timer);
    timer = null;
    narrating = false;
    speechTicket++;
    clearTimeout(silentTimer);
    if (gapStarted) {
      gapRemaining = Math.max(
        0,
        gapRemaining - (performance.now() - gapStarted),
      );
      gapStarted = 0;
    }
    audio.pause();
    document.getElementById("autoplay").textContent = deck.narration
      ? "开始口播"
      : "自动播放";
    document.getElementById("autoplay").setAttribute("aria-pressed", "false");
  }
  function play() {
    if (deck.narration) {
      if (narrating) {
        stop();
        return;
      }
      if (finished) go(0);
      incremental = false;
      narrating = true;
      speechGate.hidden = true;
      document.getElementById("autoplay").textContent = "暂停口播";
      document.getElementById("autoplay").setAttribute("aria-pressed", "true");
      reveal();
      void playSpeech();
      return;
    }
    if (timer) {
      stop();
      return;
    }
    if (index === deck.pages.length - 1) go(0);
    document.getElementById("autoplay").textContent = "暂停";
    document.getElementById("autoplay").setAttribute("aria-pressed", "true");
    timer = setInterval(
      () => {
        if (!advance()) stop();
      },
      Number(document.getElementById("interval").value) * 1000,
    );
  }
  const toggle = (id) => {
    const e = document.getElementById(id);
    e.hidden = !e.hidden;
  };
  function showControls() {
    toolbar.classList.remove("quiet");
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (!toolbar.contains(document.activeElement))
        toolbar.classList.add("quiet");
    }, 3200);
  }
  button("next", () => {
    stop();
    advance();
  });
  button("previous", () => {
    stop();
    back();
  });
  button("replay", () => {
    const resume = narrating;
    stop();
    clipIndex = 0;
    gapRemaining = 0;
    gapStarted = 0;
    audioKey = "";
    finished = false;
    step = 0;
    render();
    if (resume) play();
  });
  button("autoplay", play);
  document.getElementById("interval").addEventListener("change", () => {
    if (timer) {
      stop();
      play();
    }
  });
  button("steps", () => {
    incremental = !incremental;
    step = 0;
    document
      .getElementById("steps")
      .setAttribute("aria-pressed", String(incremental));
    document.getElementById("steps").textContent = incremental
      ? "逐步讲述"
      : "整页播放";
    reveal();
  });
  button("motion", () => {
    motion = !motion;
    document
      .getElementById("motion")
      .setAttribute("aria-pressed", String(motion));
    reveal();
  });
  button("fullscreen", () => {
    (document.fullscreenElement
      ? document.exitFullscreen()
      : document.documentElement.requestFullscreen()
    ).catch(() => {});
  });
  button("show-notes", () => toggle("notes"));
  button("show-overview", () => toggle("overview"));
  button("close-overview", () => toggle("overview"));
  button("compare", () => toggle("original"));
  for (const [i, p] of deck.pages.entries()) {
    const b = document.createElement("button");
    b.textContent = `${p.number || i + 1}. ${p.title || "演讲页面"}`;
    b.onclick = () => {
      stop();
      go(i);
      overview.hidden = true;
    };
    overview.append(b);
  }
  document.addEventListener("keydown", (e) => {
    if (
      ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName) ||
      e.ctrlKey ||
      e.metaKey ||
      e.altKey
    )
      return;
    if (["ArrowRight", "ArrowDown", "PageDown", " "].includes(e.key)) {
      e.preventDefault();
      stop();
      advance();
    } else if (["ArrowLeft", "ArrowUp", "PageUp"].includes(e.key)) {
      e.preventDefault();
      stop();
      back();
    } else if (e.key === "Home") {
      e.preventDefault();
      stop();
      go(0);
    } else if (e.key === "End") {
      e.preventDefault();
      stop();
      go(deck.pages.length - 1);
    } else if (e.key.toLowerCase() === "f")
      document.getElementById("fullscreen").click();
    else if (e.key.toLowerCase() === "n") toggle("notes");
    else if (e.key.toLowerCase() === "g") toggle("overview");
    else if (e.key.toLowerCase() === "b") toggle("blackout");
    else if (e.key.toLowerCase() === "r")
      document.getElementById("replay").click();
    else if (e.key.toLowerCase() === "p") play();
    else if (e.key === "Escape") {
      overview.hidden = true;
      notes.hidden = true;
      document.getElementById("blackout").hidden = true;
      document.getElementById("original").hidden = true;
      stop();
    }
    showControls();
  });
  viewport.addEventListener(
    "touchstart",
    (e) => {
      touch = {
        x: e.changedTouches[0].clientX,
        y: e.changedTouches[0].clientY,
      };
    },
    { passive: true },
  );
  viewport.addEventListener(
    "touchend",
    (e) => {
      if (!touch) return;
      const dx = e.changedTouches[0].clientX - touch.x,
        dy = e.changedTouches[0].clientY - touch.y;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) {
        stop();
        dx < 0 ? advance() : back();
      }
      touch = null;
    },
    { passive: true },
  );
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stop();
  });
  document.addEventListener("pointermove", showControls);
  document.addEventListener("focusin", showControls);
  window.addEventListener("resize", fit);
  new ResizeObserver(fit).observe(viewport);
  reduced.addEventListener("change", () => reveal());
  if (deck.preview)
    window.addEventListener("message", (e) => {
      if (e.source !== parent || e.data?.type !== "motion-update") return;
      const updates = e.data.layers;
      if (!Array.isArray(updates)) return;
      deck.pages[index].layers = updates.map((l) => ({
        ...l,
        asset: deck.pages[index].layers.find((p) => p.id === l.id)?.asset,
      }));
      render(false);
    });
  await document.fonts.ready;
  // Load dynamically inserted CJK glyph ranges before measuring their ink bounds.
  const fontGroups = new Map();
  for (const l of deck.pages
    .flatMap((p) => p.layers)
    .filter((l) => l.type === "text")) {
    const key = `${l.fontWeight} 16px "${fonts[l.font]}"`;
    if (!fontGroups.has(key)) fontGroups.set(key, new Set());
    for (const c of l.text) fontGroups.get(key).add(c);
  }
  await Promise.all(
    [...fontGroups].map(([font, characters]) =>
      document.fonts.load(font, [...characters].join("")).catch(() => {}),
    ),
  );
  await Promise.all(
    deck.pages
      .slice(0, 1)
      .flatMap((p) => [
        p.background,
        ...p.layers.filter((l) => l.type === "image").map((l) => l.asset),
      ])
      .filter(Boolean)
      .map(
        (src) =>
          new Promise((resolve) => {
            const im = new Image();
            im.onload = resolve;
            im.onerror = resolve;
            im.src = src;
          }),
      ),
  );
  document.getElementById("loading").remove();
  render(false);
  speechProgress();
  showControls();
  window.__motionReady = true;
  if (deck.narration && !deck.preview && !document.hidden) play();
})();
