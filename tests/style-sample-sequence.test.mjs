import test from "node:test";
import assert from "node:assert/strict";
import {
  runSampleSequence,
  sampleSelection,
} from "../shared/style-sample-sequence.mjs";
import {
  STYLE_SAMPLE_PAGES,
  STYLE_SAMPLE_VERSION,
} from "../shared/style-sample-suite.mjs";

function fixture() {
  const state = { trials: [], fingerprint: "current" };
  const calls = [],
    pages = [];
  let stop = false,
    inflight = 0,
    maximum = 0;
  const options = {
    fingerprint: "current",
    read: async () => structuredClone(state),
    stopped: () => stop,
    onPage: (p) => pages.push(p.id),
    onTrial: () => {},
    create: async (pageId, fingerprint) => {
      assert.equal(
        inflight,
        0,
        "must await prior image before submitting another page",
      );
      maximum = Math.max(maximum, ++inflight);
      calls.push(pageId);
      const trial = {
        id: String(calls.length),
        purpose: "standard-sample",
        samplePageId: pageId,
        sampleVersion: STYLE_SAMPLE_VERSION,
        baseFingerprint: fingerprint,
        status: "running",
        image: null,
      };
      state.trials.unshift(trial);
      return structuredClone(trial);
    },
    wait: async () => {
      const trial = state.trials.find((t) => t.status === "running");
      trial.status = "completed";
      trial.image = trial.id + ".png";
      inflight--;
    },
  };
  return {
    state,
    calls,
    pages,
    options,
    maximum: () => maximum,
    pause: () => {
      stop = true;
    },
  };
}

test("one click submits eight independent pages in order with concurrency one", async () => {
  const f = fixture();
  await runSampleSequence(f.options);
  assert.deepEqual(
    f.calls,
    STYLE_SAMPLE_PAGES.map((p) => p.id),
  );
  assert.equal(f.maximum(), 1);
  assert.equal(f.state.trials.length, 8);
  await runSampleSequence(f.options);
  assert.equal(f.calls.length, 8, "completed pages are reused");
});

test("a failed page stops the sequence; explicit resume skips completed pages", async () => {
  const f = fixture();
  const wait = f.options.wait;
  f.options.wait = async () => {
    await wait();
    if (f.calls.length === 3)
      Object.assign(f.state.trials[0], {
        status: "failed",
        image: null,
        error: "provider failure",
      });
  };
  await assert.rejects(runSampleSequence(f.options), /第 03 页未完成/);
  assert.equal(f.calls.length, 3);
  f.options.wait = wait;
  await runSampleSequence(f.options);
  assert.deepEqual(f.calls, [
    "cover",
    "point",
    "framework",
    "framework",
    "data",
    "process",
    "comparison",
    "story",
    "action",
  ]);
});

test("pause leaves the accepted current page intact and never submits the next", async () => {
  const f = fixture();
  f.options.onTrial = () => f.pause();
  await runSampleSequence(f.options);
  assert.deepEqual(f.calls, ["cover"]);
  assert.equal(f.state.trials[0].status, "running");
});

test("style changes and uncertain submission outcomes halt without retries", async () => {
  const changed = fixture();
  changed.state.fingerprint = "new";
  await assert.rejects(runSampleSequence(changed.options), /正式风格已改变/);
  assert.equal(changed.calls.length, 0);
  const f = fixture();
  let submitted = 0;
  f.options.create = async () => {
    submitted++;
    throw new Error("response lost");
  };
  await assert.rejects(runSampleSequence(f.options), /response lost/);
  assert.equal(submitted, 1);
});

test("incomplete or old-style images never count as a finished current suite", async () => {
  const f = fixture();
  f.state.trials.push({
    id: "old",
    purpose: "standard-sample",
    samplePageId: "cover",
    sampleVersion: STYLE_SAMPLE_VERSION,
    baseFingerprint: "old",
    status: "completed",
    image: "old.png",
  });
  await runSampleSequence(f.options);
  assert.equal(f.calls.length, 8);
});

test("filling a partial suite preserves finished pages and creates only missing pages", async () => {
  const f = fixture();
  for (const pageId of ["cover", "framework", "action"]) {
    await f.options.create(pageId, "current");
    await f.options.wait();
  }
  const saved = structuredClone(f.state.trials);
  const priorCalls = f.calls.length;
  await runSampleSequence(f.options);
  assert.deepEqual(f.calls.slice(priorCalls), [
    "point",
    "data",
    "process",
    "comparison",
    "story",
  ]);
  for (const trial of saved)
    assert.deepEqual(
      f.state.trials.find((t) => t.samplePageId === trial.samplePageId),
      trial,
    );
});

test("resume waits for an already accepted page without submitting it again", async () => {
  const f = fixture();
  await f.options.create("cover", "current");
  await runSampleSequence(f.options);
  assert.equal(f.calls.filter((id) => id === "cover").length, 1);
  assert.equal(f.calls.length, 8);
  assert.equal(f.maximum(), 1);
});

test("one-click publication selects complete current pages in order and respects valid manual choices", () => {
  const base = {
    purpose: "standard-sample",
    sampleVersion: STYLE_SAMPLE_VERSION,
    baseFingerprint: "current",
    status: "completed",
    image: "saved.png",
  };
  const trials = STYLE_SAMPLE_PAGES.map((page) => ({
    ...base,
    id: page.id,
    samplePageId: page.id,
  }));
  const older = { ...trials[0], id: "older-cover" };
  trials.push(older);
  trials.unshift(
    { ...trials[0], id: "old-style", baseFingerprint: "old" },
    { ...trials[1], id: "failed", status: "failed" },
    { ...trials[2], id: "no-image", image: null },
  );
  assert.deepEqual(
    sampleSelection(trials, "current").map((t) => t.id),
    STYLE_SAMPLE_PAGES.map((p) => p.id),
  );
  const chosen = sampleSelection(trials, "current", [
    "old-style",
    "failed",
    "no-image",
    "older-cover",
  ]);
  assert.equal(chosen[0].id, "older-cover");
  assert.equal(chosen.filter(Boolean).length, 8);
  assert(sampleSelection(trials, "different").every((t) => t === undefined));
});
