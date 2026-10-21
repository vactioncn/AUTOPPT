import { readFile } from "node:fs/promises";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

const execute = promisify(execFile);

export function validatePrimaryWorkspace(config) {
  const url = new URL(config.url);
  if (
    config.version !== 1 ||
    url.protocol !== "http:" ||
    !["localhost", "127.0.0.1"].includes(url.hostname) ||
    !url.port ||
    url.pathname !== "/" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_.-]+$/.test(config.container || "") ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_.-]+$/.test(config.volume || "")
  )
    throw new Error("主工作区配置无效；不会创建替代工作区。");
  return { ...config, url: url.origin, port: url.port };
}

export async function ensurePrimaryWorkspace(
  config,
  {
    run = execute,
    request = fetch,
    pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  } = {},
) {
  const selected = validatePrimaryWorkspace(config);
  let container;
  try {
    const result = await run("docker", ["inspect", selected.container]);
    [container] = JSON.parse(result.stdout);
  } catch {
    throw new Error(
      "无法读取已选定的主工作区。请先启动 Docker；不会新建空工作区。",
    );
  }
  const correctVolume = container?.Mounts?.some(
    (mount) =>
      mount.Type === "volume" &&
      mount.Name === selected.volume &&
      mount.Destination === "/data",
  );
  const correctPort = container?.HostConfig?.PortBindings?.["4318/tcp"]?.some(
    (binding) =>
      binding.HostPort === selected.port && binding.HostIp === "127.0.0.1",
  );
  if (!correctVolume || !correctPort)
    throw new Error("主工作区的数据卷或端口已变化；请先核对，未启动其他环境。");
  if (!container.State.Running)
    await run("docker", ["start", selected.container]);
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const response = await request(selected.url + "/api/health", {
        signal: AbortSignal.timeout(1500),
      });
      const health = await response.json();
      if (response.ok && health.app === "AutoPPT" && health.hosted && health.ok)
        return selected.url;
    } catch {
      /* Keep checking this same workspace; never switch to a fresh one. */
    }
    await pause(500);
  }
  throw new Error(
    `主工作区暂未就绪：${selected.url}。数据卷保持不变，未创建替代环境。`,
  );
}

export async function usePrimaryWorkspace(root) {
  let raw;
  try {
    raw = await readFile(
      path.join(root, ".local", "primary-workspace.json"),
      "utf8",
    );
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
  const url = await ensurePrimaryWorkspace(JSON.parse(raw));
  console.log(
    `讲好主工作区：${url}/#styles\n沿用现有账号、模型配置、风格和项目。`,
  );
  if (process.platform === "darwin" && process.env.AUTOPPT_NO_OPEN !== "1")
    spawn("open", [url + "/#styles"], {
      stdio: "ignore",
      detached: true,
    }).unref();
  return true;
}
