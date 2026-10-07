import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { readBuildInfo } from "./build-info.mjs";

// A running backend must not serve a different frontend when another build
// replaces dist/. Keep the complete public UI (including lazy chunks/fonts)
// in this process; no workspace data or files outside dist/ are captured.
export function frontendRelease(root, backend) {
  const dist = path.join(root, "dist");
  const assertBuild = (info) => {
    for (const key of ["gitSha", "appVersion", "apiSchemaVersion", "buildTime"])
      if (info[key] !== backend[key])
        throw new Error(
          "网页与后台构建不完整或不一致，请完成构建后再启动 AutoPPT。",
        );
  };
  assertBuild(readBuildInfo(dist));
  const files = new Map();
  function read(folder, prefix = "") {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const name = prefix + "/" + entry.name;
      if (entry.isDirectory()) read(path.join(folder, entry.name), name);
      else if (entry.isFile())
        files.set(name, readFileSync(path.join(folder, entry.name)));
      else throw new Error("网页构建包含不支持的文件，请重新构建。");
    }
  }
  read(dist);
  assertBuild(readBuildInfo(dist));
  const manifest = files.get("/build-info.json");
  if (!manifest || !files.get("/index.html")?.length)
    throw new Error("网页构建缺失入口，请重新构建 AutoPPT。");
  assertBuild(JSON.parse(manifest.toString("utf8")));
  function send(res, name) {
    res.set("X-AutoPPT-Release", backend.gitSha);
    res.set(
      "Cache-Control",
      name.endsWith(".html") || name === "/build-info.json"
        ? "no-store"
        : "public, max-age=0, must-revalidate",
    );
    return res
      .type(path.extname(name).slice(1) || "application/octet-stream")
      .send(files.get(name));
  }
  return {
    assets(req, res, next) {
      if (!["GET", "HEAD"].includes(req.method)) return next();
      let name;
      try {
        name = decodeURIComponent(req.path);
      } catch {
        return res.status(400).end();
      }
      if (files.has(name)) return send(res, name);
      const directoryIndex = name.replace(/\/$/, "") + "/index.html";
      if (files.has(directoryIndex)) {
        if (!name.endsWith("/"))
          return res.redirect(
            301,
            req.path + "/" + req.url.slice(req.path.length),
          );
        return send(res, directoryIndex);
      }
      return next();
    },
    index(req, res) {
      return send(res, "/index.html");
    },
  };
}
