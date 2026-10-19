(() => {
  const saved = JSON.parse(document.getElementById("deck-data").textContent);
  const data = saved.pages
    ? saved
    : {
        pages: [
          { id: "story", styleName: "水墨书卷", title: "先讲故事", ...saved },
        ],
        activePageId: "story",
      };
  const frame = document.getElementById("frame"),
    canvas = document.getElementById("canvas"),
    status = document.getElementById("status");
  const ctx = document.createElement("canvas").getContext("2d"),
    nodes = new Map(),
    fields = new Map();
  const fonts = data.fonts || [
    {
      id: "sans",
      family: "Noto Sans SC Variable",
      label: "思源黑体",
      weights: [100, 200, 300, 400, 500, 600, 700, 800, 900],
    },
    {
      id: "serif",
      family: "Noto Serif SC Variable",
      label: "思源宋体",
      weights: [200, 300, 400, 500, 600, 700, 800, 900],
    },
  ];
  const layerChoice = document.getElementById("font-layer"),
    familyChoice = document.getElementById("font-family"),
    weightChoice = document.getElementById("font-weight"),
    naturalChoice = document.getElementById("natural-glyphs");
  let page =
      data.pages.find((p) => p.id === data.activePageId) || data.pages[0],
    mode = "edited",
    renderVersion = 0;
  const fontInfo = (l) => fonts.find((f) => f.id === (l.font || "serif"));
  const family = (l) => fontInfo(l).family;
  const fontSpec = (l) =>
    `${l.fontWeight} ${l.fontSize}px "${family(l)}", "Noto Sans SC Variable"`;
  function switchMode(next) {
    mode = next;
    frame.dataset.mode = mode;
    document
      .querySelectorAll("[data-mode][aria-pressed]")
      .forEach((b) =>
        b.setAttribute("aria-pressed", String(b.dataset.mode === mode)),
      );
    document
      .querySelector(".compare-control")
      .classList.toggle("visible", mode === "compare");
    nodes.forEach(
      (n) =>
        (n.contentEditable = mode === "edited" ? "plaintext-only" : "false"),
    );
  }
  document
    .querySelectorAll("[data-mode][aria-pressed]")
    .forEach((b) =>
      b.addEventListener("click", () => switchMode(b.dataset.mode)),
    );
  document
    .getElementById("compare")
    .addEventListener("input", (e) =>
      frame.style.setProperty("--split", `${e.target.value}%`),
    );
  function fit() {
    const scale = Math.min(
      frame.clientWidth / page.width,
      frame.clientHeight / page.height,
    );
    canvas.style.transform =
      document.fullscreenElement === frame
        ? `translate(-50%,-50%) scale(${scale})`
        : `scale(${scale})`;
  }
  new ResizeObserver(fit).observe(frame);
  document.addEventListener("fullscreenchange", fit);
  document.getElementById("fullscreen").addEventListener("click", async () => {
    try {
      await frame.requestFullscreen();
    } catch {
      status.textContent = "浏览器未允许全屏，可放大窗口查看。";
    }
  });
  function overflow(l, value) {
    ctx.font = fontSpec(l);
    const m = ctx.measureText(value);
    return (
      (m.actualBoundingBoxLeft + m.actualBoundingBoxRight) * l.scaleX >
      l.maxWidth + 1
    );
  }
  function report() {
    const over = page.layers.filter((l) => overflow(l, l.value));
    status.classList.toggle("error", !!over.length);
    status.textContent = over.length
      ? `第 ${over.map((l) => l.order).join("、")} 个文字层超出原版式，请缩短文字。`
      : "文字已修改，位置、字号、颜色保持原设置。切换风格会保留本页修改。";
  }
  function update(l, value, fromCanvas = false) {
    value = value.replace(/[\r\n]+/g, " ").slice(0, 160);
    l.value = value;
    if (!fromCanvas) nodes.get(l.id).textContent = value;
    fields.get(l.id).value = value;
    nodes.get(l.id).classList.toggle("over", overflow(l, value));
    report();
    // Newly typed characters may need another embedded unicode subset.
    const node = nodes.get(l.id);
    document.fonts
      .load(fontSpec(l), value || " ")
      .then(() => {
        if (nodes.get(l.id) !== node || l.value !== value) return;
        node.classList.toggle("over", overflow(l, value));
        report();
      })
      .catch(showError);
  }
  function selectedLayer() {
    return (
      page.layers.find((l) => l.id === layerChoice.value) || page.layers[0]
    );
  }
  function showFontControls() {
    const l = selectedLayer(),
      font = fontInfo(l);
    familyChoice.value = font.id;
    weightChoice.replaceChildren(
      ...font.weights.map(
        (weight) => new Option(String(weight), String(weight)),
      ),
    );
    // Legacy/manual values can be a valid intermediate variable weight.
    if (!font.weights.includes(l.fontWeight))
      weightChoice.add(new Option(String(l.fontWeight), String(l.fontWeight)));
    weightChoice.value = String(l.fontWeight);
    weightChoice.disabled = font.weights.length === 1;
    naturalChoice.checked = l.layout === "natural";
    document.getElementById("font-description").textContent =
      `${font.usage || "内置字体"}。${font.weights.length === 1 ? "使用原生单一字重，不模拟加粗。" : "按实际字重显示。"} 换字体会开启自然字形，字宽变化时请检查版式。`;
  }
  function chooseLayer(id) {
    layerChoice.value = id;
    showFontControls();
  }
  layerChoice.addEventListener("change", showFontControls);
  familyChoice.addEventListener("change", () => {
    const l = selectedLayer(),
      font = fonts.find((f) => f.id === familyChoice.value);
    l.font = font.id;
    l.fontWeight = font.variable
      ? Math.max(font.weights[0], Math.min(font.weights.at(-1), l.fontWeight))
      : font.weights.reduce((a, b) =>
          Math.abs(b - l.fontWeight) < Math.abs(a - l.fontWeight) ? b : a,
        );
    l.layout = "natural";
    render(page).catch(showError);
  });
  weightChoice.addEventListener("change", () => {
    selectedLayer().fontWeight = Number(weightChoice.value);
    render(page).catch(showError);
  });
  naturalChoice.addEventListener("change", () => {
    selectedLayer().layout = naturalChoice.checked ? "natural" : "matched";
    render(page).catch(showError);
  });
  document.getElementById("reset-font").addEventListener("click", () => {
    const l = selectedLayer();
    Object.assign(l, l.originalTypography);
    render(page).catch(showError);
  });
  familyChoice.replaceChildren(...fonts.map((f) => new Option(f.label, f.id)));
  async function render(next) {
    const version = ++renderVersion;
    page = next;
    data.activePageId = next.id;
    delete document.body.dataset.ready;
    frame.setAttribute("aria-busy", "true");
    document
      .querySelectorAll("#style-tabs button")
      .forEach((b) =>
        b.setAttribute("aria-pressed", String(b.dataset.case === page.id)),
      );
    document
      .querySelectorAll(".actions button")
      .forEach((b) => (b.disabled = true));
    document
      .querySelectorAll(
        ".font-panel select,.font-panel input,.font-panel button",
      )
      .forEach((el) => (el.disabled = true));
    await Promise.all(
      page.layers.map((l) =>
        document.fonts.load(fontSpec(l), l.text + (l.value || "")),
      ),
    );
    await document.fonts.ready;
    if (version !== renderVersion) return;
    nodes.clear();
    fields.clear();
    document.getElementById("texts").replaceChildren();
    document.getElementById("fields").replaceChildren();
    document.getElementById("background").src = page.background;
    document.getElementById("original").src = page.original;
    frame.style.aspectRatio = `${page.width} / ${page.height}`;
    canvas.style.width = `${page.width}px`;
    canvas.style.height = `${page.height}px`;
    document.querySelector(".intro").textContent =
      `${page.styleName} · ${page.title}`;
    document.getElementById("case-description").textContent =
      page.description ||
      `${page.layers.length} 个独立文字层，原图装饰保留在底图。`;
    document.getElementById("experiment-label").textContent =
      `正文分层 · ${data.pages.length} 种风格对照`;
    document.getElementById("sample").textContent =
      page.sample?.label || "试改一句";
    document
      .getElementById("pptx")
      ?.replaceChildren(
        document.createTextNode(`下载 ${data.pages.length} 种风格分层 PPTX`),
      );
    for (const [index, l] of page.layers.entries()) {
      l.order = index + 1;
      l.value ??= l.text;
      l.originalTypography ??= {
        font: l.font || "serif",
        fontWeight: l.fontWeight,
        layout: "matched",
      };
      ctx.font = fontSpec(l);
      const m = ctx.measureText(l.text);
      l.scaleX = l.w / (m.actualBoundingBoxLeft + m.actualBoundingBoxRight);
      l.scaleY = l.h / (m.actualBoundingBoxAscent + m.actualBoundingBoxDescent);
      if (l.layout === "natural") l.scaleX = l.scaleY;
      const baseline =
        (l.fontSize - m.fontBoundingBoxAscent - m.fontBoundingBoxDescent) / 2 +
        m.fontBoundingBoxAscent;
      const span = document.createElement("span");
      span.className = "text-layer";
      span.id = l.id;
      span.role = "textbox";
      span.contentEditable = "plaintext-only";
      span.setAttribute("aria-label", l.label);
      span.spellcheck = false;
      span.textContent = l.value;
      Object.assign(span.style, {
        left: `${l.x}px`,
        top: `${l.y}px`,
        fontFamily: `"${family(l)}", "Noto Sans SC Variable"`,
        fontSize: `${l.fontSize}px`,
        fontWeight: String(l.fontWeight),
        color: l.color,
        transform: `scale(${l.scaleX},${l.scaleY}) translate(${m.actualBoundingBoxLeft}px,${m.actualBoundingBoxAscent - baseline}px)`,
      });
      document.getElementById("texts").append(span);
      nodes.set(l.id, span);
      const label = document.createElement("label");
      label.className = "field";
      label.textContent = `${index + 1}. ${l.label}`;
      const input = document.createElement("textarea");
      input.rows = l.text.length > 20 ? 2 : 1;
      input.maxLength = 160;
      input.value = l.value;
      input.setAttribute("aria-label", `编辑${l.label}`);
      label.append(input);
      document.getElementById("fields").append(label);
      fields.set(l.id, input);
      input.addEventListener("input", () => {
        switchMode("edited");
        update(l, input.value);
      });
      input.addEventListener("focus", () => chooseLayer(l.id));
      span.addEventListener("focus", () => chooseLayer(l.id));
      span.addEventListener("input", (e) => {
        if (!e.isComposing) update(l, span.textContent, true);
      });
      span.addEventListener("compositionend", () =>
        update(l, span.textContent, true),
      );
      span.addEventListener("blur", () => {
        if (span.textContent !== l.value) span.textContent = l.value;
      });
      span.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.isComposing) e.preventDefault();
      });
      span.addEventListener("paste", (e) => {
        e.preventDefault();
        document.execCommand(
          "insertText",
          false,
          e.clipboardData.getData("text/plain").replace(/[\r\n]+/g, " "),
        );
      });
      span.classList.toggle("over", overflow(l, l.value));
    }
    switchMode("edited");
    fit();
    const selected = layerChoice.value;
    layerChoice.replaceChildren(
      ...page.layers.map((l) => new Option(`${l.order}. ${l.label}`, l.id)),
    );
    if (page.layers.some((l) => l.id === selected))
      layerChoice.value = selected;
    document
      .querySelectorAll(
        ".font-panel select,.font-panel input,.font-panel button",
      )
      .forEach((el) => (el.disabled = false));
    showFontControls();
    status.classList.remove("error");
    status.textContent = "可以直接改字。切换风格会保留各页修改。";
    if (page.layers.some((l) => overflow(l, l.value))) report();
    frame.removeAttribute("aria-busy");
    document
      .querySelectorAll(".actions button")
      .forEach((b) => (b.disabled = false));
    document.body.dataset.ready = page.id;
  }
  const tabs = document.getElementById("style-tabs");
  tabs.replaceChildren();
  for (const p of data.pages) {
    const b = document.createElement("button");
    b.textContent = p.styleName;
    b.dataset.case = p.id;
    b.setAttribute("aria-pressed", "false");
    b.addEventListener("click", () => render(p).catch(showError));
    tabs.append(b);
  }
  document.getElementById("sample").addEventListener("click", () => {
    switchMode("edited");
    const sample = page.sample || {
      id: page.layers[0].id,
      text: page.layers[0].text.replace("一分钟", "两分钟"),
    };
    const l = page.layers.find((l) => l.id === sample.id);
    update(l, sample.text);
  });
  document.getElementById("reset").addEventListener("click", () => {
    switchMode("edited");
    page.layers.forEach((l) => update(l, l.text));
    status.textContent = "当前风格已恢复原文，其他风格的修改保留。";
  });
  document.getElementById("save").addEventListener("click", () => {
    const doc = document.documentElement.cloneNode(true);
    doc.querySelector("#deck-data").textContent = JSON.stringify(
      data,
    ).replaceAll("<", "\\u003c");
    doc.querySelector("#texts").replaceChildren();
    doc.querySelector("#fields").replaceChildren();
    doc.querySelector("#style-tabs").replaceChildren();
    doc.querySelector("#status").textContent = "已载入保存的文字。";
    doc.querySelector("#status").classList.remove("error");
    doc.querySelector(".frame").dataset.mode = "edited";
    doc
      .querySelectorAll("[data-mode][aria-pressed]")
      .forEach((b) =>
        b.setAttribute("aria-pressed", String(b.dataset.mode === "edited")),
      );
    doc.querySelector(".compare-control").classList.remove("visible");
    doc
      .querySelector("#pptx")
      ?.replaceWith(document.createTextNode("分层 PPTX 请从最初的试验页下载"));
    doc.querySelectorAll("img").forEach((img) => img.removeAttribute("src"));
    doc.querySelector("body").removeAttribute("data-ready");
    const url = URL.createObjectURL(
      new Blob(["<!doctype html>\n" + doc.outerHTML], {
        type: "text/html;charset=utf-8",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `讲好-${data.pages.length}种风格分层-修改版.html`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  function showError() {
    status.textContent = "字体加载失败，请重新打开试验页。";
    status.classList.add("error");
  }
  render(page).catch(showError);
})();
