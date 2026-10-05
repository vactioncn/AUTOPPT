import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import {
  pageNumberTemplate,
  pageNumberStyle,
  withProjectPageNumber,
} from "../shared/page-number.mjs";
import { RELEASE_STYLES } from "../shared/builtin-style-catalog.mjs";
import { unifiedCoverPlan } from "../server/style-cover.mjs";
import { directImagePrompt } from "../server/direct-image.mjs";
import { STYLE_COVER_NOTES } from "../shared/style-demo.mjs";
import { PLANNING_VERSION } from "../server/content-planning.mjs";
import { styleStamp } from "../server/core.mjs";

test("only explicit page-number spans change; no layout, content or other numeric labels change", () => {
  const rules =
    "\t黑白。\n微型页码，右上角\n流程 01 / 02 / 03；照片编号 2026\nUse: page numbers, geometric type.\n";
  const rendered = pageNumberStyle(rules, 84);
  assert.equal(
    rendered.rules,
    rules
      .replace("页码", "页码（显示为 84）")
      .replace("page numbers", "page numbers (display 84)"),
  );
  assert.equal(
    pageNumberStyle("微型页码，显示为 {{page_number}}", 3).rules,
    "微型页码，显示为 03",
  );
  assert.equal(pageNumberStyle("页码", 188).label, "188");
  assert.equal(
    pageNumberTemplate(pageNumberTemplate(rules)),
    pageNumberTemplate(rules),
  );
  for (const unchanged of [
    "章节编号、照片编号、页脚小序号",
    "不要显示页码。",
    "页码不显示",
    "No page numbers.",
    "without page numbers",
    "页码：01",
    'page number: "01"',
  ]) {
    assert.equal(pageNumberStyle(unchanged, 84).rules, unchanged);
    assert.equal(pageNumberStyle(unchanged, 84).supported, false);
  }
  for (const invalid of [undefined, 0, -1, 1.5, NaN, "84"])
    assert.throws(() => pageNumberStyle("微型页码", invalid), /有效/);
});

test("approved builtins retain exact source bytes; only four explicit page-number styles are eligible", () => {
  const matched = [];
  for (const style of RELEASE_STYLES) {
    const rules = readFileSync(
      new URL("../server/styles/" + style.promptFile, import.meta.url),
      "utf8",
    );
    const out = pageNumberStyle(rules, 84);
    if (out.supported) matched.push(style.name);
    assert.equal(
      out.rules.replaceAll("（显示为 84）", "").replaceAll(" (display 84)", ""),
      rules,
    );
  }
  assert.deepEqual(matched, [
    "先锋酸性色彩编辑风",
    "新瑞士主义战略编辑风",
    "高质感手账",
    "日系现代建筑提案风",
  ]);
  const style = {
    id: "test",
    name: "测试",
    rules: "右上角微型页码，哑光背景。",
  };
  const plan = unifiedCoverPlan(style);
  assert.equal(
    directImagePrompt(plan),
    "右上角微型页码（显示为 01），哑光背景。\n\n" +
      plan.contentPrompt +
      "\n\n【本页画面调整要求】\n" +
      plan.imageFeedback,
  );
  assert.equal(plan.styleRules, style.rules);
  const noNumber = unifiedCoverPlan({
    ...style,
    rules: "黑白，章节编号自由。",
  });
  assert(directImagePrompt(noNumber).startsWith(noNumber.styleRules + "\n\n"));
});

test("page identity resolves the current whole-project order, including insertion, deletion, split and merge", () => {
  const plan = { pageNumber: 1, styleRules: "微型页码" };
  let slides = Array.from({ length: 90 }, (_, i) => ({ id: String(i + 1) }));
  assert.equal(withProjectPageNumber(plan, slides, "84").pageNumber, 84);
  slides.splice(0, 0, { id: "insert" });
  assert.equal(withProjectPageNumber(plan, slides, "84").pageNumber, 85);
  slides.splice(0, 1);
  slides.splice(0, 1, { id: "split-a" }, { id: "split-b" });
  assert.equal(withProjectPageNumber(plan, slides, "84").pageNumber, 85);
  slides.splice(0, 2, { id: "merged" });
  assert.equal(withProjectPageNumber(plan, slides, "84").pageNumber, 84);
  assert.equal(plan.pageNumber, 1);
  assert.throws(
    () => withProjectPageNumber(plan, slides, "deleted"),
    /已经调整/,
  );
});

