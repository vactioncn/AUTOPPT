import { existsSync } from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

// Match the project's CHROMIUM_EXECUTABLE override and local Chrome fallback,
// then discover Playwright/system Chromium. Only missing browsers cause a skip;
// launch failures with an installed browser remain test failures.
export async function launchBrowser(t) {
  const candidates = [
    process.env.CHROMIUM_EXECUTABLE,
    chromium.executablePath(),
    ...(process.platform === "darwin"
      ? [
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        ]
      : process.platform === "win32"
        ? [
            ...[
              process.env.PROGRAMFILES,
              process.env["PROGRAMFILES(X86)"],
              process.env.LOCALAPPDATA,
            ]
              .filter(Boolean)
              .flatMap((root) => [
                path.join(root, "Google/Chrome/Application/chrome.exe"),
                path.join(root, "Microsoft/Edge/Application/msedge.exe"),
              ]),
          ]
        : [
            "/usr/bin/chromium",
            "/usr/bin/chromium-browser",
            "/usr/bin/google-chrome",
          ]),
  ];
  const executablePath = candidates.find(
    (candidate) => candidate && existsSync(candidate),
  );
  if (!executablePath) {
    if (
      process.env.REQUIRE_BROWSER === "1" ||
      process.env.BROWSER_TEST === "1" ||
      process.env.PRESENTER_BROWSER_TEST === "1"
    )
      throw new Error(
        "Browser gate requires Chromium; set CHROMIUM_EXECUTABLE or install Playwright Chromium.",
      );
    t.skip(
      "No Chromium browser found; install Playwright Chromium or set CHROMIUM_EXECUTABLE.",
    );
    return null;
  }
  return chromium.launch({ headless: true, executablePath });
}
