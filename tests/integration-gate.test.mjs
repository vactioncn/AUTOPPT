import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  runIntegration,
  integrationEnvironment,
  integrationTests,
} from "../scripts/check-integration.mjs";
test("integration gate enables both browser gates and mandatory media stress without a silent browser skip", () => {
  assert.equal(
    JSON.parse(readFileSync("package.json")).scripts["check:integration"],
    "node scripts/check-integration.mjs",
  );
  for (const key of [
    "BROWSER_TEST",
    "PRESENTER_BROWSER_TEST",
    "REQUIRE_BROWSER",
    "MEDIA_STRESS_TEST",
    "LARGE_HTML_EXPORT_TEST",
  ])
    assert.equal(integrationEnvironment[key], "1");
  for (const name of [
    "avatar-presenter-browser",
    "feedback-governance-browser",
    "avatar-presenter",
    "feedback-governance",
    "portable-project",
    "media-stress",
  ])
    assert(integrationTests.includes(`tests/${name}.test.mjs`));
  assert.match(
    readFileSync("tests/helpers/browser.mjs", "utf8"),
    /REQUIRE_BROWSER[\s\S]*throw new Error/,
  );
});

test("the executed gate passes all required flags to the installed Node without npm exec downloads", () => {
  const calls = [];
  assert.equal(
    runIntegration((command, args, options) => {
      calls.push({ command, args, options });
      return { status: 0 };
    }),
    0,
  );
  assert.equal(calls.length, 2);
  assert.equal(calls[1].command, process.execPath);
  assert.deepEqual(calls[1].args, [
    "--test",
    "--test-concurrency=1",
    ...integrationTests,
  ]);
  for (const call of calls)
    for (const [key, value] of Object.entries(integrationEnvironment))
      assert.equal(call.options.env[key], value);
});
