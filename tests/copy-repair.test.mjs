import test from "node:test";
import assert from "node:assert/strict";
import {
  prepareScreenCopy,
  validateScreenCopy,
} from "../server/screen-copy.mjs";
import { imageContentPrompt } from "../server/image-content.mjs";
import { reviewFixture } from "./fixtures/screen-copy.mjs";

const notes = "部分试点门店效率最高提升20%。今天讲五个话题。";
const input = { notes, brief: { relationship: "data" }, attachments: [] };
const draft = () => ({
  editScope: "composition",
  entries: [
    {
      text: "部分试点门店效率最高提升20%",
      role: "main",
      sourceQuote: "部分试点门店效率最高提升20%。",
    },
  ],
  mustKeep: ["部分", "试点", "最高", "20%"].map((text) => ({
    text,
    sourceQuote: "部分试点门店效率最高提升20%。",
  })),
  spokenOnly: [],
  rationale: "保留结果及限定",
});

test("equivalent count notation passes while numeric magnitude, sign, units and qualifiers stay protected", () => {
  const raw = draft();
  for (const text of [
    "部分试点门店效率最高提升120%",
    "部分试点门店效率最高提升-20%",
    "部分试点门店效率最高提升20元",
    "试点门店效率最高提升20%",
  ])
    assert.throws(
      () =>
        validateScreenCopy(
          { ...raw, entries: [{ ...raw.entries[0], text }] },
          input,
        ),
      /限定词/,
    );
  raw.entries = [
    { text: "今天讲5个话题", role: "main", sourceQuote: "今天讲五个话题。" },
  ];
  raw.mustKeep = [{ text: "五个", sourceQuote: "今天讲五个话题。" }];
  assert.doesNotThrow(() => validateScreenCopy(raw, input));
  raw.entries[0].text = "今天讲15个话题";
  assert.throws(() => validateScreenCopy(raw, input), /限定词/);
  raw.entries = [
    { text: "三4年以后", role: "main", sourceQuote: "三四年以后" },
  ];
  raw.mustKeep = [{ text: "三四年", sourceQuote: "三四年以后" }];
  assert.throws(
    () => validateScreenCopy(raw, { notes: "三四年以后" }),
    /限定词/,
  );
});

test("a review missing a qualifier gets one targeted repair and still needs review approval", async () => {
  let calls = 0;
  const result = await prepareScreenCopy(input, async (_system, user) => {
    const data = JSON.parse(user);
    calls++;
    if (calls === 1) return draft();
    const review = reviewFixture(data);
    if (calls === 2) review.entries[0].text = "部分试点门店效率提升20%";
    else {
      assert.equal(data.repair.issue.code, "missing-protection");
      assert.equal(data.repair.issue.protectedText, "最高");
      assert.match(data.repair.previousResult.entries[0].text, /效率提升/);
    }
    return review;
  });
  assert.equal(calls, 3);
  assert.equal(result.review.repairAttempts, 1);
  assert.match(result.displayText[0], /最高/);
});

test("failed repair preserves stage, original quote and candidate in the persisted error message", async () => {
  let calls = 0;
  await assert.rejects(
    prepareScreenCopy(input, async (_system, user) => {
      calls++;
      if (calls === 1) return draft();
      const review = reviewFixture(JSON.parse(user));
      review.entries[0].text = "门店效率提升20%";
      return review;
    }),
    (error) => {
      assert.match(error.message, /文案复核未通过（已自动修正一次）/);
      assert.match(error.message, /对应来源引用：部分试点门店效率最高提升20%/);
      assert.match(error.message, /候选上屏文案：门店效率提升20%/);
      return true;
    },
  );
  assert.equal(calls, 3);
});

test("initial repair cannot bypass a valid protection by clearing the list", async () => {
  let calls = 0;
  await assert.rejects(
    prepareScreenCopy(input, async () => {
      calls++;
      const raw = draft();
      raw.entries[0].text = "门店效率提升20%";
      if (calls === 2) raw.mustKeep = [];
      return raw;
    }),
    /文案提炼未通过.*已自动修正一次/s,
  );
  assert.equal(calls, 2);
});

test("source mismatch is distinct from missing copy and can be repaired", async () => {
  let calls = 0;
  const result = await prepareScreenCopy(input, async (_system, user) => {
    calls++;
    const data = JSON.parse(user);
    if (calls === 1) {
      const raw = draft();
      raw.mustKeep[0].sourceQuote = "部分试点，门店效率最高提升20%。";
      return raw;
    }
    if (calls === 2) {
      assert.equal(data.repair.issue.code, "protection-source");
      return draft();
    }
    return reviewFixture(data);
  });
  assert.equal(calls, 3);
  assert.equal(result.review.repairAttempts, 1);
});

