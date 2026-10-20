import path from "node:path";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, lstatSync } from "node:fs";
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
  "docs/无域名服务器验收.md",
  "docs/网页版部署交付.md",
  "docs/同事安装与使用说明.md",
  "docs/邀请制网页版第一版方案.md",
  "docs/网页版网站与导航改造.md",
  "docs/网页版语音演练.md",
  "docs/服务器部署操作手册.md",
];
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
export async function packageWeb({
  root = path.resolve(import.meta.dirname, ".."),
  outputDir = path.join(root, "release"),
  musicDirectory,
  fontDirectory,
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
  const music = [];
  let fontsIncluded = false;
  if (fontDirectory) {
    const directory = path.resolve(fontDirectory);
    const manifestPath = path.join(directory, "manifest.json");
    if (
      !lstatSync(manifestPath).isFile() ||
      lstatSync(manifestPath).isSymbolicLink()
    )
      throw new Error("字体包清单必须是普通文件。");
    const pack = JSON.parse(readFileSync(manifestPath, "utf8"));
    const required = new Set([
      "Jianghao Sans:regular",
      "Jianghao Sans:bold",
      "Jianghao Sans Light:regular",
      "Jianghao Serif:regular",
      "Jianghao Serif:bold",
    ]);
    if (pack.version !== 1 || pack.fonts?.length !== required.size)
      throw new Error("字体包必须包含五个完整字面。");
    const names = new Set();
    for (const font of pack.fonts) {
      if (
        !required.delete(`${font.family}:${font.slot}`) ||
        !/^font-\d+\.fntdata$/.test(font.file || "") ||
        names.has(font.file) ||
        !font.license?.includes("SIL OPEN FONT LICENSE") ||
        !Array.isArray(font.characters) ||
        font.characters.length < 20000
      )
        throw new Error("字体包字面、完整字库或授权无效。");
      const file = path.join(directory, font.file);
      if (!lstatSync(file).isFile() || lstatSync(file).isSymbolicLink())
        throw new Error("字体包只接受普通文件。");
      const bytes = readFileSync(file);
      if (
        bytes.length < 100 ||
        bytes.length > 40 * 1024 * 1024 ||
        bytes.readUInt32LE(0) !== bytes.length ||
        bytes.readUInt16LE(34) !== 0x504c ||
        digest(bytes) !== font.sha256
      )
        throw new Error("字体文件格式或校验失败。");
      names.add(font.file);
      zip.file(prefix + "deploy/fonts/" + font.file, bytes, {
        unixPermissions: 0o100644,
      });
    }
    zip.file(
      prefix + "deploy/fonts/manifest.json",
      JSON.stringify(pack) + "\n",
    );
    fontsIncluded = true;
  }
  if (musicDirectory) {
    const directory = path.resolve(musicDirectory);
    const index = JSON.parse(
      readFileSync(path.join(directory, "index.json"), "utf8"),
    );
    if (!Array.isArray(index) || !index.length || index.length > 30)
      throw new Error("音乐清单应包含 1–30 首曲目。");
    const ids = new Set();
    for (const track of index) {
      if (
        !/^[a-f0-9]{24}$/.test(track.id || "") ||
        typeof track.name !== "string" ||
        !track.name.trim() ||
        ids.has(track.id)
      )
        throw new Error("音乐清单编号或名称无效。");
      ids.add(track.id);
      const file = path.join(directory, track.id + ".mp3");
      if (!lstatSync(file).isFile() || lstatSync(file).isSymbolicLink())
        throw new Error("音乐包只接受普通 MP3 文件。");
      const bytes = readFileSync(file);
      if (
        !bytes.length ||
        bytes.length > 30 * 1024 * 1024 ||
        digest(bytes).slice(0, 24) !== track.id
      )
        throw new Error("音乐文件校验失败：" + track.name);
      zip.file(prefix + "music/" + track.id + ".mp3", bytes, {
        unixPermissions: 0o100644,
      });
      music.push({ id: track.id, name: track.name });
    }
    zip.file(
      prefix + "music/index.json",
      JSON.stringify(music, null, 2) + "\n",
      { unixPermissions: 0o100644 },
    );
  }
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
    musicIncluded: !!music.length,
    musicTracks: music,
    fontsIncluded,
  };
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
    (
      await zip
        .file(
          prefix +
            (music.length
              ? "docs/服务器部署操作手册.md"
              : "docs/网页版部署交付.md"),
        )
        .async("string")
    ).replace(/(\[[^\]]*\]\()([^)\s]+)(\))/g, (link, start, target, end) =>
      /^(?:[a-z][a-z\d+.-]*:|\/|#)/i.test(target)
        ? link
        : start + path.posix.join("docs", target) + end,
    ),
  );
  for (const name of ["deploy/release.env.example", "开始部署.md"]) {
    const bytes = await zip.file(prefix + name).async("nodebuffer");
    files.push({ path: name, size: bytes.length, sha256: digest(bytes) });
  }
  zip.file(prefix + "RELEASE.json", JSON.stringify(manifest, null, 2) + "\n");
  const bytes = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
    platform: "UNIX",
  });
  mkdirSync(outputDir, { recursive: true });
  const output = path.join(
    outputDir,
    `AutoPPT-${music.length ? "Server" : "Web"}-${commit.slice(0, 8)}.zip`,
  );
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
  const args = process.argv.slice(2);
  const musicFlag = args.indexOf("--music-dir");
  const musicDirectory = musicFlag >= 0 ? args[musicFlag + 1] : undefined;
  if (musicFlag >= 0 && !musicDirectory)
    throw new Error("--music-dir 后需提供音乐目录。");
  if (musicFlag >= 0) args.splice(musicFlag, 2);
  const fontFlag = args.indexOf("--font-dir");
  const fontDirectory = fontFlag >= 0 ? args[fontFlag + 1] : undefined;
  if (fontFlag >= 0 && !fontDirectory)
    throw new Error("--font-dir 后需提供完整字体包目录。");
  if (fontFlag >= 0) args.splice(fontFlag, 2);
  const result = await packageWeb({
    outputDir: args[0] ? path.resolve(args[0]) : undefined,
    musicDirectory,
    fontDirectory,
  });
  console.log(JSON.stringify(result, null, 2));
}
