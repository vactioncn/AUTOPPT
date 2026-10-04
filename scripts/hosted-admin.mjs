// Offline recovery only. Passwords are read from a protected file, never argv.
import path from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { Accounts } from "../server/hosted/accounts.mjs";
import { isLocked, acquireLock } from "../server/hosted/process-lock.mjs";
const [command, dataDir, account, passwordFile] = process.argv.slice(2);
if (command !== "reset-password" || !dataDir || !account || !passwordFile) {
  console.error(
    "用法：node scripts/hosted-admin.mjs reset-password <线上数据目录> <管理员账号> <密码文件>",
  );
  process.exit(1);
}
const dir = path.resolve(dataDir);
if (!existsSync(path.join(dir, "accounts.sqlite")))
  throw new Error("指定目录没有线上账号数据库。");
const lock = path.join(dir, "hosted.lock");
if (isLocked(lock)) throw new Error("请先停止线上服务，再重置管理员密码。");
acquireLock(lock);
const a = new Accounts(dir);
try {
  const user = a.db
    .prepare("SELECT id FROM users WHERE name=? AND role='admin'")
    .get(account.trim().toLowerCase());
  if (!user) throw new Error("找不到指定管理员。");
  await a.resetPassword(
    "offline-maintainer",
    user.id,
    readFileSync(passwordFile, "utf8").trim(),
  );
  console.log("管理员密码已重置，原登录已撤销。");
} finally {
  a.db.close();
}
