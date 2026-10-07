import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import express from "express";
import { frontendRelease } from "../server/frontend-release.mjs";
import { readBuildInfo } from "../server/build-info.mjs";
const run = promisify(execFile);
const a = {
  appVersion: "0.2.0",
  gitSha: "a".repeat(40),
  buildTime: "2026-10-07T00:00:00.000Z",
  apiSchemaVersion: 1,
  runtimeMode: "local-browser",
};
const b = {
  ...a,
  gitSha: "b".repeat(40),
  buildTime: "2026-10-07T01:00:00.000Z",
};
function build(root, info) {
  const dist = path.join(root, "dist");
  rmSync(dist, { recursive: true, force: true });
  mkdirSync(path.join(dist, "assets"), { recursive: true });
  mkdirSync(path.join(dist, "intro"));
  writeFileSync(path.join(dist, "build-info.json"), JSON.stringify(info));
  writeFileSync(
    path.join(dist, "index.html"),
    `<!doctype html><h1>${info.gitSha}</h1><script src="/assets/${info.gitSha}.js"></script>`,
  );
  writeFileSync(
    path.join(dist, "assets", info.gitSha + ".js"),
    `window.release=${JSON.stringify(info.gitSha)};`,
  );
  writeFileSync(
    path.join(dist, "assets", "font.woff2"),
    Buffer.from([119, 79, 70, 50, 0, 1, 2, 3]),
  );
  writeFileSync(path.join(dist, "intro", "index.html"), "<h1>介绍</h1>");
  writeFileSync(path.join(dist, ".hidden"), "private fixture");
}
async function serve(release, backend) {
  const app = express();
  app.get("/api/bootstrap", (req, res) => res.json({ buildInfo: backend }));
  app.use(release.assets);
  app.get("/{*path}", release.index);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  return { server, url: "http://127.0.0.1:" + server.address().port };
}

test("running production UI keeps matching HTML, manifest, lazy chunks and fonts after dist is replaced or removed", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "autoppt-release-"));
  let first, second;
  try {
    build(root, a);
    first = await serve(frontendRelease(root, a), a);
    const before = await fetch(first.url + "/").then((r) => r.text());
    build(root, b);
    const response = await fetch(first.url + "/project/example");
    assert.equal(await response.text(), before);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("x-autoppt-release"), a.gitSha);
    assert.deepEqual(
      await fetch(first.url + "/build-info.json").then((r) => r.json()),
      a,
    );
    assert.equal(
      (await fetch(first.url + "/api/bootstrap").then((r) => r.json()))
        .buildInfo.gitSha,
      a.gitSha,
    );
    assert.match(
      await fetch(first.url + "/assets/" + a.gitSha + ".js").then((r) =>
        r.text(),
      ),
      new RegExp(a.gitSha),
    );
    const head = await fetch(first.url + "/assets/" + a.gitSha + ".js", {
      method: "HEAD",
    });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
    assert.match(head.headers.get("content-type"), /javascript/);
    second = await serve(frontendRelease(root, b), b);
    assert.match(
      await fetch(second.url + "/").then((r) => r.text()),
      new RegExp(b.gitSha),
    );
    rmSync(path.join(root, "dist"), { recursive: true });
    const font = await fetch(first.url + "/assets/font.woff2");
    assert.match(font.headers.get("content-type"), /font\/woff2/);
    assert.equal((await font.arrayBuffer()).byteLength, 8);
    assert.equal(
      await fetch(first.url + "/intro/").then((r) => r.text()),
      "<h1>介绍</h1>",
    );
    assert.equal(
      (await fetch(first.url + "/intro", { redirect: "manual" })).status,
      301,
    );
    assert.doesNotMatch(
      await fetch(first.url + "/.hidden").then((r) => r.text()),
      /private fixture/,
    );
    assert.equal((await fetch(first.url + "/%ZZ")).status, 400);
  } finally {
    for (const instance of [first, second])
      if (instance) await new Promise((r) => instance.server.close(r));
    rmSync(root, { recursive: true, force: true });
  }
});

test("production startup rejects mismatched, incomplete and symlinked frontend builds", () => {
  const root = mkdtempSync(path.join(tmpdir(), "autoppt-release-invalid-"));
  try {
    build(root, a);
    assert.throws(() => frontendRelease(root, b), /不一致/);
    rmSync(path.join(root, "dist", "index.html"));
    assert.throws(() => frontendRelease(root, a), /缺失入口/);
    build(root, a);
    writeFileSync(path.join(root, "private.txt"), "never serve");
    symlinkSync(
      path.join(root, "private.txt"),
      path.join(root, "dist", "private.txt"),
    );
    assert.throws(() => frontendRelease(root, a), /不支持的文件/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("background launcher refuses to claim an old live backend is current, without stopping or replacing it", async () => {
  const current = readBuildInfo();
  let backend = {
    ...current,
    gitSha: current.gitSha === "b".repeat(40) ? a.gitSha : b.gitSha,
  };
  let requests = 0;
  const app = express();
  app.get("/api/health", (req, res) => {
    requests++;
    res.json({ app: "AutoPPT", ok: true });
  });
  app.get("/api/bootstrap", (req, res) => res.json({ buildInfo: backend }));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const env = {
    ...process.env,
    PORT: String(server.address().port),
    AUTOPPT_NO_OPEN: "1",
  };
  try {
    await assert.rejects(
      run(process.execPath, ["scripts/start.mjs"], { env, timeout: 10000 }),
      (e) => e.code === 1 && /旧发布/.test(e.stderr),
    );
    assert.equal(requests, 1);
    backend = current;
    const ok = await run(process.execPath, ["scripts/start.mjs"], {
      env,
      timeout: 10000,
    });
    assert.match(ok.stdout, /已在运行/);
    assert.equal(requests, 2);
    backend = undefined;
    await assert.rejects(
      run(process.execPath, ["scripts/start.mjs"], { env, timeout: 10000 }),
      (e) => e.code === 1 && /旧发布/.test(e.stderr),
    );
    assert.equal(server.listening, true);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
