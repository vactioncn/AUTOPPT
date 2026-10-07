import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

// Keep the minimum supported Node version: it need not execute TypeScript itself.
const source = readFileSync(
  new URL("../src/project-journey.ts", import.meta.url),
  "utf8",
);
const { outputText } = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
  },
});
const { projectArea, projectJourney } = await import(
  `data:text/javascript,${encodeURIComponent(outputText)}`
);

const project = (slides = []) => ({
  revision: 7,
  slides,
  batches: [],
  proposal: null,
});
const slides = [1, 2].map((i) => ({
  id: `p${i}`,
  image: "fixture.png",
  stale: false,
  status: "ready",
}));
const presentation = (revision = 7) => ({
  sourceRevision: revision,
  status: "ready",
  pages: slides.map((s) => ({ id: s.id, status: "ready" })),
});

test("journey routes and next action reflect actual mother-deck work, not visits", () => {
  assert.equal(projectArea("delivery"), "delivery");
  assert.equal(projectArea("unknown"), "overview");
  assert.equal(projectArea("toString"), "overview");
  assert.equal(projectJourney(project(), [], false).next.label, "开始写讲稿");
  assert.equal(
    projectJourney(project(slides), [], false).next.label,
    "开始演练",
  );
  for (const [p, jobs, draft] of [
    [project([{ ...slides[0], image: null }]), [], false],
    [project([{ ...slides[0], stale: true }]), [], false],
    [project([{ ...slides[0], status: "error" }]), [], false],
    [project(slides), [{ status: "running" }], false],
    [project(slides), [], true],
    [{ ...project(slides), batches: [{ slideIds: [] }] }, [], false],
    [{ ...project(slides), proposal: { type: "merge" } }, [], false],
  ]) {
    const journey = projectJourney(p, jobs, draft, [presentation()]);
    assert.equal(journey.next.area, "studio");
    assert(journey.tasks.length > 0);
  }
});

test("delivery readiness requires complete current records with the same scope and order", () => {
  const p = project(slides);
  assert.equal(
    projectJourney(p, [], false, [presentation()]).next.label,
    "检查交付",
  );
  for (const record of [
    presentation(6),
    { ...presentation(), pages: [{ id: "p1", status: "ready" }] },
    {
      ...presentation(),
      pages: [
        { id: "p1", status: "ready" },
        { id: "p2", status: "failed" },
      ],
    },
    { ...presentation(), pages: presentation().pages.reverse() },
    { ...presentation(), status: "running" },
  ])
    assert.equal(projectJourney(p, [], false, [record]).next.area, "rehearsal");
  const journey = projectJourney(
    project([
      { ...slides[0], stale: true },
      { ...slides[1], image: null },
    ]),
    [],
    false,
  );
  assert.equal(journey.illustrated, 1);
  assert.deepEqual(journey.missing, [2]);
  assert.equal(journey.stale, 1);
});
