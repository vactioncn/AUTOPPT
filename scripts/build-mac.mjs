import { packager } from "@electron/packager";
import {
  readFileSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
} from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import sharp from "sharp";
import { verifyMacApp } from "./verify-mac.mjs";
import path from "node:path";
import os from "node:os";

if (process.platform !== "darwin")
  throw new Error("请在 Mac 上构建并验证安装包。");
const root = path.resolve(import.meta.dirname, "..");
// Keep runnable bundles out of release folders and macOS application indexing.
const outputDir = path.resolve(
  process.env.AUTOPPT_MAC_OUTPUT_DIR || path.join(root, "release"),
);
execFileSync("npm", ["run", "build"], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, AUTOPPT_RUNTIME_MODE: "desktop" },
});
mkdirSync(outputDir, { recursive: true });
const buildRoot = mkdtempSync(path.join(os.tmpdir(), "autoppt-mac-build-"));
const stagingDir = path.join(buildRoot, "build.noindex");
const zip = path.join(outputDir, `AutoPPT-mac-${process.arch}.zip`);
const temporaryZip = path.join(
  outputDir,
  `.AutoPPT-${path.basename(buildRoot)}.zip`,
);
let verifiedApp;
try {
  const iconset = path.join(stagingDir, "AutoPPT.iconset");
  mkdirSync(iconset, { recursive: true });
  for (const size of [16, 32, 128, 256, 512]) {
    for (const scale of [1, 2])
      await sharp(path.join(root, "desktop/icon.svg"))
        .resize(size * scale)
        .png()
        .toFile(
          path.join(
            iconset,
            `icon_${size}x${size}${scale === 2 ? "@2x" : ""}.png`,
          ),
        );
  }
  const icon = path.join(stagingDir, "AutoPPT.icns");
  execFileSync("iconutil", ["-c", "icns", iconset, "-o", icon]);
  rmSync(iconset, { recursive: true });
  const { version } = JSON.parse(
    readFileSync(path.join(root, "package.json"), "utf8"),
  );
  // Explicit roots prevent workspace data, credentials and test artifacts leaking.
  const allowed = new Set([
    "package.json",
    "build-info.json",
    "desktop",
    "server",
    "shared",
    "dist",
    "node_modules",
  ]);
  const outputs = await packager({
    dir: root,
    out: stagingDir,
    name: "AutoPPT",
    platform: "darwin",
    arch: process.arch,
    appVersion: version,
    appBundleId: "com.autoppt.desktop",
    extendInfo: {
      NSMicrophoneUsageDescription:
        "用于录制你的演讲声音，经你确认后创建语音口播音色。",
    },
    icon,
    overwrite: true,
    asar: false,
    prune: true,
    ignore: (file) => {
      const relative = file.replace(/^[/\\]+/, "");
      if (!relative) return false;
      if (!allowed.has(relative.split(/[/\\]/)[0])) return true;
      return (
        /^server[/\\]hosted[/\\]/.test(relative) &&
        !relative.endsWith("worker-meter.mjs")
      );
    },
  });
  verifiedApp = path.join(outputs[0], "AutoPPT.app");
  await verifyMacApp(verifiedApp);
  execFileSync("ditto", [
    "-c",
    "-k",
    "--sequesterRsrc",
    "--keepParent",
    verifiedApp,
    temporaryZip,
  ]);
  execFileSync("unzip", ["-tq", temporaryZip], { stdio: "inherit" });
  renameSync(temporaryZip, zip);
  console.log(`可分享的压缩包：${zip}`);
  console.log("这是未公证的内部构建；尚未完成 Apple Developer ID 签名与公证。");
} finally {
  // Only delete this invocation's newly created scratch files, never an installed
  // app, an earlier release directory, or either user workspace.
  try {
    // Running the bundled executable for verification may register it even in a
    // .noindex folder. Remove only this build's registration before its files.
    if (verifiedApp) {
      const result = spawnSync(
        "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister",
        ["-u", verifiedApp],
        { encoding: "utf8" },
      );
      // A bundle rejected before launch was never registered (-10814).
      // Cleanup must not hide the validation error that caused that rejection.
      if (
        result.status !== 0 &&
        !`${result.stdout}${result.stderr}`.includes("-10814")
      )
        console.warn(
          "临时 App 注册清理未完成：",
          result.error?.message || result.stderr,
        );
    }
  } finally {
    rmSync(temporaryZip, { force: true });
    rmSync(buildRoot, { recursive: true, force: true });
  }
}
console.log(
  "构建临时 App 已清理。安装时解压 ZIP，将 AutoPPT.app 放入 /Applications；升级请先退出旧版，再替换同名程序。项目数据保留在独立工作区。",
);
