// Only explicit page-number slots may be parameterized. Chapter/photo/step
// numbers are not page numbers. Preserve every byte outside each matched slot.
export const PAGE_NUMBER_TOKEN = "{{page_number}}";

export function pageNumberTemplate(rules = "") {
  if (rules.includes(PAGE_NUMBER_TOKEN)) return rules;
  return rules.replace(/页码|\bpage numbers?\b/gi, (label, offset) => {
    const start =
      Math.max(
        rules.lastIndexOf("\n", offset - 1),
        rules.lastIndexOf("。", offset - 1),
        rules.lastIndexOf(";", offset - 1),
        rules.lastIndexOf("；", offset - 1),
      ) + 1;
    const end = rules.slice(offset).search(/[\n。;；]/);
    const clause = rules.slice(start, end < 0 ? rules.length : offset + end);
    // Ambiguous, negative and already numbered directives need manual editing.
    if (
      /不要|不需要|不使用|不显示|禁止|不必|不得|取消|去掉|无页码|\b(no|not|never|without|omit|remove)\b/i.test(
        clause,
      )
    )
      return label;
    if (
      /^\s*[:：=]?\s*(?:[0-9０-９]|["“'‘][0-9]|\{)/.test(
        rules.slice(offset + label.length),
      )
    )
      return label;
    return /page/i.test(label)
      ? `${label} (display ${PAGE_NUMBER_TOKEN})`
      : `${label}（显示为 ${PAGE_NUMBER_TOKEN}）`;
  });
}

export function pageNumberStyle(rules = "", pageNumber) {
  const template = pageNumberTemplate(rules);
  const supported = template.includes(PAGE_NUMBER_TOKEN);
  const valid = Number.isSafeInteger(pageNumber) && pageNumber > 0;
  if (supported && !valid)
    throw new Error("动态页码缺少有效的整份演讲页序，请重新提交制作。");
  const label = valid ? String(pageNumber).padStart(2, "0") : null;
  return {
    supported,
    label: supported ? label : null,
    rules: supported ? template.replaceAll(PAGE_NUMBER_TOKEN, label) : rules,
  };
}

export function withProjectPageNumber(plan, slides, slideId) {
  const index = slides.findIndex((slide) => slide.id === slideId);
  if (index < 0) throw new Error("原页面已经调整，请在当前页面重新发起制作。");
  return { ...plan, pageNumber: index + 1 };
}
