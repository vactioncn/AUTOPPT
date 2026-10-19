(() => {
  const data = JSON.parse(document.getElementById("deck-data").textContent);
  const frame = document.getElementById("frame");
  const canvas = document.getElementById("canvas");
  const status = document.getElementById("status");
  const ctx = document.createElement("canvas").getContext("2d");
  const nodes = new Map();
  const fields = new Map();
  document.getElementById("background").src = data.background;
  document.getElementById("original").src = data.original;
  let mode = "edited";
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
    nodes.forEach((node) => (node.contentEditable = String(mode === "edited")));
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
      frame.clientWidth / data.width,
      frame.clientHeight / data.height,
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
  function overflow(layer, value) {
    ctx.font = `${layer.fontWeight} ${layer.fontSize}px "Noto Serif SC Variable"`;
    const m = ctx.measureText(value);
    return (
      (m.actualBoundingBoxLeft + m.actualBoundingBoxRight) * layer.scaleX >
      layer.maxWidth + 1
    );
  }
  function update(layer, value, fromCanvas = false) {
    value = value.replace(/[\r\n]+/g, " ").slice(0, 160);
    layer.value = value;
    if (!fromCanvas) nodes.get(layer.id).textContent = value;
    fields.get(layer.id).value = value;
    nodes.get(layer.id).classList.toggle("over", overflow(layer, value));
    const over = data.layers.filter((l) => overflow(l, l.value));
    status.classList.toggle("error", !!over.length);
    status.textContent = over.length
      ? `第 ${over.map((l) => l.order).join("、")} 个文字层超出原版式，请缩短文字。`
      : "文字已修改，位置、字号、颜色保持原设置。可保存为独立 HTML。";
  }
  async function initialize() {
    await Promise.all(
      data.layers.map((l) =>
        document.fonts.load(
          `${l.fontWeight} ${l.fontSize}px "Noto Serif SC Variable"`,
          l.value ?? l.text,
        ),
      ),
    );
    await document.fonts.ready;
    for (const [index, l] of data.layers.entries()) {
      l.order = index + 1;
      l.value ??= l.text;
      ctx.font = `${l.fontWeight} ${l.fontSize}px "Noto Serif SC Variable"`;
      const m = ctx.measureText(l.text);
      l.scaleX = l.w / (m.actualBoundingBoxLeft + m.actualBoundingBoxRight);
      l.scaleY = l.h / (m.actualBoundingBoxAscent + m.actualBoundingBoxDescent);
      const baseline =
        (l.fontSize - m.fontBoundingBoxAscent - m.fontBoundingBoxDescent) / 2 +
        m.fontBoundingBoxAscent;
      const span = document.createElement("span");
      span.className = "text-layer";
      span.id = l.id;
      span.role = "textbox";
      span.contentEditable = "true";
      span.setAttribute("aria-label", l.label);
      span.spellcheck = false;
      span.textContent = l.value;
      Object.assign(span.style, {
        left: `${l.x}px`,
        top: `${l.y}px`,
        fontFamily: '"Noto Serif SC Variable",serif',
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
      input.rows = 2;
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
      span.addEventListener("input", () => update(l, span.textContent, true));
      span.addEventListener("keydown", (e) => {
        if (e.key === "Enter") e.preventDefault();
      });
      span.addEventListener("paste", (e) => {
        e.preventDefault();
        document.execCommand(
          "insertText",
          false,
          e.clipboardData.getData("text/plain").replace(/[\r\n]+/g, " "),
        );
      });
    }
    fit();
    document.body.dataset.ready = "true";
  }
  document.getElementById("sample").addEventListener("click", () => {
    switchMode("edited");
    const l = data.layers[0];
    update(l, l.text.replace("一分钟", "两分钟"));
  });
  document.getElementById("reset").addEventListener("click", () => {
    switchMode("edited");
    data.layers.forEach((l) => update(l, l.text));
    status.textContent = "已恢复原文。";
  });
  document.getElementById("save").addEventListener("click", () => {
    const doc = document.documentElement.cloneNode(true);
    doc.querySelector("#deck-data").textContent = JSON.stringify(
      data,
    ).replaceAll("<", "\\u003c");
    doc.querySelector("#texts").replaceChildren();
    doc.querySelector("#fields").replaceChildren();
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
      .replaceWith(document.createTextNode("分层 PPTX 请从最初的试验页下载"));
    doc.querySelectorAll("img").forEach((img) => img.removeAttribute("src"));
    doc.querySelector("body").removeAttribute("data-ready");
    const url = URL.createObjectURL(
      new Blob(["<!doctype html>\n" + doc.outerHTML], {
        type: "text/html;charset=utf-8",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "讲好-正文分层-修改版.html";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  initialize().catch(() => {
    status.textContent = "字体加载失败，请重新打开试验页。";
    status.classList.add("error");
  });
})();
