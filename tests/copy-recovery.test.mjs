import test from "node:test";
import assert from "node:assert/strict";
import {
  prepareScreenCopy,
  reusableScreenCopy,
  screenCopyKey,
  COPY_VERSION,
} from "../server/screen-copy.mjs";
import { imageContentPrompt } from "../server/image-content.mjs";
import { reviewFixture } from "./fixtures/screen-copy.mjs";

const claim = "仅试点门店的响应时间缩短20%，不是销售额增长。";
const explanation =
  "具体做法包括把重复查询交给工具，复杂情况仍然交给人工判断。负责人会在演讲中介绍每一步的协作方式和遇到的例外，不需要把这些操作细节全部写到画面上。";
const notes = `大家有没有想过这样一件事情？\n\n${claim}\n\n${explanation}`;
const input = {
  notes,
  brief: { relationship: "statement" },
  attachments: [{ id: "chart", filename: "chart.png", name: "试点图表" }],
};
const draft = () => ({
  editScope: "composition",
  entries: [{ text: claim, role: "main", sourceQuote: claim }],
  mustKeep: ["仅试点门店", "20%", "不是销售额增长"].map((text) => ({
    text,
    sourceQuote: claim,
  })),
  spokenOnly: [{ sourceQuote: explanation, reason: "操作细节留给演讲者" }],
  semanticSupport: [],
  rationale: "保留结论、范围和否定，讲解留在备注。",
});

test("three draft alternatives recover invalid citations and structure before the independent review", async () => {
  const original = structuredClone(input),
    calls = [],
    progress = [];
  const result = await prepareScreenCopy(
    { ...input, onProgress: (s) => progress.push(s) },
    async (system, user, refs) => {
      const data = JSON.parse(user);
      calls.push(data);
      assert.deepEqual(refs, ["chart.png"]);
      if (system.includes("复核编辑")) return reviewFixture(data);
      if (!data.repair)
        return {
          ...draft(),
          entries: [{ ...draft().entries[0], sourceQuote: "无依据引用" }],
        };
      if (data.repair.attempt === 1)
        return { ...draft(), editScope: "details" };
      assert.match(data.repair.strategy, /另一种/);
      assert.match(data.repair.issue.message, /原文案/);
      return draft();
    },
  );
  assert.equal(calls.length, 4);
  assert.deepEqual(result.displayText, [claim]);
  assert.equal(result.review.repairAttempts, 2);
  assert.equal(result.review.status, "reviewed");
  assert.equal(result.review.attempts[0].issue.code, "entry-source");
  assert.equal(progress.filter((s) => s.includes("备选方案")).length, 2);
  assert(!imageContentPrompt(result).includes(explanation));
  assert.deepEqual(input, original);
});

test("review retries meaning and readability problems with new expressions, not the manuscript", async () => {
  let calls = 0;
  const result = await prepareScreenCopy(input, async (system, user) => {
    calls++;
    const data = JSON.parse(user);
    if (!system.includes("复核编辑")) return draft();
    const review = reviewFixture(data);
    if (!data.repair) review.checks.faithful = false;
    else if (data.repair.attempt === 1) review.checks.readable = false;
    return review;
  });
  assert.equal(calls, 4);
  assert.equal(result.review.repairAttempts, 2);
  assert.deepEqual(result.displayText, [claim]);
  assert.equal(result.review.sourceFallback, false);
  assert.equal(result.review.status, "reviewed");
});

test("exhausted malformed alternatives continue with one intact source sentence and complete notes", async () => {
  let calls = 0;
  const result = await prepareScreenCopy(input, async () => {
    calls++;
    return {};
  });
  assert.equal(calls, 4);
  assert.deepEqual(result.displayText, [claim]);
  assert.equal(result.review.status, "advisory");
  assert.equal(result.review.excerptFallback, true);
  assert.equal(result.spokenOnly[0].sourceQuote, notes);
  assert(result.metrics.characters <= result.profile.characters);
  assert(!imageContentPrompt(result).includes(explanation));
});

test("even an apparently approved full-manuscript alternative cannot resurrect the old fallback", async () => {
  const full = {
    ...draft(),
    entries: notes.split("\n\n").map((text, i) => ({
      text,
      role: i ? "support" : "main",
      sourceQuote: text,
    })),
  };
  let calls = 0;
  const result = await prepareScreenCopy(input, async (system, user) => {
    calls++;
    if (!system.includes("复核编辑")) return full;
    return { ...reviewFixture(JSON.parse(user)), entries: full.entries };
  });
  assert.equal(calls, 4);
  assert.notEqual(result.displayText.join(""), notes.replace(/\n/g, ""));
  assert(result.metrics.characters <= result.profile.characters);
  assert(!imageContentPrompt(result).includes(explanation));
});

