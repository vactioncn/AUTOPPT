import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";

export async function verifyMacApp(appPath) {
  const root = path.join(appPath, "Contents/Resources/app");
  for (const privateName of [".local", ".hosted", ".env", "deploy", "tests"])
    assert(
      !existsSync(path.join(root, privateName)),
      `不应打包 ${privateName}`,
    );
  const temp = mkdtempSync(path.join(os.tmpdir(), "autoppt-package-"));
  const child = fork(path.join(root, "server/index.mjs"), [], {
    execPath: path.join(appPath, "Contents/MacOS/AutoPPT"),
    execArgv: [],
    cwd: root,
    silent: true,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      TMPDIR: os.tmpdir(),
      ELECTRON_RUN_AS_NODE: "1",
      NODE_ENV: "production",
      PORT: "0",
      AUTOPPT_DATA_DIR: temp,
      AUTOPPT_DESKTOP_TOKEN: "package-verification-only",
    },
  });
  let errors = "";
  child.stderr.on("data", (chunk) => {
    errors += chunk;
  });
  let timer;
  try {
    const ready = new Promise((resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error("App 内置后端启动超时")),
        20000,
      );
      child.once("error", reject);
      child.once("exit", (code) =>
        reject(new Error(`App 内置后端退出 ${code}: ${errors}`)),
      );
      child.once("message", resolve);
    });
    const { port } = await ready;
    const url = `http://127.0.0.1:${port}`;
    const headers = { "X-AutoPPT-Desktop": "package-verification-only" };
    assert.equal((await fetch(url)).status, 403);
    const data = await (
      await fetch(url + "/api/bootstrap", { headers })
    ).json();
    assert.equal(data.projects.length, 0);
    assert.ok(data.styles.some((s) => s.name === "克制儿童摄影杂志风"));
    assert.equal((await fetch(url, { headers })).status, 200);
    assert.equal(
      (await (await fetch(url + "/api/account", { headers })).json()).hosted,
      false,
    );
    assert.equal(
      (await (await fetch(url + "/api/desktop/status", { headers })).json())
        .activeJobs,
      0,
    );
    console.log(
      "安装包验证通过：自带运行环境、内置风格、免登录、独立空工作区、私有本机接口。",
    );
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill();
      await exited;
    }
    rmSync(temp, { recursive: true, force: true });
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename)
  await verifyMacApp(path.resolve(process.argv[2]));
