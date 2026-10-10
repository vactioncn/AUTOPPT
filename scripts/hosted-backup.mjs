// Run only with the app service stopped. Archives include private user content.
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  createReadStream,
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  linkSync,
  rmSync,
  chmodSync,
  copyFileSync,
  mkdtempSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { isLocked } from "../server/hosted/process-lock.mjs";
async function digest(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}
function inspect(dir) {
  const databases = [path.join(dir, "accounts.sqlite")];
  if (!existsSync(databases[0]))
    throw new Error("没有线上账号数据库，请核对数据卷。");
  for (const user of existsSync(path.join(dir, "users"))
    ? readdirSync(path.join(dir, "users"), { withFileTypes: true })
    : []) {
    if (!user.isDirectory()) throw new Error("用户数据目录存在异常文件。");
    const file = path.join(dir, "users", user.name, "autoppt.sqlite");
    if (existsSync(file)) databases.push(file);
  }
  for (const file of databases) {
    // SQLite WAL readers may need a writable shared-memory file. Inspect a
    // complete temporary snapshot so a read-only source volume stays untouched.
    const snapshot = mkdtempSync(path.join(tmpdir(), "autoppt-db-check-"));
    let db;
    try {
      const copied = path.join(snapshot, "database.sqlite");
      for (const suffix of ["", "-wal", "-shm"]) {
        if (existsSync(file + suffix)) copyFileSync(file + suffix, copied + suffix);
      }
      db = new DatabaseSync(copied, { readOnly: true });
      if (
        db.prepare("PRAGMA quick_check").get().quick_check !== "ok" ||
        db.prepare("PRAGMA foreign_key_check").all().length
      )
        throw new Error("数据库完整性检查失败。");
    } finally {
      db?.close();
      rmSync(snapshot, { recursive: true, force: true });
    }
  }
  return databases.length;
}
function assertDirectory(dir) {
  if (!lstatSync(dir).isDirectory() || lstatSync(dir).isSymbolicLink())
    throw new Error("数据目录必须是普通目录。");
}
export async function backupHosted(dir, file) {
  dir = path.resolve(dir);
  file = path.resolve(file);
  assertDirectory(dir);
  if (file === dir || file.startsWith(dir + path.sep))
    throw new Error("备份必须写入数据目录之外。");
  if (existsSync(file) || existsSync(file + ".json"))
    throw new Error("备份文件已存在，不覆盖历史备份。");
  if (isLocked(path.join(dir, "hosted.lock")))
    throw new Error("请先等待任务结束并正常停止服务，再备份。");
  // Check every entry before archiving, so tar never follows an unexpected link.
  const check = (folder) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      if (!entry.isDirectory() && !entry.isFile())
        throw new Error("备份目录包含非普通文件。");
      if (entry.isDirectory()) check(path.join(folder, entry.name));
    }
  };
  check(dir);
  // A newly initialized server may have no user workspace yet.
  const count = inspect(dir);
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    execFileSync(
      "tar",
      ["-czf", temp, "--exclude=hosted.lock", "-C", dir, "."],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    chmodSync(temp, 0o600);
    const manifest = {
      format: "AutoPPT-hosted-backup",
      version: 1,
      createdAt: new Date().toISOString(),
      sha256: await digest(temp),
      databases: count,
    };
    writeFileSync(file + ".json", JSON.stringify(manifest, null, 2) + "\n", {
      flag: "wx",
      mode: 0o600,
    });
    linkSync(temp, file);
    return manifest;
  } finally {
    rmSync(temp, { force: true });
  }
}
export async function restoreHosted(dir, file) {
  dir = path.resolve(dir);
  file = path.resolve(file);
  assertDirectory(dir);
  if (readdirSync(dir).length)
    throw new Error("只允许恢复到新的空数据目录；不会覆盖已有项目。");
  const manifest = JSON.parse(readFileSync(file + ".json", "utf8"));
  if (
    manifest.format !== "AutoPPT-hosted-backup" ||
    manifest.version !== 1 ||
    manifest.sha256 !== (await digest(file))
  )
    throw new Error("备份校验失败；请保留原始压缩包和 JSON 校验记录。");
  const list = execFileSync("tar", ["-tzf", file], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  })
    .trim()
    .split("\n");
  if (
    list.some(
      (name) =>
        !name.startsWith("./") ||
        name.split("/").includes("..") ||
        name.includes("\\"),
    )
  )
    throw new Error("备份存在异常路径。");
  const types = execFileSync("tar", ["-tvzf", file], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  })
    .trim()
    .split("\n");
  if (types.some((line) => !["-", "d"].includes(line[0])))
    throw new Error("备份不接受链接或设备文件。");
  execFileSync("tar", ["-xzf", file, "-C", dir], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  // This utility runs as root during restore, then returns the volume to the app.
  if (process.getuid?.() === 0) execFileSync("chown", ["-R", "1000:1000", dir]);
  const databases = inspect(dir);
  if (databases !== manifest.databases)
    throw new Error("恢复后的数据库数量与备份记录不符。");
  return { databases, sha256: manifest.sha256 };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const [command, dir, file] = process.argv.slice(2);
  if (!["backup", "restore"].includes(command) || !dir || !file)
    throw new Error(
      "用法：node scripts/hosted-backup.mjs backup|restore <数据目录> <备份.tar.gz>",
    );
  console.log(
    JSON.stringify(
      await (command === "backup" ? backupHosted : restoreHosted)(dir, file),
    ),
  );
}