test("retry cannot clear valid protection for the claim it retains", async () => {
  let calls = 0;
  const result = await prepareScreenCopy(input, async (system, user) => {
    calls++;
    const data = JSON.parse(user);
    if (system.includes("复核编辑")) return reviewFixture(data);
    if (!data.repair)
      return {
        ...draft(),
        spokenOnly: [{ sourceQuote: "无依据引用", reason: "口播" }],
      };
    return {
      ...draft(),
      entries: [{ text: "响应时间缩短20%", role: "main", sourceQuote: claim }],
      mustKeep: [],
    };
  });
  assert.equal(calls, 3);
  assert.deepEqual(result.displayText, [claim]);
  assert(result.mustKeep.some((p) => p.text === "仅试点门店"));
  assert(result.mustKeep.some((p) => p.text === "不是销售额增长"));
});

test("recovery outage stops extra requests and cancellation propagates immediately", async () => {
  let calls = 0;
  const result = await prepareScreenCopy(input, async () => {
    calls++;
    if (calls === 1) return {};
    throw new Error("429");
  });
  assert.equal(calls, 2);
  assert.deepEqual(result.displayText, [claim]);
  assert.equal(result.review.status, "advisory");
  const controller = new AbortController();
  calls = 0;
  await assert.rejects(
    prepareScreenCopy({ ...input, signal: controller.signal }, async () => {
      if (++calls === 2) controller.abort();
      return {};
    }),
    { name: "AbortError" },
  );
  assert.equal(calls, 2);
});

test("short source quotes preserve conditions; an indivisible long sentence is never cut or pasted in full", async () => {
  const source =
    "仅在试点范围内，如果" +
    "非常具体而且必须完整讲清楚的前提条件".repeat(12) +
    "都满足，才能考虑下一步。";
  const result = await prepareScreenCopy(
    { notes: source, brief: {} },
    async () => ({}),
  );
  assert.deepEqual(result.displayText, ["本页要点"]);
  assert.equal(result.spokenOnly[0].sourceQuote, source);
  assert.match(result.rationale, /中性页题/);
  assert.equal(result.review.status, "advisory");
});

test("only legacy whole-source fallback caches are rejected; confirmed short copy stays reusable", async () => {
  const valid = await prepareScreenCopy(input, async (system, user) =>
    system.includes("复核编辑") ? reviewFixture(JSON.parse(user)) : draft(),
  );
  assert(reusableScreenCopy(valid, notes, input.attachments));
  const legacy = {
    ...valid,
    version: COPY_VERSION,
    sourceKey: screenCopyKey(notes, input.attachments),
    review: { ...valid.review, sourceFallback: true },
  };
  assert.equal(reusableScreenCopy(legacy, notes, input.attachments), null);
  assert.equal(valid.review.repairAttempts, 0);
});

test("local source restoration that makes copy dense is optimized again and never replaces a shorter valid draft", async () => {
  const source =
    "仅试点门店，通过重新组织分工、记录重复查询、安排人员负责例外情况，以及定期回顾每一步协作方式，响应时间缩短20%。";
  const compact = {
    ...draft(),
    entries: [
      {
        text: "仅试点门店，响应时间缩短20%。",
        role: "main",
        sourceQuote: source,
      },
    ],
    mustKeep: ["仅试点门店", "20%"].map((text) => ({
      text,
      sourceQuote: source,
    })),
    spokenOnly: [],
  };
  let calls = 0;
  const result = await prepareScreenCopy(
    {
      notes: source + "\n\n完整操作过程留给演讲者。",
      brief: { relationship: "statement" },
    },
    async (system, user) => {
      calls++;
      if (!system.includes("复核编辑")) return compact;
      const data = JSON.parse(user);
      const review = reviewFixture(data);
      review.entries = [{ ...compact.entries[0], text: "响应时间缩短20%。" }];
      return review;
    },
  );
  assert.equal(calls, 4);
  assert.deepEqual(
    result.displayText,
    compact.entries.map((e) => e.text),
  );
  assert(
    result.review.attempts.some((a) => a.issue.code === "restoration-density"),
  );
  assert.equal(result.review.status, "advisory");
});

test("exhausted detail editing preserves explicitly locked copy rather than replacing it with a source excerpt", async () => {
  const previous = { displayText: ["已确认的标题", "已确认的短注释"] };
  const result = await prepareScreenCopy(
    { ...input, previous, feedback: "保留原文案，只补细节" },
    async () => ({}),
  );
  assert.deepEqual(result.displayText, previous.displayText);
  assert.equal(result.editScope, "details");
});

test("source fallback does not split a condition from its result at a formatting newline", async () => {
  const sentence = "仅在试点范围内，\n响应时间缩短20%，不是销售额增长。";
  const result = await prepareScreenCopy(
    { notes: sentence + "\n\n具体操作留给讲解。", brief: {} },
    async () => ({}),
  );
  assert.deepEqual(result.displayText, [sentence]);
});
