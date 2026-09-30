import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultSystem,
  validateSystem,
  composeScene,
  samplePlan,
  validateScene,
  renderSceneSvg,
  LAYOUTS,
} from "../shared/slides.mjs";
const style = {
  rules: "暖白纸色，细字体与留白",
  colors: ["#f5f2e9", "#252c26", "#bc5236"],
};
test("all ten layout families create bounded editable elements from the same saved system", () => {
  const system = validateSystem(defaultSystem(style));
  assert.equal(system.layouts.length, 10);
  for (const l of system.layouts) {
    const scene = composeScene(samplePlan(l), system);
    assert(scene.elements.some((e) => e.type === "text"));
    assert.equal(validateScene(scene).elements.length, scene.elements.length);
    assert(renderSceneSvg(scene).includes("<svg"));
  }
  const dark = defaultSystem({
    rules: "深色舞台",
    colors: ["#202930", "#f4f2e8", "#eab06c"],
  });
  assert.notEqual(system.tokens.background, dark.tokens.background);
});
test("editing validates bounds and preserves complete text; HTML escapes untrusted copy", () => {
  const system = defaultSystem(style),
    scene = composeScene(samplePlan(system.layouts[2]), system);
  scene.elements[0].text = '<script>alert("test")</script>';
  assert(!renderSceneSvg(scene).includes("<script>"));
  const bad = structuredClone(scene);
  bad.elements[0].x = 1599;
  assert.throws(() => validateScene(bad));
  const long = structuredClone(scene);
  long.elements[0].text = "长文字".repeat(999);
  assert.throws(() => validateScene(long));
  const before = structuredClone(scene);
  const got = validateScene(scene);
  assert.deepEqual(scene, before);
  assert.equal(got.elements[0].text, scene.elements[0].text);
});
