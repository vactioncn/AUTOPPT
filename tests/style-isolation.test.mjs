import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { styleStamp, styleLanguageKey } from "../server/core.mjs";
import { nearbyCompositions } from "../server/content-planning.mjs";

test("selected style controls new pages; only an unchanged, known style can lock an approved page", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "autoppt-style-isolation-"));
  process.env.AUTOPPT_DATA_DIR = dir;
  process.env.OPENAI_API_KEY = "local-fixture";
  process.env.OPENAI_BASE_URL = "http://127.0.0.1:1/v1";
  const originalFetch = globalThis.fetch;
  const { design, styleLanguageFor, imagePrompt } =
    await import("../server/models.mjs");
  const { db, get, put } = await import("../server/store.mjs");
  t.after(() => {
    globalThis.fetch = originalFetch;
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const minimal = {
    id: "minimal",
    name: "极简",
    rules: "黑白底、荧光色块、无衬线字体、清晰端点、细线与准确留白。",
    colors: ["#dfff00"],
  };
  const watercolor = {
    id: "watercolor",
    name: "水彩",
    rules: "温暖桃色背景、中文衬线字体、纸张纹理、水彩笔触与丰富花卉装饰。",
    colors: ["#edb1a0"],
  };
  const language = (style) =>
    Object.fromEntries(
      [
        "identity",
        "typography",
        "colorSystem",
        "compositionPrinciples",
        "graphicLanguage",
        "detailLanguage",
        "adaptationRules",
        "avoid",
      ].map((k) => [k, style.rules]),
    );
  const plan = (style) => ({
    editScope: "composition",
    detailText: ["补充说明"],
    title: "一起参与",
    displayText: ["一起参与"],
    layout: style.rules + "标题居中、说明位于下方。",
    visual: style.rules,
    typography: style.rules,
    visualForm: "typographic",
    compositionKey: "centered",
    selectionReason: "用邀请表达主题",
    alternatives: [
      { idea: "文字为主", reason: "突出邀请" },
      { idea: "图像为主", reason: "强化氛围" },
    ],
    styleFeatures: ["当前字体", "当前配色", "当前材质"],
    styleExecution: {
      typeHierarchy: style.rules,
      spatialRhythm: style.rules,
      graphicHierarchy: style.rules,
      microDetail: style.rules,
    },
  });
  const brief = {
    claim: "邀请",
    relationship: "statement",
    allowedForms: ["typographic"],
    mustNotImply: [],
  };
  let output = plan(minimal),
    lastRequest,
    compilerCalls = 0;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "http://127.0.0.1:1/v1/chat/completions");
    const body = JSON.parse(options.body);
    lastRequest = JSON.parse(body.messages[1].content[0].text);
    assert.equal(body.messages[1].content.length, 1);
    if (body.messages[0].content.includes("风格规范整理师")) {
      compilerCalls++;
      assert(!body.messages[0].content.includes("黑白与荧光强调"));
      output = language(
        lastRequest.name === minimal.name ? minimal : watercolor,
      );
    }
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify(output) } }],
      }),
      { status: 200 },
    );
  };
  put("style", minimal);
  put("styleLanguage", {
    id: "language-v3-" + styleStamp(watercolor).fingerprint,
    language: language(minimal),
  });
  assert.deepEqual(await styleLanguageFor(minimal), language(minimal));
  assert.deepEqual(await styleLanguageFor(watercolor), language(watercolor));
  assert.equal(compilerCalls, 2);
  await styleLanguageFor(minimal);
  assert.equal(compilerCalls, 2);
  assert.deepEqual(get("style", minimal.id), minimal);
  assert(get("styleLanguage", styleLanguageKey(watercolor)));

  const render = (style, previous = null, extra = {}) =>
    design(
      "邀请一起参与",
      style,
      "测试",
      "保留布局，只补细节",
      previous,
      undefined,
      {
        contentBrief: brief,
        designLanguage: language(style),
        notesUnchanged: true,
        ...extra,
      },
    );
  output = plan(minimal);
  const approved = await render(minimal);
  assert.equal(approved.visual, minimal.rules);
  assert.equal(lastRequest.previous, null);
  assert.deepEqual(approved.sourceStyle, styleStamp(minimal));
  output = { ...plan(watercolor), editScope: "details" }; // Deliberately wrong model edit scope.
  const refined = await render(minimal, approved);
  assert.equal(refined.editScope, "details");
  assert.equal(refined.visual, approved.visual);
  assert.equal(refined.layout, approved.layout);
  assert.equal(
    refined.visualDirection.typography,
    approved.visualDirection.typography,
  );
  assert.deepEqual(refined.displayText, ["一起参与", "补充说明"]);
  for (const style of [watercolor, { ...minimal, rules: watercolor.rules }]) {
    const changed = await render(style, approved);
    assert.equal(lastRequest.previous, null);
    assert.equal(lastRequest.refinementAllowed, false);
    assert.equal(changed.editScope, "composition");
    assert.equal(changed.visual, watercolor.rules);
    assert.equal(changed.visualDirection.typography, watercolor.rules);
    const prompt = imagePrompt(changed);
    assert(prompt.includes(watercolor.rules));
    assert(!prompt.includes("荧光"));
    assert(!prompt.includes("Keep fine line hierarchy"));
    assert(!prompt.includes("without mottling, paper texture"));
  }
  const legacy = { ...approved };
  delete legacy.sourceStyle;
  assert.equal((await render(minimal, legacy)).editScope, "composition");
  assert.equal(
    (await render(minimal, legacy, { previousStyle: styleStamp(minimal) }))
      .editScope,
    "details",
  );
  assert.equal(
    (await render(minimal, approved, { notesUnchanged: false })).editScope,
    "composition",
  );
  assert.equal(
    (
      await design("邀请一起参与", minimal, "测试", "", approved, undefined, {
        contentBrief: brief,
        designLanguage: language(minimal),
      })
    ).editScope,
    "composition",
  );
  const pages = [
    { id: "a", plan: approved },
    {
      id: "b",
      plan: { ...plan(watercolor), sourceStyle: styleStamp(watercolor) },
    },
    { id: "current" },
    { id: "c", plan: legacy, planStyle: styleStamp(minimal) },
    { id: "unknown", plan: legacy },
  ];
  assert.deepEqual(
    nearbyCompositions(pages, "current", styleStamp(minimal).fingerprint).map(
      (p) => p.id,
    ),
    ["a", "c"],
  );
});
