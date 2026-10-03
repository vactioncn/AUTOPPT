// Real UI screenshots using isolated, public demo data. No live project reads or model calls.
import {
  mkdtempSync,
  mkdirSync,
  copyFileSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { spawn } from "node:child_process";
import { once } from "node:events";
import http from "node:http";
import { chromium } from "playwright-core";
import sharp from "sharp";
import { DEFAULT_STYLE_ID } from "../shared/styles.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (!existsSync(path.join(root, "dist/index.html")))
  throw Error("Run npm run build first.");
const dir = mkdtempSync(path.join(tmpdir(), "autoppt-intro-"));
const output = path.join(root, "public/intro/screenshots");
mkdirSync(output, { recursive: true });
mkdirSync(path.join(dir, "assets"));
copyFileSync(
  path.join(root, "public/style-covers/restrained-childhood-editorial.png"),
  path.join(dir, "assets/demo-cover.png"),
);
writeFileSync(
  path.join(dir, "settings.json"),
  JSON.stringify({
    text: {
      baseUrl: "https://api.example.com/v1",
      model: "your-text-model",
      clearKey: true,
    },
    image: {
      baseUrl: "https://api.example.com/v1",
      model: "your-image-model",
      clearKey: true,
    },
  }),
);
const timestamp = "2026-10-03T00:00:00.000Z";
const notes =
  "今天，我们从儿童摄影里一个自然的瞬间开始。一个眼神，一缕光，一次不经意的回头，都值得被认真记录。\n\n我希望画面保留这样的真实，也希望每一页的表达清楚、有层次。这就是我们这次使用的克制儿童摄影杂志风。";
const displayText = ["克制", "儿童摄影杂志风"];
const plan = {
  engine: "image",
  title: "克制儿童摄影杂志风",
  displayText,
  styleRules: readFileSync(
    path.join(root, "server/styles/restrained-childhood-editorial.txt"),
    "utf8",
  ),
  layout: "构图依据内容和风格原文完成。",
  visual: "黑白摄影与少量荧光黄绿，体现自然的童年瞬间。",
  rationale: "演示资料：完整展开留在讲稿，画面聚焦主题。",
  screenCopy: {
    mustKeep: [],
    spokenOnly: [
      { sourceQuote: notes.split("\n")[0], reason: "背景展开保留在口播。" },
    ],
    metrics: {
      sourceCharacters: notes.replace(/\s/g, "").length,
      characters: displayText.join("").length,
      groups: 2,
      warnings: [],
    },
    review: {
      draftCharacters: displayText.join("").length,
      reason: "演示资料：主文案点题，展开保留在完整讲稿。",
      changes: [],
    },
  },
};
const slide = {
  id: "demo-slide",
  batchIds: ["demo-batch"],
  styleId: DEFAULT_STYLE_ID,
  notes,
  manuscriptVersion: 1,
  plan,
  image: "demo-cover.png",
  status: "ready",
  error: null,
  stale: false,
  versions: [],
  attachments: [],
  createdAt: timestamp,
  imageStyle: {
    id: DEFAULT_STYLE_ID,
    name: "克制儿童摄影杂志风",
    imageRefs: [],
    designRefs: [],
  },
};
const project = {
  id: "demo-project",
  title: "把童年，留在好照片里",
  styleId: DEFAULT_STYLE_ID,
  createdAt: timestamp,
  updatedAt: timestamp,
  revision: 1,
  batches: [
    {
      id: "demo-batch",
      text: notes,
      slideIds: [slide.id],
      createdAt: timestamp,
    },
  ],
  slides: [slide],
  draft: "",
  proposal: null,
  undo: null,
};
const db = new DatabaseSync(path.join(dir, "autoppt.sqlite"));
db.exec(
  "CREATE TABLE records (kind TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(kind,id))",
);
db.prepare("INSERT INTO records VALUES (?,?,?)").run(
  "project",
  project.id,
  JSON.stringify(project),
);
db.close();
const portFinder = http.createServer();
portFinder.listen(0, "127.0.0.1");
await once(portFinder, "listening");
const port = portFinder.address().port;
await new Promise((r) => portFinder.close(r));
const base = `http://127.0.0.1:${port}`;
let browser,
  logs = "";
const errors = [];
const child = spawn(process.execPath, ["server/index.mjs"], {
  cwd: root,
  env: {
    ...process.env,
    NODE_ENV: "production",
    AUTOPPT_DATA_DIR: dir,
    PORT: String(port),
    OPENAI_API_KEY: "",
    OPENAI_BASE_URL: "https://api.example.com/v1",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
child.stdout.on("data", (s) => (logs += s));
child.stderr.on("data", (s) => (logs += s));
try {
  let ready = false;
  for (let i = 0; i < 150; i++) {
    try {
      if ((await fetch(base + "/api/health")).ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!ready) throw Error(logs);
  const executablePath =
    process.env.CHROMIUM_EXECUTABLE ||
    (process.platform === "darwin"
      ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
      : undefined);
  browser = await chromium.launch({ executablePath, headless: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1040 },
    deviceScaleFactor: 1,
  });
  page.on("pageerror", (e) => {
    errors.push(e.message);
    console.error(e.message);
  });
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return url.origin === base || url.protocol === "data:"
      ? route.continue()
      : route.abort();
  });
  const capture = async (name) => {
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(
        [...document.images]
          .filter((i) => i.getBoundingClientRect().top < innerHeight)
          .map((i) => i.decode().catch(() => {})),
      );
    });
    const buffer = await page.screenshot({ animations: "disabled" });
    const image = await sharp(buffer).webp({ quality: 92 }).toBuffer();
    writeFileSync(path.join(output, name + ".webp"), image);
    console.log("Captured " + name);
  };
  const workspace = async () => {
    await page.goto(base + "/#project/demo-project");
    await page
      .getByRole("heading", { name: project.title, exact: true })
      .waitFor();
  };
  await workspace();
  await page.getByRole("button", { name: /^打开第 1 页：/ }).waitFor();
  await capture("workspace");
  await page.getByRole("button", { name: "演说稿", exact: true }).click();
  await capture("manuscript");
  await page
    .getByRole("button", { name: "在末尾插入一页", exact: true })
    .click();
  await page
    .getByLabel("新页面逐字稿", { exact: true })
    .fill(
      "接下来，我们把视线转向一次真实的拍摄。让这一页只讲清一个问题，也给观众留下思考的空间。",
    );
  await capture("insert");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "关闭", exact: true })
    .click();
  await page.getByRole("button", { name: /^全部页面/ }).click();
  await page.getByRole("button", { name: /^打开第 1 页：/ }).click();
  await page
    .getByLabel("重新设计要求", { exact: true })
    .fill("保留自然的摄影质感，调整画面重心，让文字与人物之间更有呼吸感。");
  await page
    .getByRole("button", { name: "上屏文案与风格", exact: true })
    .click();
  await capture("detail");
  await page.getByLabel("重新设计要求", { exact: true }).fill("");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "关闭", exact: true })
    .click();
  await page.getByRole("button", { name: "导出 PPT", exact: true }).click();
  await page.getByRole("button", { name: /下载 PPT 与逐字稿/ }).waitFor();
  await capture("export");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "关闭", exact: true })
    .click();
  await page.goto(base + "/#styles");
  await page
    .getByRole("heading", { name: "把喜欢的，变成你的风格。" })
    .waitFor();
  await capture("styles");
  await page.getByRole("button", { name: "新建演讲项目", exact: true }).click();
  await page
    .getByPlaceholder("例如：儿童摄影行业的下一步")
    .fill("把童年，留在好照片里");
  await page
    .getByRole("button", { name: "默认 · 沿用风格", exact: true })
    .waitFor();
  await page
    .getByLabel("内容倾向（可选）", { exact: true })
    .fill("面向儿童摄影影楼老板，讨论拍摄体验与门店经营");
  await capture("options");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "关闭", exact: true })
    .click();
  await page.goto(base + "/#settings");
  await page.getByRole("heading", { name: "连接你的创作能力。" }).waitFor();
  await capture("settings");
  if (errors.length) throw Error(errors.join("\n"));
  writeFileSync(
    path.join(output, "manifest.json"),
    JSON.stringify(
      {
        source: "isolated AutoPPT demo workspace",
        viewport: { width: 1440, height: 1040 },
        modelCalls: 0,
        privateData: false,
        files: [
          "workspace",
          "manuscript",
          "insert",
          "detail",
          "export",
          "styles",
          "options",
          "settings",
        ].map((x) => x + ".webp"),
      },
      null,
      2,
    ) + "\n",
  );
  // Keep the running local introduction current without touching its database or process.
  const builtShots = path.join(root, "dist/intro/screenshots");
  mkdirSync(builtShots, { recursive: true });
  for (const name of [
    "workspace",
    "manuscript",
    "insert",
    "detail",
    "export",
    "styles",
    "options",
    "settings",
  ])
    copyFileSync(
      path.join(output, name + ".webp"),
      path.join(builtShots, name + ".webp"),
    );
  console.log(
    "Screenshot capture complete. Demo database removed; no user data touched.",
  );
} finally {
  await browser?.close();
  if (child.exitCode === null) {
    const stopped = once(child, "exit");
    child.kill("SIGTERM");
    await stopped;
  }
  rmSync(dir, { recursive: true, force: true });
}
