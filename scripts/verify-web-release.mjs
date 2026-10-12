import path from "node:path";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const root = path.resolve(process.argv[2] || ".");
const manifest = JSON.parse(
  readFileSync(path.join(root, "RELEASE.json"), "utf8"),
);
if (
  !/^[a-f0-9]{40}$/.test(manifest.gitSha || "") ||
  !Array.isArray(manifest.files)
)
  throw new Error("发行清单无效。");
for (const file of manifest.files) {
  if (
    !file.path ||
    path.isAbsolute(file.path) ||
    file.path.split(/[\\/]/).includes("..")
  )
    throw new Error("发行清单路径无效。");
  const bytes = readFileSync(path.join(root, file.path));
  if (
    bytes.length !== file.size ||
    createHash("sha256").update(bytes).digest("hex") !== file.sha256
  )
    throw new Error("发行文件校验失败：" + file.path);
}
console.log(
  `发行包校验通过：${manifest.gitSha}，${manifest.files.length} 个文件，${manifest.musicTracks?.length || 0} 首音乐。`,
);
