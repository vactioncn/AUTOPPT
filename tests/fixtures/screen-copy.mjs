// Provider fixtures test orchestration, not real model semantic quality.
export function copyFixture(
  data,
  texts = ["LOCAL TEST FIXTURE", "DETAIL LABEL"],
) {
  const locked = data.previous?.displayText;
  return {
    editScope: locked ? "details" : "composition",
    entries: (locked || texts).map((text, i) => ({
      text,
      role: i ? "support" : "main",
      sourceQuote: data.notes,
    })),
    mustKeep: [],
    semanticSupport: [],
    spokenOnly: [
      { sourceQuote: data.notes, reason: "完整展开保留在口播，画面提炼重点" },
    ],
    rationale: "保留主要表达，完整解释留在口播",
  };
}
export function reviewFixture(data) {
  return {
    entries: data.candidate.entries,
    spokenOnly: data.candidate.spokenOnly,
    semanticSupport: data.candidate.semanticSupport || [],
    rationale: data.candidate.rationale,
    checks: {
      faithful: true,
      noRedundancy: true,
      readable: true,
      attachmentsConsidered: true,
    },
    densityReason: "已复核核心表达、必要支撑和附件阅读负担，避免重复解释。",
    splitSuggestion: "",
    changes: [],
  };
}
