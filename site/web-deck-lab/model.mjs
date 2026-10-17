export const PAGE_TYPES = Object.freeze({
  cover: 1,
  compare: 3,
  network: 3,
  question: 2,
  scenario: 2,
  flow: 3,
  lenses: 4,
  agenda: 5,
  statement: 2,
});

export function validateDeck(deck) {
  if (
    !deck?.id ||
    !deck.title ||
    !deck.source?.pages ||
    !Array.isArray(deck.slides) ||
    !deck.slides.length
  )
    throw new Error("需要 id、title、source.pages 和非空 slides。");
  const text = (value, field) => {
    if (typeof value !== "string" || !value.trim())
      throw new Error(`缺少文字：${field}`);
  };
  const fields = {
    cover: ["subtitle", "aside"],
    compare: ["conclusion"],
    network: ["center", "subtitle"],
    question: ["question", "conclusion"],
    scenario: ["year", "budget", "unit", "subtitle", "condition", "label"],
    flow: ["subtitle"],
    lenses: ["subtitle"],
    agenda: [],
    statement: ["statement", "subtitle"],
  };
  for (const [i, slide] of deck.slides.entries()) {
    if (!Object.hasOwn(PAGE_TYPES, slide.type))
      throw new Error(`第 ${i + 1} 页表现类型未实现。`);
    for (const field of [
      "title",
      "chapter",
      "pattern",
      "patternName",
      ...fields[slide.type],
    ])
      text(slide[field], `${i + 1}.${field}`);
    if (slide.cues?.length !== PAGE_TYPES[slide.type])
      throw new Error(`第 ${i + 1} 页步骤数与表现方式不匹配。`);
    slide.cues.forEach((cue) => text(cue, "cue"));
    if (!slide.sources?.length) throw new Error(`第 ${i + 1} 页缺少来源。`);
    for (const ref of slide.sources)
      text(deck.source.pages[String(ref)], `source.pages.${ref}`);
    if (["network", "flow", "lenses", "agenda"].includes(slide.type)) {
      const count = { network: 4, flow: 6, lenses: 4, agenda: 5 }[slide.type];
      if (slide.items?.length !== count)
        throw new Error(`第 ${i + 1} 页需要 ${count} 项。`);
      slide.items.forEach((item) =>
        slide.type === "agenda"
          ? ["title", "text"].forEach((k) => text(item[k], k))
          : text(item, "item"),
      );
    }
    if (slide.type === "compare")
      for (const side of ["left", "right"])
        for (const k of ["label", "title"])
          text(slide[side]?.[k], `${side}.${k}`);
  }
  return deck;
}

export function buildTimeline(deck) {
  return deck.slides.flatMap((slide, page) =>
    slide.cues.map((cue, phase) => ({ page, phase, cue })),
  );
}

export function indexFromHash(hash, timeline) {
  const match = /^#(\d+)\.(\d+)$/.exec(hash);
  if (!match) return -1;
  return timeline.findIndex(
    (step) =>
      step.page === Number(match[1]) - 1 && step.phase === Number(match[2]),
  );
}

export function moveIndex(index, delta, timeline) {
  return Math.min(timeline.length - 1, Math.max(0, index + delta));
}
