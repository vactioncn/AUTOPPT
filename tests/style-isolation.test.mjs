import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { styleStamp } from "../server/core.mjs";
import { copyFixture, reviewFixture } from "./fixtures/screen-copy.mjs";
import sharp from "sharp";

test("raw style prompts stay exact and independent from reusable, source-bound screen copy", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "autoppt-style-isolation-"));
  process.env.AUTOPPT_DATA_DIR = dir;
  process.env.OPENAI_API_KEY = "local-fixture";
  process.env.OPENAI_BASE_URL = "http://127.0.0.1:1/v1";
  const originalFetch = globalThis.fetch;
  const { design, imagePrompt, generateImage } =
    await import("../server/models.mjs");
  const { db, put, get } = await import("../server/store.mjs");
  t.after(() => {
    globalThis.fetch = originalFetch;
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const minimal = {
    id: "minimal",
    name: "极简",
    rules: "  黑白底、荧光色块。\n\n保持原来的标点和空白。\n",
    colors: ["#dfff00"],
    referenceProfiles: [{ graphics: "UNWANTED_OLD_DIAGRAM" }],
  };
  const watercolor = {
    id: "watercolor",
    name: "水彩",
    rules: "\t温暖桃色背景、中文衬线字体、纸张纹理、水彩笔触与丰富花卉装饰。\n",
    colors: ["#edb1a0"],
  };
  const notes = "邀请一起参与。完整背景讲解留在口播。";
  const brief = { claim: "邀请", relationship: "statement", mustNotImply: [] };
  const calls = [];
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "http://127.0.0.1:1/v1/chat/completions");
    const body = JSON.parse(options.body);
    const data = JSON.parse(body.messages[1].content[0].text);
    calls.push(data);
    assert(!("style" in data));
    assert(!("designLanguage" in data));
    assert(!("savedObservations" in data));
    assert(!options.body.includes("荧光"));
    assert(!options.body.includes("水彩"));
    assert(!options.body.includes("VISUAL_FEEDBACK"));
    let response;
    if (body.messages[0].content.includes("演讲上屏文案复核编辑"))
      response = reviewFixture(data);
    else if (body.messages[0].content.includes("演讲上屏文案编辑"))
      response = copyFixture(data, [data.feedback ? "参与" : "一起参与"]);
    else assert.fail("Style rewriting or visual planning must not be called");
    return Response.json({
      choices: [{ message: { content: JSON.stringify(response) } }],
    });
  };
  put("style", minimal);
  const render = (style, previous = null, extra = {}) =>
    design(notes, style, "测试", "VISUAL_FEEDBACK", previous, undefined, {
      contentBrief: brief,
      ...extra,
    });
  const approved = await render(minimal);
  assert.equal(calls.length, 2);
  assert.deepEqual(approved.sourceStyle, styleStamp(minimal));
  assert.equal(approved.styleRules, minimal.rules);
  assert.equal(
    imagePrompt({ ...approved, imageFeedback: "" }),
    minimal.rules + "\n\n" + approved.contentPrompt,
  );
  assert.equal(approved.promptMode, "verbatim-style-v5");
  assert.equal(
    imagePrompt(approved),
    minimal.rules +
      "\n\n" +
      approved.contentPrompt +
      "\n\n【本页画面调整要求】\nVISUAL_FEEDBACK",
  );
  assert(!imagePrompt(approved).includes("UNWANTED_OLD_DIAGRAM"));
  assert(!imagePrompt(approved).includes("完整背景讲解留在口播"));
  assert.deepEqual(approved.screenCopy.semanticSupport, []);
  assert.match(approved.contentPrompt, /保持原意和表达程度/);
  assert.match(approved.contentPrompt, /少量、轻微、中性/);
  assert(!approved.contentPrompt.includes("可选语义辅助资料"));
  assert.equal(approved.compositionPlan, undefined);
  const oldPromptPlan = { ...approved, promptMode: "verbatim-style-v3" };
  assert.throws(() => imagePrompt(oldPromptPlan), /当前流程/);
  assert(imagePrompt(approved).includes("VISUAL_FEEDBACK"));
  assert.deepEqual(get("style", minimal.id), minimal);
  for (const style of [watercolor, { ...minimal, rules: watercolor.rules }]) {
    const changed = await render(style, approved);
    assert.equal(
      calls.length,
      2,
      "changing only style must not invoke content models",
    );
    assert(changed.copyReused);
    assert.deepEqual(changed.displayText, approved.displayText);
    assert.deepEqual(changed.screenCopy, approved.screenCopy);
    const prompt = imagePrompt(changed);
    assert(prompt.includes(watercolor.rules));
    assert(!prompt.includes("荧光"));
    assert(!prompt.includes("RESOLVED STYLE EXECUTION"));
  }
  const edited = await render(watercolor, approved, {
    copyFeedback: "只保留参与两个字",
  });
  assert.equal(calls.length, 4);
  assert.deepEqual(calls[2].currentCopy, approved.displayText);
  assert.deepEqual(calls[3].currentCopy, approved.displayText);
  assert.equal(calls[2].previous, null);
  assert.deepEqual(edited.displayText, ["参与"]);
  assert(!edited.copyReused);
  const updated = await design(
    notes + "补充条件。",
    minimal,
    "测试",
    "",
    approved,
    undefined,
    { contentBrief: brief },
  );
  assert.equal(calls.length, 6);
  assert.equal(calls[4].currentCopy, null);
  assert(!updated.copyReused);
  writeFileSync(path.join(dir, "assets", "chart.png"), Buffer.from("fixture"));
  const withAttachment = await render(minimal, approved, {
    attachments: [
      { id: "chart", filename: "chart.png", width: 100, height: 100 },
    ],
  });
  // A new attachment must require re-editing the copy, not borrow the old source key.
  assert(!withAttachment.copyReused);
  const legacy = {
    ...approved,
    screenCopy: { ...approved.screenCopy, version: 1 },
  };
  const migrated = await render(minimal, legacy);
  assert(!migrated.copyReused);
  assert.throws(
    () => imagePrompt({ ...approved, displayText: ["偷偷增加文字"] }),
    /排版改动/,
  );
  assert.throws(
    () => imagePrompt({ ...approved, contentPrompt: "偷偷替层级赋义" }),
    /内容部分与/,
  );
  await assert.rejects(generateImage(approved, watercolor), /风格已变化/);
  const pixels = await sharp({
    create: { width: 24, height: 16, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "http://127.0.0.1:1/v1/images/generations");
    const body = JSON.parse(options.body);
    assert.equal(body.prompt, imagePrompt(approved));
    assert.equal(body.quality, approved.imageRequest.quality);
    assert.equal(body.size, approved.imageRequest.size);
    return Response.json({
      model: "provider-reported-model",
      size: "1536x1024",
      quality: "low",
      data: [
        {
          b64_json: pixels.toString("base64"),
          revised_prompt: "provider rewrite",
        },
      ],
    });
  };
  await generateImage(approved, minimal);
  // Trial retries upgrade the boundary while keeping style, content and history.
  const { runTrial } = await import("../server/trials.mjs");
  put("trial", {
    id: "old-trial",
    styleId: minimal.id,
    styleSnapshot: minimal,
    notes,
    feedback: "VISUAL_FEEDBACK",
    engine: "image",
    plan: { ...oldPromptPlan, contentPrompt: "OLD_SEMANTIC_BOUNDARY" },
    status: "failed",
    image: null,
  });
  const beforeTrialCalls = calls.length;
  await runTrial(
    { payload: { styleId: minimal.id, trialId: "old-trial" } },
    new AbortController().signal,
    () => {},
  );
  const resumed = get("trial", "old-trial");
  assert.equal(resumed.status, "completed");
  assert.equal(resumed.plan.promptMode, "verbatim-style-v5");
  assert.deepEqual(resumed.plan.screenCopy, approved.screenCopy);
  assert.equal(resumed.plan.styleRules, minimal.rules);
  assert.equal(calls.length, beforeTrialCalls);
  assert.equal(approved.imageRequest.providerOrigin, "http://127.0.0.1:1");
  assert.deepEqual(approved.imageResponse, {
    width: 24,
    height: 16,
    reportedModel: "provider-reported-model",
    reportedSize: "1536x1024",
    reportedQuality: "low",
    revisedPrompt: "provider rewrite",
  });
});
