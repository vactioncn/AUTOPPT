import path from "node:path";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import JSZip from "jszip";

export const deploymentPaths = [
  "package.json",
  "package-lock.json",
  "index.html",
  "tsconfig.json",
  "vite.config.ts",
  "src",
  "server",
  "shared",
  "public",
  "site",
  "scripts",
  "tests",
  "deploy",
  ".dockerignore",
  ".gitignore",
  "README.md",
  "docs/线上部署.md",
  "docs/网页版部署交付.md",
  "docs/同事安装与使用说明.md",
  "docs/邀请制网页版第一版方案.md",
];
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
export async function packageWeb({
  root = path.resolve(import.meta.dirname, ".."),
  outputDir = path.join(root, "release"),
} = {}) {
  const git = (...args) =>
    execFileSync("git", args, { cwd: root, maxBuffer: 256 * 1024 * 1024 });
  if (git("status", "--porcelain", "--untracked-files=no").toString().trim())
    throw new Error("请先提交已完成改动，再从干净提交生成部署包。");
  const commit = git("rev-parse", "HEAD").toString().trim();
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error("发布提交号无效。");
  const prefix = "AutoPPT-Web/";
  const zip = await JSZip.loadAsync(
    git(
      "archive",
      "--format=zip",
      `--prefix=${prefix}`,
      commit,
      "--",
      ...deploymentPaths,
    ),
  );
  const files = [];
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue;
    const name = entry.name.slice(prefix.length);
    if (
      /(^|\/)(?:\.local|\.hosted|node_modules|secrets|\.env)(?:\/|$)/.test(
        name,
      ) ||
      /\.(?:sqlite|app)(?:\/|$)/.test(name)
    )
      throw new Error(`部署包不能包含个人数据或密钥：${name}`);
    if ((Number(entry.unixPermissions) & 0o170000) === 0o120000)
      throw new Error(`部署包不接受符号链接：${name}`);
    const bytes = await entry.async("nodebuffer");
    files.push({ path: name, size: bytes.length, sha256: digest(bytes) });
  }
  const manifest = {
    product: "AutoPPT invited web V1",
    format: 1,
    gitSha: commit,
    buildTime: new Date().toISOString(),
    files,
  };
  zip.file(prefix + "RELEASE.json", JSON.stringify(manifest, null, 2) + "\n");
  const example = await zip
    .file(prefix + "deploy/.env.example")
    .async("string");
  zip.file(
    prefix + "deploy/release.env.example",
    example +
      `\nAUTOPPT_BUILD_GIT_SHA=${commit}\nAUTOPPT_BUILD_TIME=${manifest.buildTime}\n`,
  );
  zip.file(
    prefix + "开始部署.md",
    await zip.file(prefix + "docs/网页版部署交付.md").async("string"),
  );
  const bytes = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
  mkdirSync(outputDir, { recursive: true });
  const output = path.join(outputDir, `AutoPPT-Web-${commit.slice(0, 8)}.zip`);
  writeFileSync(output, bytes, { flag: "wx", mode: 0o600 });
  writeFileSync(
    output + ".sha256",
    `${digest(bytes)}  ${path.basename(output)}\n`,
    { flag: "wx", mode: 0o600 },
  );
  // Inspect what was written rather than treating archive creation as verification.
  const saved = await JSZip.loadAsync(readFileSync(output), {
    checkCRC32: true,
  });
  if (
    JSON.parse(await saved.file(prefix + "RELEASE.json").async("string"))
      .gitSha !== commit
  )
    throw new Error("部署包版本核对失败。");
  return { output, sha256: digest(bytes), gitSha: commit, files: files.length };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const result = await packageWeb({
    outputDir: process.argv[2] ? path.resolve(process.argv[2]) : undefined,
  });
  console.log(JSON.stringify(result, null, 2));
}
