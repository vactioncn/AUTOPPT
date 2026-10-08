import test from "node:test";
import assert from "node:assert/strict";
import { hasSourceEvidence } from "../server/source-evidence.mjs";

test("source quotes tolerate layout and paired emphasis without changing words", () => {
  const source =
    "**第二组：四件具体事情。**\n\n添改讲义——认真负责。\n\n纠正解剖图——严谨治学。";
  for (const quote of [
    source,
    source.replaceAll("\n\n", "\n"),
    source.replaceAll("\n", ""),
    source.replaceAll("**", "").replaceAll("\n\n", " \t\r\n"),
    "添改讲义——认真负责。纠正解剖图——严谨治学。",
  ])
    assert(hasSourceEvidence(source, quote), quote);
  for (const marker of ["**", "__", "***", "*", "_"]) {
    assert(
      hasSourceEvidence(
        `这里${marker}仍需人工复核${marker}。`,
        "这里仍需人工复核。",
      ),
    );
    assert(
      hasSourceEvidence(
        "这里仍需人工复核。",
        `这里${marker}仍需人工复核${marker}。`,
      ),
    );
  }
  assert(hasSourceEvidence("AI\r\n model 仍需复核。", "AI model 仍需复核。"));
  assert(hasSourceEvidence("AI\u00a0model", "AI model"));
  assert(hasSourceEvidence("中 文　排 版", "中文排版"));
});

test("source quotes cannot invent facts, cross gaps or erase meaningful separators", () => {
  for (const [source, quote] of [
    ["正文10篇散文。", "正文20篇散文。"],
    ["这并不是说医学没有价值。", "这是说医学没有价值。"],
    ["仅试点门店提高20%。", "门店提高20%。仅试点"],
    ["甲。中间一段不可省略。乙。", "甲。乙。"],
    ["匿名信事件。", "幻灯片事件。"],
    ["提高120%。", "20%"],
    ["提高0.20%。", "20%"],
    ["数量10。", "1"],
    ["数量10.5。", "10"],
    ["now here", "nowhere"],
    ["nowhere", "now here"],
    ["数量1 20。", "数量120。"],
    ["2*3*4", "234"],
    ["2**3**4", "234"],
    ["2 * 3", "2 3"],
    ["a_b_c", "abc"],
    ["~~不是~~", "~~是~~"],
    ["`**保留**`", "`保留`"],
    ["`two  spaces`", "`two spaces`"],
    ["\\*字\\*", "\\字\\"],
    ["正文", "** **"],
    ["正文", " \n\t"],
  ])
    assert.equal(
      hasSourceEvidence(source, quote),
      false,
      `${source} / ${quote}`,
    );
  assert.equal(hasSourceEvidence(null, "正文"), false);
  assert(hasSourceEvidence("120% 不等于20%。", "20%"));
});
