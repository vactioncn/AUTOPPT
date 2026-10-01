export const compositionFixture = () => ({
  alternatives: [
    { concept: "中央聚合", reason: "围绕一个焦点" },
    { concept: "横向比较", reason: "便于同类比较" },
    { concept: "上下联系", reason: "表达从属" },
  ],
  reason: "依据本页内容选择中央聚合",
  direction:
    "COMPOSITION_MARKER 以本页原文组织中央聚合的图文关系，不添加新文案。",
  signature: "中央聚合，文字为中心，主体围绕内容",
  review: {
    layout: "入口清楚",
    whitespace: "分组有停顿",
    hierarchy: "主次明确",
    color: "按所选风格",
    originality: "区别于附近页面",
  },
});
