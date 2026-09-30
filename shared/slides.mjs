// The same page objects drive the browser and editable PowerPoint export.
export const W = 1600,
  H = 900;
export const LAYOUTS = [
  ["cover", "封面", "主题与副标题，适合开场", 2],
  ["section", "章节", "章节名称与一句过渡", 2],
  ["statement", "核心观点", "一句核心观点与简短解释", 3],
  ["metric", "大数字", "一个真实数字及口径说明", 3],
  ["comparison", "对比", "两组观点或前后变化", 2],
  ["process", "步骤流程", "有先后顺序的三到五个步骤", 5],
  ["timeline", "时间轴", "按时间展开的事件", 5],
  ["relationship", "关系图", "一个核心及关联对象", 4],
  ["chart", "数据图表", "来自讲稿的可量化数据", 8],
  ["summary", "要点总结", "两到四条并列要点", 4],
];
const hex = (v) => typeof v === "string" && /^#[\da-f]{6}$/i.test(v);
const num = (v, lo, hi, name) => {
  if (!Number.isFinite(v) || v < lo || v > hi)
    throw new Error(`${name}超出范围。`);
  return v;
};
const clean = (v, max = 1000) => {
  if (typeof v !== "string" || v.length > max)
    throw new Error("页面文字格式无效。");
  return v;
};
const luminance = (h) => {
  const c = h
    .slice(1)
    .match(/../g)
    .map((x) => parseInt(x, 16) / 255);
  return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
};
export function defaultSystem(style = {}) {
  const colors = (style.colors || []).filter(hex),
    dark = /深色|深蓝黑|暗色/.test(style.rules || "");
  const sorted = [...colors].sort((a, b) => luminance(a) - luminance(b));
  const accent =
    colors.find((c) => {
      const a = c
        .slice(1)
        .match(/../g)
        .map((x) => parseInt(x, 16));
      return Math.max(...a) - Math.min(...a) > 45;
    }) || colors.find((c) => luminance(c) < 0.4) || "#bc5236";
  const measures = (style.referenceProfiles || [])
    .flatMap((p) => p.spec?.regions || [])
    .filter((r) => r.kind === "text")
    .map((r) => r.measurements || {});
  const heading = measures.find((m) => m.fontSizeRatio >= 0.07) || {};
  const tokens = {
    background: dark ? sorted[0] || "#202930" : sorted.at(-1) || "#f5f2e9",
    foreground: dark ? sorted.at(-1) || "#f4f2e8" : sorted[0] || "#252c26",
    accent,
    muted: dark ? "#bac4ca" : "#656d70",
    fontFace: heading.fontFamily || "Microsoft YaHei",
    titleSize: Math.round(
      Math.min(104, Math.max(60, (heading.fontSizeRatio || 0.09) * H)),
    ),
    bodySize: 30,
    titleWeight: heading.fontWeight >= 600 ? 700 : 400,
    margin: 80,
    lineWidth: 2,
    cornerRadius: 0,
  };
  if (tokens.foreground === tokens.background)
    tokens.foreground = dark ? "#ffffff" : "#202520";
  const layouts = LAYOUTS.map(([id, name, description, maxItems]) => ({
    id,
    kind: id,
    name,
    description,
    maxItems,
    origin: "extended",
    titleBox: ["cover", "section", "statement"].includes(id)
      ? [80, 220, 1440, 300]
      : [80, 65, 1440, 135],
    contentBox: ["cover", "section", "statement"].includes(id)
      ? [80, 650, 1440, 160]
      : [80, 250, 1440, 565],
    align: "left",
  }));
  return { version: 1, tokens, layouts };
}
function boxValid(a) {
  return (
    Array.isArray(a) &&
    a.length === 4 &&
    a.every(Number.isFinite) &&
    a[0] >= 0 &&
    a[1] >= 0 &&
    a[2] > 0 &&
    a[3] > 0 &&
    a[0] + a[2] <= W + 0.1 &&
    a[1] + a[3] <= H + 0.1
  );
}
export function validateSystem(raw) {
  if (!raw || raw.version !== 1 || !raw.tokens || !Array.isArray(raw.layouts))
    throw new Error("设计规范或版式库不完整。");
  const t = raw.tokens;
  for (const c of ["background", "foreground", "accent", "muted"])
    if (!hex(t[c])) throw new Error("设计规范颜色无效。");
  clean(t.fontFace, 100);
  for (const [k, lo, hi] of [
    ["titleSize", 40, 140],
    ["bodySize", 22, 48],
    ["titleWeight", 100, 900],
    ["margin", 40, 160],
    ["lineWidth", 1, 8],
    ["cornerRadius", 0, 40],
  ])
    num(t[k], lo, hi, k);
  if (raw.layouts.length < 10 || raw.layouts.length > 30)
    throw new Error("版式库需覆盖十种内容用途。");
  const ids = new Set();
  const layouts = raw.layouts.map((l) => {
    if (
      !/^[a-z][a-z0-9-]{0,39}$/.test(l.id) ||
      ids.has(l.id) ||
      !LAYOUTS.some((x) => x[0] === l.kind) ||
      !boxValid(l.titleBox) ||
      !boxValid(l.contentBox) ||
      !["left", "center", "right"].includes(l.align)
    )
      throw new Error("版式的名称、区域或用途无效。");
    ids.add(l.id);
    num(l.maxItems, 1, LAYOUTS.find((x) => x[0] === l.kind)[3], "版式容量");
    if (!Number.isInteger(l.maxItems)) throw new Error("版式容量必须是整数。");
    return {
      id: l.id,
      kind: l.kind,
      name: clean(l.name, 60),
      description: clean(l.description, 600),
      maxItems: l.maxItems,
      titleBox: l.titleBox,
      contentBox: l.contentBox,
      align: l.align,
      origin: l.origin === "reference" ? "reference" : "extended",
    };
  });
  if (LAYOUTS.some(([kind]) => !layouts.some((l) => l.kind === kind)))
    throw new Error("版式库缺少必要的内容用途。");
  return { version: 1, tokens: { ...t }, layouts };
}
export function systemForStyle(style) {
  return style.designSystem
    ? validateSystem(style.designSystem)
    : defaultSystem(style);
}
export function wrapText(text, width, size) {
  const lines = [];
  const weight = (c) =>
    /[\u2e80-\uffef]/u.test(c)
      ? 1
      : /[MW@]/.test(c)
        ? 0.85
        : /[il., !:;'|]/.test(c)
          ? 0.3
          : 0.57;
  for (const paragraph of text.split("\n")) {
    let line = "",
      used = 0;
    for (const c of paragraph) {
      const w = weight(c) * size;
      if (used + w > width && line) {
        lines.push(line);
        line = "";
        used = 0;
      }
      line += c;
      used += w;
    }
    lines.push(line);
  }
  return lines;
}
export function fittedText(text, w, h, size, min = 22) {
  for (let s = size; s >= min; s--) {
    const lines = wrapText(text, w, s);
    if (lines.length * s * 1.22 <= h) return { fontSize: s, lines };
  }
  throw new Error(
    "这页文字超出版式容量，请缩短画面文案或拆分页面。逐字稿已保留。",
  );
}
export function validateScene(raw) {
  if (
    !raw ||
    raw.version !== 1 ||
    raw.width !== W ||
    raw.height !== H ||
    !hex(raw.background) ||
    !Array.isArray(raw.elements) ||
    raw.elements.length < 1 ||
    raw.elements.length > 150
  )
    throw new Error("可编辑页面结构无效。");
  const ids = new Set();
  const elements = raw.elements.map((e) => {
    if (
      !e ||
      !["text", "rect", "ellipse", "line", "chart"].includes(e.type) ||
      typeof e.id !== "string" ||
      ids.has(e.id)
    )
      throw new Error("页面元素无效或重名。");
    ids.add(e.id);
    if (!boxValid([e.x, e.y, e.w, e.h])) throw new Error("页面元素超出画布。");
    const out = { id: e.id, type: e.type, x: e.x, y: e.y, w: e.w, h: e.h };
    if (e.type === "text") {
      const text = clean(e.text, 3000);
      num(e.fontSize, 16, 180, "字号");
      if (!hex(e.color) || !["left", "center", "right"].includes(e.align))
        throw new Error("文字样式无效。");
      const fit = fittedText(text, e.w, e.h, e.fontSize, 16);
      Object.assign(out, {
        text,
        fontSize: fit.fontSize,
        lines: fit.lines,
        fontFace: clean(e.fontFace, 100),
        bold: !!e.bold,
        color: e.color,
        align: e.align,
      });
    } else if (e.type === "chart") {
      if (
        !["bar", "line"].includes(e.chartType) ||
        !Array.isArray(e.labels) ||
        !Array.isArray(e.values) ||
        e.labels.length !== e.values.length ||
        e.labels.length < 1 ||
        e.labels.length > 8 ||
        e.values.some((v) => !Number.isFinite(v))
      )
        throw new Error("图表数据不完整。");
      Object.assign(out, {
        chartType: e.chartType,
        labels: e.labels.map((v) => clean(v, 60)),
        values: e.values,
        unit: clean(e.unit || "", 30),
        color: e.color,
        foreground: e.foreground,
        fontFace: clean(e.fontFace, 100),
      });
      if (!hex(e.color) || !hex(e.foreground))
        throw new Error("图表颜色无效。");
    } else {
      if (e.fill != null && !hex(e.fill)) throw new Error("形状填色无效。");
      if (!hex(e.stroke)) throw new Error("形状线色无效。");
      num(e.strokeWidth, 0, 12, "线宽");
      Object.assign(out, {
        fill: e.fill || null,
        stroke: e.stroke,
        strokeWidth: e.strokeWidth,
        radius: Math.min(40, Math.max(0, e.radius || 0)),
        arrow: !!e.arrow,
        flipH: !!e.flipH,
      });
    }
    return out;
  });
  return {
    version: 1,
    width: W,
    height: H,
    background: raw.background,
    elements,
  };
}
export function composeScene(plan, system) {
  const { tokens: t, layouts } = validateSystem(system);
  const l = layouts.find((x) => x.id === plan.layoutId);
  if (!l) throw new Error("请选择这个风格中的有效版式。");
  const c = plan.content;
  if (
    !c ||
    typeof c.title !== "string" ||
    !Array.isArray(c.items) ||
    c.items.length > l.maxItems
  )
    throw new Error("页面内容超过所选版式容量。");
  const els = [];
  let count = 0;
  const text = (
    s,
    x,
    y,
    w,
    h,
    size = t.bodySize,
    color = t.foreground,
    bold = false,
    align = "left",
  ) => {
    if (!s) return;
    clean(s, 3000);
    const fit = fittedText(s, w, h, size, 22);
    els.push({
      id: `e${++count}`,
      type: "text",
      text: s,
      x,
      y,
      w,
      h,
      ...fit,
      fontFace: t.fontFace,
      bold,
      color,
      align,
    });
  };
  const shape = (
    type,
    x,
    y,
    w,
    h,
    fill = null,
    stroke = t.accent,
    strokeWidth = t.lineWidth,
    arrow = false,
    flipH = false,
  ) =>
    els.push({
      id: `e${++count}`,
      type,
      x,
      y,
      w: Math.max(w, 1),
      h: Math.max(h, 1),
      fill,
      stroke,
      strokeWidth,
      radius: t.cornerRadius,
      arrow,
      flipH,
    });
  const heading = (box = l.titleBox, size = t.titleSize) =>
    text(c.title, ...box, size, t.foreground, t.titleWeight >= 600, l.align);
  const [x, y, w, h] = l.contentBox;
  const items = c.items.map((i) => ({
    label: clean(i.label || "", 140),
    body: clean(i.body || "", 800),
  }));
  switch (l.kind) {
    case "cover":
    case "section":
    case "statement":
      heading(
        l.titleBox,
        l.kind === "cover" ? Math.min(130, t.titleSize * 1.25) : t.titleSize,
      );
      shape("line", x, Math.max(1, y - 36), Math.min(120, w), 1);
      text(
        c.subtitle || items.map((i) => i.body || i.label).join("\n"),
        x,
        y,
        w,
        h,
        t.bodySize,
        t.muted,
        false,
        l.align,
      );
      break;
    case "metric":
      heading();
      if (!c.metric) throw new Error("数字版式需要来自讲稿的真实数字。");
      text(String(c.metric), x, y, w, h * 0.48, 160, t.accent, true, l.align);
      text(
        c.subtitle || "",
        x,
        y + h * 0.57,
        w,
        h * 0.18,
        36,
        t.foreground,
        false,
        l.align,
      );
      text(
        items.map((i) => i.body || i.label).join("\n"),
        x,
        y + h * 0.8,
        w,
        h * 0.18,
        26,
        t.muted,
        false,
        l.align,
      );
      break;
    case "comparison": {
      heading();
      if (items.length !== 2) throw new Error("对比版式需要两组内容。");
      const cw = (w - 100) / 2;
      shape("line", x + cw + 50, y, 1, h, null, t.muted, 1);
      items.forEach((i, n) => {
        const xx = x + n * (cw + 100);
        text(i.label, xx, y, cw, 130, 52, t.accent, t.titleWeight >= 600);
        text(i.body, xx, y + 165, cw, h - 165, t.bodySize);
      });
      break;
    }
    case "process":
    case "timeline": {
      heading();
      if (items.length < 2) throw new Error("流程或时间轴至少需要两个节点。");
      const cw = w / items.length;
      shape(
        "line",
        x + cw * 0.15,
        y + 85,
        w - cw * 0.3,
        1,
        null,
        t.accent,
        t.lineWidth,
        l.kind === "process",
      );
      items.forEach((i, n) => {
        const xx = x + n * cw;
        shape("ellipse", xx + 12, y + 65, 40, 40, t.accent, t.accent, 0);
        text(
          l.kind === "process" ? String(n + 1) : i.label,
          xx,
          y + 130,
          cw - 26,
          90,
          l.kind === "process" ? 36 : 32,
          t.accent,
          true,
        );
        text(
          l.kind === "process" ? i.label : i.body,
          xx,
          y + 235,
          cw - 30,
          120,
          32,
        );
        if (l.kind === "process")
          text(i.body, xx, y + 385, cw - 30, h - 390, 24, t.muted);
      });
      break;
    }
    case "relationship": {
      heading();
      if (items.length < 2 || items.length > 4)
        throw new Error("关系图支持二到四个关联对象。");
      const cx = x + w * 0.5,
        cy = y + h * 0.5;
      items.forEach((i, n) => {
        const xx = n % 2 ? x + w * 0.7 : x,
          yy = n < 2 ? y : y + h * 0.68;
        const ww = w * 0.3;
        shape(
          "line",
          Math.min(cx, xx + ww / 2),
          Math.min(cy, yy + 70),
          Math.abs(cx - (xx + ww / 2)),
          Math.abs(cy - (yy + 70)),
          null,
          t.muted,
          1,
          false,
          (cx - (xx + ww / 2)) * (cy - (yy + 70)) < 0,
        );
        shape("rect", xx, yy, ww, 150, null, t.accent, 2);
        text(i.label, xx + 22, yy + 18, ww - 44, 54, 30, t.foreground, true);
        text(i.body, xx + 22, yy + 78, ww - 44, 54, 22, t.muted);
      });
      shape("ellipse", cx - 145, cy - 105, 290, 210, t.background, t.accent, 3);
      text(
        c.subtitle || "核心",
        cx - 120,
        cy - 65,
        240,
        130,
        38,
        t.accent,
        true,
        "center",
      );
      break;
    }
    case "chart": {
      heading();
      if (!c.chart) throw new Error("图表版式需要讲稿中的数值数据。");
      els.push({
        id: `e${++count}`,
        type: "chart",
        x,
        y,
        w,
        h: h - 60,
        chartType: c.chart.type || "bar",
        labels: c.chart.labels,
        values: c.chart.values,
        unit: c.chart.unit || "",
        color: t.accent,
        foreground: t.foreground,
        fontFace: t.fontFace,
      });
      text(c.subtitle || "", x, y + h - 40, w, 40, 24, t.muted);
      break;
    }
    default: {
      heading();
      if (!items.length) throw new Error("总结版式需要内容要点。");
      const rh = h / items.length;
      items.forEach((i, n) => {
        const yy = y + n * rh;
        shape("line", x, yy, w, 1, null, t.muted, 1);
        text(
          i.label,
          x,
          yy + 22,
          w * 0.33,
          rh - 36,
          36,
          t.accent,
          t.titleWeight >= 600,
        );
        text(i.body, x + w * 0.38, yy + 22, w * 0.62, rh - 36, t.bodySize);
      });
    }
  }
  return validateScene({
    version: 1,
    width: W,
    height: H,
    background: t.background,
    elements: els,
  });
}
export function samplePlan(layout) {
  const data = {
    cover: { title: "让想法被看见", subtitle: "主题与副标题", items: [] },
    section: {
      title: "开始新的篇章",
      subtitle: "用一句话连接前后内容",
      items: [],
    },
    statement: {
      title: "一个值得被记住的观点",
      subtitle: "清晰的层级，让重要的内容自然被看见。",
      items: [],
    },
    metric: {
      title: "让关键变化一眼可见",
      metric: "32%",
      subtitle: "示例数值 · 实际制作只使用讲稿数据",
      items: [],
    },
    comparison: {
      title: "把不同之处讲清楚",
      items: [
        { label: "原来的方式", body: "描述现状与限制" },
        { label: "新的方式", body: "说明变化与价值" },
      ],
    },
    process: {
      title: "一步一步，形成完整过程",
      items: [
        { label: "理解", body: "找到关键问题" },
        { label: "设计", body: "组织解决方法" },
        { label: "行动", body: "让方法进入实践" },
      ],
    },
    timeline: {
      title: "让重要节点连成一条线",
      items: [
        { label: "起点", body: "说明最初状态" },
        { label: "转折", body: "呈现关键变化" },
        { label: "下一步", body: "明确前进方向" },
      ],
    },
    relationship: {
      title: "围绕同一个核心",
      subtitle: "核心主题",
      items: [
        { label: "要素一", body: "说明关联" },
        { label: "要素二", body: "说明关联" },
        { label: "要素三", body: "说明关联" },
        { label: "要素四", body: "说明关联" },
      ],
    },
    chart: {
      title: "让数据帮助说明问题",
      subtitle: "版式示例，非真实业务数据",
      items: [],
      chart: {
        type: "bar",
        labels: ["一", "二", "三", "四"],
        values: [18, 32, 25, 46],
        unit: "",
      },
    },
    summary: {
      title: "把值得带走的内容留下",
      items: [
        { label: "一个判断", body: "提炼本段最重要的结论" },
        { label: "一个方法", body: "说明能够怎样行动" },
        { label: "一个方向", body: "连接接下来的内容" },
      ],
    },
  };
  return {
    layoutId: layout.id,
    content: data[layout.kind],
    title: data[layout.kind].title,
  };
}
const escape = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export function renderSceneSvg(input) {
  const s = validateScene(input);
  const elements = s.elements
    .map((e) => {
      let body = "";
      if (e.type === "text")
        body = `<text fill="${e.color}" font-family="${escape(e.fontFace)}, PingFang SC, sans-serif" font-size="${e.fontSize}" font-weight="${e.bold ? 700 : 400}" text-anchor="${e.align === "center" ? "middle" : e.align === "right" ? "end" : "start"}">${e.lines.map((line, i) => `<tspan x="${e.x + (e.align === "center" ? e.w / 2 : e.align === "right" ? e.w : 0)}" y="${e.y + e.fontSize * 0.88 + i * e.fontSize * 1.22}">${escape(line)}</tspan>`).join("")}</text>`;
      else if (e.type === "chart") {
        const left = e.x + 55,
          top = e.y + 30,
          cw = e.w - 75,
          ch = e.h - 105,
          n = e.values.length;
        const max = Math.max(1, ...e.values),
          min = Math.min(0, ...e.values),
          scale = ch / (max - min),
          zero = top + max * scale;
        body = `<line x1="${left}" y1="${zero}" x2="${left + cw}" y2="${zero}" stroke="${e.foreground}" opacity=".4"/>`;
        const points = [];
        e.values.forEach((v, i) => {
          const x = left + ((i + 0.5) * cw) / n,
            y = top + (max - v) * scale;
          if (e.chartType === "bar")
            body += `<rect x="${x - (cw / n) * 0.25}" y="${Math.min(zero, y)}" width="${(cw / n) * 0.5}" height="${Math.max(1, Math.abs(y - zero))}" fill="${e.color}"/>`;
          else {
            points.push(`${x},${y}`);
            body += `<circle cx="${x}" cy="${y}" r="6" fill="${e.color}"/>`;
          }
          body += `<text x="${x}" y="${y - 12}" text-anchor="middle" font-family="${escape(e.fontFace)},sans-serif" font-size="26" fill="${e.foreground}">${escape(v + e.unit)}</text><text x="${x}" y="${top + ch + 44}" text-anchor="middle" font-family="${escape(e.fontFace)},sans-serif" font-size="25" fill="${e.foreground}">${escape(e.labels[i])}</text>`;
        });
        if (e.chartType === "line")
          body += `<polyline points="${points.join(" ")}" fill="none" stroke="${e.color}" stroke-width="3"/>`;
      } else if (e.type === "line") {
        const x1 = e.x + (e.flipH ? e.w : 0),
          x2 = e.x + (e.flipH ? 0 : e.w);
        body = `<line x1="${x1}" y1="${e.y}" x2="${x2}" y2="${e.y + e.h}" stroke="${e.stroke}" stroke-width="${e.strokeWidth}"/>`;
        if (e.arrow) {
          const angle = (Math.atan2(e.h, x2 - x1) * 180) / Math.PI;
          body += `<path d="M 0 0 L -14 -6 L -14 6 Z" fill="${e.stroke}" transform="translate(${x2} ${e.y + e.h}) rotate(${angle})"/>`;
        }
      } else if (e.type === "ellipse")
        body = `<ellipse cx="${e.x + e.w / 2}" cy="${e.y + e.h / 2}" rx="${e.w / 2}" ry="${e.h / 2}" fill="${e.fill || "none"}" stroke="${e.stroke}" stroke-width="${e.strokeWidth}"/>`;
      else
        body = `<rect x="${e.x}" y="${e.y}" width="${e.w}" height="${e.h}" rx="${e.radius}" fill="${e.fill || "none"}" stroke="${e.stroke}" stroke-width="${e.strokeWidth}"/>`;
      return `<g data-element="${escape(e.id)}">${body}</g>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" height="100%" role="img" aria-label="可编辑演讲页面"><rect width="${W}" height="${H}" fill="${s.background}"/>${elements}</svg>`;
}
