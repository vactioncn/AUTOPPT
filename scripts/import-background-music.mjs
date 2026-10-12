import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

const args = process.argv.slice(2);
if (args[0] !== "--directory" || !args[1] || !args[2]) {
  console.error(
    "用法：node scripts/import-background-music.mjs --directory 音乐目录 曲目1.mp3 [曲目2.mp3 …]",
  );
  process.exit(1);
}
const directory = path.resolve(args[1]);
await mkdir(directory, { recursive: true, mode: 0o700 });
let tracks = [];
try {
  tracks = JSON.parse(
    await readFile(path.join(directory, "index.json"), "utf8"),
  );
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}
if (!Array.isArray(tracks)) throw new Error("音乐目录清单无效，原文件保留。");
// Validate the entire import before publishing the new catalogue.
const imports = await Promise.all(
  args.slice(2).map(async (file) => {
    const bytes = await readFile(file);
    const isMp3 =
      bytes.subarray(0, 3).toString() === "ID3" ||
      (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
    if (!/\.mp3$/i.test(file) || !isMp3 || bytes.length > 30 * 1024 * 1024)
      throw new Error("请提供 30 MB 以内的 MP3：" + path.basename(file));
    const id = createHash("sha256").update(bytes).digest("hex").slice(0, 24);
    const name = path
      .basename(file, path.extname(file))
      .replace(/｜July - 001 - In Love｜July$/, "");
    return { id, name, bytes };
  }),
);
for (const { id, name, bytes } of imports) {
  await writeFile(path.join(directory, id + ".mp3"), bytes, { mode: 0o600 });
  if (!tracks.some((t) => t.id === id)) tracks.push({ id, name });
}
const temporary = path.join(directory, ".index-" + randomUUID());
await writeFile(temporary, JSON.stringify(tracks, null, 2) + "\n", {
  mode: 0o600,
});
await rename(temporary, path.join(directory, "index.json"));
console.log(
  JSON.stringify({ imported: imports.length, total: tracks.length, directory }),
);
