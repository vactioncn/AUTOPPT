import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import express from "express";

test("presenter credentials remain local, masked, and never return API credentials", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "autoppt-heygen-settings-"));
  process.env.AUTOPPT_DATA_DIR = dir;
  const store = await import("../server/store.mjs");
  const settings = await import("../server/presenter/settings.mjs");
  t.after(() => {
    store.db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const fake = "synthetic-heygen-credential-for-tests";
  assert.equal(settings.publicPresenterSettings().hasKey, false);
  assert.equal(
    (
      await settings.testPresenterConnection(() =>
        assert.fail("No request without credentials"),
      )
    ).ok,
    false,
  );
  const saved = settings.savePresenterSettings({
    apiKey: fake,
    baseUrl: "https://untrusted.invalid",
  });
  assert.equal(saved.hasKey, true);
  assert.equal(saved.generationAvailable, true);
  assert.equal(JSON.stringify(saved).includes(fake), false);
  const file = path.join(dir, "presenter-settings.json");
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { apiKey: fake });
  settings.savePresenterSettings({ apiKey: "" });
  assert.equal(settings.presenterSettings().apiKey, fake);
  for (const apiKey of [[], {}, 123, "invalid value", "bad\nvalue"]) {
    assert.throws(() => settings.savePresenterSettings({ apiKey }));
    assert.equal(settings.presenterSettings().apiKey, fake);
  }
  assert.throws(() => settings.savePresenterSettings({ clearKey: "false" }));
  let requests = 0;
  const checked = await settings.testPresenterConnection(
    async (url, options) => {
      requests++;
      assert.equal(url, "https://api.heygen.com/v3/users/me");
      assert.equal(options.method, "GET");
      assert.equal(options.headers["X-Api-Key"], fake);
      assert.equal(options.redirect, "error");
      assert.equal(options.body, undefined);
      return Response.json({
        data: {
          username: "PRIVATE_NAME",
          email: "PRIVATE_EMAIL",
          wallet: { remaining_balance: 12 },
        },
      });
    },
  );
  assert.equal(requests, 1);
  assert.equal(checked.ok, true);
  assert.doesNotMatch(
    JSON.stringify(checked),
    /PRIVATE|remaining_balance|synthetic/,
  );
  for (const status of [301, 401, 403, 429, 500]) {
    const result = await settings.testPresenterConnection(
      async () => new Response(fake, { status }),
    );
    assert.equal(result.ok, false);
    assert.equal(JSON.stringify(result).includes(fake), false);
  }
  for (const response of [
    Response.json({ error: fake }),
    new Response("bad json"),
    Response.json({ data: [] }),
  ])
    assert.equal(
      (await settings.testPresenterConnection(async () => response)).ok,
      false,
    );
  assert.equal(
    (
      await settings.testPresenterConnection(async () => {
        throw new Error(fake);
      })
    ).ok,
    false,
  );

  const app = express();
  app.use(express.json());
  settings.registerPresenterSettings(app);
  const server = app.listen(0, "127.0.0.1");
  t.after(() => server.close());
  await once(server, "listening");
  const url = `http://127.0.0.1:${server.address().port}/api/settings/presenter`;
  assert.equal(
    JSON.stringify(await (await fetch(url)).json()).includes(fake),
    false,
  );
  const cleared = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clearKey: true }),
  });
  assert.equal((await cleared.json()).hasKey, false);
  assert.equal(JSON.parse(readFileSync(file, "utf8")).apiKey, "");
  process.env.AUTOPPT_WORKER_TOKEN = "synthetic-worker";
  try {
    for (const [route, method] of [
      [url, "GET"],
      [url, "PUT"],
      [url + "/test", "POST"],
    ])
      assert.equal((await fetch(route, { method })).status, 403);
  } finally {
    delete process.env.AUTOPPT_WORKER_TOKEN;
  }
});
