import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { projectStyles } from "../shared/styles.mjs";
import * as presets from "../shared/audience-presets.mjs";
const code = ts.transpileModule(
  readFileSync(new URL("../src/RedesignDialog.tsx", import.meta.url), "utf8"),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  },
).outputText;
function harness(selected = [], pageBusy = () => false) {
  const state = [],
    requests = [];
  let index = 0,
    closed = 0,
    submitted = 0;
  const exports = {};
  const jsx = (type, props) => ({ type, props });
  const components = Object.fromEntries(
    [
      "Button",
      "Field",
      "Modal",
      "SlideImage",
      "StylePreview",
      "DesignOptionsEditor",
      "ArrowsClockwise",
    ].map((x) => [x, x]),
  );
  runInNewContext(code, {
    exports,
    require(name) {
      if (name === "react")
        return {
          useState(value) {
            const i = index++;
            if (!(i in state))
              state[i] = typeof value === "function" ? value() : value;
            return [
              state[i],
              (v) => (state[i] = typeof v === "function" ? v(state[i]) : v),
            ];
          },
        };
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (name === "./api")
        return { post: async (url, body) => requests.push({ url, body }) };
      if (name.endsWith("styles.mjs")) return { projectStyles };
      if (name.endsWith("audience-presets.mjs")) return presets;
      if (name === "./DesignOptionsEditor")
        return {
          ...components,
          emptyDesignOptions: { audience: null, palette: null },
          validDesignOptions: (v) =>
            !v.audience || !!v.audience.description.trim(),
        };
      if (name === "./redesign.css") return {};
      return components;
    },
  });
  const project = {
    id: "project",
    revision: 7,
    styleId: "catalog-old",
    slides: [1, 2, 3].map((i) => ({ id: "p" + i, notes: "讲稿" + i })),
    designOptions: { audience: null, palette: null },
  };
  const styles = [
    {
      id: "catalog-old",
      name: "原风格",
      catalogSourceId: "old",
      catalogHidden: true,
      canUse: true,
    },
    {
      id: "catalog-new",
      name: "已发布风格",
      catalogSourceId: "new",
      canUse: true,
    },
    { id: "draft", name: "未发布", rules: "private" },
    {
      id: "catalog-hidden",
      catalogSourceId: "hidden",
      catalogHidden: true,
      canUse: true,
    },
  ];
  const render = () => {
    index = 0;
    return exports.RedesignDialog({
      project,
      styles,
      hosted: true,
      selected,
      pageBusy,
      onClose: () => closed++,
      onSubmitted: (n) => (submitted = n),
    });
  };
  const find = (tree, predicate) => {
    if (!tree || typeof tree !== "object") return;
    if (predicate(tree)) return tree;
    for (const child of [tree.props?.children].flat(Infinity)) {
      const found = find(child, predicate);
      if (found) return found;
    }
  };
  const field = (tree, label) =>
    find(tree, (n) => n.type === "Field" && n.props.label === label).props
      .children;
  const button = (tree, label) =>
    find(
      tree,
      (n) => n.type === "Button" && [n.props.children].flat().includes(label),
    );
  const start = (tree) =>
    find(tree, (n) => n.type === "Button" && n.props.variant === "primary");
  return {
    render,
    find,
    field,
    button,
    start,
    requests,
    project,
    get closed() {
      return closed;
    },
    get submitted() {
      return submitted;
    },
  };
}
test("redesign keeps choices local until confirmation and submits selected pages with approved style and audience", async () => {
  const h = harness(["p1", "p3"]);
  let tree = h.render();
  assert.equal(h.requests.length, 0);
  const select = h.field(tree, "视觉风格（主题）");
  const options = select.props.children
    .flat(Infinity)
    .filter((x) => x?.type === "option");
  assert.deepEqual(
    Array.from(options, (x) => x.props.value),
    ["catalog-old", "catalog-new"],
  );
  select.props.onChange({ target: { value: "catalog-new" } });
  tree = h.render();
  h.field(tree, "内容倾向").props.onChange({
    target: { value: "children-photography" },
  });
  tree = h.render();
  assert.equal(h.requests.length, 0);
  await h.start(tree).props.onClick();
  assert.equal(h.requests.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(h.requests[0])), {
    url: "/projects/project/render",
    body: {
      slideIds: ["p1", "p3"],
      redesign: true,
      revision: 7,
      redesignSettings: {
        styleId: "catalog-new",
        designOptions: {
          audience: presets.audiencePreset("children-photography"),
          palette: null,
        },
      },
    },
  });
  assert.equal(h.submitted, 2);
  assert.equal(h.project.styleId, "catalog-old");
  assert.equal(h.project.designOptions.audience, null);
});
test("cancelling changed settings makes no request; busy pages and empty custom audiences cannot submit", async () => {
  const h = harness();
  let tree = h.render();
  h.field(tree, "视觉风格（主题）").props.onChange({
    target: { value: "catalog-new" },
  });
  tree = h.render();
  h.button(tree, "取消").props.onClick();
  assert.equal(h.closed, 1);
  assert.equal(h.requests.length, 0);
  const locked = harness([], (id) => id === "p2");
  tree = locked.render();
  assert.equal(locked.start(tree).props.disabled, true);
  await locked.start(tree).props.onClick();
  assert.equal(locked.requests.length, 0);
  const custom = harness();
  tree = custom.render();
  custom
    .field(tree, "内容倾向")
    .props.onChange({ target: { value: "custom" } });
  tree = custom.render();
  assert.equal(custom.start(tree).props.disabled, true);
  custom
    .field(tree, "受众与场景")
    .props.onChange({ target: { value: "面向宠物摄影客户" } });
  tree = custom.render();
  assert.equal(custom.start(tree).props.disabled, false);
  assert.equal(custom.requests.length, 0);
  await custom.start(tree).props.onClick();
  assert.equal(
    custom.requests[0].body.redesignSettings.designOptions.audience.description,
    "面向宠物摄影客户",
  );
  assert.equal(custom.submitted, 3);
});
