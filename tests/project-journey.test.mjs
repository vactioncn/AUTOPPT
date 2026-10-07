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
const { projectArea, projectJourney, projectPrimaryAction } = await import(
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

test("each area owns its primary action and PPTX readiness reflects export checks", () => {
  const journey = projectJourney(project(slides), [], false);
  const action = (area, state = journey, options) =>
    projectPrimaryAction(area, state, options);
  assert.equal(action("overview").label, "开始演练");
  assert.equal(action("studio").target, "pages");
  assert.equal(action("rehearsal").label, "打开演讲播放器");
  assert.equal(
    action("rehearsal", journey, { speechAvailable: true }).target,
    "player",
  );
  assert.equal(action("delivery").label, "下载 ZIP 交付包");
  assert.equal(
    action("delivery", journey, { bundleAvailable: false }).label,
    "下载 PPTX",
  );
  for (const blocked of [
    projectJourney(project(), [], false),
    projectJourney(project([{ ...slides[0], image: null }]), [], false),
    projectJourney(project(slides), [{ status: "running" }], false),
    projectJourney(
      { ...project(slides), batches: [{ slideIds: [] }] },
      [],
      false,
    ),
  ]) {
    assert.equal(blocked.pptxReady, false);
    assert.equal(action("delivery", blocked).label, "查看导出检查");
  }
  assert.equal(
    action("rehearsal", projectJourney(project(), [], false)).label,
    "返回制作台",
  );
  assert.deepEqual(action("rehearsal", journey, { speechAvailable: false }), {
    area: "rehearsal",
    target: "player",
    label: "标准放映不可用",
    disabled: true,
  });
  assert.deepEqual(
    action("rehearsal", projectJourney(project(), [], false), {
      speechAvailable: false,
    }),
    { area: "studio", target: "pages", label: "返回制作台" },
  );
});

test("task queue carries concrete repair destinations and counts", () => {
  const journey = projectJourney(
    project([
      { ...slides[0], image: null, status: "error" },
      { ...slides[1], stale: true },
    ]),
    [{ status: "running" }],
    true,
  );
  for (const target of ["missing", "stale", "failed", "jobs", "composer"]) {
    const task = journey.tasks.find((t) => t.action.target === target);
    assert(task, `reachable ${target} task`);
    assert.equal(task.action.area, "studio");
    assert(task.action.label.length > 0);
    assert(task.reason.length > 0);
  }
  for (const [slide, label] of [
    [{ ...slides[0], image: null }, "补齐 1 页画面"],
    [{ ...slides[0], stale: true }, "核对 1 页画面"],
    [{ ...slides[0], status: "error" }, "检查 1 页失败页面"],
  ]) {
    const state = projectJourney(project([slide]), [], false);
    assert.equal(projectPrimaryAction("studio", state).label, label);
    assert.equal(projectPrimaryAction("overview", state).label, label);
  }
});

test("failed pages with existing artwork require review while missing artwork still blocks delivery", () => {
  for (const hasImage of [true, false]) {
    const journey = projectJourney(
      project([
        {
          ...slides[0],
          status: "error",
          image: hasImage ? "fixture.png" : null,
        },
      ]),
      [],
      false,
    );
    assert.equal(journey.failed, 1);
    assert.equal(journey.needsReview, true);
    assert.equal(journey.pptxReady, hasImage);
    assert.deepEqual(journey.missing, hasImage ? [] : [1]);
    assert.equal(
      projectPrimaryAction("delivery", journey).label,
      "查看导出检查",
    );
  }
});
