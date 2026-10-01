import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { styleStamp } from "../server/core.mjs";
import {
  validateCompositionPlan,
  nearbyDirections,
} from "../server/composition.mjs";
import { copyFixture, reviewFixture } from "./fixtures/screen-copy.mjs";
import sharp from "sharp";

import { compositionFixture } from "./fixtures/composition.mjs";

test("composition validation and neighboring context reject missing plans and exclude unrelated pages", () => {
  const value = compositionFixture();
  const frozen = structuredClone(value);
  assert.equal(validateCompositionPlan(value).version, 1);
  assert.deepEqual(value, frozen);
  for (const v of [
    null,
    { ...value, review: {} },
    { ...value, alternatives: [value.alternatives[0]] },
    { ...value, direction: "" },
  ])
    assert.throws(() => validateCompositionPlan(v));
  const slides = Array.from({ length: 7 }, (_, i) => ({
    id: String(i),
    image: "image.png",
    plan: {
      sourceStyle: { id: "style" },
      compositionPlan: { signature: "layout-" + i },
    },
  }));
  slides[1].plan.sourceStyle.id = "other";
  slides[2].image = null;
  assert.deepEqual(
    nearbyDirections(slides, "4", "style").map((s) => s.pageId),
    ["3", "5", "6", "0"],
  );
  assert.deepEqual(
    nearbyDirections(
      [{ id: "old", image: "old.png", plan: { sourceStyle: { id: "style" } } }],
      "new",
      "style",
    ),
    [],
  );
  const style = { id: "style", name: "风格", rules: "原文", colors: [] };
  assert.equal(
    styleStamp(style).fingerprint,
    styleStamp({ ...style, compositionMode: "direct" }).fingerprint,
  );
  assert.notEqual(
    styleStamp(style).fingerprint,
    styleStamp({ ...style, compositionMode: "content-led" }).fingerprint,
  );
});

test("opt-in art direction preserves raw style and frozen copy, passes real materials, and is visible in the exact request", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "autoppt-composition-"));
  process.env.AUTOPPT_DATA_DIR = dir;
  process.env.OPENAI_API_KEY = "local-fixture";
  process.env.OPENAI_BASE_URL = "http://127.0.0.1:1/v1";
  const originalFetch = globalThis.fetch;
  const { design, imagePrompt, generateImage } =
    await import("../server/models.mjs");
  const { db, assetPath } = await import("../server/store.mjs");
  t.after(() => {
    globalThis.fetch = originalFetch;
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const notes = "邀请一起参与。";
  const style = {
    id: "s",
    name: "水彩",
    rules: "\t原文水彩、衬线与桃色。\n",
    colors: [],
  };
  const calls = [];
  let failed = false;
  let actualImagePrompt;
  const png = await sharp({
    create: { width: 64, height: 36, channels: 3, background: "#fff" },
  })
    .png()
    .toBuffer();
  writeFileSync(assetPath("material.png"), png);
  globalThis.fetch = async (url, options) => {
    if (url.endsWith("/images/edits")) {
      actualImagePrompt = options.body.get("prompt");
      assert.deepEqual(
        Buffer.from(await options.body.get("image[]").arrayBuffer()),
        png,
      );
      return Response.json({ data: [{ b64_json: png.toString("base64") }] });
    }
    const b = JSON.parse(options.body);
    const system = b.messages[0].content;
    const data = JSON.parse(b.messages[1].content[0].text);
    calls.push({ system, data, content: b.messages[1].content });
    let response;
    if (system.includes("本阶段只负责本页构图")) {
      assert.equal(data.style, style.rules);
      response = failed ? {} : compositionFixture();
    } else if (system.includes("演讲上屏文案复核编辑"))
      response = reviewFixture(data);
    else if (system.includes("演讲上屏文案编辑")) {
      assert(!("style" in data));
      response = copyFixture(data, ["一起参与"]);
    } else assert.fail("Unexpected model");
    return Response.json({
      choices: [{ message: { content: JSON.stringify(response) } }],
    });
  };
  const attachment = {
    id: "a",
    filename: "material.png",
    name: "真实素材.png",
  };
  const opts = {
    contentBrief: { claim: "邀请", relationship: "statement" },
    attachments: [attachment],
  };
  const direct = await design(notes, style, "", "", null, undefined, opts);
  assert.equal(calls.length, 2);
  assert(!direct.compositionPlan);
  const enabled = { ...style, compositionMode: "content-led" };
  const prior = structuredClone(direct);
  const plan = await design(notes, enabled, "", "本页反馈", direct, undefined, {
    ...opts,
    recentCompositions: [{ pageId: "neighbor", signature: "上文结构" }],
  });
  assert.equal(calls.length, 3);
  assert.deepEqual(plan.screenCopy, direct.screenCopy);
  assert.deepEqual(direct, prior);
  assert.equal(plan.styleRules, style.rules);
  assert.equal(calls[2].data.contentPrompt, direct.contentPrompt);
  assert.deepEqual(calls[2].data.recent, [
    { pageId: "neighbor", signature: "上文结构" },
  ]);
  assert.deepEqual(
    Buffer.from(calls[2].content[1].image_url.url.split(",")[1], "base64"),
    png,
  );
  const prompt = imagePrompt(plan);
  assert(prompt.startsWith(style.rules + "\n\n" + direct.contentPrompt));
  assert(prompt.includes("COMPOSITION_MARKER"));
  assert(!prompt.includes("上文结构"));
  assert(prompt.endsWith("本页反馈"));
  await generateImage(plan, enabled, undefined, [attachment]);
  assert.equal(actualImagePrompt, prompt);
  assert.equal(plan.imageRequest.prompt, prompt);
  await assert.rejects(
    generateImage({ ...plan, compositionPlan: undefined }, enabled, undefined, [
      attachment,
    ]),
    /构图方式/,
  );
  const off = await design(notes, style, "", "", plan, undefined, opts);
  assert.equal(calls.length, 3);
  assert(!off.compositionPlan);
  assert(!imagePrompt(off).includes("COMPOSITION_MARKER"));
  failed = true;
  await assert.rejects(
    design(notes, enabled, "", "", plan, undefined, opts),
    /构图需要/,
  );
});
