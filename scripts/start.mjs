import { spawn } from "node:child_process";
import {
  mkdirSync,
  openSync,
  writeFileSync,
  existsSync,
  closeSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PORT || 4317),
  url = `http://127.0.0.1:${port}`;
const healthy = async () => {
  try {
    const r = await fetch(url + "/api/health", {
      signal: AbortSignal.timeout(1500),
    });
    return (await r.json()).app === "AutoPPT";
  } catch {
    return false;
  }
};
const browse = () => {
  if (process.platform === "darwin" && process.env.AUTOPPT_NO_OPEN !== "1")
    spawn("open", [url], { stdio: "ignore", detached: true }).unref();
};
if (await healthy()) {
  console.log(`AutoPPT 已在运行：${url}`);
  browse();
  process.exit(0);
}
if (!existsSync(path.join(root, "dist", "index.html"))) {
  console.error("请先在项目目录运行 npm install 和 npm run build。");
  process.exit(1);
}
mkdirSync(path.join(root, ".local"), { recursive: true, mode: 0o700 });
const logPath = path.join(root, ".local", "server.log");
const log = openSync(logPath, "a", 0o600);
const child = spawn(process.execPath, ["server/index.mjs"], {
  cwd: root,
  env: { ...process.env, NODE_ENV: "production", PORT: String(port) },
  stdio: ["ignore", log, log],
  detached: true,
});
child.on("error", (e) => {
  console.error(e.message);
  process.exitCode = 1;
});
child.unref();
closeSync(log);
writeFileSync(path.join(root, ".local", "server.pid"), String(child.pid));
for (let i = 0; i < 50; i++) {
  await new Promise((r) => setTimeout(r, 200));
  if (await healthy()) {
    console.log(
      `AutoPPT 已启动：${url}\n项目数据：${path.join(root, ".local")}\n运行日志：${logPath}`,
    );
    browse();
    process.exit(0);
  }
}
console.error(
  `启动未完成，请查看 ${logPath}。如果端口 ${port} 已被其他程序占用，请通过 PORT 设置其他端口。`,
);
process.exit(1);
