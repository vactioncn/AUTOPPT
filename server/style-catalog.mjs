import { DatabaseSync } from "node:sqlite";
import { mkdirSync, copyFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { all, get, put, assetPath, now } from "./store.mjs";
import { HOSTED_BUILTIN_STYLE_IDS } from "../shared/styles.mjs";

const dir = process.env.AUTOPPT_STYLE_CATALOG_DIR;
let catalog;
if (dir) {
  mkdirSync(path.join(dir, "assets"), { recursive: true, mode: 0o700 });
  catalog = new DatabaseSync(path.join(dir, "catalog.sqlite"));
  catalog.exec(
    "PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS styles (id TEXT PRIMARY KEY, data TEXT NOT NULL)",
  );
}
const entries = () =>
  catalog
    ? catalog
        .prepare("SELECT data FROM styles")
        .all()
        .map((r) => JSON.parse(r.data))
    : [];
const save = (style) =>
  catalog
    .prepare(
      "INSERT INTO styles VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
    )
    .run(style.id, JSON.stringify(style));
const media = (style) => [
  ...new Set(
    [
      style.cover,
      ...style.refs,
      ...(style.examples || []).map((e) => e.image),
    ].filter(Boolean),
  ),
];

export function syncStyleCatalog() {
  for (const style of entries()) {
    const before = get("style", style.id);
    if (before?.catalogRevision === style.catalogRevision) continue;
    for (const name of media(style)) {
      const destination = assetPath(name);
      if (!existsSync(destination))
        copyFileSync(path.join(dir, "assets", name), destination);
    }
    // Published copies have their own identities. Never overwrite a customer's
    // old rules, imported projects, trials or generated slides.
    put("style", style);
  }
}

export function catalogStatus(style) {
  if (!catalog || style.catalogSourceId) return style;
  const row = catalog
    .prepare("SELECT data FROM styles WHERE id=?")
    .get(`catalog-${style.id}`);
  const published = row && JSON.parse(row.data);
  return {
    ...style,
    catalogAvailable: true,
    publishedTrialIds: published?.examples?.map((e) => e.id) || [],
    publishedAt:
      published && !published.catalogHidden ? published.publishedAt : null,
  };
}

export function withdrawStyle(styleId) {
  if (!catalog) return;
  const row = catalog
    .prepare("SELECT data FROM styles WHERE id=?")
    .get(`catalog-${styleId}`);
  if (!row) return;
  const style = JSON.parse(row.data);
  style.catalogHidden = true;
  style.catalogRevision = `hidden-${now()}`;
  save(style);
}

export function registerStyleCatalog(app) {
  app.post("/api/styles/:id/publish", (req, res) => {
    if (!catalog)
      return res
        .status(409)
        .json({ error: "发布到客户风格库需要使用服务器版管理员账号。" });
    const style = get("style", req.params.id);
    if (
      !style ||
      style.deletedAt ||
      !style.rules?.trim() ||
      style.catalogSourceId
    )
      return res.status(400).json({ error: "请先保存一个可用的原始风格。" });
    if (
      all("job").some(
        (j) =>
          ["style", "trial"].includes(j.type) &&
          j.payload?.styleId === style.id &&
          ["queued", "running"].includes(j.status),
      )
    )
      return res
        .status(409)
        .json({ error: "请等待风格提炼或试做完成后发布。" });
    // The admin intentionally chooses which completed trial images to publish.
    const ids = req.body.trialIds;
    if (
      !Array.isArray(ids) ||
      ids.length > 12 ||
      new Set(ids).size !== ids.length
    )
      return res
        .status(400)
        .json({ error: "请选择最多 12 张不同的试做样例。" });
    const examples = ids.map((id) => {
      const trial = get("trial", id);
      if (
        !trial ||
        trial.styleId !== style.id ||
        !trial.image ||
        (get("job", trial.jobId)?.status || trial.status) !== "completed"
      )
        throw new Error("只能发布这个风格已完成的图片试做。");
      return {
        id: trial.id,
        title: String(trial.plan?.title || "页面示例").slice(0, 100),
        expression: "实际生成样例",
        image: trial.image,
      };
    });
    const published = {
      id: `catalog-${style.id}`,
      catalogSourceId: style.id,
      replacesStyleId: HOSTED_BUILTIN_STYLE_IDS.includes(style.id)
        ? style.id
        : undefined,
      name: style.name,
      description: style.description,
      rules: style.rules,
      colors: style.colors || [],
      refs: style.refs || [],
      cover: style.cover,
      compositionMode: style.compositionMode,
      builtin: false,
      status: "ready",
      examples,
      catalogHidden: false,
      publishedAt: now(),
      updatedAt: now(),
    };
    for (const name of media(published)) {
      const source = assetPath(name); // Validate before joining the shared path.
      copyFileSync(source, path.join(dir, "assets", name));
    }
    published.catalogRevision = createHash("sha256")
      .update(JSON.stringify(published))
      .digest("hex");
    save(published);
    res.json({ published: true, style: catalogStatus(style) });
  });
  app.delete("/api/styles/:id/publish", (req, res) => {
    if (!catalog)
      return res.status(409).json({ error: "当前工作区没有客户风格库。" });
    withdrawStyle(req.params.id);
    res.json({ published: false });
  });
}
