import test from "node:test";
import assert from "node:assert/strict";
import {
  validateSpec,
  validateReview,
  reconstructionPlan,
} from "../server/style-spec.mjs";
import { styleStamp } from "../server/core.mjs";
import { specFixture, reviewFixture } from "./fixtures/calibration.mjs";
test("reference observations reject invented precision, invalid geometry and missing evidence", () => {
  const spec = validateSpec(specFixture());
  assert.equal(spec.regions[0].measurements.fontFamily, null);
  for (const mutate of [
    (r) => (r.regions[0].box = [0.9, 0, 0.4, 1]),
    (r) => (r.regions[0].measurements.fontWeight = 9000),
    (r) => (r.constraints[0].target = "missing"),
    (r) => r.constraints.pop(),
    (r) => (r.regions[0].evidence = ""),
    (r) => (r.sourceRegion = [0, 0, 0, 0]),
  ]) {
    const raw = specFixture();
    mutate(raw);
    assert.throws(() => validateSpec(raw));
  }
});
test("reconstruction preserves original copy and all new image stamps record text-only generation", () => {
  const style = {
    id: "style",
    name: "sample",
    rules: "rules",
    refs: ["sample.png"],
    referenceProfiles: [
      { ref: "sample.png", spec: validateSpec(specFixture()) },
    ],
  };
  const plan = reconstructionPlan(style, "sample.png");
  assert.deepEqual(plan.displayText, specFixture().originalText);
  assert.equal(plan.referenceMode, "rules-only");
  assert.deepEqual(styleStamp(style, plan).imageRefs, []);
  assert.deepEqual(
    styleStamp(style, { ...plan, referenceMode: "with-reference" }).imageRefs,
    [],
  );
  assert.deepEqual(styleStamp(style, plan).designRefs, []);
});
test("review derives honest outcome and rejects incomplete or invalid checks", () => {
  const raw = reviewFixture();
  assert.equal(validateReview(raw).status, "deviations");
  raw.checks[1].status = "uncertain";
  assert.equal(validateReview(raw).status, "uncertain");
  raw.checks[1].status = "match";
  assert.equal(validateReview(raw).status, "matched");
  raw.checks.pop();
  assert.throws(() => validateReview(raw));
  const invalid = reviewFixture();
  invalid.checks[0].region = [0, 0, 3, 1];
  assert.throws(() => validateReview(invalid));
});
