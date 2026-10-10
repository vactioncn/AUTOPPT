import test from "node:test";
import assert from "node:assert/strict";
import { browsePages } from "../shared/page-browser.mjs";
import { planImageBatch } from "../shared/image-batch.mjs";
import { exportManuscript } from "../shared/manuscript.mjs";

const slides = Array.from({ length: 53 }, (_, index) => ({
  id: `page-${index + 1}`,
  notes: `这是第 ${index + 1} 页的原稿。`,
  plan: {
    title: index === 40 ? "MiniMax 声音" : `页面 ${index + 1}`,
    displayText: index === 40 ? ["保留你的声音"] : [],
    styleRules: "不可搜索的私有风格提示词",
  },
  image: `original-${index + 1}.jpg`,
  versions: [{ id: "old-version" }],
  batchIds: [index < 30 ? "old" : "new"],
}));

test("large-project browsing bounds rendered pages and preserves IDs, order, images, history and complete export", () => {
  const snapshot = JSON.stringify(slides);
  const first = browsePages(slides, slides, "", 0);
  const second = browsePages(slides, slides, "", 1);
  const last = browsePages(slides, slides, "", 100);
  assert.equal(first.slides.length, 24);
  assert.equal(second.slides[0], slides[24]);
  assert.equal(last.current, 2);
  assert.equal(last.slides.length, 5);
  assert.equal(last.numbers.get(slides[52].id), 53);
  assert.deepEqual([...first.slides, ...second.slides, ...last.slides], slides);
  assert.equal(JSON.stringify(slides), snapshot);
  const exported = exportManuscript({
    title: "长项目",
    revision: 1,
    slides,
    batches: [],
  });
  assert.match(exported, /这是第 53 页的原稿/);
});

test("scoped search supports original page number, mixed-case terms, Unicode width, screen text, and excludes style prompts", () => {
  const scope = slides.slice(30);
  assert.deepEqual(browsePages(scope, slides, "４１", 5).slides, [slides[40]]);
  assert.deepEqual(browsePages(scope, slides, "MINIMAX 声音", 0).slides, [
    slides[40],
  ]);
  assert.deepEqual(browsePages(scope, slides, "保留你的声音", 0).slides, [
    slides[40],
  ]);
  assert.equal(browsePages(scope, slides, "1", 0).total, 0);
  assert.equal(browsePages(slides, slides, "私有风格", 0).total, 0);
  assert.equal(browsePages(slides, slides, "找不到的文字", 0).pages, 1);
  assert.equal(browsePages(slides.slice(0, 2), slides, "", 2).current, 0);
});

test("image batch budgeting keeps the exact original page order, deduplicates and treats unknown quotas conservatively", () => {
  const input = ["last", "first", "last", "middle"];
  const partial = planImageBatch(input, 2);
  assert.deepEqual(partial.ids.slice(0, partial.affordable), ["last", "first"]);
  assert.equal(partial.remaining, 1);
  assert.equal(partial.limited, true);
  assert.equal(planImageBatch(input, 0).affordable, 0);
  assert.equal(planImageBatch(input, null).known, false);
  assert.equal(planImageBatch(input, -1).known, false);
  assert.equal(planImageBatch(input, 3).limited, false);
  assert.deepEqual(input, ["last", "first", "last", "middle"]);
});
