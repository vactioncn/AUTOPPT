import {
  readFile,
  writeFile,
  copyFile,
  readdir,
  rename,
} from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [upstreamArg, filmArg, webArg] = process.argv.slice(2);
if (!webArg)
  throw new Error(
    "用法：node scripts/package-huashu-motion-demo.mjs <上游目录> <样片目录> <新网页目录>",
  );
const upstream = path.resolve(upstreamArg),
  film = path.resolve(filmArg),
  web = path.resolve(webArg);
const videos = (await readdir(path.join(film, "out")))
  .filter((f) => /-v\d+\.mp4$/.test(f))
  .sort(
    (a, b) => Number(a.match(/-v(\d+)/)[1]) - Number(b.match(/-v(\d+)/)[1]),
  );
if (!videos.length) throw new Error("请先用 om render 导出 MP4。");
execFileSync(
  process.execPath,
  [
    path.join(upstream, "cli/om.js"),
    "export",
    "html",
    film,
    "--out",
    web,
    "--title",
    "一页 PPT，怎样让人看懂？",
  ],
  { stdio: "inherit" },
);
await rename(path.join(web, "index.html"), path.join(web, "native.html"));
for (const f of ["viewer.html", "viewer.css", "viewer.js"])
  await copyFile(
    path.join(root, "site/huashu-motion-lab", f),
    path.join(web, f === "viewer.html" ? "index.html" : f),
  );
await copyFile(
  path.join(film, "out", videos.at(-1)),
  path.join(web, "demo.mp4"),
);
await writeFile(
  path.join(web, "README.txt"),
  "讲好 × huashu-motion 独立试验\n请用本机静态服务打开 index.html；直接双击 iframe 网页可能被浏览器同源策略阻止。\n可直接打开 demo.mp4 观看带声音视频。source.zip 为 huashu-motion 可编辑工程，解压后用 om studio 打开。\n图表为虚构教学数据，未接入讲好正式工作台。\n",
);
console.log(JSON.stringify({ web, video: videos.at(-1) }, null, 2));
