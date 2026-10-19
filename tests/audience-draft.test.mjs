import test from "node:test";
import assert from "node:assert/strict";
import { createAudienceDraft } from "../shared/audience-draft.mjs";

function fixture() {
  let clock = 0,
    id = 0;
  const timers = new Map(),
    calls = [],
    results = [],
    states = [];
  const draft = createAudienceDraft({
    setTimer: (fn, ms) => {
      timers.set(++id, { at: clock + ms, fn });
      return id;
    },
    clearTimer: (key) => timers.delete(key),
    generate: (description, signal) =>
      new Promise((resolve, reject) =>
        calls.push({ description, signal, resolve, reject }),
      ),
    onResult: (value) => results.push(value),
    onState: (value) => states.push(value),
  });
  const advance = (ms) => {
    clock += ms;
    for (const [key, timer] of [...timers])
      if (timer.at <= clock) {
        timers.delete(key);
        timer.fn();
      }
  };
  let input = {
    description: "",
    brief: "",
    enabled: true,
    composing: false,
    context: "style-a",
  };
  const update = (patch = {}) => draft.update((input = { ...input, ...patch }));
  return { draft, calls, results, states, advance, update, timers };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));
const result = (description) => ({
  description,
  brief: `${description}的方案`,
});

test("audience draft debounces input and waits for Chinese composition without opening details", async () => {
  const f = fixture();
  f.update();
  f.advance(2000);
  assert.equal(f.calls.length, 0);
  f.update({ description: "面向", composing: true });
  f.advance(2000);
  assert.equal(f.calls.length, 0);
  f.update({ description: "面向老师", composing: false });
  f.advance(800);
  f.update({ description: "面向小学老师" });
  f.advance(800);
  assert.equal(f.calls.length, 0);
  f.advance(100);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].description, "面向小学老师");
  f.update();
  f.advance(2000);
  assert.equal(f.calls.length, 1);
  f.calls[0].resolve(result("面向小学老师"));
  await settle();
  assert.deepEqual(f.results, [result("面向小学老师")]);
  assert.equal(f.states.at(-1).status, "ready");
  f.draft.dispose();
});

test("old replies cannot overwrite newer text, manual edits, clearing or a closed editor", async () => {
  for (const change of [
    { description: "新受众" },
    { brief: "我手动写的说明" },
    { description: "" },
    { context: "style-b" },
    { enabled: false },
    "dispose",
  ]) {
    const f = fixture();
    f.update({ description: "原受众" });
    f.advance(900);
    if (change === "dispose") f.draft.dispose();
    else f.update(change);
    assert(f.calls[0].signal.aborted);
    f.calls[0].resolve(result("原受众"));
    await settle();
    assert.deepEqual(f.results, []);
    f.draft.dispose();
  }
});

test("failures release busy state, never loop automatically, and allow an explicit retry", async () => {
  const f = fixture();
  f.update({ description: "赛事观众" });
  f.advance(900);
  f.calls[0].reject(new Error("模拟网络错误"));
  await settle();
  assert.deepEqual(f.states.at(-1), { status: "error", error: "模拟网络错误" });
  f.update();
  f.advance(10000);
  assert.equal(f.calls.length, 1);
  f.draft.retry();
  f.advance(0);
  assert.equal(f.calls.length, 2);
  f.calls[1].resolve(result("赛事观众"));
  await settle();
  assert.deepEqual(f.results, [result("赛事观众")]);
  f.draft.dispose();
});

test("saved briefs and manual edits do not trigger model calls, explicit regeneration does", async () => {
  const f = fixture();
  f.update({ description: "已有受众", brief: "已有完整说明" });
  f.advance(10000);
  assert.equal(f.calls.length, 0);
  f.update({ brief: "用户自己调整的说明" });
  f.advance(10000);
  assert.equal(f.calls.length, 0);
  f.draft.retry();
  f.advance(0);
  assert.equal(f.calls.length, 1);
  f.calls[0].resolve(result("已有受众"));
  await settle();
  assert.deepEqual(f.results, [result("已有受众")]);
  f.draft.dispose();
});
