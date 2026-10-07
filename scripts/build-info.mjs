import { writeFileSync } from "node:fs";
import { createBuildInfo, sourceRoot } from "../server/build-info.mjs";
import path from "node:path";
const info = createBuildInfo({ release: true });
writeFileSync(
  path.join(sourceRoot, "build-info.json"),
  JSON.stringify(info, null, 2) + "\n",
);
console.log(
  `Build: ${info.appVersion} ${info.gitSha} ${info.runtimeMode} ${info.buildTime}`,
);
