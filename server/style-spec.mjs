// Structured observations remain estimates unless an original design file supplies exact values.
export const dimensions = [
  "layout",
  "typography",
  "color",
  "graphics",
  "density",
  "content",
];
const text = (v) => typeof v === "string" && v.trim().length > 0;
export function validBox(box) {
  return (
    Array.isArray(box) &&
    box.length === 4 &&
    box.every((v) => Number.isFinite(v) && v >= 0 && v <= 1) &&
    box[2] > 0 &&
    box[3] > 0 &&
    box[0] + box[2] <= 1.001 &&
    box[1] + box[3] <= 1.001
  );
}
export function validateSpec(raw) {
  const fail = () => {
    throw new Error("参考图的结构化规格不完整，请重新提炼。");
  };
  if (
    !raw ||
    !validBox(raw.sourceRegion) ||
    !text(raw.sourceDescription) ||
    !Number.isFinite(raw.aspectRatio) ||
    raw.aspectRatio < 0.5 ||
    raw.aspectRatio > 3 ||
    !Array.isArray(raw.originalText) ||
    raw.originalText.some((v) => typeof v !== "string") ||
    !Array.isArray(raw.regions) ||
    !raw.regions.length ||
    raw.regions.length > 24 ||
    !Array.isArray(raw.constraints) ||
    !raw.constraints.length ||
    !Array.isArray(raw.adaptationRules) ||
    !raw.adaptationRules.every(text)
  )
    fail();
  const ids = new Set(raw.regions.map((r) => r.id));
  if (ids.size !== raw.regions.length) fail();
  const regions = raw.regions.map((r) => {
    if (
      !text(r.id) ||
      !text(r.label) ||
      !["text", "graphic", "decoration"].includes(r.kind) ||
      !validBox(r.box) ||
      !text(r.evidence) ||
      !["observed", "estimated", "unknown"].includes(r.confidence)
    )
      fail();
    const m = r.measurements || {};
    const ranges = {
      fontSizeRatio: [0.001, 1],
      fontWeight: [1, 1000],
      lineHeight: [0.5, 4],
      letterSpacingEm: [-0.2, 2],
      strokeWidthRatio: [0, 0.1],
      fillRatio: [0, 1],
      maxLines: [1, 100],
    };
    for (const [k, [min, max]] of Object.entries(ranges))
      if (m[k] != null && (!Number.isFinite(m[k]) || m[k] < min || m[k] > max))
        fail();
    if (m.color != null && !/^#[a-f\d]{6}$/i.test(m.color)) fail();
    if (m.fontFamily != null && !text(m.fontFamily)) fail();
    return {
      id: r.id,
      label: r.label,
      kind: r.kind,
      box: r.box,
      text: typeof r.text === "string" ? r.text : "",
      evidence: r.evidence,
      confidence: r.confidence,
      measurements: Object.fromEntries(
        [...Object.keys(ranges), "color", "fontFamily"]
          .filter((k) => k in m)
          .map((k) => [k, m[k]]),
      ),
    };
  });
  const constraints = raw.constraints.map((c) => {
    if (
      !dimensions.slice(0, 5).includes(c.dimension) ||
      !(c.target === "canvas" || ids.has(c.target)) ||
      !text(c.rule) ||
      !text(c.evidence) ||
      typeof c.locked !== "boolean"
    )
      fail();
    return {
      dimension: c.dimension,
      target: c.target,
      rule: c.rule,
      evidence: c.evidence,
      locked: c.locked,
    };
  });
  if (
    !dimensions
      .slice(0, 5)
      .every((d) => constraints.some((c) => c.dimension === d))
  )
    fail();
  return {
    version: 1,
    sourceRegion: raw.sourceRegion,
    sourceDescription: raw.sourceDescription,
    aspectRatio: raw.aspectRatio,
    originalText: raw.originalText,
    regions,
    constraints,
    adaptationRules: raw.adaptationRules,
  };
}
export function validateReview(raw) {
  if (
    !raw ||
    !text(raw.summary) ||
    !Array.isArray(raw.checks) ||
    raw.checks.length !== dimensions.length ||
    new Set(raw.checks.map((c) => c.dimension)).size !== dimensions.length
  )
    throw new Error("画面检查结果不完整，请重试检查。");
  const checks = raw.checks.map((c) => {
    if (
      !dimensions.includes(c.dimension) ||
      !["match", "deviation", "uncertain"].includes(c.status) ||
      !["extraction", "planning", "rendering", "uncertain", "none"].includes(
        c.likelyStage,
      ) ||
      !["expected", "actual", "evidence", "suggestion"].every((k) =>
        text(c[k]),
      ) ||
      (c.region != null && !validBox(c.region))
    )
      throw new Error("画面检查缺少有效的对照依据，请重试检查。");
    return Object.fromEntries(
      [
        "dimension",
        "status",
        "expected",
        "actual",
        "evidence",
        "suggestion",
        "likelyStage",
        "region",
      ].map((k) => [k, c[k] ?? null]),
    );
  });
  return {
    version: 1,
    summary: raw.summary,
    checks,
    status: checks.some((c) => c.status === "deviation")
      ? "deviations"
      : checks.some((c) => c.status === "uncertain")
        ? "uncertain"
        : "matched",
    checkedAt: new Date().toISOString(),
  };
}
export function reconstructionPlan(style, referenceId) {
  const profile = style.referenceProfiles?.find((p) => p.ref === referenceId);
  const spec = profile?.spec;
  if (!spec) throw new Error("请先提炼所选参考图的结构化规格。");
  if (!spec.originalText.length)
    throw new Error("这张参考图没有可确认的原文，请换一张文字可读的参考图。");
  return {
    title: "原图复刻测试",
    displayText: spec.originalText,
    layout: JSON.stringify({
      sourceRegion: spec.sourceRegion,
      aspectRatio: spec.aspectRatio,
      regions: spec.regions,
    }),
    visual: JSON.stringify(spec.constraints),
    rationale: "保持原内容与布局，检验提炼及出图；不进行新讲稿的创意改编。",
    referenceId,
    referenceMode: "rules-only",
    purpose: "reconstruction",
    referenceSpec: spec,
    referenceReason: spec.sourceDescription,
    styleFeatures: spec.constraints.map((c) => c.rule),
    adaptations: "原图复刻：保留原图可辨认文字和图形主题，排除截图界面。",
  };
}
