import { fileURLToPath } from "node:url";
import { usePrimaryWorkspace } from "./primary-workspace.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
if (!(await usePrimaryWorkspace(root))) {
  if (!process.argv.includes("--dev")) process.env.NODE_ENV = "production";
  await import("../server/index.mjs");
}
