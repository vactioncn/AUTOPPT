import { packager } from "@electron/packager";
import { readFileSync, mkdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import sharp from "sharp";
import { verifyMacApp } from "./verify-mac.mjs";
import path from "node:path";

if (process.platform !== "darwin")
  throw new Error("请在 Mac 上构建并验证安装包。");
const root = path.resolve(import.meta.dirname, "..");
const iconset = path.join(root, "release", "AutoPPT.iconset");
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
const icon = path.join(root, "release", "AutoPPT.icns");
execFileSync("iconutil", ["-c", "icns", iconset, "-o", icon]);
rmSync(iconset, { recursive: true });
const { version } = JSON.parse(
  readFileSync(path.join(root, "package.json"), "utf8"),
);
// Explicit roots prevent workspace data, credentials and test artifacts leaking.
const allowed = new Set([
  "package.json",
  "desktop",
  "server",
  "shared",
  "dist",
  "node_modules",
]);
const outputs = await packager({
  dir: root,
  out: path.join(root, "release"),
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
console.log(
  "Mac App 已生成：\n" +
    outputs.map((p) => path.join(p, "AutoPPT.app")).join("\n"),
);
const zip = path.join(root, "release", `AutoPPT-mac-${process.arch}.zip`);
await verifyMacApp(path.join(outputs[0], "AutoPPT.app"));
rmSync(zip, { force: true });
execFileSync("ditto", [
  "-c",
  "-k",
  "--sequesterRsrc",
  "--keepParent",
  path.join(outputs[0], "AutoPPT.app"),
  zip,
]);
console.log(`可分享的压缩包：${zip}`);
console.log("这是未公证的内部构建；尚未完成 Apple Developer ID 签名与公证。");
