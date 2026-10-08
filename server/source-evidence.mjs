// Compare quoted words, not their presentation. This does not rewrite the
// manuscript, paraphrase claims, remove punctuation or join English words/numbers.
function evidenceText(value) {
  // Only paired emphasis is formatting. Keep literal/escaped markers, arithmetic,
  // identifiers, strikethrough, links and code unchanged.
  const emphasis = [
    /(?<![\\\w*])\*{3}(?!\*)(?=\S)([\s\S]*?\S)(?<!\\)\*{3}(?![\w*])/gu,
    /(?<![\\\w*])\*{2}(?!\*)(?=\S)([\s\S]*?\S)(?<!\\)\*{2}(?![\w*])/gu,
    /(?<![\\\w_])_{2}(?!_)(?=\S)([\s\S]*?\S)(?<!\\)_{2}(?![\w_])/gu,
    /(?<![\\\w*])\*(?!\*)(?=\S)([\s\S]*?\S)(?<!\\)\*(?![\w*])/gu,
    /(?<![\\\w_])_(?!_)(?=\S)([\s\S]*?\S)(?<!\\)_(?![\w_])/gu,
  ];
  return value
    .split(/(`+[^`]*`+)/gu)
    .map((part) => {
      if (part.startsWith("`")) return part;
      for (const pattern of emphasis) part = part.replace(pattern, "$1");
      return part
        .replace(/\s+/gu, " ")
        .replace(/(?<![A-Za-z0-9_]) | (?![A-Za-z0-9_])/gu, "");
    })
    .join("")
    .trim();
}

export function hasSourceEvidence(source, quote) {
  if (typeof source !== "string" || typeof quote !== "string") return false;
  const text = evidenceText(source),
    excerpt = evidenceText(quote);
  if (!excerpt) return false;
  let at = text.indexOf(excerpt);
  while (at >= 0) {
    const before = text[at - 1] || "",
      after = text[at + excerpt.length] || "";
    // A quote of 20% must not match 120%; "now" must not match "nowhere".
    const left =
      /^[A-Za-z0-9_]/u.test(excerpt) && /[A-Za-z0-9_.]/u.test(before);
    const right =
      /[A-Za-z0-9_]$/u.test(excerpt) &&
      (/[A-Za-z0-9_]/u.test(after) ||
        (/\d$/u.test(excerpt) &&
          /^\.\d/u.test(text.slice(at + excerpt.length))));
    if (!left && !right) return true;
    at = text.indexOf(excerpt, at + 1);
  }
  return false;
}
