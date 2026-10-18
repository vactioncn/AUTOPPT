import { readFile, writeFile, mkdir, copyFile, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [upstreamArg, outputArg] = process.argv.slice(2);
if (!upstreamArg || !outputArg)
  throw new Error(
    "用法：node scripts/build-huashu-motion-demo.mjs <huashu-motion 源码目录> <新输出目录>",
  );
const upstream = path.resolve(upstreamArg),
  output = path.resolve(outputArg);
const commit = execFileSync("git", ["-C", upstream, "rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
if (commit !== "3e927801e78b587878fb7dbb65d616326df00c21")
  throw new Error(`上游版本 ${commit} 未经本次试验验证，请使用记录的提交。`);
let exists = false;
try {
  await access(output);
  exists = true;
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}
if (exists)
  throw new Error("输出目录已存在；请选择新目录，避免覆盖编辑器中的修改。");
execFileSync(
  process.execPath,
  [path.join(upstream, "cli/om.js"), "new", output],
  { stdio: "inherit" },
);
const dir = path.join(root, "site/huashu-motion-lab");
const [template, css, js, treatment] = await Promise.all(
  ["index.template.html", "film.css", "film.js", "treatment.md"].map((f) =>
    readFile(path.join(dir, f), "utf8"),
  ),
);
// Twenty 4/4 bars at 120 BPM = 40 seconds. Original three-note theme; local synthesizers.
const melody = [
  "D2 A2 B2 z2",
  "A2 F2 E2 z2",
  "D4 z4",
  "D2 F2 A2 z2",
  "E2 G2 B2 z2",
  "F2 A2 d2 z2",
  "E4 z4",
  "D2 A2 B2 A2",
  "F2 A2 d2 A2",
  "E2 G2 B2 G2",
  "F2 A2 d2 A2",
  "E4 z4",
  "D2 F2 A2 d2",
  "E2 G2 B2 e2",
  "F2 A2 d2 f2",
  "A4 z4",
  "d2 a2 b2 z2",
  "a2 f2 e2 z2",
  "d4 A2 F2",
  "D6 z2",
];
const chords = [
  "[DFA]8",
  "[B,DF]8",
  "[A,CE]8",
  "[DFA]8",
  "[EGB]8",
  "[FAd]8",
  "[A,CE]8",
  "[DFA]8",
  "[FAd]8",
  "[EGB]8",
  "[FAd]8",
  "[A,CE]8",
  "[DFA]8",
  "[EGB]8",
  "[FAd]8",
  "[A,CE]8",
  "[DFA]8",
  "[B,DF]8",
  "[A,CE]8",
  "[DFA]8",
];
const bass = [
  "D,,8",
  "B,,,8",
  "A,,,8",
  "D,,8",
  "E,,8",
  "F,,8",
  "A,,,8",
  "D,,8",
  "F,,8",
  "E,,8",
  "F,,8",
  "A,,,8",
  "D,,8",
  "E,,8",
  "F,,8",
  "A,,,8",
  "D,,8",
  "B,,,8",
  "A,,,8",
  "D,,8",
];
const marks = { 0: "hook", 3: "focus", 7: "data", 12: "logic", 16: "ending" };
const score = `X:1\nT:Follow the Thought\nM:4/4\nL:1/8\nQ:1/4=120\nK:Dm\nV:M inst=piano role=melody gain=0.6\n!mf! ${melody.map((bar, i) => `${marks[i] ? `!mark:${marks[i]}! ` : ""}${bar}`).join(" | ")} |\nV:H inst=warmpad gain=0.23\n!p! ${chords.join(" | ")} |\nV:B inst=sinebass gain=0.3\n!p! ${bass.join(" | ")} |\nV:P inst=drums kit=pop gain=0.17\n!p! ${melody.map((_, i) => (i < 3 || (i >= 7 && i < 16) ? "C,,2 ^F,,2 D,,2 ^F,,2" : "z8")).join(" | ")} |`;
await writeFile(
  path.join(output, "index.html"),
  template
    .replace("__CSS__", css)
    .replace("__SCORE__", score)
    .replace("__JS__", js),
);
await writeFile(path.join(output, "treatment.md"), treatment);
await copyFile(
  path.join(upstream, "fonts/NotoSansSC-700.woff"),
  path.join(output, "assets/fonts/NotoSansSC-700.woff"),
);
await copyFile(
  path.join(upstream, "LICENSE"),
  path.join(output, "HUASHU-MOTION-LICENSE.txt"),
);
await writeFile(
  path.join(output, "provenance.json"),
  JSON.stringify(
    {
      upstream: "https://github.com/alchaincyf/huashu-motion",
      commit,
      name: "huashu-motion",
      version: "0.1.0",
      authoredBy: "AutoPPT demo experiment",
      date: "2026-10-18",
      data: "Fictional teaching example; quarterly orders 30,45,40,60",
      narration: "none",
      score: "original ABC; local synthesis",
    },
    null,
    2,
  ),
);
await mkdir(path.join(output, "tools"), { recursive: true });
console.log(
  JSON.stringify({ output, commit, duration: 40, scenes: 5 }, null, 2),
);
