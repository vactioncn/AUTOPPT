import test from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";

test(
  "desktop loopback backend uses a random port and private token, with no account login",
  { timeout: 20000 },
  async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "autoppt-desktop-"));
    const child = fork("server/index.mjs", [], {
      silent: true,
      env: {
        ...process.env,
        NODE_ENV: "production",
        AUTOPPT_DATA_DIR: dir,
        PORT: "0",
        AUTOPPT_DESKTOP_TOKEN: "desktop-test-token",
      },
    });
    try {
      const [message] = await once(child, "message");
      assert.equal(message.type, "ready");
      assert.ok(message.port > 0);
      const url = `http://127.0.0.1:${message.port}`;
      assert.equal((await fetch(url + "/api/bootstrap")).status, 403);
      const headers = { "X-AutoPPT-Desktop": "desktop-test-token" };
      assert.deepEqual(
        await (await fetch(url + "/api/account", { headers })).json(),
        { hosted: false, user: null },
      );
      const response = await fetch(url + "/api/bootstrap", {
        headers: { ...headers, Origin: url },
      });
      assert.equal(response.status, 200);
      const workspace = await response.json();
      assert.equal(workspace.projects.length, 0);
      assert.ok(workspace.styles.some((s) => s.name === "克制儿童摄影杂志风"));
      assert.equal(
        (
          await fetch(url + "/api/bootstrap", {
            headers: { ...headers, Origin: "https://example.com" },
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await fetch(url + "/api/settings", {
            method: "PUT",
            headers: {
              ...headers,
              Origin: url,
              "Content-Type": "application/json",
            },
            body: "{}",
          })
        ).status,
        200,
      );
      const exited = once(child, "exit");
      child.disconnect();
      await exited;
    } finally {
      child.kill();
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
