import test from "node:test";
import assert from "node:assert/strict";
import {
  characterCount,
  copyProfile,
  copyMetrics,
  validateScreenCopy,
  prepareScreenCopy,
  assertDesignedCopy,
  reusableScreenCopy,
} from "../server/screen-copy.mjs";
import { imageContentPrompt } from "../server/image-content.mjs";
import { reviewFixture } from "./fixtures/screen-copy.mjs";

const notes =
  "2025年，仅试点门店的响应时间缩短20%，不是销售额增长。比如客服把重复查询交给工具，复杂问题仍由人工处理。";
const input = {
  notes,
  brief: { relationship: "data" },
  language: {},
  feedback: "",
  previous: null,
  attachments: [],
};
const draft = () => ({
  editScope: "composition",
  entries: [
    {
      text: "2025年，仅试点门店响应时间缩短20%",
      role: "main",
      sourceQuote: notes.slice(0, notes.indexOf("。")),
    },
    {
      text: "不是销售额增长",
      role: "qualifier",
      sourceQuote: "不是销售额增长",
    },
    {
      text: "比如客服把重复查询交给工具，复杂问题仍由人工处理。",
      role: "support",
      sourceQuote: "比如客服把重复查询交给工具，复杂问题仍由人工处理。",
    },
  ],
  mustKeep: ["2025年", "仅试点门店", "响应时间", "20%", "不是销售额增长"].map(
    (text) => ({ text, sourceQuote: notes }),
  ),
  spokenOnly: [],
  rationale: "保留范围和指标，不误导为销售增长",
});
const reviewed = (data) => ({
  ...reviewFixture(data),
  entries: data.candidate.entries.slice(0, 2),
  spokenOnly: [
    {
      sourceQuote: draft().entries[2].text,
      reason: "具体例子留在口播，不重复主结论",
    },
  ],
  changes: ["移去客服例子的完整解释，保留统计范围与指标"],
});

test("semantic context is sourced, independently reviewed and stays outside primary copy", async () => {
  const source =
    "第一层指个人赋能，第二层指进入业务流程。今天大多数团队在哪一层？";
  const support = { sourceQuote: "第一层指个人赋能，第二层指进入业务流程。" };
  const question = "今天大多数团队在哪一层？";
  const setup = {
    ...input,
    notes: source,
    brief: { relationship: "positioning" },
  };
  const candidate = {
    editScope: "composition",
    entries: [{ text: question, role: "main", sourceQuote: question }],
    mustKeep: [],
    spokenOnly: [],
    semanticSupport: [support],
    rationale: "保持设问，定义只辅助理解",
  };
  let calls = 0;
  const final = await prepareScreenCopy(setup, async (system, user) => {
    const data = JSON.parse(user);
    if (!calls++) return candidate;
    assert.deepEqual(data.candidate.semanticSupport, [support]);
    assert.match(system, /疑问变结论/);
    return reviewFixture(data);
  });
  assert.equal(calls, 2);
  assert.deepEqual(final.displayText, [question]);
  assert.equal(final.metrics.characters, characterCount(question));
  assert.deepEqual(final.semanticSupport, [support]);
  const prompt = imageContentPrompt(final);
  assert.match(prompt, /可选语义辅助资料｜不作为主体/);
  assert(prompt.indexOf(question) < prompt.indexOf(support.sourceQuote));
  assert.match(prompt, /图形、箭头、标签和位置标记也不能暗示/);
  assert(reusableScreenCopy(final, source));
  assert.equal(reusableScreenCopy({ ...final, version: 2 }, source), null);
  for (const semanticSupport of [
    [{ sourceQuote: "第一层以拍照为中心" }],
    [{ sourceQuote: question, attachmentId: "missing-chart" }],
    [support, support],
  ]) {
    assert.throws(
      () => validateScreenCopy({ ...candidate, semanticSupport }, setup),
      /语义辅助/,
    );
  }
  calls = 0;
  await assert.rejects(
    prepareScreenCopy(setup, async (_s, user) => {
      if (!calls++) return candidate;
      return {
        ...reviewFixture(JSON.parse(user)),
        semanticSupport: [{ sourceQuote: "第二层经营用户" }],
      };
    }),
    /语义辅助/,
  );
});

test("absent or removed context leaves undefined concepts undefined", async () => {
  let calls = 0;
  const result = await prepareScreenCopy(input, async (_s, user) => {
    if (!calls++)
      return {
        ...draft(),
        semanticSupport: [{ sourceQuote: "复杂问题仍由人工处理" }],
      };
    const review = reviewed(JSON.parse(user));
    delete review.semanticSupport;
    return review;
  });
  assert.deepEqual(result.semanticSupport, []);
  const prompt = imageContentPrompt(result);
  assert.match(prompt, /没有额外的、已确认的语义辅助资料/);
  assert.match(prompt, /对应序号、准确短译/);
  assert.match(prompt, /提问不能变成结论/);
  assert.match(prompt, /不得引入主文案和辅助资料都没有的新话题/);
  assert(!prompt.includes("复杂问题仍由人工处理"));
});

