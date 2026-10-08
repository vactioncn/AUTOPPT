import test from "node:test";
import assert from "node:assert/strict";
import {
  analyzePerformance,
  detailBatches,
  planningWindows,
  DETAIL_LIMITS,
} from "../server/speech/performance-director.mjs";
import { readPerformanceCheckpoint } from "../server/speech/performance-checkpoint.mjs";
import { mockGlobalPlan, mockDelivery } from "./helpers/performance-model.mjs";

const config = { style: "natural", sounds: true };
const pagesOf = (texts) =>
  texts.map((text, i) => ({
    id: `page-${i}`,
    title: `标题${i + 1}`,
    text,
    notes: text,
  }));
const controller = () => new AbortController();
const run = (
  pages,
  model,
  options = {},
  progress = () => {},
  signal = controller().signal,
) =>
  analyzePerformance(
    pages,
    config,
    signal,
    progress,
    async (_prompt, raw) => model(JSON.parse(raw)),
    options,
  );

test("133 pages are read in full once, then batched across pages and mapped to original IDs", async () => {
  const pages = pagesOf(
    Array.from({ length: 133 }, (_, i) =>
      Array.from(
        { length: 8 },
        (_, j) => `第${i + 1}页的第${j + 1}句话。`,
      ).join(""),
    ),
  );
  const inputs = [],
    checkpoints = [],
    progress = [];
  const result = await run(
    pages,
    (input) => {
      inputs.push(input);
      if (input.stage === "planning") {
        assert.equal(
          input.pages.map((p) => p.text).join(""),
          pages.map((p) => p.text).join(""),
        );
        return mockGlobalPlan(input);
      }
      assert.equal(
        input.globalPlan.overview,
        inputs[0] && mockGlobalPlan(inputs[0]).overview,
      );
      assert(input.units.length <= DETAIL_LIMITS.units);
      assert(
        input.units.reduce((n, u) => n + u.text.length, 0) <=
          DETAIL_LIMITS.characters,
      );
      assert(input.pageEnd - input.pageStart < DETAIL_LIMITS.pages);
      // Output order is irrelevant; IDs must map to their own page and unit.
      return {
        units: mockDelivery(input)
          .units.reverse()
          .map((u) => ({
            ...u,
            reason: `映射${u.id}`,
            emphasis: true,
            sound: "chuckle",
          })),
      };
    },
    { onCheckpoint: (entries) => checkpoints.push(entries) },
    (message, completed) => progress.push({ message, completed }),
  );
  assert.equal(
    inputs.length,
    18,
    "1 global request + 17 detail batches instead of 133 page requests",
  );
  assert.equal(inputs[1].pageStart, 1);
  assert.equal(inputs[1].pageEnd, 8);
  assert.match(
    progress[1].message,
    /第 1\/17 批 · 第 1–8\/133 页 · 本批 64 句/,
  );
  assert.equal(
    progress[1].completed,
    0,
    "in-flight units are not presented as completed",
  );
  assert.equal(progress[2].completed, 8);
  for (const [i, page] of result.entries()) {
    assert.equal(page.id, pages[i].id);
    assert.equal(page.units.map((u) => u.text).join(""), pages[i].text);
    assert.equal(page.units[0].id, "1");
    assert.equal(page.units[0].reason, `映射${i + 1}:1`);
    assert.equal(page.units.filter((u) => u.emphasis).length, 1);
    assert.equal(page.units.filter((u) => u.sound).length, 1);
  }
  assert.equal(checkpoints.at(-1).length, 133);
});

test("long scripts and oversized pages are completely read; partial global planning resumes", async () => {
  const pages = pagesOf(["开场。", "很长的故事。".repeat(12000), "最后总结。"]);
  const windows = planningWindows(pages);
  assert(windows.length > 1);
  assert.equal(
    windows.flatMap((w) => w.map((p) => p.text)).join(""),
    pages.map((p) => p.text).join(""),
  );
  const checkpoint = { fingerprint: "same", entries: [] };
  let calls = 0;
  await assert.rejects(
    run(
      pages,
      (input) => {
        if (++calls === 2) throw new Error("规划中断");
        return mockGlobalPlan(input);
      },
      {
        onDirector: (director) => {
          checkpoint.director = director;
        },
      },
    ),
    /规划中断/,
  );
  assert.equal(checkpoint.director.parts.length, 1);
  const resume = readPerformanceCheckpoint(checkpoint, "same", pages, config);
  assert(resume, "global-only progress is resumable");
  const resumed = [];
  await assert.rejects(
    run(
      pages,
      (input) => {
        resumed.push(input);
        if (input.stage === "delivery") throw new Error("批次中断");
        return mockGlobalPlan(input);
      },
      resume,
    ),
    /批次中断/,
  );
  assert.equal(
    resumed.filter((i) => i.stage === "planning").length,
    windows.length - 1,
  );
  assert.equal(resumed.filter((i) => i.stage === "consolidation").length, 1);
  assert.equal(resumed[0].pages[0].text, windows[1][0].text);
});

