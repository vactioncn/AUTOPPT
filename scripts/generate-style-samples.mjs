// Explicit, resumable authoring command. No model calls without --generate.
// Use a dedicated workspace with its own settings.json; never a user workspace.
import path from "node:path";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  copyFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import sharp from "sharp";
import { STYLE_SHOWCASE } from "../shared/style-showcase.mjs";
import {
  STYLE_SAMPLE_PAGES,
  STYLE_SAMPLE_TITLE,
  STYLE_SAMPLE_VERSION,
} from "../shared/style-sample-suite.mjs";

const args = process.argv.slice(2);
const folder = args[args.indexOf("--workspace") + 1];
if (!args.includes("--workspace") || !folder)
  throw new Error(
    "请提供 --workspace 独立样例目录；使用 --generate 调用模型，--publish 发布完整样例。",
  );
const workspace = path.resolve(folder);
if (!existsSync(path.join(workspace, ".style-sample-workspace")))
  throw new Error("目录缺少专用样例工作区标记，拒绝使用已有用户内容。");
process.env.AUTOPPT_DATA_DIR = workspace;
if (process.env.AUTOPPT_WORKER_TOKEN || process.env.AUTOPPT_DESKTOP_TOKEN)
  throw new Error("请在独立样例进程运行。");
const { get, assetPath } = await import("../server/store.mjs");
const { standardSamplePlan } = await import("../server/style-sample-plan.mjs");
const { generateImage } = await import("../server/models.mjs");
const { directImagePrompt } = await import("../server/direct-image.mjs");
const hash = (value) => createHash("sha256").update(value).digest("hex");
const statePath = path.join(workspace, "generation.json");
const state = existsSync(statePath)
  ? JSON.parse(readFileSync(statePath))
  : { version: STYLE_SAMPLE_VERSION, pages: {} };
assert.equal(state.version, STYLE_SAMPLE_VERSION);
const save = () =>
  writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n", {
    mode: 0o600,
  });
const only = args.includes("--only")
  ? args[args.indexOf("--only") + 1].split(",")
  : null;
if (args.includes("--revise") && !only)
  throw new Error("修订必须用 --only 明确指定页，原图保存在历史中。");
const tasks = STYLE_SHOWCASE.flatMap((group) =>
  STYLE_SAMPLE_PAGES.map((page) => ({
    group,
    page,
    key: `${group.id}-${page.id}`,
  })),
);
const selected = tasks.filter(({ key }) => !only || only.includes(key));
assert(selected.length > 0, "没有匹配的样例");

if (args.includes("--generate")) {
  const run = async ({ group, page, key }) => {
    const style = get("style", group.styleId);
    assert(style?.rules);
    const plan = standardSamplePlan(style, page.id);
    const contentHash = hash(
      JSON.stringify([
        STYLE_SAMPLE_VERSION,
        style.rules,
        page,
        plan.imageFeedback,
      ]),
    );
    const previous = state.pages[key];
    if (previous) {
      if (!args.includes("--revise"))
        assert.equal(
          previous.contentHash,
          contentHash,
          "内容已变化，使用新的独立工作区，保留原图。",
        );
      if (
        !args.includes("--revise") &&
        previous.status === "completed" &&
        existsSync(assetPath(previous.image))
      )
        return;
      // A request may have completed at the provider after disconnection.
      if (!args.includes("--retry") && !args.includes("--revise"))
        throw new Error(
          `${key} 有未完成记录，请核对结果后显式 --retry，不自动重复调用。`,
        );
    }
    state.pages[key] = {
      status: "running",
      contentHash,
      startedAt: new Date().toISOString(),
      ...(previous
        ? {
            history: [
              ...(previous.history || []),
              { ...previous, history: undefined },
            ],
          }
        : {}),
    };
    save();
    console.log(JSON.stringify({ key, status: "generating", page: page.type }));
    try {
      const image = await generateImage(
        plan,
        style,
        new AbortController().signal,
      );
      const metadata = await sharp(assetPath(image)).metadata();
      assert(Math.abs(metadata.width / metadata.height / (16 / 9) - 1) < 0.01);
      writeFileSync(
        path.join(workspace, `${key}.plan.json`),
        JSON.stringify(plan, null, 2) + "\n",
      );
      state.pages[key] = {
        ...state.pages[key],
        status: "completed",
        image,
        completedAt: new Date().toISOString(),
        stylePromptSha256: hash(style.rules),
        requestPromptSha256: hash(directImagePrompt(plan)),
        sourceImageSha256: hash(readFileSync(assetPath(image))),
        width: metadata.width,
        height: metadata.height,
      };
      save();
      console.log(
        JSON.stringify({
          key,
          status: "completed",
          completed: Object.values(state.pages).filter(
            (p) => p.status === "completed",
          ).length,
          total: tasks.length,
        }),
      );
    } catch (error) {
      state.pages[key] = {
        ...state.pages[key],
        status: "failed",
        error: error.message,
        uncertain: !!error.uncertain,
      };
      save();
      throw error;
    }
  };
  // Finish both in-flight requests before reporting a failure.
  for (let i = 0; i < selected.length; i += 2) {
    const results = await Promise.allSettled(selected.slice(i, i + 2).map(run));
    const failure = results.find((r) => r.status === "rejected");
    if (failure) throw failure.reason;
  }
}

