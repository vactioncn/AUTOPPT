import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { dateContextPrompt } from "../server/date-context.mjs";
import { directImagePrompt } from "../server/direct-image.mjs";
import { imageContentPrompt } from "../server/image-content.mjs";
import { unifiedCoverPlan } from "../server/style-cover.mjs";

test("runtime date follows the Shanghai calendar across future year boundaries", () => {
  assert.match(
    dateContextPrompt(new Date("2026-12-31T15:59:59Z")),
    /Asia\/Shanghai）：2026-12-31/,
  );
  const future = dateContextPrompt(new Date("2026-12-31T16:00:00Z"));
  assert.match(future, /Asia\/Shanghai）：2027-01-01/);
  assert(!future.includes("2026"));
  assert.match(future, /不自动写入画面、讲稿或风格规则/);
});

test("existing image plans receive the date boundary without rewriting source facts or saved styles", () => {
  const style = {
    id: "existing-style",
    name: "旧风格",
    rules: "\t黑白摄影，微型编辑信息可用 PORTFOLIO 2024。\n",
  };
  const plan = unifiedCoverPlan(style);
  plan.displayText = ["2025年的实验"];
  plan.screenCopy = {
    ...plan.screenCopy,
    entries: [{ text: "2025年的实验", role: "main" }],
    displayText: plan.displayText,
    semanticSupport: [{ sourceQuote: "实验从2024年开始准备。" }],
  };
  plan.contentPrompt = imageContentPrompt(plan.screenCopy);
  plan.attachments = [{ id: "chart", name: "截屏2024-01-01.png" }];
  const before = structuredClone({ style, plan });
  const prompt = directImagePrompt(plan);
  assert(prompt.startsWith(style.rules + "\n\n"));
  assert.match(prompt, /【上屏主文案】\n2025年的实验/);
  assert.match(prompt, /实验从2024年开始准备/);
  assert.match(prompt, /素材边缘的装饰年份/);
  assert.match(prompt, /不能借此篡改截图或图表/);
  assert.match(prompt, /不要从上传文件名、截图文件名/);
  assert.match(prompt, /不得用当前年份替换/);
  assert.deepEqual({ style, plan }, before);
});

test("all JSON model requests carry runtime context while spoken source dates remain untouched", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "autoppt-date-context-"));
  process.env.AUTOPPT_DATA_DIR = dir;
  process.env.OPENAI_API_KEY = "fixture-only";
  process.env.OPENAI_BASE_URL = "http://127.0.0.1:1/v1";
  const { jsonModel } = await import("../server/models.mjs");
  const { db } = await import("../server/store.mjs");
  const previousFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = previousFetch;
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const notes = "2025年进行的实验，2024年开始准备。";
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "http://127.0.0.1:1/v1/chat/completions");
    const body = JSON.parse(options.body);
    assert.match(
      body.messages[0].content,
      /本次运行日期（Asia\/Shanghai）：\d{4}-\d{2}-\d{2}/,
    );
    assert.match(body.messages[0].content, /年份与日期属于内容事实/);
    assert.equal(body.messages[1].content[0].text, notes);
    return Response.json({
      choices: [{ message: { content: JSON.stringify({ notes }) } }],
    });
  };
  assert.deepEqual(await jsonModel("按原文分析", notes), { notes });
});
