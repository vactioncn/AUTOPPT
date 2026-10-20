import test from "node:test";
import assert from "node:assert/strict";
import {
  CHOREOGRAPHIES,
  choreography,
  planEntrance,
} from "../shared/motion/choreography.mjs";

test("authored entrances settle at original geometry, bound stagger and honor reduced motion", () => {
  const layers = Array.from({ length: 120 }, (_, i) => ({
    id: `t${i}`,
    type: "text",
    x: i % 2 ? 900 : 60,
    w: 500,
    fontSize: i ? 32 : 80,
    step: i % 31,
  }));
  const original = JSON.stringify(layers);
  const signatures = new Set();
  for (const preset of CHOREOGRAPHIES.filter((p) => p.id !== "custom")) {
    const page = { width: 1600, layers, choreography: preset.id };
    signatures.add(JSON.stringify(planEntrance(page, layers[0], 0)));
    for (const [i, l] of layers.entries()) {
      const p = planEntrance(page, l, i);
      assert(p.delay <= 1400);
      assert(p.duration + p.delay <= 2400);
      assert.equal(p.frames.at(-1).transform, "none");
      assert.equal(p.frames.at(-1).opacity, 1);
      const reduced = planEntrance(page, l, i, false, true);
      assert.deepEqual(reduced.frames, [{ opacity: 0 }, { opacity: 1 }]);
      assert.equal(reduced.delay, 0);
      assert(reduced.duration <= 150);
    }
  }
  assert.equal(signatures.size, 6);
  assert.equal(JSON.stringify(layers), original);
  assert.throws(() => choreography("invented"), /动效编排/);
  assert.equal(choreography(), "custom");
});

test("steps replay only their own timing and comparison follows actual canvas placement", () => {
  const a = { id: "a", type: "text", x: 10, w: 500, fontSize: 60, step: 0 };
  const b = { ...a, id: "b", x: 1000, step: 6 };
  const page = { width: 1600, layers: [a, b], choreography: "contrast" };
  assert.match(planEntrance(page, a, 0).frames[0].transform, /-46/);
  assert.match(planEntrance(page, b, 1).frames[0].transform, /\(46/);
  assert.equal(planEntrance(page, b, 1, true).delay, 0);
  assert(planEntrance(page, b, 1).delay > 0);
});
