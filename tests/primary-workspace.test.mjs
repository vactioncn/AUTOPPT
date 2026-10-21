import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  ensurePrimaryWorkspace,
  usePrimaryWorkspace,
} from "../scripts/primary-workspace.mjs";

const config = {
  version: 1,
  url: "http://localhost:51927",
  container: "main",
  volume: "saved-data",
};
const inspected = (running = true, volume = config.volume) => ({
  State: { Running: running },
  Mounts: [{ Type: "volume", Name: volume, Destination: "/data" }],
  HostConfig: {
    PortBindings: { "4318/tcp": [{ HostPort: "51927", HostIp: "127.0.0.1" }] },
  },
});
const healthy = async () => ({
  ok: true,
  json: async () => ({ app: "AutoPPT", hosted: true, ok: true }),
});

test("configured launches reuse the same running data volume", async () => {
  const calls = [];
  const url = await ensurePrimaryWorkspace(config, {
    run: async (command, args) => {
      calls.push([command, ...args]);
      return { stdout: JSON.stringify([inspected()]) };
    },
    request: healthy,
  });
  assert.equal(url, config.url);
  assert.deepEqual(calls, [["docker", "inspect", "main"]]);
});
test("a stopped primary starts its existing container, never creates a replacement", async () => {
  const calls = [];
  await ensurePrimaryWorkspace(config, {
    run: async (_, args) => {
      calls.push(args);
      return { stdout: JSON.stringify([inspected(false)]) };
    },
    request: healthy,
  });
  assert.deepEqual(calls, [
    ["inspect", "main"],
    ["start", "main"],
  ]);
});
test("missing containers and changed data volumes fail closed", async () => {
  await assert.rejects(
    ensurePrimaryWorkspace(config, {
      run: async () => {
        throw new Error("missing");
      },
    }),
    /不会新建空工作区/,
  );
  const calls = [];
  await assert.rejects(
    ensurePrimaryWorkspace(config, {
      run: async (_, args) => {
        calls.push(args);
        return { stdout: JSON.stringify([inspected(false, "empty-data")]) };
      },
    }),
    /数据卷或端口/,
  );
  assert.deepEqual(calls, [["inspect", "main"]]);
});
test("unhealthy primary never falls back to another environment", async () => {
  const urls = [];
  await assert.rejects(
    ensurePrimaryWorkspace(config, {
      run: async () => ({ stdout: JSON.stringify([inspected()]) }),
      request: async (url) => {
        urls.push(url);
        throw new Error("offline");
      },
      pause: async () => {},
    }),
    /未创建替代环境/,
  );
  assert.deepEqual([...new Set(urls)], [config.url + "/api/health"]);
});
test("fresh checkouts without a primary selection retain the normal startup path", async () => {
  const folder = await mkdtemp(path.join(tmpdir(), "autoppt-primary-"));
  try {
    assert.equal(await usePrimaryWorkspace(folder), false);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
