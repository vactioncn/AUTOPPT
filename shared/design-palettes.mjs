export const PALETTE_GROUPS = ["清爽商务", "温暖人文", "深色舞台", "鲜明创意"];

const palette = (name, group, colors, instructions) => ({
  group,
  palette: {
    name,
    instructions:
      instructions ||
      `背景 ${colors[0]}，主文字 ${colors[1]}，强调色 ${colors[2]}。强调色少量使用，正文保持与背景的清晰对比；其余设计语言沿用所选风格。`,
    colors,
  },
});

// Keep the first four saved presets byte-for-byte compatible with old projects.
export const DESIGN_PALETTES = [
  palette(
    "黑白 · 荧光黄",
    "鲜明创意",
    ["#FFFFFF", "#111111", "#DFFF00"],
    "黑或白为大面积底色，文字使用高对比黑白色；荧光黄 #DFFF00 只用于重点。黑底、白底均可，按内容选择。",
  ),
  palette(
    "暖白 · 深蓝",
    "清爽商务",
    ["#F6F3ED", "#17324D", "#3972B8"],
    "暖白 #F6F3ED 为背景，深蓝 #17324D 为主文字，蓝色 #3972B8 为少量强调色；保持清晰对比。",
  ),
  palette(
    "米白 · 赭红",
    "温暖人文",
    ["#F5EEE5", "#302823", "#B84E37"],
    "米白 #F5EEE5 为背景，深褐 #302823 为主文字，赭红 #B84E37 为少量强调色；保持清晰对比。",
  ),
  palette(
    "深色 · 薄荷绿",
    "深色舞台",
    ["#152525", "#F2F6F4", "#86D6AE"],
    "深灰 #152525 为背景，浅白 #F2F6F4 为主文字，薄荷绿 #86D6AE 为少量强调色；保持清晰对比。",
  ),
  palette("极简 · 石墨灰", "清爽商务", ["#F5F5F3", "#242628", "#59636E"]),
  palette("雾蓝 · 靛青", "清爽商务", ["#EDF3F8", "#172F4D", "#3457C5"]),
  palette("奶油 · 森林绿", "清爽商务", ["#F4F3E9", "#203B32", "#3D745A"]),
  palette("樱粉 · 酒红", "温暖人文", ["#F9EFEE", "#452C35", "#9D3B54"]),
  palette("砂岩 · 橄榄绿", "温暖人文", ["#EEE8DC", "#34382D", "#68734D"]),
  palette("羊皮 · 暖棕", "温暖人文", ["#F4E9D8", "#3C2C24", "#A25D36"]),
  palette("午夜 · 冰蓝", "深色舞台", ["#101C30", "#EDF3FA", "#77C9F5"]),
  palette("深海 · 香槟金", "深色舞台", ["#152832", "#F7F0E4", "#D7B675"]),
  palette("墨紫 · 薰衣草", "深色舞台", ["#251D32", "#F5F0FA", "#B9A2EC"]),
  palette("冷白 · 朱红", "鲜明创意", ["#F6F7F8", "#202126", "#D43C32"]),
  palette("柠檬 · 钴蓝", "鲜明创意", ["#F5F2CA", "#1D3150", "#315BD6"]),
  palette("奶油 · 活力橙", "鲜明创意", ["#FFF4E5", "#382B27", "#CF571D"]),
];

export function samePalette(a, b) {
  return (
    !!a &&
    !!b &&
    a.name === b.name &&
    a.instructions === b.instructions &&
    a.colors.length === b.colors.length &&
    a.colors.every((c, i) => c.toUpperCase() === b.colors[i].toUpperCase())
  );
}

export function normalizeHexColor(value) {
  const hex = value.trim().replace(/^#/, "");
  if (/^[\da-f]{3}$/i.test(hex))
    return (
      "#" +
      [...hex]
        .map((c) => c + c)
        .join("")
        .toUpperCase()
    );
  return /^[\da-f]{6}$/i.test(hex) ? "#" + hex.toUpperCase() : null;
}
