import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { once } from "node:events";
import express from "express";
import { load } from "cheerio";
import { chromium } from "playwright-core";
import {
  prepareIntroduction,
  validateTarget,
  verifyIntroduction,
} from "../scripts/deploy-intro.mjs";

const root = path.resolve(import.meta.dirname, "..");

function fixture(t) {
  const temp = mkdtempSync(path.join(tmpdir(), "autoppt-deploy-test-"));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  return temp;
}

test("deployment rejects bucket roots, traversal, URLs, flags and ambiguous directory names", () => {
  for (const target of [
    undefined,
    "",
    "/",
    ".",
    "..",
    "../site",
    "a/b",
    "a\\b",
    "oss://turing-show",
    "https://example.com",
    "--delete",
    "a?b",
    "a b",
    "a\nb",
    "autoppt\n",
    "A",
    "a".repeat(64),
  ])
    assert.throws(() => validateTarget(target));
  for (const target of ["autoppt", "web01", "report-01", "site_2"])
    assert.equal(validateTarget(target), target);
});

test("standalone payload contains only public intro files and resolves inside the deployment prefix", (t) => {
  const temp = fixture(t);
  const output = path.join(temp, "site");
  const files = prepareIntroduction(output);
  assert.equal(files.length, 20);
  assert.deepEqual(
    readdirSync(output, { recursive: true })
      .filter((p) => !["screenshots", "artwork"].includes(p))
      .sort(),
    files,
  );
  assert(
    files.every(
      (p) => !/(^\.|api|server|settings\.json|manifest|\.map$)/.test(p),
    ),
  );
  const $ = load(readFileSync(path.join(output, "index.html"), "utf8"));
  for (const el of $("[src], [href], [data-zoom]").toArray()) {
    for (const attr of ["src", "href", "data-zoom"]) {
      const value = $(el).attr(attr);
      if (!value || value.startsWith("#") || value.startsWith("https://"))
        continue;
      const resolved = new URL(value, "https://show.turing.art/autoppt/");
      assert(resolved.pathname.startsWith("/autoppt/"), value);
      assert(
        files.includes(resolved.pathname.slice("/autoppt/".length)),
        value,
      );
    }
  }
  assert.equal(
    $("#open-workspace").attr("href"),
    "https://github.com/vactioncn/AUTOPPT",
  );
  assert.throws(() => prepareIntroduction(output), /必须为空/);
});

test("dry run invokes OSS on isolated payload, never deletes, cleans up and propagates upload failure", (t) => {
  const temp = fixture(t);
  const config = path.join(temp, "config");
  const binary = path.join(temp, "ossutil");
  const log = path.join(temp, "invocation.json");
  writeFileSync(config, "[default]\n");
  writeFileSync(
    binary,
    `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.writeFileSync(process.env.TEST_OSS_LOG, JSON.stringify({args, files: fs.readdirSync(args[1], {recursive: true})}));
process.exit(Number(process.env.TEST_OSS_EXIT || 0));
`,
    { mode: 0o755 },
  );
  const invoke = (target, exit = "0") =>
    spawnSync(
      process.execPath,
      [path.join(root, "scripts/deploy-intro.mjs"), target, "--dry-run"],
      {
        cwd: temp,
        encoding: "utf8",
        env: {
          ...process.env,
          OSSUTIL_BIN: binary,
          OSSUTIL_CONFIG_FILE: config,
          TEST_OSS_LOG: log,
          TEST_OSS_EXIT: exit,
        },
      },
    );
  assert.notEqual(invoke("../bad").status, 0);
  assert(!existsSync(log));
  const result = invoke("autoppt-test");
  assert.equal(result.status, 0, result.stderr);
  const { args, files } = JSON.parse(readFileSync(log, "utf8"));
  assert.equal(args[0], "sync");
  assert.equal(args[2], "oss://turing-show/autoppt-test/");
  assert(args.includes("--dry-run"));
  assert(!args.includes("--delete"));
  assert(files.includes("index.html") && !files.includes("package.json"));
  assert(!existsSync(args[1]));
  assert.match(result.stdout, /未上传或删除/);
  assert.doesNotMatch(result.stdout, /部署成功/);
  const failure = invoke("autoppt-test", "7");
  assert.notEqual(failure.status, 0);
  assert.match(failure.stderr, /退出码 7/);
  assert.doesNotMatch(failure.stdout, /部署成功/);
});

test("public verification checks directory entry, all assets and stale content", async (t) => {
  const output = path.join(fixture(t), "site");
  const files = prepareIntroduction(output);
  const app = express();
  app.use("/autoppt", express.static(output));
  app.get("/stale/*path", (req, res) => res.type("html").send("old page"));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.closeAllConnections();
    return new Promise((resolve) => server.close(resolve));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  await verifyIntroduction(`${base}/autoppt/`, output, files);
  await assert.rejects(
    verifyIntroduction(`${base}/missing/`, output, files),
    /HTTP 404/,
  );
  await assert.rejects(
    verifyIntroduction(`${base}/stale/index.html`, output, files),
    /内容尚未/,
  );
});

test(
  "deployed intro works at a subdirectory on desktop and mobile",
  { skip: !process.env.INTRO_BROWSER_TEST, timeout: 60000 },
  async (t) => {
    const temp = fixture(t);
    const output = path.join(temp, "site");
    prepareIntroduction(output);
    const app = express();
    app.use("/autoppt", express.static(output));
    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    t.after(() => {
      server.closeAllConnections();
      return new Promise((resolve) => server.close(resolve));
    });
    const browser = await chromium.launch({
      executablePath:
        process.env.CHROMIUM_EXECUTABLE ||
        (process.platform === "darwin"
          ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
          : undefined),
      headless: true,
    });
    t.after(() => browser.close());
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("response", (response) => {
      if (response.status() >= 400) errors.push(response.url());
    });
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`http://127.0.0.1:${server.address().port}/autoppt/`);
      await page.locator("img[src]").evaluateAll((images) => {
        for (const img of images) img.loading = "eager";
        return Promise.all(images.map((img) => img.decode()));
      });
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      );
      await page.locator('[data-zoom="screenshots/export.webp"]').click();
      assert(await page.getByRole("dialog").isVisible());
      await page.getByRole("button", { name: "关闭截图" }).click();
      assert.equal(
        await page.locator("#open-workspace").getAttribute("href"),
        "https://github.com/vactioncn/AUTOPPT",
      );
      assert(
        (
          await (
            await page.request.get(
              `http://127.0.0.1:${server.address().port}/autoppt/guide.md`,
            )
          ).text()
        ).includes("逐字稿"),
      );
    }
    assert.deepEqual(errors, []);
  },
);
