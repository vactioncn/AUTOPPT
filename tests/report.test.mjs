import test from "node:test";
import assert from "node:assert/strict";
import { characterCount, projectReport } from "../server/report.mjs";

const slide = (id, notes, extra = {}) => ({
  id,
  notes,
  manuscriptVersion: 1,
  ...extra,
});
test("report uses the exported notes and separates source headings from spoken body", () => {
  const report = projectReport({
    revision: 7,
    draft: "未提交 草稿",
    batches: [
      { id: "b", text: "# 标题\n\n第一句。\n第二句。", slideIds: ["a", "b"] },
    ],
    slides: [
      slide("a", "第一句。", { image: "a.png" }),
      slide("b", "第二句。", { stale: true }),
    ],
  });
  assert.equal(report.original, 11);
  assert.equal(report.body, 8);
  assert.equal(report.removedHeadings, 3);
  assert.equal(report.notes, 8);
  assert.equal(report.speech, 8);
  assert.equal(report.pages, 2);
  assert.equal(report.readyPages, 1);
  assert.equal(report.stalePages, 1);
  assert.equal(report.draft, 5);
  assert.equal(report.status, "matched");
  assert.equal(report.firstDifference, null);
  assert.deepEqual(
    report.perPage.map((p) => p.characters),
    [4, 4],
  );
});
test("equal counts do not conceal changed text or order; locate the first affected page", () => {
  const report = projectReport({
    batches: [{ text: "甲乙丙丁", slideIds: ["a", "b"] }],
    slides: [slide("a", "甲乙"), slide("b", "丁丙")],
  });
  assert.equal(report.difference, 0);
  assert.equal(report.status, "different");
  assert.equal(report.firstDifference.position, 3);
  assert.equal(report.firstDifference.page, 2);
});
test("unprocessed batches remain in the original baseline and draft is excluded", () => {
  const report = projectReport({
    draft: "另外的草稿",
    batches: [{ id: "b", label: "第 1 段", text: "完整原文。", slideIds: [] }],
    slides: [],
  });
  assert.equal(report.body, 5);
  assert.equal(report.notes, 0);
  assert.equal(report.difference, -5);
  assert.equal(report.unsegmented[0].characters, 5);
  assert.equal(report.status, "different");
});
test("count Unicode characters consistently and preserve already-normalized manual split notes", () => {
  assert.equal(characterCount(" A😀，\n\t中 2"), 5);
  const report = projectReport({
    batches: [{ text: "甲# 标记\n乙", slideIds: ["a", "b"] }],
    slides: [slide("a", "甲"), slide("b", "# 标记\n乙")],
  });
  assert.equal(report.status, "matched");
  const legacy = projectReport({
    batches: [{ text: "# 原稿标题\n正文", slideIds: ["a"] }],
    slides: [{ id: "a", notes: "# 旧备注标题\n正文" }],
  });
  assert.equal(legacy.status, "matched");
  assert.equal(legacy.notes, 2);
  assert.equal(projectReport({}).status, "empty");
});
