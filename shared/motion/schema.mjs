// This independent scene format never mutates the source project or its PPT export.
export const MOTION_VERSION = 1;
export const FONTS = {
  sans: "Noto Sans SC Variable",
  serif: "Noto Serif SC Variable",
  custom: "Presentation Custom",
};
export const EFFECTS = ["rise", "fade", "wipe", "zoom", "draw", "none"];
const number = (value, min, max, label) => {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  )
    throw new Error(`${label}超出范围（${min}–${max}）`);
  return value;
};
const color = (value) => {
  if (!/^#[\da-f]{6}$/i.test(value))
    throw new Error("颜色必须为六位十六进制颜色");
  return value;
};
const text = (v, max = 2000) => {
  if (typeof v !== "string" || v.length > max)
    throw new Error("文字内容过长或格式错误");
  return v;
};
export function validateLayers(input, width, height) {
  number(width, 100, 8192, "画布宽度");
  number(height, 100, 8192, "画布高度");
  if (!Array.isArray(input) || input.length > 120)
    throw new Error("每页最多 120 个图层");
  const ids = new Set();
  return input.map((layer, index) => {
    const id =
      typeof layer.id === "string" && /^[\w-]{1,80}$/.test(layer.id)
        ? layer.id
        : `layer-${index}`;
    if (ids.has(id)) throw new Error("图层编号重复");
    ids.add(id);
    if (!["text", "image"].includes(layer.type))
      throw new Error("不支持的图层类型");
    const x = number(layer.x, 0, width, "横坐标"),
      y = number(layer.y, 0, height, "纵坐标");
    const w = number(layer.w, 1, width - x, "图层宽度"),
      h = number(layer.h, 1, height - y, "图层高度");
    const base = {
      id,
      type: layer.type,
      x,
      y,
      w,
      h,
      label: text(layer.label || "", 120),
      step: number(layer.step ?? 0, 0, 30, "讲述步骤"),
      delay: number(layer.delay ?? 0, 0, 3000, "延迟"),
      duration: number(layer.duration ?? 700, 100, 3000, "时长"),
      effect: EFFECTS.includes(layer.effect) ? layer.effect : "rise",
      rotation: number(layer.rotation ?? 0, -180, 180, "旋转"),
    };
    if (layer.type === "text")
      return {
        ...base,
        text: text(layer.text),
        font: Object.hasOwn(FONTS, layer.font) ? layer.font : "sans",
        fontSize: number(layer.fontSize, 4, height, "字号"),
        fontWeight: number(layer.fontWeight ?? 400, 100, 900, "字重"),
        color: color(layer.color),
        align: ["left", "center", "right"].includes(layer.align)
          ? layer.align
          : "left",
        letterSpacing: number(layer.letterSpacing ?? 0, -20, 100, "字距"),
        lineHeight: number(layer.lineHeight ?? 1.2, 0.8, 3, "行距"),
        fit: layer.fit !== false,
      };
    if (layer.asset && !/^[\w-]+\.(png|jpg|webp)$/.test(layer.asset))
      throw new Error("图层图片无效");
    return { ...base, asset: layer.asset || null };
  });
}
export function validateAnalysis(raw, width, height) {
  if (!Array.isArray(raw?.texts) || !Array.isArray(raw?.objects))
    throw new Error("分析没有返回文字和元素列表");
  if (raw.objects.length > 24) throw new Error("可动元素过多，请简化分析");
  const layers = validateLayers(
    [
      ...raw.texts.map((t, i) => ({ ...t, id: `text-${i}`, type: "text" })),
      ...raw.objects.map((o, i) => ({
        ...o,
        id: `object-${i}`,
        type: "image",
      })),
    ],
    width,
    height,
  );
  const regions = layers.map((l, i) => {
    const source =
      i < raw.texts.length ? raw.texts[i] : raw.objects[i - raw.texts.length];
    const fill = source.fill == null ? null : color(source.fill);
    let polygon = null;
    if (l.type === "image" && source.polygon != null) {
      if (
        !Array.isArray(source.polygon) ||
        source.polygon.length < 3 ||
        source.polygon.length > 80
      )
        throw new Error("元素轮廓无效");
      polygon = source.polygon.map((p) => {
        if (!Array.isArray(p) || p.length !== 2)
          throw new Error("元素轮廓点无效");
        return [
          number(p[0], 0, l.w, "轮廓横坐标"),
          number(p[1], 0, l.h, "轮廓纵坐标"),
        ];
      });
    }
    return {
      id: l.id,
      fill,
      polygon,
      matte: source.matte == null ? null : color(source.matte),
    };
  });
  // Do not animate a crop which contains text or intersects another extracted object.
  const intersects = (a, b) =>
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  const accepted = [];
  for (const l of layers) {
    if (
      l.type === "image" &&
      (layers.some((t) => t.type === "text" && intersects(l, t)) ||
        accepted.some((t) => t.type === "image" && intersects(l, t)))
    )
      continue;
    accepted.push(l);
  }
  return {
    layers: accepted,
    regions: regions.filter((r) => accepted.some((l) => l.id === r.id)),
    warnings: Array.isArray(raw.warnings)
      ? raw.warnings.slice(0, 20).map((w) => text(w, 500))
      : [],
    summary: text(raw.summary || "", 1000),
  };
}
