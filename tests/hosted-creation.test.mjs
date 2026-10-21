import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { manuscriptTitle } from "../shared/first-picture.mjs";
import { defaultStyleId } from "../shared/styles.mjs";
import { audiencePreset } from "../shared/audience-presets.mjs";

const transpile = (file, module = ts.ModuleKind.CommonJS) =>
  ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
const onboarding = await import(
  `data:text/javascript,${encodeURIComponent(transpile("../src/onboarding.ts", ts.ModuleKind.ESNext))}`
);
const code = transpile("../src/HostedNewProject.tsx");
const empty = { audience: null, palette: null };
function harness(
  entries = new Map(),
  post = async (_, body) => ({ id: "created", ...body }),
) {
  const storage = {
    getItem: (k) => entries.get(k) ?? null,
    setItem: (k, v) => entries.set(k, v),
    removeItem: (k) => entries.delete(k),
  };
  const calls = [],
    exports = {};
  function SharedNewProject() {}
  runInNewContext(code, {
    exports,
    localStorage: storage,
    require(name) {
      if (name === "react")
        return {
          useState: (v) => [typeof v === "function" ? v() : v, () => {}],
          useRef: (current) => ({ current }),
          useCallback: (fn) => fn,
        };
      if (name === "react/jsx-runtime")
        return { jsx: (type, props) => ({ type, props }) };
      if (name === "./NewProject") return { NewProject: SharedNewProject };
      if (name === "./DesignOptionsEditor")
        return { emptyDesignOptions: empty };
      if (name === "./onboarding")
        return {
          ...onboarding,
          createGenerationRequest: (scope) =>
            onboarding.createGenerationRequest(scope, () => storage),
        };
      if (name.endsWith("first-picture.mjs")) return { manuscriptTitle };
      if (name.endsWith("styles.mjs")) return { defaultStyleId };
      if (name === "./api")
        return {
          post: async (url, body) => {
            calls.push({ url, body });
            return post(url, body);
          },
        };
      throw Error(name);
    },
  });
  const render = (props = {}) => {
    const result = exports.HostedNewProject({
      userId: "one",
      styles: [
        { id: "style-a", rules: "original" },
        { id: "style-b", rules: "other" },
      ],
      example: false,
      ...props,
    });
    assert.equal(result.type, SharedNewProject);
    return result.props;
  };
  return { entries, calls, render };
}

test("shared settings create an empty project with industry/palette and never queue generation", async () => {
  const h = harness(),
    form = h.render();
  assert.equal(h.calls.length, 0);
  const choices = {
    audience: audiencePreset("education"),
    palette: {
      name: "自定义配色",
      instructions: "暖白背景与深蓝文字",
      colors: ["#F6F3ED", "#17324D", "#3972B8"],
    },
  };
  assert(choices.audience);
  form.onDraftChange({ ...form.initialDraft, title: "仅创建项目", choices });
  const project = await form.createProject({
    title: "仅创建项目",
    styleId: "style-a",
    designOptions: choices,
  });
  assert.equal(project.draft, "");
  assert.deepEqual(project.designOptions, choices);
  assert.deepEqual(
    h.calls.map((c) => c.url),
    ["/projects"],
  );
  assert.equal(h.entries.has("autoppt-new-project:v1:one"), false);
});

test("legacy manuscript and new settings survive cancellation, library return and failed creation", async () => {
  const text = "\n原始讲稿，标点与空格不改。\n ";
  const legacy = JSON.stringify({
    text,
    title: "已输入主题",
    styleId: "style-a",
  });
  let fail = true;
  const h = harness(
    new Map([["autoppt-first-picture:v1:one", legacy]]),
    async (_, body) => {
      if (fail) throw Error("connection lost");
      return { id: "saved", ...body };
    },
  );
  let form = h.render();
  assert.equal(form.initialDraft.title, "已输入主题");
  assert.equal(form.retainedManuscript, true);
  const draft = {
    ...form.initialDraft,
    title: "修改主题",
    audienceKind: "custom",
    customAudience: { description: "受众", brief: "已确认说明" },
    choices: {
      audience: { description: "受众", brief: "已确认说明" },
      palette: null,
    },
  };
  form.onDraftChange(draft);
  form = h.render({ initialStyle: "style-b" });
  assert.equal(form.initialStyle, "style-b");
  assert.equal(form.initialDraft.title, "修改主题");
  assert.equal(form.initialDraft.choices.audience.brief, "已确认说明");
  form.onDraftChange(form.initialDraft);
  const input = {
    title: form.initialDraft.title,
    styleId: form.initialStyle,
    designOptions: form.initialDraft.choices,
  };
  await assert.rejects(form.createProject(input), /connection lost/);
  assert.equal(h.entries.get("autoppt-first-picture:v1:one"), legacy);
  assert(h.entries.has("autoppt-new-project:v1:one"));
  fail = false;
  form = h.render();
  form.onDraftChange(form.initialDraft);
  const saved = await form.createProject(input);
  assert.equal(saved.draft, text);
  assert.equal(h.calls[0].body.requestId, h.calls[1].body.requestId);
  assert.equal(h.entries.has("autoppt-first-picture:v1:one"), false);
});

test("account isolation, example routes and newer drafts in another tab are preserved", async () => {
  const entries = new Map([
    [
      "autoppt-first-picture:v1:one",
      JSON.stringify({ text: "原稿", title: "主题" }),
    ],
  ]);
  const h = harness(entries, async (_, body) => {
    entries.set("autoppt-first-picture:v1:one", "newer legacy draft");
    entries.set("autoppt-new-project:v1:one", "newer form draft");
    return { id: "saved", ...body };
  });
  assert.equal(h.render({ userId: "two" }).retainedManuscript, false);
  const example = h.render({ userId: "two", example: true });
  assert.equal(example.retainedManuscript, true);
  assert.equal(h.calls.length, 0);
  const form = h.render();
  form.onDraftChange(form.initialDraft);
  await form.createProject({
    title: "主题",
    styleId: "style-a",
    designOptions: empty,
  });
  assert.equal(
    entries.get("autoppt-first-picture:v1:one"),
    "newer legacy draft",
  );
  assert.equal(entries.get("autoppt-new-project:v1:one"), "newer form draft");
});

test("refreshing a style deep link keeps the user's later style choice", () => {
  const h = harness();
  const form = h.render({ initialStyle: "style-a" });
  form.onDraftChange({
    ...form.initialDraft,
    title: "保留选择",
    styleId: "style-b",
  });
  assert.equal(h.render({ initialStyle: "style-a" }).initialStyle, "style-b");
  // Entering from a different explicit style uses that new selection.
  const reopened = h.render({ initialStyle: "style-b" });
  reopened.onDraftChange({ ...reopened.initialDraft, styleId: "style-b" });
  assert.equal(h.render({ initialStyle: "style-a" }).initialStyle, "style-a");
});
