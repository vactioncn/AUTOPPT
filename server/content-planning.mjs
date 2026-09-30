// Content structures constrain meaning, not style or fixed template geometry.
export const PLANNING_VERSION = 3;
export const RELATION_FORMS = {
  positioning: ["position", "hierarchy"],
  hierarchy: ["hierarchy", "position", "comparison"],
  causality: ["flow", "comparison", "relationship"],
  process: ["flow", "sequence"],
  comparison: ["comparison"],
  partWhole: ["relationship", "hierarchy"],
  data: ["metric", "chart"],
  statement: ["typographic", "statement"],
  invitation: ["typographic", "relationship"],
  exploration: ["relationship", "typographic"],
  list: ["list", "relationship"],
  spatial: ["map", "spatial"],
};
export function validateBriefs(raw, pages) {
  if (!Array.isArray(raw.pages) || raw.pages.length !== pages.length)
    throw new Error("内容关系梳理不完整，请重试。");
  const ids = new Set();
  const result = {};
  for (const b of raw.pages) {
    const page = pages.find((p) => p.id === b.id);
    if (
      !page ||
      ids.has(b.id) ||
      !RELATION_FORMS[b.relationship] ||
      ![b.claim, b.visualTask, b.evidence].every(
        (v) => typeof v === "string" && v.trim(),
      ) ||
      !page.notes.includes(b.evidence) ||
      !Array.isArray(b.entities) ||
      b.entities.some((v) => typeof v !== "string" || !v.trim()) ||
      !Array.isArray(b.mustNotImply) ||
      b.mustNotImply.some((v) => typeof v !== "string") ||
      (b.relationship === "spatial" && b.literalSpatial !== true)
    )
      throw new Error("内容关系缺少有效原文依据，请重新分析。");
    ids.add(b.id);
    result[b.id] = {
      version: PLANNING_VERSION,
      claim: b.claim,
      relationship: b.relationship,
      evidence: b.evidence,
      entities: b.entities,
      visualTask: b.visualTask,
      mustNotImply: b.mustNotImply,
      allowedForms: RELATION_FORMS[b.relationship],
    };
  }
  return result;
}
export function validateComposition(raw, brief) {
  if (
    !raw ||
    ![
      raw.visualForm,
      raw.compositionKey,
      raw.selectionReason,
      raw.typography,
    ].every((v) => typeof v === "string" && v.trim())
  )
    throw new Error("方案缺少内容与构图的选择依据，请重新设计。");
  if (!brief.allowedForms.includes(raw.visualForm))
    throw new Error(
      `构图没有表达本页的内容关系（${brief.relationship}），未开始出图。请重新设计。`,
    );
  if (
    !Array.isArray(raw.alternatives) ||
    raw.alternatives.length < 2 ||
    raw.alternatives.some(
      (c) =>
        typeof c.idea !== "string" ||
        !c.idea.trim() ||
        typeof c.reason !== "string" ||
        !c.reason.trim(),
    )
  )
    throw new Error("方案没有比较不同表现方式的内容适用性，请重新构思。");
}
export function validateStyleExecution(raw) {
  const keys = [
    "typeHierarchy",
    "spatialRhythm",
    "graphicHierarchy",
    "microDetail",
  ];
  if (
    !raw ||
    keys.some((k) => typeof raw[k] !== "string" || raw[k].trim().length < 20)
  )
    throw new Error(
      "方案缺少字体层级、空间节奏或图形细节的具体落实，请重新设计。",
    );
  return Object.fromEntries(keys.map((k) => [k, raw[k]]));
}
export function validateLanguage(raw) {
  const keys = [
    "identity",
    "typography",
    "colorSystem",
    "compositionPrinciples",
    "graphicLanguage",
    "detailLanguage",
    "adaptationRules",
    "avoid",
  ];
  if (
    !raw ||
    keys.some((k) => typeof raw[k] !== "string" || raw[k].trim().length < 10)
  )
    throw new Error("风格规范缺少可执行的视觉特征，请重新整理。");
  return Object.fromEntries(keys.map((k) => [k, raw[k]]));
}
export function nearbyCompositions(slides, currentId) {
  const at = slides.findIndex((s) => s.id === currentId);
  return slides
    .slice(Math.max(0, at - 4), at + 3)
    .filter((s) => s.id !== currentId && s.plan)
    .map((s) => ({
      id: s.id,
      position: slides.indexOf(s) < at ? "before" : "after",
      title: s.plan.title,
      relationship: s.plan.contentBrief?.relationship || null,
      visualForm: s.plan.visualForm || null,
      compositionKey: s.plan.compositionKey || s.plan.layout,
      layoutId: s.plan.layoutId,
      visual: s.plan.visual,
    }));
}
