import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fork, spawnSync } from "node:child_process";
import { once } from "node:events";
import { STYLE_SHOWCASE } from "../shared/style-showcase.mjs";

test(
  "local public site, help and legacy links share the release and public media without model calls",
  { timeout: 30000 },
  async () => {
    const data = mkdtempSync(path.join(tmpdir(), "jianghao-site-"));
    const child = fork(new URL("../server/index.mjs", import.meta.url), [], {
      env: {
        ...process.env,
        NODE_ENV: "production",
        PORT: "0",
        AUTOPPT_DATA_DIR: data,
        AUTOPPT_WORKER_TOKEN: "",
        AUTOPPT_DESKTOP_TOKEN: "",
      },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    let logs = "";
    child.stderr.on("data", (s) => {
      logs += s;
    });
    try {
      const ready = await new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("server startup timeout: " + logs)),
          20000,
        );
        child.on("message", (value) => {
          if (value.type === "ready") {
            clearTimeout(timer);
            resolve(value);
          }
        });
        child.once("exit", () => {
          clearTimeout(timer);
          reject(new Error("server exited: " + logs));
        });
      });
      const base = `http://127.0.0.1:${ready.port}`;
      const expected = JSON.parse(
        readFileSync(new URL("../build-info.json", import.meta.url)),
      );
      let html;
      for (const route of ["/website", "/support", "/"]) {
        const response = await fetch(base + route);
        assert.equal(response.status, 200);
        assert.equal(
          response.headers.get("x-autoppt-release"),
          expected.gitSha,
        );
        const text = await response.text();
        assert.match(text, /id="root"/);
        if (html) assert.equal(text, html);
        html = text;
      }
      for (const [from, to] of [
        ["/intro", "/website"],
        ["/intro/", "/website"],
        ["/intro/index.html", "/website"],
        ["/intro/help.html", "/support"],
      ]) {
        const response = await fetch(base + from, { redirect: "manual" });
        assert.equal(response.status, 302);
        assert.equal(response.headers.get("location"), to);
      }
      const media = [
        "/brand/mark.svg",
        "/product-demo/jianghao-introduction.mp4",
        "/product-demo/讲好-产品介绍.pptx",
        ...STYLE_SHOWCASE.flatMap((style) =>
          style.pages.map((page) => `/style-showcase/${page.id}.webp`),
        ),
      ];
      for (const file of media) {
        const response = await fetch(base + file, { method: "HEAD" });
        assert.equal(response.status, 200, file);
        assert(
          !response.headers.get("content-type").includes("text/html"),
          file,
        );
        assert(Number(response.headers.get("content-length")) > 0, file);
      }
      const bootstrap = await fetch(base + "/api/bootstrap").then((r) =>
        r.json(),
      );
      assert.deepEqual(bootstrap.projects, []);
      assert.deepEqual(bootstrap.jobs, []);
    } finally {
      if (child.exitCode === null) {
        child.kill("SIGINT");
        await once(child, "exit");
      }
      rmSync(data, { recursive: true, force: true });
    }
  },
);

test("retired static publisher stops before uploading a divergent website", () => {
  const result = spawnSync(
    process.execPath,
    ["scripts/deploy-intro.mjs", "autoppt"],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /已停用/);
  assert.match(result.stderr, /不会上传/);
});