if (args.includes("--publish")) {
  assert(
    tasks.every(({ key }) => state.pages[key]?.status === "completed"),
    "32 张必须全部完成后再发布。",
  );
  const out = path.resolve(`public/style-samples-v${STYLE_SAMPLE_VERSION}`);
  assert(!existsSync(out), "不覆盖已发布样例；修改内容请升级样例版本。");
  const staging = path.join(workspace, "public-ready");
  mkdirSync(staging, { recursive: true });
  const pages = [];
  for (const { group, page, key } of tasks) {
    const record = state.pages[key];
    const source = readFileSync(assetPath(record.image));
    assert.equal(hash(source), record.sourceImageSha256);
    for (const width of [1600, 640]) {
      await sharp(source)
        .resize(width, (width * 9) / 16, {
          fit: "contain",
          background: "#ffffff",
        })
        .webp({ quality: width === 1600 ? 90 : 85 })
        .toFile(
          path.join(staging, `${key}${width === 640 ? "-small" : ""}.webp`),
        );
    }
    pages.push({
      id: key,
      styleId: group.styleId,
      pageId: page.id,
      number: page.number,
      type: page.type,
      title: page.title,
      stylePromptSha256: record.stylePromptSha256,
      sourceImageSha256: record.sourceImageSha256,
      requestPromptSha256: record.requestPromptSha256,
      revised: !!record.history?.length,
      sha256: hash(readFileSync(path.join(staging, `${key}.webp`))),
      width: 1600,
      height: 900,
    });
  }
  writeFileSync(
    path.join(staging, "manifest.json"),
    JSON.stringify(
      {
        title: STYLE_SAMPLE_TITLE,
        version: STYLE_SAMPLE_VERSION,
        disclosure:
          "同一篇产品介绍、八种页面类型、四种原始风格，使用讲好图片生成流程实际制作。数据是八页示例的数量比例；人物及场景为AI生成的使用情境，非客户实证。",
        pages,
      },
      null,
      2,
    ) + "\n",
  );
  mkdirSync(out);
  for (const { key } of tasks)
    for (const suffix of [".webp", "-small.webp"])
      copyFileSync(
        path.join(staging, key + suffix),
        path.join(out, key + suffix),
      );
  copyFileSync(
    path.join(staging, "manifest.json"),
    path.join(out, "manifest.json"),
  );
  console.log(JSON.stringify({ published: pages.length, folder: out }));
}
if (!args.includes("--generate") && !args.includes("--publish"))
  console.log(
    JSON.stringify({
      title: STYLE_SAMPLE_TITLE,
      planned: selected.map(({ key }) => key),
      modelCalls: 0,
    }),
  );
