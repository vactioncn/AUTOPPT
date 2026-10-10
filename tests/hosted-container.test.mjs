import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
const exec = promisify(execFile);
const docker = (...args) => exec("docker", args, { maxBuffer: 1024 * 1024 });
test(
  "Linux container runs as non-root, persists across restarts and restores a read-only volume backup",
  { skip: process.env.HOSTED_DOCKER_TEST !== "1", timeout: 120000 },
  async () => {
    const name = "autoppt-test-" + randomUUID();
    const volume = name + "-data";
    const restoreVolume = name + "-restore";
    const image =
      process.env.HOSTED_TEST_IMAGE || "autoppt-hosted:verification";
    const dir = mkdtempSync(path.join(tmpdir(), "autoppt-container-"));
    const password = "Container-fixture-" + randomUUID();
    const secret = path.join(dir, "password");
    writeFileSync(secret, password, { mode: 0o444 });
    const run = (dataVolume) =>
      docker(
        "run",
        "-d",
        "--name",
        name,
        "--init",
        "-p",
        "127.0.0.1::4318",
        "-e",
        "AUTOPPT_ADMIN_PASSWORD_FILE=/run/secrets/password",
        "-e",
        "AUTOPPT_PUBLIC_URL=http://127.0.0.1:4318",
        "--mount",
        `type=bind,source=${secret},target=/run/secrets/password,readonly`,
        "--mount",
        `type=volume,source=${dataVolume},target=/data`,
        image,
      );
    try {
      await run(volume);
      const port = (await docker("port", name, "4318/tcp")).stdout
        .trim()
        .split(":")
        .pop();
      let base = `http://127.0.0.1:${port}`;
      const ready = async () => {
        base =
          "http://127.0.0.1:" +
          (await docker("port", name, "4318/tcp")).stdout
            .trim()
            .split(":")
            .pop();
        for (let i = 0; i < 100; i++) {
          try {
            if ((await fetch(base + "/api/health")).ok) return;
          } catch {}
          await new Promise((r) => setTimeout(r, 100));
        }
        const logs = await docker("logs", name);
        throw new Error(logs.stdout + logs.stderr);
      };
      await ready();
      assert.equal(
        (await docker("exec", name, "id", "-u")).stdout.trim(),
        "1000",
      );
      const login = await fetch(base + "/api/account/login", {
        method: "POST",
        headers: {
          Origin: "http://127.0.0.1:4318",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: "admin", password }),
      });
      assert.equal(login.status, 200);
      const cookie = login.headers.get("set-cookie").split(";")[0];
      const boot = await fetch(base + "/api/bootstrap", {
        headers: { Cookie: cookie },
      });
      assert.equal(boot.status, 200);
      const data = await boot.json();
      assert(data.styles.some((s) => s.name === "克制儿童摄影杂志风"));
      const created = await fetch(base + "/api/projects", {
        method: "POST",
        headers: {
          Origin: "http://127.0.0.1:4318",
          Cookie: cookie,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ title: "Container backup preserved project" }),
      });
      assert.equal(created.status, 201);
      const project = await created.json();
      await docker("restart", name);
      await ready();
      const account = await (
        await fetch(base + "/api/account", { headers: { Cookie: cookie } })
      ).json();
      assert.equal(account.user.name, "admin");
      assert.equal(account.user.available, 20);
      await docker("kill", name);
      await docker("start", name);
      await ready();
      assert.equal(
        (
          await (
            await fetch(base + "/api/account", { headers: { Cookie: cookie } })
          ).json()
        ).user.name,
        "admin",
      );
      await docker("stop", name);
      await docker(
        "run",
        "--rm",
        "--user",
        "root",
        "--mount",
        `type=volume,source=${volume},target=/data,readonly`,
        "--mount",
        `type=bind,source=${dir},target=/backup`,
        image,
        "node",
        "scripts/hosted-backup.mjs",
        "backup",
        "/data",
        "/backup/verified.tar.gz",
      );
      await docker("volume", "create", restoreVolume);
      await docker(
        "run",
        "--rm",
        "--user",
        "root",
        "--mount",
        `type=volume,source=${restoreVolume},target=/data`,
        "--mount",
        `type=bind,source=${dir},target=/backup,readonly`,
        image,
        "node",
        "scripts/hosted-backup.mjs",
        "restore",
        "/data",
        "/backup/verified.tar.gz",
      );
      await docker("rm", name);
      await run(restoreVolume);
      await ready();
      const restored = await fetch(base + `/api/projects/${project.id}`, {
        headers: { Cookie: cookie },
      });
      assert.equal(restored.status, 200);
      assert.equal((await restored.json()).title, project.title);
      assert.equal(
        (
          await (
            await fetch(base + "/api/account", { headers: { Cookie: cookie } })
          ).json()
        ).user.available,
        20,
      );
    } finally {
      await docker("rm", "-f", name).catch(() => {});
      await docker("volume", "rm", volume).catch(() => {});
      await docker("volume", "rm", restoreVolume).catch(() => {});
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
