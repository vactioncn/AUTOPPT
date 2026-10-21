import test from "node:test";
import assert from "node:assert/strict";
import { styleSamplePreviews } from "../server/style-sample-preview.mjs";
import { styleStamp } from "../server/core.mjs";
import {
  STYLE_SAMPLE_PAGES,
  STYLE_SAMPLE_VERSION,
} from "../shared/style-sample-suite.mjs";

test("partial saved samples are previewed in page order without changing styles or trials", () => {
  const style = {
    id: "draft",
    name: "draft",
    rules: "saved rules",
    colors: [],
  };
  const trials = STYLE_SAMPLE_PAGES.slice(0, 7)
    .map((page) => ({
      id: page.id,
      styleId: style.id,
      jobId: page.id,
      image: `${page.id}.jpg`,
      purpose: "standard-sample",
      samplePageId: page.id,
      sampleVersion: STYLE_SAMPLE_VERSION,
      baseFingerprint: styleStamp(style).fingerprint,
      status: "completed",
      createdAt: "2026-10-20",
    }))
    .reverse();
  const original = structuredClone({ style, trials });
  const examples = styleSamplePreviews([style], trials, []).get(style.id);
  assert.equal(examples.length, 7);
  assert.deepEqual(
    examples.map((e) => e.pageId),
    STYLE_SAMPLE_PAGES.slice(0, 7).map((p) => p.id),
  );
  assert.deepEqual({ style, trials }, original);
  const point = trials.find((t) => t.id === "point");
  const candidates = [
    {
      ...point,
      id: "newest-completed",
      image: "new.jpg",
      createdAt: "2026-10-21",
    },
    {
      ...point,
      id: "not-finished",
      jobId: "running-job",
      createdAt: "2026-10-22",
    },
    {
      ...point,
      id: "wrong-style",
      baseFingerprint: "old",
      createdAt: "2026-10-23",
    },
    {
      ...point,
      id: "ordinary-trial",
      purpose: "transfer",
      createdAt: "2026-10-24",
    },
    ...trials,
  ];
  assert.equal(
    styleSamplePreviews([style], candidates, [
      { id: "running-job", status: "running" },
    ]).get(style.id)[1].id,
    "newest-completed",
  );
  const chosen = styleSamplePreviews(
    [{ ...style, sampleChoices: { point: point.id } }],
    candidates,
    [{ id: "running-job", status: "running" }],
  ).get(style.id);
  assert.equal(
    chosen[1].id,
    point.id,
    "The saved older choice must match publishing and gallery",
  );
  assert.equal(
    styleSamplePreviews(
      [{ ...style, publishedTrialIds: [point.id] }],
      candidates,
      [],
    ).get(style.id)[1].id,
    point.id,
    "Existing published choices survive upgrading without rewriting stored styles",
  );
  assert.equal(
    styleSamplePreviews([{ ...style, rules: "changed" }], trials, []).get(
      style.id,
    ).length,
    0,
  );
  assert.equal(
    styleSamplePreviews([{ ...style, catalogSourceId: "source" }], trials, [])
      .size,
    0,
  );
});
