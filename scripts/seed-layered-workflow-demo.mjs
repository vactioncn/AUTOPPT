// Import the explicit five-style experiment into a NEW isolated work directory.
// Does not discover/copy business projects, settings, keys, or installed app data.
import { readFile, mkdir, copyFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { validateLayers } from "../shared/motion/schema.mjs";
const [sourceArg, targetArg, option] = process.argv.slice(2);
if (option && option !== "--authored-motion") throw new Error("Unknown option");
const authored = option === "--authored-motion";
if (!sourceArg || !targetArg)
  throw new Error(
    "Usage: node scripts/seed-layered-workflow-demo.mjs EXPERIMENT_DIR NEW_DATA_DIR [--authored-motion]",
  );
const source = path.resolve(sourceArg),
  target = path.resolve(targetArg);
const input = JSON.parse(
  await readFile(path.join(source, "output/layers.json"), "utf8"),
);
const geometry = JSON.parse(
  await readFile(
    path.join(source, "font-embedding/review/calibrated-geometry.json"),
    "utf8",
  ),
);
await mkdir(target, { recursive: false });
process.env.AUTOPPT_DATA_DIR = target;
const { put, now, db, assetPath } = await import("../server/store.mjs");
const pages = [],
  slides = [];
for (const p of input.pages) {
  const original = `${p.id}-original.${p.id === "story" ? "png" : "webp"}`;
  const background = `${p.id}-background.png`;
  await copyFile(
    path.join(
      source,
      p.id === "story" ? "original.png" : `multi/${p.id}/original.webp`,
    ),
    assetPath(original),
  );
  await copyFile(
    path.join(source, `output/${p.id}-background.png`),
    assetPath(background),
  );
  const calibration = geometry.filter((g) => g.page === p.id);
  const layers = validateLayers(
    p.layers.map((l, i) => {
      const g = calibration[i];
      return {
        ...l,
        type: "text",
        x: g.position.left,
        y: g.position.top,
        w: Math.min(g.position.width, p.width - g.position.left),
        h: Math.min(g.position.height, p.height - g.position.top),
        fontSize: g.fontSize,
        fontWeight: g.font.includes("Light")
          ? 300
          : g.bold
            ? l.font === "serif"
              ? 600
              : 700
            : 400,
        fit: false,
        lineHeight: 1,
        letterSpacing: p.id === "neo" && i === 3 ? -18 : 0,
        align: "left",
        effect: i ? "rise" : "fade",
        step: {
          story: [1, 1, 2, 2],
          japanese: [0, 1, 1],
          childhood: [0, 0, 1, 1],
          neo: [0, 0, 0, 1, 2],
          avant: [0, 0, 1, 1, 2],
        }[p.id][i],
        delay: 0,
        duration: 650,
        rotation: 0,
      };
    }),
    p.width,
    p.height,
  );
  const notes = p.layers.map((l) => l.text).join("\n");
  pages.push({
    id: p.id,
    number: pages.length + 1,
    title: `${p.styleName} · ${p.title}`,
    width: p.width,
    height: p.height,
    source: {
      image: original,
      notes,
      displayText: p.layers.map((l) => l.text),
      stale: false,
      fingerprint: `fixture-${p.id}`,
    },
    background,
    layers,
    status: "ready",
    playbackMode: authored ? "natural" : "steps",
    choreography: authored
      ? {
          story: "story",
          japanese: "editorial",
          childhood: "focus",
          neo: "chapter",
          avant: "contrast",
        }[p.id]
      : "custom",
    reviewed: false,
    warnings: [],
    summary:
      "沿用五种风格试验素材 · 本次用于验证编辑与播放，未调用模型重新出图",
  });
  slides.push({
    id: p.id,
    notes,
    image: original,
    plan: { title: p.title, displayText: p.layers.map((l) => l.text) },
    styleId: "restrained-minimal",
    versions: [],
    status: "ready",
    stale: false,
    batchIds: [],
    manuscriptVersion: 1,
  });
}
const project = {
  id: "layered-five-styles",
  title: "分层演讲 · 五种风格测试",
  revision: 1,
  createdAt: now(),
  updatedAt: now(),
  styleId: "restrained-minimal",
  draft: "",
  batches: [],
  slides,
};
put("project", project);
put("motion", {
  id: "layered-five-styles-demo",
  version: 1,
  sourceMode: "layered",
  projectId: project.id,
  title: project.title,
  revision: 1,
  sourceRevision: 1,
  status: "ready",
  progress: "五种风格已准备好，可改字与试播",
  createdAt: now(),
  updatedAt: now(),
  pages,
  customFont: null,
});
await writeFile(
  path.join(target, "source-project.json"),
  JSON.stringify(project, null, 2),
);
db.close();
console.log(
  `Created ${pages.length} isolated pages at ${target}. No model settings copied.`,
);
