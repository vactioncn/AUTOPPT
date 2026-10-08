import test from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ts from "typescript";
import { launchBrowser } from "./helpers/browser.mjs";

test(
  "two browser tabs share a persisted identity; lost responses and readiness changes replay one paid task",
  { skip: process.env.BROWSER_TEST !== "1", timeout: 60000 },
  async (t) => {
    const dir = await mkdtemp(path.join(tmpdir(), "autoppt-identity-tabs-"));
    let child, browser, base;
    const start = async () => {
      child = fork("tests/helpers/paid-server.mjs", [], {
        silent: true,
        env: {
          PATH: process.env.PATH,
          AUTOPPT_DATA_DIR: dir,
          NODE_ENV: "test",
        },
      });
      const [ready] = await once(child, "message", {
        signal: AbortSignal.timeout(10000),
      });
      base = `http://127.0.0.1:${ready.port}`;
    };
    const stop = async () => {
      const end = once(child, "exit");
      child.kill();
      await end;
    };
    t.after(async () => {
      await browser?.close();
      if (child?.exitCode === null) await stop();
      await rm(dir, { recursive: true, force: true });
    });
    await start();
    browser = await launchBrowser(t);
    if (!browser) return;
    const context = await browser.newContext();
    const library = (
      await readFile("shared/paid-operations.mjs", "utf8")
    ).replace(/export /g, "");
    const client = ts
      .transpile(
        (await readFile("src/paid-request.ts", "utf8")).replace(
          /^import[^\n]+\n/,
          "",
        ),
        { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
      )
      .replace(/export /g, "");
    const script =
      library +
      "\n" +
      client +
      "\nwindow.preparePaidRequest=preparePaidRequest;";
    const pages = await Promise.all([context.newPage(), context.newPage()]);
    for (const page of pages) {
      await page.goto(base + "/api/request-scope");
      await page.addScriptTag({ content: script });
    }
    const prepare = (page) =>
      page.evaluate(async () => {
        window.options = {
          method: "POST",
          body: JSON.stringify({ value: "合成讲稿" }),
        };
        window.identity = await window.preparePaidRequest(
          "/design-options/palette",
          window.options,
        );
        return window.options.headers.get("X-AutoPPT-Request-Id");
      });
    const ids = await Promise.all(pages.map(prepare));
    assert.equal(ids[0], ids[1]);
    const send = (page) =>
      page.evaluate(async () => {
        const r = await fetch("/api/design-options/palette", window.options);
        return { status: r.status, data: await r.json() };
      });
    const responses = await Promise.all(pages.map(send));
    assert.deepEqual(responses.map((x) => x.status).sort(), [202, 409]);
    // Do not mark acceptance: simulate callers that never receive the successful body.
    await pages[0].reload();
    await pages[0].addScriptTag({ content: script });
    assert.equal(await prepare(pages[0]), ids[0]);
    await fetch(base + "/test/readiness", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ready: false }),
    });
    assert.equal((await send(pages[0])).status, 202);
    const state = await (await fetch(base + "/test/state")).json();
    assert.equal(state.jobs.length, 1);
    assert.equal(state.usage.length, 1);
    await pages[0].evaluate(() => window.identity.accepted());
    const persisted = await pages[1].evaluate(() =>
      JSON.stringify(localStorage),
    );
    assert(!persisted.includes("合成讲稿"));
    assert(!persisted.includes("synthetic.invalid"));
    assert.equal(await prepare(pages[1]), ids[0]);
    assert.equal(
      await pages[1].evaluate(() => window.identity.wasComplete),
      true,
    );
    const multipartIds = await pages[1].evaluate(async () => {
      const prepare = async (first) => {
        const body = new FormData();
        body.append(
          "images",
          new File([first], "first.png", { type: "image/png" }),
        );
        body.append(
          "images",
          new File(["same final image"], "last.png", { type: "image/png" }),
        );
        const options = { method: "POST", body };
        await window.preparePaidRequest("/styles", options);
        return options.headers.get("X-AutoPPT-Request-Id");
      };
      return [
        await prepare("first content"),
        await prepare("different first content"),
        await prepare("first content"),
      ];
    });
    assert.notEqual(multipartIds[0], multipartIds[1]);
    assert.equal(multipartIds[0], multipartIds[2]);
    let posts = 0;
    pages[1].on("request", (r) => {
      if (r.method() === "POST") posts++;
    });
    pages[1].once("dialog", (dialog) => dialog.dismiss());
    assert.equal(
      await pages[1].evaluate(() => window.identity.retry(true)),
      false,
    );
    assert.equal(posts, 0);
  },
);
