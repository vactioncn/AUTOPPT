import test from "node:test";
import assert from "node:assert/strict";
import { prepareSpeechText } from "../shared/speech-text.mjs";

test("spoken text omits directions, writing labels and image markup while retaining speech", () => {
  const raw =
    "# 演讲结构\n开场\n各位朋友，大家好。\n〔停顿，环视全场〕\n**今天只讲一个问题。**\n获奖者是 Francis（弗朗西斯），82 岁。⁠![Attachment.png](Attachment.png)\n---\n第一部分：为什么改变\n我们要保留（成本下降 20%）这个数字。\n【微笑】谢谢大家。";
  const before = raw;
  const result = prepareSpeechText(raw);
  assert.equal(
    result.text,
    "各位朋友，大家好。\n\n今天只讲一个问题。\n获奖者是 Francis（弗朗西斯），82 岁。\n\n我们要保留（成本下降 20%）这个数字。\n谢谢大家。",
  );
  assert(result.removed.some((r) => r.reason === "舞台或语气提示"));
  assert.equal(
    prepareSpeechText("【语气：热情】大家好！〔语速:慢〕欢迎大家。").text,
    "大家好！欢迎大家。",
  );
  assert.equal(raw, before);
});
test("title-only pages become silent and explicit no-speech blocks are removed", () => {
  assert.equal(
    prepareSpeechText("主标题\n企业经营升级\n副标题\n科学经营之路").text,
    "",
  );
  assert.equal(prepareSpeechText("标题页：超级品控").text, "");
  assert.equal(
    prepareSpeechText(
      "【不口播】这段给导演。\n不要念。【/不口播】\n正式开始。\n<!-- 编辑备注 -->",
    ).text,
    "正式开始。",
  );
});
test("spoken quotes, meanings, units and linked wording survive formatting cleanup", () => {
  const raw =
    "> 我说：**电脑还能干这个？**\n- [重要观点](https://example.com)\n1. 增长 10%，不是 100%。\n我们称它为【光遗传学】。\n1988 年，100 * 2 等于 200。\n（停顿是表达的一部分。）";
  assert.equal(
    prepareSpeechText(raw).text,
    "我说：电脑还能干这个？\n重要观点\n增长 10%，不是 100%。\n我们称它为【光遗传学】。\n1988 年，100 * 2 等于 200。\n（停顿是表达的一部分。）",
  );
});
