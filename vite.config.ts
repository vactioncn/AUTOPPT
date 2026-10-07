import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { createBuildInfo, readBuildInfo } from "./server/build-info.mjs";
export default defineConfig(({ command }) => {
  const info = command === "build" ? readBuildInfo() : createBuildInfo();
  return {
    define: { __AUTOPPT_BUILD_INFO__: JSON.stringify(info) },
    plugins: [
      react(),
      {
        name: "autoppt-build-info",
        generateBundle() {
          this.emitFile({
            type: "asset",
            fileName: "build-info.json",
            source: JSON.stringify(info, null, 2) + "\n",
          });
        },
      },
    ],
  };
});
