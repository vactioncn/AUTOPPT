import test from "node:test";
import assert from "node:assert/strict";
import {
  speechUnits,
  validateDelivery,
  compilePerformancePage,
  performanceMatches,
  performanceSettings,
} from "../shared/speech-performance.mjs";
import { prepareSpeechText } from "../shared/speech-text.mjs";
const cue = (unit, overrides = {}) => ({
  id: unit.id,
  emotion: "calm",
  pace: 1,
  pauseAfter: 0.5,
  emphasis: false,
  sound: "",
  reason: "为下一句留出思考时间",
  ...overrides,
});

test("director preserves every character, compiles supported controls and separates emotional changes", () => {
  const text = "那时我们真的很难。\n后来，大家都笑了！\n这就是改变。🙂";
  const raw = speechUnits(text);
  assert.equal(raw.map((u) => u.text).join(""), text);
  const units = validateDelivery(
    raw,
    raw.map((u, i) =>
      cue(
        u,
        i === 2 ? { emotion: "happy", emphasis: true, sound: "chuckle" } : {},
      ),
    ),
    performanceSettings(),
  );
  const clips = compilePerformancePage({ text, units }, "speech-2.8-hd", {
    speed: 1,
  });
  assert.equal(clips.map((c) => c.spokenText).join(""), text);
  assert.match(clips[0].text, /<#0.5#>/);
  assert(!clips[0].text.endsWith("<#0.5#>"));
  assert.equal(clips[1].delivery.emotion, "happy");
  assert.equal(clips[1].delivery.speed, 0.94);
  assert.equal(clips[1].delivery.volume, 1.12);
  assert.match(clips[1].text, /\(chuckle\)/);
  assert.throws(
    () =>
      compilePerformancePage({ text, units }, "speech-2.6-hd", { speed: 1 }),
    /Speech 2.8/,
  );
  assert.equal(
    compilePerformancePage({ text: "", units: [] }, "speech-2.8-hd", {
      speed: 1,
    }).length,
    0,
  );
});
test("director rejects rewritten prose, missing/duplicate IDs, unsupported tags and invalid parameters", () => {
  const units = speechUnits("内容一。内容二。");
  const out = units.map((u) => cue(u));
  for (const bad of [
    out.slice(0, 1),
    [out[0], out[0]],
    [cue(units[0], { text: "替换事实" }), out[1]],
    [cue(units[0], { pauseAfter: 99 }), out[1]],
    [cue(units[0], { pace: NaN }), out[1]],
    [cue(units[0], { sound: "applause" }), out[1]],
  ])
    assert.throws(() => validateDelivery(units, bad, performanceSettings()));
  const page = { text: "原文", units: [{ ...cue({ id: "1" }), text: "变更" }] };
  assert.throws(
    () => compilePerformancePage(page, "speech-2.8-hd", { speed: 1 }),
    /不一致/,
  );
});
test("auxiliary effects are sparse and coughs require explicit manuscript directions", () => {
  const units = speechUnits("请思考这句话。我们也经历过失败。");
  assert(
    validateDelivery(
      units,
      units.map((u) => cue(u, { sound: "coughs" })),
      performanceSettings(),
      "我听见他咳嗽了一下。",
    ).every((u) => !u.sound),
  );
  const marked = validateDelivery(
    units,
    units.map((u) => cue(u, { sound: "coughs" })),
    performanceSettings(),
    "（咳嗽）我们继续。",
  );
  assert.deepEqual(
    marked.map((u) => u.sound),
    ["coughs", ""],
  );
  assert(
    validateDelivery(
      units,
      units.map((u) => cue(u, { sound: "laughs" })),
      { sounds: false },
    ).every((u) => !u.sound),
  );
  const raw =
    "主标题：故事\n（轻笑）今天很开心。\n（咳嗽）我们继续。\n咳嗽也是身体的信号。";
  assert.equal(
    prepareSpeechText(raw).text,
    "今天很开心。\n我们继续。\n咳嗽也是身体的信号。",
  );
});
test("performance validity is bound to exact page IDs, ordering and spoken text", () => {
  const pages = [
      { id: "a", text: "你好。" },
      { id: "b", text: "" },
    ],
    plan = { version: 1, pages };
  assert(performanceMatches(plan, pages));
  assert(!performanceMatches(plan, [...pages].reverse()));
  assert(!performanceMatches(plan, [{ id: "a", text: "变了。" }, pages[1]]));
  assert(!performanceMatches(plan, pages.slice(0, 1)));
});