test("batch validation is atomic for missing, duplicate, foreign and rewritten units", async () => {
  const pages = pagesOf(["第一页。", "第二页。", "第三页。"]);
  for (const alter of [
    (units) => units.slice(0, -1),
    (units) => [units[0], units[0], units[2]],
    (units) => [...units.slice(0, 2), { ...units[2], id: "9:1" }],
    (units) => [...units.slice(0, 2), { ...units[2], text: "改写了正文" }],
    (units) => [...units.slice(0, 2), { ...units[2], pace: 99 }],
  ]) {
    let saves = 0,
      director;
    await assert.rejects(
      run(
        pages,
        (input) =>
          mockGlobalPlan(input) || { units: alter(mockDelivery(input).units) },
        {
          onCheckpoint: () => saves++,
          onDirector: (value) => {
            director = value;
          },
        },
      ),
    );
    assert.equal(saves, 0);
    assert(
      director.plan,
      "the global plan remains saved despite a malformed detail batch",
    );
  }
  let calls = 0;
  await assert.rejects(
    run(pages, () => {
      calls++;
      return {
        overview: "不完整",
        sections: [{ startPage: 2, endPage: 3, direction: "遗漏第一页" }],
      };
    }),
    /全场表达规划不完整/,
  );
  assert.equal(calls, 1, "invalid global plans must not reach detail requests");
});

test("cancelled late responses never checkpoint and old per-page progress resumes without reannotating saved sentences", async () => {
  const pages = pagesOf(["第一句。第二句。", "第三句。"]);
  const entries = [
    {
      id: pages[0].id,
      units: [
        {
          ...mockDelivery({ units: [{ id: "1" }] }).units[0],
          text: "第一句。",
        },
      ],
    },
  ];
  const inputs = [];
  const output = await run(
    pages,
    (input) => {
      inputs.push(input);
      return mockGlobalPlan(input) || mockDelivery(input);
    },
    { entries },
  );
  assert.equal(inputs[0].stage, "planning");
  assert.deepEqual(
    inputs[1].units.map((u) => u.id),
    ["1:2", "2:1"],
  );
  assert.deepEqual(output[0].units[0], entries[0].units[0]);
  assert.deepEqual(inputs[1].previousDelivery, [
    { text: "第一句。", emotion: "calm", pace: 1 },
  ]);
  const abort = controller();
  let saves = 0;
  await assert.rejects(
    run(
      pages,
      (input) => {
        if (input.stage === "delivery") abort.abort();
        return mockGlobalPlan(input) || mockDelivery(input);
      },
      { onCheckpoint: () => saves++ },
      () => {},
      abort.signal,
    ),
    { name: "AbortError" },
  );
  assert.equal(saves, 0);
});

test("empty pages and split long pages keep a contiguous valid checkpoint and preserve every character", async () => {
  const pages = pagesOf(["", "长句".repeat(5000), "", "结束。", ""]);
  let checkpoint;
  await run(pages, (input) => mockGlobalPlan(input) || mockDelivery(input), {
    onDirector: (director) => {
      checkpoint = { fingerprint: "same", entries: [], director };
    },
    onCheckpoint: (entries) => {
      checkpoint.entries = entries;
      assert(readPerformanceCheckpoint(checkpoint, "same", pages, config));
    },
  });
  assert.equal(checkpoint.entries.length, 5);
  assert.equal(
    checkpoint.entries[1].units.map((u) => u.text).join(""),
    pages[1].text,
  );
  const batches = detailBatches(pages);
  assert(
    batches.length > 1,
    "character limit applies before the sentence limit",
  );
  const empty = pagesOf(["", ""]);
  let calls = 0;
  const result = await run(empty, () => calls++);
  assert.equal(calls, 0);
  assert.equal(result.length, 2);
});