test(
  "real job pipeline sends page 84, not batch 1, and retries resolve the new order",
  { timeout: 15000 },
  async (t) => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "autoppt-page-number-"));
    process.env.AUTOPPT_DATA_DIR = dir;
    process.env.OPENAI_API_KEY = "fixture-only";
    process.env.OPENAI_BASE_URL = "http://127.0.0.1:1/v1";
    const { get, put, db } = await import("../server/store.mjs");
    const { enqueue, retry } = await import("../server/jobs.mjs");
    const oldFetch = globalThis.fetch;
    t.after(() => {
      globalThis.fetch = oldFetch;
      db.close();
      rmSync(dir, { recursive: true, force: true });
    });
    const image = await sharp({
      create: { width: 1600, height: 900, channels: 3, background: "white" },
    })
      .png()
      .toBuffer();
    const requests = [];
    let fail = false;
    globalThis.fetch = async (url, options) => {
      assert.equal(
        url,
        "http://127.0.0.1:1/v1/images/generations",
        "no text or paid model calls",
      );
      requests.push(JSON.parse(options.body));
      if (fail)
        return Response.json(
          { error: { message: "fixture failure" } },
          { status: 400 },
        );
      return Response.json({ data: [{ b64_json: image.toString("base64") }] });
    };
    const style = {
      id: "number-style",
      name: "测试风格",
      rules: "  顶部留白\n微型页码，右上角\n流程编号 01 / 02 / 03\n",
      colors: [],
      refs: [],
    };
    put("style", style);
    const plan = {
      ...unifiedCoverPlan(style),
      contentBrief: { version: PLANNING_VERSION },
    };
    delete plan.purpose;
    const slides = Array.from({ length: 90 }, (_, i) => ({
      id: "s" + (i + 1),
      notes: STYLE_COVER_NOTES,
      attachments: [],
      versions: [],
      status: "pending",
      stale: false,
      pendingPlan: structuredClone(plan),
      pendingPlanStyle: styleStamp(style),
    }));
    put("project", {
      id: "project",
      title: "页序测试",
      revision: 0,
      styleId: style.id,
      slides,
      batches: [],
    });
    const wait = async (job) => {
      for (let i = 0; i < 500; i++) {
        const state = get("job", job.id);
        if (!["queued", "running"].includes(state.status)) return state;
        await new Promise((r) => setTimeout(r, 10));
      }
      assert.fail("job timed out");
    };
    let job = await wait(enqueue("render", "project", { slideIds: ["s84"] }));
    assert.equal(job.status, "completed", job.error);
    assert.match(requests.at(-1).prompt, /微型页码（显示为 84），右上角/);
    assert.match(requests.at(-1).prompt, /流程编号 01 \/ 02 \/ 03/);
    assert.equal(get("project", "project").slides[83].plan.pageNumber, 84);
    assert.equal(get("style", style.id).rules, style.rules);
    fail = true;
    job = await wait(enqueue("render", "project", { slideIds: ["s85"] }));
    assert.equal(job.status, "failed");
    const p = get("project", "project");
    p.slides.unshift({ ...structuredClone(slides[0]), id: "inserted" });
    put("project", p);
    fail = false;
    job = await wait(retry(job.id));
    assert.equal(job.status, "completed", job.error);
    assert.match(requests.at(-1).prompt, /微型页码（显示为 86），右上角/);
    const completed = get("project", "project").slides.find(
      (s) => s.id === "s85",
    );
    assert.equal(completed.plan.pageNumber, 86);
    assert.equal(completed.plan.imageRequest.prompt, requests.at(-1).prompt);
  },
);
