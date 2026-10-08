import { spawnSync } from "node:child_process";
export const integrationEnvironment = {
  BROWSER_TEST: "1",
  PRESENTER_BROWSER_TEST: "1",
  REQUIRE_BROWSER: "1",
  MEDIA_STRESS_TEST: "1",
  LARGE_HTML_EXPORT_TEST: "1",
};
export const integrationTests = [
  "tests/integration-gate.test.mjs",
  "tests/model-recovery.test.mjs",
  "tests/model-request-policy.test.mjs",
  "tests/paid-request-browser.test.mjs",
  "tests/paid-requests.test.mjs",
  "tests/user-error-browser.test.mjs",
  "tests/user-error.test.mjs",
  "tests/avatar-presenter.test.mjs",
  "tests/feedback-governance.test.mjs",
  "tests/portable-project.test.mjs",
  "tests/image-storage.test.mjs",
  "tests/html-download.test.mjs",
  "tests/media-stress.test.mjs",
  "tests/usage.test.mjs",
  "tests/feedback-governance-browser.test.mjs",
  "tests/avatar-presenter-browser.test.mjs",
];
export function runIntegration(run = spawnSync) {
  const env = { ...process.env, ...integrationEnvironment };
  const steps = [
    [process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build"]],
    [process.execPath, ["--test", "--test-concurrency=1", ...integrationTests]],
  ];
  for (const [command, args] of steps) {
    const result = run(command, args, {
      env,
      stdio: "inherit",
      timeout: 900000,
    });
    if (result.error || result.status !== 0) {
      console.error(
        "Integration gate failed",
        result.error?.code || result.status,
      );
      return 1;
    }
  }
  return 0;
}
if (process.argv[1]?.endsWith("check-integration.mjs"))
  process.exitCode = runIntegration();
