export const dimensionNames = [
  "layout",
  "typography",
  "color",
  "graphics",
  "density",
  "content",
];
export function specFixture() {
  return {
    sourceRegion: [0, 0, 1, 1],
    sourceDescription: "完整参考单页（本地测试素材）",
    aspectRatio: 16 / 9,
    originalText: [
      "LOCAL TEST FIXTURE",
      "16:9 / Automated workflow verification",
    ],
    regions: [
      {
        id: "title",
        label: "标题",
        kind: "text",
        box: [0.05, 0.3, 0.75, 0.2],
        text: "LOCAL TEST FIXTURE",
        confidence: "estimated",
        evidence: "画面中部的主标题",
        measurements: {
          fontFamily: null,
          fontWeight: 400,
          fontSizeRatio: 0.08,
          color: "#44553B",
        },
      },
      {
        id: "body",
        label: "说明",
        kind: "text",
        box: [0.05, 0.5, 0.75, 0.12],
        text: "16:9 / Automated workflow verification",
        confidence: "estimated",
        evidence: "标题下方辅助文字",
        measurements: { fontSizeRatio: 0.03, fontWeight: 400 },
      },
      {
        id: "field",
        label: "底色",
        kind: "graphic",
        box: [0, 0, 1, 1],
        text: "",
        confidence: "observed",
        evidence: "浅绿色背景",
        measurements: { color: "#EDF0E4" },
      },
    ],
    constraints: dimensionNames
      .slice(0, 5)
      .map((dimension) => ({
        dimension,
        target: "canvas",
        rule: "保持参考图的" + dimension,
        evidence: "明确标注的本地测试素材",
        locked: true,
      })),
    adaptationRules: ["保留文字层级，内容过长时更换版式。"],
  };
}
export function reviewFixture() {
  return {
    summary: "本地检查测试：标题偏重，需根据参考图调整。",
    checks: dimensionNames.map((dimension) => ({
      dimension,
      status: dimension === "typography" ? "deviation" : "match",
      expected: "参考图为细字与留白",
      actual:
        dimension === "typography" ? "测试判定为字重偏粗" : "本地测试维度吻合",
      evidence: "LOCAL TEST FIXTURE，仅用于验证交互",
      likelyStage: dimension === "typography" ? "rendering" : "none",
      suggestion:
        dimension === "typography"
          ? "保持版式，把标题字重调轻"
          : "保留当前处理",
      region: [0.05, 0.3, 0.75, 0.2],
    })),
  };
}
