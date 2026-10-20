/* Standalone runtime: no imports, remote requests, eval, or framework dependency. */
(async function () {
  "use strict";
  const deck = JSON.parse(document.getElementById("deck-data").textContent);
  for (const node of document.querySelectorAll("script.deck-page")) {
    deck.pages.push(JSON.parse(node.textContent));
    node.remove();
  }
  const audioData = document.getElementById("deck-audio");
  if (audioData) {
    Object.assign(deck.audio, JSON.parse(audioData.textContent));
    audioData.remove();
  }
  const media = new Map();
  function mediaSource(reference) {
    if (!reference?.startsWith("asset:")) return reference || "";
    if (media.has(reference)) return media.get(reference);
    const node = document.getElementById(reference.slice(6));
    if (!node) throw new Error("演示素材缺失，请重新导出完整 HTML");
    const encoded = node.textContent,
      comma = encoded.indexOf(",");
    const mime = encoded.slice(5, comma).replace(/;base64$/, "");
    const buffers = [];
    // Decode bounded pieces only when a page or clip is used. Remove its
    // encoded DOM block after creating a reusable local Blob URL.
    for (let i = comma + 1; i < encoded.length; i += 65536) {
      const bytes = atob(encoded.slice(i, i + 65536));
      buffers.push(Uint8Array.from(bytes, (c) => c.charCodeAt(0)));
    }
    const url = URL.createObjectURL(new Blob(buffers, { type: mime }));
    media.set(reference, url);
    node.remove();
    return url;
  }
  window.addEventListener("pagehide", (event) => {
    if (!event.persisted)
      for (const url of media.values()) URL.revokeObjectURL(url);
  });
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
  let audition = false,
    auditionTicket = 0,
    selectedLayer = "",
    composing = false;
  const editHistory = [],
    redoHistory = [];
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
      audio.src = mediaSource(deck.audio[clip.file]);
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
  let fontLoadFailed = false;
  const canvas = document.createElement("canvas"),
    ctx = canvas.getContext("2d");
  const button = (id, fn) =>
    document.getElementById(id).addEventListener("click", fn);
  function fit() {
    const p = deck.pages[index];
    if (!p) return;
    stage.style.setProperty(
      "--editor-scale",
      Math.min(
        viewport.clientWidth / p.width,
        viewport.clientHeight / p.height,
      ),
    );
    stage.style.width = p.width + "px";
    stage.style.height = p.height + "px";
    stage.style.transform = `translate(-50%,-50%) scale(${Math.min(viewport.clientWidth / p.width, viewport.clientHeight / p.height)})`;
    if (deck.preview)
      current?.querySelectorAll(".layer.selected").forEach(keepHandlesInCanvas);
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
    document.getElementById("next").textContent =
      incremental && step < maxStep() ? "下一步" : "下一页";
    document.getElementById("previous").textContent =
      incremental && step > 0 ? "上一步" : "上一页";
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
  function endAudition() {
    auditionTicket++;
    audition = false;
    document.body.classList.remove("audition");
    applyMode();
    reveal(false);
    parent.postMessage({ type: "motion-audition", playing: false }, "*");
  }
  function auditionPage() {
    endAudition();
    document.activeElement?.blur();
    audition = true;
    document.body.classList.add("audition");
    motion = true;
    incremental = false;
    reveal(true);
    const ticket = ++auditionTicket;
    parent.postMessage({ type: "motion-audition", playing: true }, "*");
    Promise.allSettled(animations.map((a) => a.finished)).then(() => {
      if (ticket === auditionTicket) endAudition();
    });
  }
  function reveal(animate = true) {
    cancelAnimations();
    current.querySelectorAll(".layer").forEach((node, i) => {
      const l = deck.pages[index].layers[i],
        visible = !incremental || l.step <= step;
      node.hidden = !visible;
      if (
        !animate ||
        (deck.preview && !audition) ||
        !visible ||
        l.effect === "none" ||
        !motion
      )
        return;
      if (incremental && l.step < step) return;
      const order = allSteps().indexOf(l.step);
      const p = deck.pages[index];
      const authored = p.choreography && p.choreography !== "custom";
      const plan = planEntrance(p, l, i, incremental, reduced.matches);
      animations.push(
        node
          .querySelector(".content")
          .animate(
            authored || reduced.matches ? plan.frames : frames(l.effect),
            {
              duration:
                authored || reduced.matches ? plan.duration : l.duration,
              delay:
                authored || reduced.matches
                  ? plan.delay
                  : l.delay + (incremental ? 0 : Math.max(0, order) * 430),
              easing: plan.easing,
              fill: "backwards",
            },
          ),
      );
    });
    const p = deck.pages[index];
    if (
      animate &&
      (!deck.preview || audition) &&
      motion &&
      !reduced.matches &&
      ["story", "chapter"].includes(p.choreography) &&
      (!incremental || step === 0)
    ) {
      animations.push(
        current.querySelector(".background").animate(
          [
            { transform: "scale(1.025)", opacity: 0.82 },
            { transform: "scale(1)", opacity: 1 },
          ],
          { duration: 1200, easing: "cubic-bezier(.16,1,.3,1)" },
        ),
      );
    }
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
  function inspectLayout() {
    if (!deck.preview) return;
    const issues = fontLoadFailed ? ["字体未能加载，请重新打开预览"] : [];
    for (const l of deck.pages[index].layers) {
      if (l.type !== "text" || l.fit) continue;
      const node = [...current.querySelectorAll(".layer")]
        .find((n) => n.dataset.id === l.id)
        ?.querySelector(".text");
      if (node && (node.scrollHeight > l.h + 2 || node.scrollWidth > l.w + 2))
        issues.push(l.label || l.text.slice(0, 16));
    }
    parent.postMessage(
      {
        type: "motion-check",
        pageId: deck.pages[index].id,
        layers: JSON.stringify(
          deck.pages[index].layers.map(({ asset, ...l }) => l),
        ),
        issues,
      },
      "*",
    );
  }
  function applyMode() {
    const mode = deck.preview ? "whole" : deck.pages[index].playbackMode;
    // Old decks keep the presenter's manual mode when moving between pages.
    if (!mode) return;
    incremental = mode === "steps" && !deck.narration;
    motion = mode !== "whole" && !deck.staticMode && !deck.preview;
    document.getElementById("steps").textContent = incremental
      ? "逐步讲述"
      : "整页播放";
    document
      .getElementById("steps")
      .setAttribute("aria-pressed", String(incremental));
    document
      .getElementById("motion")
      .setAttribute("aria-pressed", String(motion));
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
    bg.src = mediaSource(p.background);
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
        img.src = mediaSource(l.asset);
        img.alt = l.label || "";
        img.draggable = false;
        content.append(img);
      }
      if (deck.preview) {
        outer.addEventListener("click", () => selectLayer(l.id));
        if (deck.layered) attachEditor(outer, l);
      }
      scene.append(outer);
    }
    stage.append(scene);
    current = scene;
    fit();
    if (deck.preview) selectLayer(selectedLayer, false);
    notes.textContent = p.notes || "本页没有演讲备注。";
    const original = document.getElementById("original");
    original.src = mediaSource(p.original);
    reveal(animate);
    inspectLayout();
    if (
      !deck.preview &&
      animate &&
      motion &&
      !reduced.matches &&
      (!p.choreography || p.choreography === "custom")
    )
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
    applyMode();
    step = incremental ? 0 : maxStep();
    render(true, direction);
    speechProgress();
    if (narrating) void playSpeech();
    return true;
  }
  function advance() {
    if (editing) return false;
    if (incremental && step < maxStep()) {
      step = allSteps().find((s) => s > step);
      reveal();
      return true;
    }
    return go(index + 1);
  }
  function back() {
    if (editing) return;
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
    if (editing) return;
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
  const editButton = document.getElementById("edit-page");
  let editing = false;
  if (deck.managed && window.opener) {
    editButton.hidden = false;
    editButton.onclick = () => {
      if (editing) {
        editing = false;
        editButton.textContent = "暂停改字";
        showControls();
        return;
      }
      stop();
      animations.forEach((a) => a.finish());
      editing = true;
      editButton.textContent = "等待保存 · 点击取消";
      window.opener.postMessage(
        {
          type: "motion-edit",
          deckId: deck.deckId,
          pageId: deck.pages[index].id,
        },
        location.origin,
      );
      window.opener.focus();
    };
    window.addEventListener("message", async (e) => {
      if (
        e.source !== window.opener ||
        e.origin !== location.origin ||
        e.data?.type !== "motion-saved" ||
        e.data.deckId !== deck.deckId
      )
        return;
      const p = deck.pages.find((p) => p.id === e.data.pageId);
      if (!p || !editing) return;
      p.layers = e.data.layers;
      p.playbackMode = e.data.playbackMode;
      p.choreography = e.data.choreography || "custom";
      await Promise.all(
        p.layers
          .filter((l) => l.type === "text")
          .map((l) =>
            document.fonts.load(
              `${l.fontWeight} 16px "${fonts[l.font]}"`,
              l.text,
            ),
          ),
      );
      applyMode();
      render(false);
      editing = false;
      editButton.textContent = "暂停改字";
      speechProgress(
        deck.narration ? "画面已更新 · 已有口播保持原样，点击开始口播继续" : "",
      );
      showControls();
    });
  }
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
      deck.preview ||
      e.target.isContentEditable ||
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
      if (deck.preview) return;
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
  function selectLayer(id, notify = true) {
    selectedLayer = id;
    current
      ?.querySelectorAll(".layer")
      .forEach((n) => n.classList.toggle("selected", n.dataset.id === id));
    current?.querySelectorAll(".layer.selected").forEach(keepHandlesInCanvas);
    if (notify) parent.postMessage({ type: "motion-select", id }, "*");
  }
  function rememberEdit() {
    const snapshot = JSON.stringify(deck.pages[index].layers);
    if (editHistory.at(-1) !== snapshot) editHistory.push(snapshot);
    if (editHistory.length > 80) editHistory.shift();
    redoHistory.length = 0;
  }
  function emitEdit() {
    parent.postMessage(
      {
        type: "motion-canvas-edit",
        pageId: deck.pages[index].id,
        layers: deck.pages[index].layers.map(({ asset, ...l }) => l),
      },
      "*",
    );
    Promise.all(
      deck.pages[index].layers
        .filter((l) => l.type === "text")
        .map((l) =>
          document.fonts.load(
            `${l.fontWeight} 16px "${fonts[l.font]}"`,
            l.text,
          ),
        ),
    )
      .then(() => requestAnimationFrame(inspectLayout))
      .catch(() => {
        fontLoadFailed = true;
        inspectLayout();
      });
  }
  function undoCanvas(redo = false) {
    const from = redo ? redoHistory : editHistory,
      to = redo ? editHistory : redoHistory;
    if (!from.length) return;
    endAudition();
    to.push(JSON.stringify(deck.pages[index].layers));
    deck.pages[index].layers = JSON.parse(from.pop());
    render(false);
    emitEdit();
  }
  function placeLayer(node, l) {
    Object.assign(node.style, {
      left: l.x + "px",
      top: l.y + "px",
      width: l.w + "px",
      height: l.h + "px",
      transform: `rotate(${l.rotation}deg)`,
    });
    const text = node.querySelector(".text");
    if (text && !l.fit) text.style.width = l.w + "px";
    keepHandlesInCanvas(node);
  }
  function keepHandlesInCanvas(node) {
    if (!node.classList.contains("selected")) return;
    const bounds = stage.getBoundingClientRect();
    const scale = bounds.width / deck.pages[index].width;
    const l = deck.pages[index].layers.find((l) => l.id === node.dataset.id);
    const angle = ((l?.rotation || 0) * Math.PI) / 180;
    for (const handle of node.querySelectorAll(".move-handle,.resize-handle")) {
      handle.style.translate = "none";
      const r = handle.getBoundingClientRect();
      if (!r.width) continue;
      const dx =
        r.left < bounds.left + 2
          ? bounds.left + 2 - r.left
          : Math.min(0, bounds.right - 2 - r.right);
      const dy =
        r.top < bounds.top + 2
          ? bounds.top + 2 - r.top
          : Math.min(0, bounds.bottom - 2 - r.bottom);
      // Handle offsets are in the rotated layer's local coordinates.
      handle.style.translate = `${(dx * Math.cos(angle) + dy * Math.sin(angle)) / scale}px ${(-dx * Math.sin(angle) + dy * Math.cos(angle)) / scale}px`;
    }
  }
  function attachEditor(outer, initial) {
    const getLayer = () =>
      deck.pages[index].layers.find((l) => l.id === initial.id);
    const text = outer.querySelector(".text");
    if (text) {
      text.contentEditable = "plaintext-only";
      text.spellcheck = false;
      text.setAttribute("role", "textbox");
      text.setAttribute("aria-multiline", "true");
      text.setAttribute(
        "aria-label",
        `编辑文字：${initial.label || initial.text.slice(0, 20)}`,
      );
      text.addEventListener("focus", () => {
        if (audition) endAudition();
        selectLayer(initial.id);
      });
      text.addEventListener("compositionstart", () => {
        rememberEdit();
        composing = true;
      });
      const input = () => {
        const value = text.innerText.replace(/\r\n/g, "\n");
        if (!composing && value !== getLayer().text) rememberEdit();
        getLayer().text = value;
        if (!composing) emitEdit();
      };
      text.addEventListener("compositionend", () => {
        composing = false;
        input();
      });
      text.addEventListener("beforeinput", () => {
        if (!composing) rememberEdit();
      });
      text.addEventListener("input", input);
      text.addEventListener("paste", (e) => {
        e.preventDefault();
        document.execCommand(
          "insertText",
          false,
          e.clipboardData.getData("text/plain"),
        );
      });
      text.addEventListener("drop", (e) => e.preventDefault());
      text.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && !e.isComposing) {
          text.blur();
          outer.querySelector(".move-handle")?.focus();
        }
      });
    }
    for (const resize of [false, true]) {
      const handle = document.createElement("button");
      handle.type = "button";
      handle.className = resize ? "resize-handle" : "move-handle";
      const icon = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "svg",
      );
      icon.setAttribute("viewBox", "0 0 24 24");
      icon.setAttribute("aria-hidden", "true");
      const path = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "path",
      );
      path.setAttribute(
        "d",
        resize
          ? "M6 6l12 12M10 18h8v-8"
          : "M12 3v18M3 12h18M8 7l4-4 4 4M8 17l4 4 4-4M7 8l-4 4 4 4M17 8l4 4-4 4",
      );
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", "currentColor");
      path.setAttribute("stroke-width", "1.7");
      path.setAttribute("stroke-linecap", "round");
      path.setAttribute("stroke-linejoin", "round");
      icon.append(path);
      handle.append(icon);
      handle.setAttribute(
        "aria-label",
        `${resize ? "调整范围" : "移动"}：${initial.label || initial.id}`,
      );
      handle.title = resize
        ? "拖动调整文本范围；方向键微调，Shift 加速"
        : "拖动移动；方向键微调，Shift 加速";
      const applyDelta = (start, dx, dy) => {
        const l = getLayer(),
          p = deck.pages[index];
        if (resize) {
          const angle = (start.rotation * Math.PI) / 180;
          l.w = Math.min(
            p.width - start.x,
            Math.max(16, start.w + dx * Math.cos(angle) + dy * Math.sin(angle)),
          );
          l.h = Math.min(
            p.height - start.y,
            Math.max(16, start.h - dx * Math.sin(angle) + dy * Math.cos(angle)),
          );
        } else {
          l.x = Math.min(p.width - l.w, Math.max(0, start.x + dx));
          l.y = Math.min(p.height - l.h, Math.max(0, start.y + dy));
        }
        for (const key of ["x", "y", "w", "h"])
          l[key] = Math.floor(l[key] * 100) / 100;
        placeLayer(outer, l);
      };
      let drag = null;
      handle.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        if (audition) endAudition();
        selectLayer(initial.id);
        text?.blur();
        handle.focus();
        rememberEdit();
        drag = {
          x: e.clientX,
          y: e.clientY,
          layer: { ...getLayer() },
          scale: stage.getBoundingClientRect().width / deck.pages[index].width,
        };
        handle.setPointerCapture(e.pointerId);
      });
      handle.addEventListener("pointermove", (e) => {
        if (!drag) return;
        applyDelta(
          drag.layer,
          (e.clientX - drag.x) / drag.scale,
          (e.clientY - drag.y) / drag.scale,
        );
      });
      const finish = () => {
        if (drag) {
          drag = null;
          emitEdit();
        }
      };
      handle.addEventListener("pointerup", finish);
      handle.addEventListener("lostpointercapture", finish);
      handle.addEventListener("pointercancel", () => {
        if (!drag) return;
        Object.assign(getLayer(), drag.layer);
        placeLayer(outer, getLayer());
        finish();
      });
      handle.addEventListener("keydown", (e) => {
        const delta = {
          ArrowLeft: [-1, 0],
          ArrowRight: [1, 0],
          ArrowUp: [0, -1],
          ArrowDown: [0, 1],
        }[e.key];
        if (!delta) return;
        e.preventDefault();
        rememberEdit();
        applyDelta(
          { ...getLayer() },
          delta[0] * (e.shiftKey ? 10 : 1),
          delta[1] * (e.shiftKey ? 10 : 1),
        );
        emitEdit();
      });
      outer.append(handle);
    }
  }
  if (deck.preview) {
    document.addEventListener("keydown", (e) => {
      if (composing || e.isComposing) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        undoCanvas(e.shiftKey);
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        parent.postMessage({ type: "motion-save-request" }, "*");
      }
    });
    window.addEventListener("message", async (e) => {
      if (e.source !== parent) return;
      if (e.data?.type === "motion-lock") {
        document.body.classList.toggle("editor-locked", !!e.data.locked);
        if (e.data.locked) document.activeElement?.blur();
        current.querySelectorAll(".text[contenteditable]").forEach((n) => {
          n.contentEditable = e.data.locked ? "false" : "plaintext-only";
        });
        return;
      }
      if (e.data?.type === "motion-replay") return auditionPage();
      if (e.data?.type === "motion-stop") return endAudition();
      if (e.data?.type === "motion-select-layer")
        return selectLayer(e.data.id, false);
      if (e.data?.type === "motion-undo") return undoCanvas();
      if (e.data?.type !== "motion-update" || !Array.isArray(e.data.layers))
        return;
      if (composing) return;
      const p = deck.pages[index];
      const next = e.data.layers.map((l) => ({
        ...l,
        asset: p.layers.find((old) => old.id === l.id)?.asset,
      }));
      const sequenceChanged =
        p.choreography !== (e.data.choreography || "custom");
      p.choreography = e.data.choreography || "custom";
      // Input echoes must not replace the focused node or disturb the IME/caret.
      const changed = next.filter(
        (l, i) => JSON.stringify(l) !== JSON.stringify(p.layers[i]),
      );
      if (audition && (changed.length || sequenceChanged)) endAudition();
      if (changed.length) rememberEdit();
      p.layers = next;
      for (const l of changed) {
        const node = [...current.querySelectorAll(".layer")].find(
          (n) => n.dataset.id === l.id,
        );
        if (!node) continue;
        placeLayer(node, l);
        if (l.type === "text") {
          const content = node.querySelector(".content");
          content.replaceChildren();
          renderText(l, content);
          // Replace handlers as a unit only for changes originating in the inspector.
          node
            .querySelectorAll(".move-handle,.resize-handle")
            .forEach((h) => h.remove());
          if (deck.layered) attachEditor(node, l);
          keepHandlesInCanvas(node);
          try {
            await document.fonts.load(
              `${l.fontWeight} 16px "${fonts[l.font]}"`,
              l.text,
            );
          } catch {
            fontLoadFailed = true;
          }
        }
      }
      requestAnimationFrame(inspectLayout);
    });
  }
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
      document.fonts.load(font, [...characters].join("")).catch(() => {
        fontLoadFailed = true;
      }),
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
            im.src = mediaSource(src);
          }),
      ),
  );
  document.getElementById("loading").remove();
  applyMode();
  render(!deck.preview);
  if (deck.preview)
    parent.postMessage(
      { type: "motion-ready", pageId: deck.pages[index].id },
      "*",
    );
  speechProgress();
  showControls();
  window.__motionReady = true;
  if (deck.narration && !deck.preview && !document.hidden) play();
})();
