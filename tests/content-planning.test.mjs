import test from "node:test";
import assert from "node:assert/strict";
import {
  validateBriefs,
  validateComposition,
  nearbyCompositions,
  validateStyleExecution,
  preserveComposition,
} from "../server/content-planning.mjs";
import { styleLanguageKey } from "../server/core.mjs";
const pages = [
  { id: "a", notes: "有了地图，我们处在个人赋能这个层级。" },
  { id: "b", notes: "一个环节快了，但前后没连通，不等于整体改善。" },
];
const brief = (p, relationship) => ({
  id: p.id,
  claim: "原文核心含义",
  relationship,
  evidence: p.notes,
  entities: ["原文概念"],
  visualTask: "表达关系",
  mustNotImply: [],
});
test("content relationship evidence accepts formatting-only differences and preserves source", () => {
  const page = {
    id: "page-78",
    notes:
      "**第二组：四件具体事情。**\n\n添改讲义——认真负责。\n\n纠正解剖图——严谨治学。",
  };
  const original = structuredClone(page);
  const evidence =
    "第二组：四件具体事情。\n添改讲义——认真负责。\n纠正解剖图——严谨治学。";
  assert.equal(
    validateBriefs({ pages: [{ ...brief(page, "list"), evidence }] }, [page])[
      page.id
    ].evidence,
    evidence,
  );
  assert.deepEqual(page, original);
  assert.throws(
    () =>
      validateBriefs(
        {
          pages: [
            {
              ...brief(page, "list"),
              evidence: evidence.replace("认真负责", "不负责任"),
            },
          ],
        },
        [page],
      ),
    /原文依据/,
  );
});
test("semantic briefs preserve page mapping and evidence; a metaphor cannot silently become spatial data", () => {
  const out = validateBriefs(
    { pages: [brief(pages[0], "positioning"), brief(pages[1], "causality")] },
    pages,
  );
  assert(!out.a.allowedForms.includes("map"));
  assert(out.b.allowedForms.includes("flow"));
  assert(out.a.allowedForms.includes("typographic"));
  assert(out.b.allowedForms.includes("typographic"));
  assert.throws(() =>
    validateBriefs(
      {
        pages: [brief(pages[0], "positioning"), brief(pages[0], "positioning")],
      },
      pages,
    ),
  );
  assert.throws(() =>
    validateBriefs(
      {
        pages: [
          { ...brief(pages[0], "positioning"), evidence: "编造的内容" },
          brief(pages[1], "causality"),
        ],
      },
      pages,
    ),
  );
  assert.throws(() =>
    validateBriefs(
      { pages: [brief(pages[0], "spatial"), brief(pages[1], "causality")] },
      pages,
    ),
  );
});
test("unrelated repeated maps are rejected before generating images; no template id is required for a valid composition", () => {
  const b = validateBriefs({ pages: [brief(pages[1], "causality")] }, [
    pages[1],
  ]).b;
  const plan = {
    visualForm: "map",
    compositionKey: "左字右群岛",
    selectionReason: "把环节画成岛",
    typography: "细字重",
    alternatives: [
      { idea: "群岛", reason: "强调隔离" },
      { idea: "流程", reason: "直接显示环节" },
    ],
  };
  assert.throws(() => validateComposition(plan, b));
  assert.doesNotThrow(() =>
    validateComposition(
      { ...plan, visualForm: "flow", compositionKey: "断点流程" },
      b,
    ),
  );
});
test("neighbor context includes actual composition, excluding the page being redesigned", () => {
  const slides = ["a", "b", "c"].map((id, i) => ({
    id,
    plan: {
      title: id,
      visualForm: i ? "flow" : "position",
      compositionKey: "构图" + id,
      visual: "具体图形",
    },
  }));
  const nearby = nearbyCompositions(slides, "b");
  assert.deepEqual(
    nearby.map((p) => p.id),
    ["a", "c"],
  );
  assert.equal(nearby[0].visualForm, "position");
  assert.equal(nearby[1].position, "after");
});
test("a color-only style claim cannot replace resolved typography, density and graphic detail", () => {
  assert.throws(() =>
    validateStyleExecution({
      color: "blue",
      styleFeatures: ["浅底", "蓝色", "细线"],
    }),
  );
  const detail = {
    typeHierarchy:
      "标题为细而舒展的中文大字，正文约其四分之一，微型标签再缩小一层。",
    spatialRhythm:
      "标题与图形共享对齐轴，详细信息形成局部聚集，空场保持连续而不零碎。",
    graphicHierarchy:
      "主体、辅助引线和局部定位标记具有三种对比强度，边界端点精确对齐。",
    microDetail:
      "英文短标签由本页观点直接翻译，并列入上屏文案，不能随意补入年份或坐标。",
  };
  assert.deepEqual(validateStyleExecution(detail), detail);
  assert.throws(() =>
    validateStyleExecution({ ...detail, microDetail: "不需要" }),
  );
});
test("derived language has a compiler revision and changes with the user's rules", () => {
  const style = {
    id: "s",
    name: "User style",
    rules: "approved rules",
    colors: [],
  };
  assert.match(styleLanguageKey(style), /^language-v4-/);
  assert.notEqual(
    styleLanguageKey(style),
    styleLanguageKey({ ...style, rules: "revised rules" }),
  );
});

// Protect the approved design even when the model proposes an over-eager redesign.
test("detail refinement cannot replace approved composition, copy or graphic emphasis", () => {
  const previous = {
    title: "原主题",
    displayText: ["原主标题", "原单位"],
    layout: "两行大标题，图形在下方",
    visual: "荧光标题与两个图标路径",
    visualDirection: { typography: "强势黑体" },
  };
  const proposed = {
    title: "新标题",
    displayText: ["巨大新增说明"],
    layout: "一行小标题",
    visual: "删掉图标，扩大节点",
    detailText: ["逐步汇集"],
    styleExecution: {
      microDetail: "补充说明放在对应线段附近，使用次级字号，不改变已有构图。",
    },
  };
  const result = preserveComposition(previous, proposed, {
    typography: "常规字体",
  });
  assert.equal(result.layout, previous.layout);
  assert.equal(result.visual, previous.visual);
  assert.equal(result.typography, "强势黑体");
  assert.deepEqual(result.displayText, ["原主标题", "原单位", "逐步汇集"]);
  assert.deepEqual(previous.displayText, ["原主标题", "原单位"]);
  assert.throws(() =>
    preserveComposition(
      previous,
      { ...proposed, detailText: ["过长".repeat(25)] },
      {},
    ),
  );
});