test("density is Unicode copy accounting with advisory task budgets, not source-length truncation", () => {
  assert.equal(characterCount("中文 🙂\n20%"), 6);
  assert.equal(copyProfile({ relationship: "statement" }).kind, "focus");
  assert.equal(
    copyProfile({ relationship: "comparison" }).kind,
    "relationship",
  );
  assert.equal(copyProfile({ relationship: "data" }).kind, "evidence");
  assert.equal(
    copyProfile({ relationship: "data" }, [{ id: "chart" }]).kind,
    "attachment",
  );
  const long = draft();
  long.entries[0].text = notes.repeat(4);
  assert.doesNotThrow(() => validateScreenCopy(long, input));
  const metrics = copyMetrics(long.entries, notes, copyProfile(input.brief));
  assert(metrics.warnings.includes("总字数偏多"));
  assert(metrics.warnings.includes("存在较长文字块"));
  assert(metrics.ratio > 1);
});

test("independent review shortens a dense draft, preserves qualifiers and leaves the manuscript untouched", async () => {
  const original = structuredClone(input),
    calls = [];
  const final = await prepareScreenCopy(input, async (system, user, refs) => {
    const data = JSON.parse(user);
    calls.push({ system, data, refs });
    return calls.length === 1 ? draft() : reviewed(data);
  });
  assert.equal(calls.length, 2);
  assert.match(calls[0].system, /上屏文案编辑/);
  assert.match(calls[1].system, /复核编辑/);
  assert.deepEqual(calls[1].data.candidate.mustKeep, draft().mustKeep);
  assert(final.metrics.characters < final.review.draftCharacters);
  assert.deepEqual(
    final.displayText,
    draft()
      .entries.slice(0, 2)
      .map((e) => e.text),
  );
  assert.deepEqual(input, original);
  assert.equal(final.spokenOnly[0].sourceQuote, draft().entries[2].text);
  assert.equal(final.review.status, "reviewed");
});

test("review cannot approve lost qualifiers, invented source evidence or repeated text", async () => {
  for (const mutate of [
    (r) => {
      r.entries[0].text = r.entries[0].text.replace("20%", "120%");
    },
    (r) => {
      r.entries[0].text = "门店响应时间缩短20%";
    },
    (r) => {
      r.entries[1].sourceQuote = "编造的原稿";
    },
    (r) => {
      r.entries.push({ ...r.entries[1] });
    },
  ]) {
    let n = 0;
    await assert.rejects(
      prepareScreenCopy(input, async (_s, user) => {
        if (!n++) return draft();
        const r = reviewed(JSON.parse(user));
        mutate(r);
        return r;
      }),
      /限定词|来源|重复/,
    );
  }
});

test("failed readability or fidelity review stops before layout and suggests manual splitting", async () => {
  let n = 0;
  await assert.rejects(
    prepareScreenCopy(input, async (_s, user) => {
      if (!n++) return draft();
      return {
        ...reviewed(JSON.parse(user)),
        checks: {
          ...reviewFixture({ candidate: draft() }).checks,
          readable: false,
        },
        splitSuggestion: "把试点数据和客服案例分成两页",
      };
    }),
    /未开始出图.*分成两页/,
  );
  assert.equal(n, 2);
  const bad = draft();
  bad.entries[0] = null;
  assert.throws(() => validateScreenCopy(bad, input), /来源/);
});

test("detail review freezes approved copy but can remove new annotations; composition can shorten it", async () => {
  const previous = {
    displayText: draft()
      .entries.slice(0, 2)
      .map((e) => e.text),
  };
  const refine = { ...input, previous, feedback: "只补细节" };
  let n = 0;
  const result = await prepareScreenCopy(refine, async (_s, user) => {
    if (!n++) return { ...draft(), editScope: "details" };
    return reviewed(JSON.parse(user));
  });
  assert.deepEqual(result.displayText, previous.displayText);
  const changed = { ...draft(), editScope: "details" };
  changed.entries[0].text = "新的主标题";
  assert.throws(() => validateScreenCopy(changed, refine), /不能替换/);
  assert.throws(
    () => validateScreenCopy({ ...draft(), editScope: "details" }, input),
    /没有可保留/,
  );
});

test("attachments enter both editorial calls and their labels remain outside authored-copy counts", async () => {
  const attachments = [
    { id: "chart", filename: "chart.png", name: "试点数据" },
  ];
  let n = 0;
  const final = await prepareScreenCopy(
    { ...input, attachments },
    async (_s, user, refs) => {
      assert.deepEqual(refs, ["chart.png"]);
      const data = JSON.parse(user);
      assert.equal(data.profile.kind, "attachment");
      return !n++ ? draft() : reviewed(data);
    },
  );
  assert.equal(
    final.metrics.characters,
    characterCount(final.displayText.join("")),
  );
  const invalid = draft();
  invalid.entries[0].attachmentId = "foreign-image";
  assert.throws(
    () => validateScreenCopy(invalid, { ...input, attachments }),
    /来源/,
  );
});

test("layout cannot reintroduce removed prose and cancellation does not start review", async () => {
  const copy = { displayText: ["已复核主文案"] };
  assert.doesNotThrow(() => assertDesignedCopy([...copy.displayText], copy));
  assert.throws(
    () => assertDesignedCopy([...copy.displayText, "又加回一段解释"], copy),
    /排版改动/,
  );
  const controller = new AbortController();
  let n = 0;
  await assert.rejects(
    prepareScreenCopy({ ...input, signal: controller.signal }, async () => {
      n++;
      controller.abort();
      return draft();
    }),
    { name: "AbortError" },
  );
  assert.equal(n, 1);
});
