import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { product } from "../site/intro/content.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bucket = "oss://turing-show";
const domain = "https://show.turing.art";

export function validateTarget(target) {
  // A single non-empty directory, never a root, path traversal or URL.
  if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(target || ""))
    throw new Error(
      "请明确指定单个网站子目录（1–63 位小写字母、数字、短横线或下划线），例如 autoppt。",
    );
  return target;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      `${path.basename(command)} 执行失败，退出码 ${result.status ?? result.signal}`,
    );
}

function copyPublicFile(relative, output) {
  const source = path.join(root, "public", relative);
  // Do not follow a replaced public directory or asset into private storage.
  let part = path.join(root, "public");
  for (const segment of relative.split("/")) {
    if (lstatSync(part).isSymbolicLink())
      throw new Error(`不发布符号链接：${relative}`);
    part = path.join(part, segment);
  }
  if (lstatSync(source).isSymbolicLink() || !lstatSync(source).isFile())
    throw new Error(`不是可发布的普通文件：${relative}`);
  const dest = path.join(output, relative.replace(/^intro\//, ""));
  mkdirSync(path.dirname(dest), { recursive: true });
  copyFileSync(source, dest);
}

export function prepareIntroduction(output) {
  if (existsSync(output) && readdirSync(output).length)
    throw new Error("发布暂存目录必须为空。");
  mkdirSync(output, { recursive: true });
  run(process.execPath, [path.join(root, "scripts/build-intro.mjs")], {
    cwd: root,
    env: { ...process.env, AUTOPPT_INTRO_OUTPUT_DIR: output },
  });
  let html = readFileSync(path.join(output, "index.html"), "utf8");
  // The introduction is the deployed directory's index, not /intro/index.html.
  html = html
    .replaceAll("../favicon.svg", "./favicon.svg")
    .replaceAll("../style-covers/", "./style-covers/")
    .replace(
      'href="../#projects"',
      'href="https://github.com/vactioncn/AUTOPPT"',
    )
    .replace("打开本机工作台 ↗", "查看源码与安装入口 ↗");
  writeFileSync(path.join(output, "index.html"), html);

  // Copy only assets actually used by this page. Never sync the repo, .local,
  // dist, or a whole public directory that may later contain unrelated files.
  const screenshots = new Set(
    [...html.matchAll(/screenshots\/([a-z0-9-]+\.webp)/g)].map((m) => m[1]),
  );
  for (const name of screenshots)
    copyPublicFile(`intro/screenshots/${name}`, output);
  copyPublicFile("favicon.svg", output);

  return [
    "index.html",
    "help.html",
    "intro.css",
    "intro.js",
    "guide.md",
    "favicon.svg",
    ...product.gallery.map((style) => `artwork/${style.file}.webp`),
    ...[...screenshots].map((name) => `screenshots/${name}`),
  ].sort();
}

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

export async function verifyIntroduction(base, output, files) {
  // Check the human-facing directory URL as well as each uploaded resource.
  for (const file of ["", ...files]) {
    const local = readFileSync(path.join(output, file || "index.html"));
    const response = await fetch(`${base}${file}`, {
      headers: { "Cache-Control": "no-cache" },
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok)
      throw new Error(`公网验证失败：${file || "/"} HTTP ${response.status}`);
    if (
      (!file || file === "index.html") &&
      (!response.headers.get("content-type")?.includes("text/html") ||
        response.headers.get("content-disposition")?.includes("attachment"))
    )
      throw new Error(
        "公网入口没有以网页形式打开，请检查 OSS 域名与静态网站配置。",
      );
    if (digest(Buffer.from(await response.arrayBuffer())) !== digest(local))
      throw new Error(
        `公网内容尚未与本次发布一致：${file || "/"}，请检查 CDN 缓存。`,
      );
  }
}

async function main(args) {
  const [target, option, ...extra] = args;
  validateTarget(target);
  if (extra.length || (option && option !== "--dry-run"))
    throw new Error("用法：npm run deploy:intro -- <网站子目录> [--dry-run]");
  const dryRun = option === "--dry-run";
  const localBinary = path.join(homedir(), ".local/bin/ossutil");
  const binary =
    process.env.OSSUTIL_BIN ||
    (existsSync(localBinary) ? localBinary : "ossutil");
  const dedicatedConfig = path.join(
    homedir(),
    ".config/oss-web-deploy/ossutilconfig",
  );
  const config =
    process.env.OSSUTIL_CONFIG_FILE ||
    (existsSync(dedicatedConfig)
      ? dedicatedConfig
      : path.join(homedir(), ".ossutilconfig"));
  if (!existsSync(config))
    throw new Error("尚未配置 ossutil。请按部署说明设置本机授权文件。");

  const temp = mkdtempSync(path.join(tmpdir(), "autoppt-intro-deploy-"));
  try {
    const output = path.join(temp, "site");
    const files = prepareIntroduction(output);
    console.log(`\n${dryRun ? "预演" : "发布"}：${bucket}/${target}/`);
    console.log(
      `只上传以下 ${files.length} 个介绍页文件：\n${files.join("\n")}`,
    );
    const syncArgs = [
      "sync",
      `${output}/`,
      `${bucket}/${target}/`,
      "--config-file",
      config,
      "--output-dir",
      path.join(temp, "logs"),
      "--checkpoint-dir",
      path.join(temp, "checkpoints"),
      "--cache-control",
      "no-cache",
      "--force",
    ];
    if (dryRun) syncArgs.push("--dry-run");
    // Never --delete: other files already in this directory are preserved.
    run(binary, syncArgs, { cwd: temp });
    const url = `${domain}/${target}/`;
    if (dryRun) {
      console.log(`\n预演完成，未上传或删除云端文件。预期网址：${url}`);
      return;
    }
    console.log("\n文件已上传，正在验证公网入口与全部资源……");
    await verifyIntroduction(url, output, files);
    console.log(
      `\n部署成功，公网内容验证通过。\nOSS：${bucket}/${target}/\nURL：${url}`,
    );
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`发布未完成：${error.message}`);
    process.exitCode = 1;
  });
}
