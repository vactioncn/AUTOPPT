import test from "node:test";
import assert from "node:assert/strict";
import {
  sentences,
  splitAt,
  unitsFromEnds,
  orderedSelection,
} from "../server/core.mjs";
test("sentence parsing never changes the source, including repeated text, quotes, whitespace and emoji", () => {
  for (const text of [
    "  开始。\n\n继续！“为什么？”\r\n因为如此。  ",
    "第一句。第一句。第二句。",
    "没有标点也必须完整保留",
    "\n\n原文🙂。结尾\n",
    "English. Next? Yes!\n最后一句。",
    "\t\n  内容有前导空白。\n \n结尾  ",
  ])
    assert.equal(sentences(text).join(""), text);
});
test("manual splitting supports 2, 3, 5 pages with exact reconstruction", () => {
  const text = "第一句话。第二句话。第三句话。第四句话。第五句话。";
  for (const cuts of [[5], [5, 10], [5, 10, 15, 20]]) {
    const units = splitAt(text, cuts);
    assert.equal(units.length, cuts.length + 1);
    assert.equal(units.join(""), text);
  }
  assert.throws(() => splitAt(text, [0]));
  assert.throws(() => splitAt(text, [5, 5]));
  assert.throws(() => splitAt(text, [text.length]));
  assert.throws(() => splitAt("你好🙂世界", [3]));
});
test("invalid AI boundaries cannot lose or duplicate a source sentence", () => {
  const parts = ["甲。", "乙。", "丙。"];
  assert.deepEqual(unitsFromEnds(parts, [1, 3]), ["甲。", "乙。丙。"]);
  for (const ends of [[1, 2], [2, 1, 3], [1, 1, 3], [3, 4], []])
    assert.throws(() => unitsFromEnds(parts, ends));
});
test("merging keeps source order and rejects nonadjacent pages", () => {
  const slides = ["a", "b", "c"].map((id) => ({ id }));
  assert.deepEqual(
    orderedSelection(slides, ["b", "a"]).map((s) => s.id),
    ["a", "b"],
  );
  assert.throws(() => orderedSelection(slides, ["a", "c"]));
  assert.throws(() => orderedSelection(slides, ["a", "a"]));
});