test("optional claim moved entirely to speech releases its own protection, but a retained claim cannot lose its conditions", async () => {
  const quote = "今天讲五个话题。";
  const candidate = draft();
  candidate.entries.push({ text: quote, role: "support", sourceQuote: quote });
  candidate.mustKeep.push({ text: "五个", sourceQuote: quote });
  const getReview = (data) => ({
    ...reviewFixture(data),
    entries: data.candidate.entries.slice(0, 1),
    spokenOnly: [{ sourceQuote: quote, reason: "话题数留给口播" }],
    omittedClaims: [{ sourceQuote: quote, reason: "移去完整支撑句" }],
  });
  let calls = 0;
  const result = await prepareScreenCopy(input, async (_system, user) =>
    !calls++ ? candidate : getReview(JSON.parse(user)),
  );
  assert(!result.mustKeep.some((item) => item.text === "五个"));
  calls = 0;
  await assert.rejects(
    prepareScreenCopy(input, async (_system, user) => {
      if (!calls++) return candidate;
      const data = JSON.parse(user),
        review = getReview(data);
      review.entries.push({
        text: "今天讲几个话题",
        role: "support",
        sourceQuote: quote,
      });
      return review;
    }),
    /五个/,
  );
});

test("one repair budget is shared by both stages and abort does not trigger repair", async () => {
  let calls = 0;
  await assert.rejects(
    prepareScreenCopy(input, async (_s, user) => {
      calls++;
      if (calls === 1) {
        const raw = draft();
        raw.entries[0].text = "门店效率提升20%";
        return raw;
      }
      if (calls === 2) return draft();
      const review = reviewFixture(JSON.parse(user));
      review.entries[0].text = "门店效率提升20%";
      return review;
    }),
    /文案复核未通过/,
  );
  assert.equal(calls, 3);
  const controller = new AbortController();
  calls = 0;
  await assert.rejects(
    prepareScreenCopy({ ...input, signal: controller.signal }, async () => {
      calls++;
      controller.abort();
      const raw = draft();
      raw.entries[0].text = "门店效率提升20%";
      return raw;
    }),
    /abort/i,
  );
  assert.equal(calls, 1);
});

test("main and support roles reach image prompt without changing text or adding layout choices", () => {
  const copy = draft();
  copy.entries.push({
    text: "今天讲五个话题",
    role: "support",
    sourceQuote: "今天讲五个话题。",
  });
  copy.displayText = copy.entries.map((entry) => entry.text);
  const prompt = imageContentPrompt(copy);
  assert.match(prompt, /第 1 组：核心表达\n第 2 组：支撑信息/);
  assert.match(prompt, /仅作设计依据，不上屏/);
  for (const text of copy.displayText)
    assert.equal(prompt.split(text).length - 1, 1);
  assert(!prompt.includes("左") && !prompt.includes("右"));
  assert.equal(
    imageContentPrompt({ displayText: ["旧文案"] }).includes("第 1 组"),
    false,
  );
});

test("a repaired draft is rejected when independent review still finds it unfaithful", async () => {
  let calls = 0;
  await assert.rejects(
    prepareScreenCopy(input, async (_system, user) => {
      calls++;
      if (calls === 1) {
        const raw = draft();
        raw.entries[0].text = "门店效率提升20%";
        return raw;
      }
      if (calls === 2) return draft();
      const result = reviewFixture(JSON.parse(user));
      result.checks.faithful = false;
      return result;
    }),
    /复核未通过/,
  );
  assert.equal(calls, 3);
});

test("claim omission cannot release the main claim or hide an unqualified result in auxiliary excerpts", async () => {
  let calls = 0;
  await assert.rejects(
    prepareScreenCopy(input, async (_system, user) => {
      if (!calls++) return draft();
      const result = reviewFixture(JSON.parse(user)),
        sourceQuote = draft().entries[0].sourceQuote;
      result.entries[0].text = "效率提升20%";
      result.omittedClaims = [{ sourceQuote, reason: "移到口播" }];
      result.spokenOnly = [{ sourceQuote, reason: "移到口播" }];
      return result;
    }),
    /部分/,
  );
  const raw = draft();
  raw.entries = [
    { ...raw.entries[0], text: "部分试点门店效率最" },
    { text: "高提升20%", role: "support", sourceQuote: notes },
  ];
  assert.throws(() => validateScreenCopy(raw, input), /限定词/);
});
