import {
  openSync,
  closeSync,
  writeFileSync,
  readFileSync,
  unlinkSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
function processStart(pid) {
  try {
    if (process.platform === "linux") {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19];
    }
    return execFileSync("/bin/ps", ["-o", "lstart=", "-p", String(pid)], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}
export function isLocked(file) {
  let value;
  try {
    value = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    return e.code !== "ENOENT";
  }
  if (!Number.isSafeInteger(value.pid) || value.pid < 1 || !value.started)
    return true;
  try {
    process.kill(value.pid, 0);
  } catch (e) {
    if (e.code === "ESRCH") return false;
    return true;
  }
  const current = processStart(value.pid);
  return !current || current === value.started;
}
export function acquireLock(file) {
  const value = JSON.stringify({
    pid: process.pid,
    started: processStart(process.pid),
  });
  try {
    const fd = openSync(file, "wx", 0o600);
    writeFileSync(fd, value);
    closeSync(fd);
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
    if (isLocked(file))
      throw new Error("该线上数据目录已有服务运行，请勿重复启动。");
    unlinkSync(file);
    return acquireLock(file);
  }
  process.once("exit", () => {
    try {
      if (readFileSync(file, "utf8") === value) unlinkSync(file);
    } catch {}
  });
}
