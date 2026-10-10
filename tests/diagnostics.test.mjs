import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
  readdirSync,
} from "node:fs";
import { execFileSync, fork } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import os from "node:os";
import { createBuildInfo, readBuildInfo } from "../server/build-info.mjs";
import { diagnostics } from "../server/diagnostics.mjs";
import {
  API_SCHEMA_VERSION,
  compareBuildInfo,
  dataRootLabels,
} from "../shared/diagnostics.mjs";

const a = "a".repeat(40),
  b = "b".repeat(40);
const info = {
  appVersion: "0.2.0",
  gitSha: a,
  buildTime: "2026-10-07T00:00:00.000Z",
  apiSchemaVersion: API_SCHEMA_VERSION,
  runtimeMode: "local-browser",
};

test("release build metadata is fixed across frontend and backend, not runtime HEAD/env", () => {
  const frozen = readBuildInfo();
  assert.deepEqual(
    JSON.parse(readFileSync("dist/build-info.json", "utf8")),
    frozen,
  );
  const js = readdirSync("dist/assets")
    .filter((n) => /^index-.*\.js$/.test(n))
    .map((n) => readFileSync(`dist/assets/${n}`, "utf8"))
    .join("\n");
  for (const key of ["gitSha", "buildTime", "appVersion"])
    assert.ok(js.includes(frozen[key]));
  const dir = mkdtempSync(path.join(os.tmpdir(), "autoppt-build-"));
  try {
    writeFileSync(path.join(dir, "package.json"), '{"version":"0.2.0"}');
    assert.equal(createBuildInfo({ root: dir, env: {} }).gitSha, "unknown");
    assert.throws(
      () => createBuildInfo({ root: dir, env: {}, release: true }),
      /完整 Git SHA/,
    );
    const generated = createBuildInfo({
      root: dir,
      release: true,
      env: {
        AUTOPPT_BUILD_GIT_SHA: a,
        AUTOPPT_BUILD_TIME: info.buildTime,
        AUTOPPT_RUNTIME_MODE: "desktop",
      },
    });
    writeFileSync(path.join(dir, "build-info.json"), JSON.stringify(generated));
    execFileSync("git", ["init", "-q", dir]);
    execFileSync(
      "git",
      [
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.invalid",
        "commit",
        "--allow-empty",
        "-qm",
        "unrelated runtime HEAD",
      ],
      { cwd: dir },
    );
    assert.notEqual(
      execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: dir,
        encoding: "utf8",
      }).trim(),
      a,
    );
    assert.deepEqual(readBuildInfo(dir), generated);
    const result = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import { readBuildInfo } from ${JSON.stringify(new URL("../server/build-info.mjs", import.meta.url).href)}; console.log(JSON.stringify(readBuildInfo(${JSON.stringify(dir)})))`,
      ],
      {
        env: {
          ...process.env,
          AUTOPPT_BUILD_GIT_SHA: b,
          AUTOPPT_BUILD_TIME: "2099-01-01",
        },
        encoding: "utf8",
      },
    );
    assert.deepEqual(JSON.parse(result), generated);
    writeFileSync(path.join(dir, "build-info.json"), "null");
    assert.throws(() => readBuildInfo(dir), /构建版本信息无效/);
    rmSync(path.join(dir, "build-info.json"));
    assert.throws(() => readBuildInfo(dir), /构建版本信息缺失/);
    assert.throws(
      () =>
        createBuildInfo({
          root: dir,
          release: true,
          env: { AUTOPPT_BUILD_GIT_SHA: "main" },
        }),
      /完整 Git SHA/,
    );
    assert.equal(
      createBuildInfo({ root: dir, env: { AUTOPPT_BUILD_GIT_SHA: "unknown" } })
        .gitSha,
      "unknown",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("schema mismatch always blocks; production SHA mismatch blocks; unknown and dev HMR stay usable", () => {
  for (const production of [true, false]) {
    assert.equal(
      compareBuildInfo(
        info,
        { ...info, apiSchemaVersion: API_SCHEMA_VERSION + 1 },
        production,
      ).blocked,
      true,
    );
    assert.equal(compareBuildInfo(info, undefined, production).blocked, true);
    for (const [front, back] of [
      [info, { ...info, gitSha: "unknown" }],
      [{ ...info, gitSha: "unknown" }, info],
    ]) {
      assert.equal(compareBuildInfo(front, back, production).status, "unknown");
      assert.equal(compareBuildInfo(front, back, production).blocked, false);
    }
  }
  assert.equal(compareBuildInfo(info, { ...info, gitSha: b }).blocked, true);
  assert.equal(
    compareBuildInfo(info, { ...info, gitSha: b }, false).status,
    "mismatch",
  );
  assert.equal(
    compareBuildInfo(info, { ...info, gitSha: b }, false).blocked,
    false,
  );
  assert.equal(compareBuildInfo(info, info).status, "matched");
  assert.equal(
    compareBuildInfo(info, { ...info, gitSha: a.toUpperCase() }).status,
    "matched",
  );
  assert.doesNotMatch(
    JSON.stringify(
      compareBuildInfo(info, {
        apiSchemaVersion: "/private/secret/token=cookie",
      }),
    ),
    /private|secret|token=|cookie/,
  );
});

for (const mode of ["local-browser", "desktop", "hosted"]) {
  test(
    `bootstrap ${mode}: runtime, safe workspace, capabilities/reasons and legacy features`,
    { timeout: 20000 },
    async () => {
      const dir = mkdtempSync(
        path.join(os.tmpdir(), "autoppt-diagnostics-private-"),
      );
      const token = "fixture-private-token";
      const child = fork("server/index.mjs", [], {
        silent: true,
        env: {
          PATH: process.env.PATH,
          NODE_ENV: "production",
          PORT: "0",
          AUTOPPT_DATA_DIR: dir,
          ...(mode === "hosted"
            ? { AUTOPPT_WORKER_TOKEN: token }
            : mode === "desktop"
              ? { AUTOPPT_DESKTOP_TOKEN: token }
              : {}),
        },
      });
      try {
        const [ready] = await once(child, "message", {
          signal: AbortSignal.timeout(15000),
        });
        const headers =
          mode === "hosted"
            ? { "x-autoppt-worker": token }
            : mode === "desktop"
              ? { "x-autoppt-desktop": token }
              : {};
        const response = await fetch(
          `http://127.0.0.1:${ready.port}/api/bootstrap`,
          { headers },
        );
        assert.equal(response.status, 200);
        const body = await response.json();
        assert.deepEqual(body.buildInfo, {
          ...readBuildInfo(),
          runtimeMode: mode,
        });
        if (mode !== "hosted") {
          const page = await fetch(`http://127.0.0.1:${ready.port}/`, {
            headers,
          });
          assert.equal(
            page.headers.get("x-autoppt-release"),
            readBuildInfo().gitSha,
          );
          assert.match(page.headers.get("content-type"), /text\/html/);
          assert.equal(page.headers.get("cache-control"), "no-store");
          const asset = (await page.text()).match(
            /src="(\/assets\/[^\"]+\.js)"/,
          )?.[1];
          assert.ok(asset, "built entry script is present");
          const script = await fetch(`http://127.0.0.1:${ready.port}${asset}`, {
            headers,
          });
          assert.equal(script.status, 200);
          assert.match(script.headers.get("content-type"), /javascript/);
          assert.equal(
            script.headers.get("x-autoppt-release"),
            readBuildInfo().gitSha,
          );
        }
        assert.equal(body.dataRootLabel, dataRootLabels[mode]);
        assert.deepEqual(body.features, {
          styleUrlImport: true,
          unifiedStyleCover: true,
          directStylePrompt: true,
          designOptions: true,
          insertAndManuscriptExport: true,
          motionPresentation: mode !== "hosted",
          speechPresentation: mode !== "hosted",
          projectPackages: true,
          spokenHtml: true,
        });
        for (const capability of Object.values(body.capabilities)) {
          assert.equal(typeof capability.enabled, "boolean");
          if (!capability.enabled) assert.ok(capability.reason?.length > 5);
        }
        assert.equal(body.capabilities.standardPresentation.enabled, true);
        assert.equal(body.capabilities.aiNarration.enabled, false);
        assert.equal(
          body.capabilities.localModelSettings.enabled,
          mode !== "hosted",
        );
        assert.equal(
          body.capabilities.adminModelSettings.enabled,
          mode === "hosted",
        );
        assert.equal(body.capabilities.projectPackages.enabled, true);
        assert.equal(body.capabilities.bundleExport.enabled, true);
        assert.equal(
          body.capabilities.motionPresentation.enabled,
          mode !== "hosted",
        );
        if (mode === "hosted")
          assert.match(
            body.capabilities.aiNarration.reason,
            /暂不提供 AI 口播/,
          );
        assert.ok(!JSON.stringify(body).includes(dir));
        assert.ok(!JSON.stringify(body).includes(token));
        assert.doesNotMatch(
          JSON.stringify({
            buildInfo: body.buildInfo,
            dataRootLabel: body.dataRootLabel,
            capabilities: body.capabilities,
          }),
          /\/Users\/|\/private\/|\/data\/|apiKey|cookie/i,
        );
      } finally {
        if (child.exitCode === null && child.signalCode === null) {
          const ended = once(child, "exit");
          child.kill();
          await ended;
        }
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );
}

test("configured speech enables local AI; hosted restrictions win over configuration", () => {
  for (const mode of ["local-browser", "desktop"])
    assert.equal(
      diagnostics(info, { mode, speechReady: true }).capabilities.aiNarration
        .enabled,
      true,
    );
  assert.equal(
    diagnostics(info, { mode: "hosted", speechReady: true }).capabilities
      .aiNarration.enabled,
    false,
  );
});
