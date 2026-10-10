import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { styleStamp } from "../server/core.mjs";
import { copyFixture, reviewFixture } from "./fixtures/screen-copy.mjs";
import { compositionFixture } from "./fixtures/composition.mjs";
import sharp from "sharp";

test("retired composition metadata retains historical style fingerprints", () => {
  const style = { id: "style", name: "风格", rules: "原文", colors: [] };
  assert.equal(
    styleStamp(style).fingerprint,
    styleStamp({ ...style, compositionMode: "direct" }).fingerprint,
  );
  assert.notEqual(
    styleStamp(style).fingerprint,
    styleStamp({ ...style, compositionMode: "content-led" }).fingerprint,
  );
  assert.notEqual(
    styleStamp(style).fingerprint,
    styleStamp({ ...style, rules: "用户的新原文" }).fingerprint,
  );
});

test("legacy enabled styles and retried trials keep raw style and copy without an extra composition call", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "autoppt-retired-composition-"));
  process.env.AUTOPPT_DATA_DIR = dir;
  process.env.OPENAI_API_KEY = "local-fixture";
  process.env.OPENAI_BASE_URL = "http://127.0.0.1:1/v1";
  const originalFetch = globalThis.fetch;
  const { design, imagePrompt, generateImage } =
    await import("../server/models.mjs");
  const { db, assetPath, put, get } = await import("../server/store.mjs");
  const { runTrial } = await import("../server/trials.mjs");
  t.after(() => {
    globalThis.fetch = originalFetch;
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const notes = "邀请一起参与。";
  const style = {
    id: "s",
    name: "摄影编辑风",
    rules: "\t黑白摄影、巨大手写英文与自由构图。\n",
    colors: [],
    compositionMode: "content-led",
  };
  const originalStyle = structuredClone(style);
  const textCalls = [];
  const imagePrompts = [];
  const png = await sharp({
    create: { width: 64, height: 36, channels: 3, background: "#fff" },
  })
    .png()
    .toBuffer();
  writeFileSync(assetPath("material.png"), png);
  globalThis.fetch = async (url, options) => {
    if (url.endsWith("/images/edits")) {
      imagePrompts.push(options.body.get("prompt"));
      assert.deepEqual(
        Buffer.from(await options.body.get("image[]").arrayBuffer()),
        png,
      );
      return Response.json({ data: [{ b64_json: png.toString("base64") }] });
    }
    if (url.endsWith("/images/generations")) {
      imagePrompts.push(JSON.parse(options.body).prompt);
      return Response.json({ data: [{ b64_json: png.toString("base64") }] });
    }
    const b = JSON.parse(options.body);
    const system = b.messages[0].content;
    const data = JSON.parse(b.messages[1].content[0].text);
    textCalls.push(system);
    let response;
    if (system.includes("演讲上屏文案复核编辑")) response = reviewFixture(data);
    else if (system.includes("演讲上屏文案编辑"))
      response = copyFixture(data, ["一起参与"]);
    else assert.fail("An extra composition model must never be called");
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
  assert.equal(textCalls.length, 2);
  assert.equal(direct.compositionPlan, undefined);
  assert.deepEqual(style, originalStyle);
  const legacy = {
    ...structuredClone(direct),
    compositionPlan: compositionFixture(),
  };
  legacy.compositionPlan.direction += " 不使用照片，不添加英文。";
  const frozenLegacy = structuredClone(legacy);
  const plan = await design(notes, style, "", "本页反馈", legacy, undefined, {
    ...opts,
    designOptions: {
      audience: {
        description: "运动会志愿者",
        brief: "可选联想，不补写赛制。",
      },
      palette: {
        name: "蓝白",
        instructions: "白底蓝色强调。",
        colors: ["#FFFFFF"],
      },
    },
  });
  assert.equal(
    textCalls.length,
    2,
    "Valid screen copy is reused without another model call",
  );
  assert.equal(plan.compositionPlan, undefined);
  assert.deepEqual(plan.screenCopy, direct.screenCopy);
  assert.deepEqual(legacy, frozenLegacy);
  assert.equal(plan.styleRules, style.rules);
  const prompt = imagePrompt({
    ...plan,
    compositionPlan: legacy.compositionPlan,
  });
  assert(prompt.startsWith(style.rules + "\n\n" + direct.contentPrompt));
  assert(!prompt.includes("COMPOSITION_MARKER"));
  assert(!prompt.includes("不使用照片"));
  assert(prompt.includes("本页反馈"));
  assert.match(prompt, /运动会志愿者/);
  assert.match(prompt, /独立配色方案/);
  await generateImage(
    { ...plan, compositionPlan: legacy.compositionPlan },
    style,
    undefined,
    [attachment],
  );
  assert.equal(imagePrompts.at(-1), prompt);
  const trialPlan = await design(notes, style, "", "", null, undefined, {
    contentBrief: opts.contentBrief,
  });
  const legacyTrialPlan = {
    ...trialPlan,
    compositionPlan: legacy.compositionPlan,
  };
  const beforeRetryCalls = textCalls.length;
  put("style", style);
  put("trial", {
    id: "legacy-trial",
    styleId: style.id,
    styleSnapshot: style,
    notes,
    engine: "image",
    status: "failed",
    purpose: "transfer",
    plan: legacyTrialPlan,
  });
  await runTrial(
    { payload: { styleId: style.id, trialId: "legacy-trial" } },
    new AbortController().signal,
    () => {},
  );
  const retried = get("trial", "legacy-trial");
  assert.equal(retried.status, "completed");
  assert.equal(retried.plan.compositionPlan, undefined);
  assert.deepEqual(retried.plan.screenCopy, trialPlan.screenCopy);
  assert.equal(textCalls.length, beforeRetryCalls);
  assert(!retried.plan.imageRequest.prompt.includes("COMPOSITION_MARKER"));
  assert.deepEqual(get("style", style.id), originalStyle);
});
