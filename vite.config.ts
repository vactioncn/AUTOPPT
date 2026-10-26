import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { createBuildInfo, readBuildInfo } from "./server/build-info.mjs";
export default defineConfig(({ command }) => {
  const info = command === "build" ? readBuildInfo() : createBuildInfo();
  const basePath = (process.env.AUTOPPT_BASE_PATH || "").replace(/\/+$/, "");
  if (basePath && !/^\/[a-zA-Z0-9_-]+$/.test(basePath)) throw new Error("Invalid AUTOPPT_BASE_PATH");
  const backendPin = process.env.AUTOPPT_COMPATIBLE_BACKEND_GIT_SHA || "";
  if (backendPin && (!basePath || !/^[a-f0-9]{40}$/i.test(backendPin))) throw new Error("Backend pin requires a prefixed build and full SHA");
  return {
    base: basePath + "/",
    build: { outDir: process.env.AUTOPPT_BUILD_OUT_DIR || "dist" },
    define: { __AUTOPPT_BUILD_INFO__: JSON.stringify(info), __AUTOPPT_BASE_PATH__: JSON.stringify(basePath), __AUTOPPT_BACKEND_GIT_SHA__: JSON.stringify(backendPin) },
    plugins: [
      react(),
      {
        name: "autoppt-build-info",
        generateBundle() {
          this.emitFile({
            type: "asset",
            fileName: "build-info.json",
            source: JSON.stringify({ ...info, ...(backendPin ? { compatibleBackendGitSha: backendPin } : {}) }, null, 2) + "\n",
          });
        },
      },
    ],
  };
});
