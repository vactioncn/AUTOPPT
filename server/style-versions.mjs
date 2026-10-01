import { createHash } from "node:crypto";
import { all, get, put, id, now, transaction } from "./store.mjs";

const content = (style) => ({
  rules: style.rules || "",
  compositionMode:
    style.compositionMode === "content-led" ? "content-led" : "direct",
});
export const styleVersionToken = (style) =>
  createHash("sha256")
    .update(JSON.stringify(content(style)))
    .digest("hex");
export const withStyleVersion = (style) => ({
  ...style,
  versionToken: styleVersionToken(style),
});

export function assertStyleVersion(style, expected) {
  if (expected !== undefined && expected !== styleVersionToken(style))
    throw Object.assign(
      new Error(
        "风格提示词已在另一处更新。你的输入仍保留，请刷新版本记录后比较再保存。",
      ),
      { status: 409 },
    );
}

function storedVersions(styleId) {
  return all("styleVersion")
    .filter((v) => v.styleId === styleId)
    .sort((a, b) => a.sequence - b.sequence);
}

// Old extraction/promotion history is exposed read-only. Missing metadata is
// not invented and opening the history never writes to the database.
export function styleVersions(style) {
  const legacy = (style.history || []).flatMap((entry, index) =>
    typeof entry.rules === "string" && entry.rules.trim()
      ? [
          {
            id: `legacy-${index}-${styleVersionToken(entry)}`,
            source: "legacy",
            rules: entry.rules,
            compositionMode: ["direct", "content-led"].includes(
              entry.compositionMode,
            )
              ? entry.compositionMode
              : null,
            createdAt: entry.updatedAt || null,
          },
        ]
      : [],
  );
  const stored = storedVersions(style.id);
  const versions = [...legacy, ...stored];
  const token = styleVersionToken(style);
  const latest = stored.at(-1);
  if (
    style.rules?.trim() &&
    (!latest ||
      styleVersionToken(latest) !== token ||
      latest.compositionMode === null)
  )
    versions.push({
      id: `current-${token}`,
      source: "baseline",
      createdAt: style.updatedAt || null,
      ...content(style),
    });
  return {
    currentToken: token,
    versions: versions
      .map((version, i) => ({
        ...version,
        number: i + 1,
        current: i === versions.length - 1,
      }))
      .reverse(),
  };
}

// All prompt-changing entry points use this single atomic checkpoint. Full
// histories are separate records so snapshots never recursively copy histories.
export function saveStyleVersion(
  before,
  next,
  source,
  restoredFrom = null,
  afterSave = () => {},
) {
  return transaction(() => {
    const current = get("style", before.id);
    if (
      !current ||
      current.deletedAt ||
      current.updatedAt !== before.updatedAt ||
      styleVersionToken(current) !== styleVersionToken(before)
    )
      throw Object.assign(new Error("风格已有变化，请刷新后重试。"), {
        status: 409,
      });
    const changed = styleVersionToken(before) !== styleVersionToken(next);
    if (changed) {
      const stored = storedVersions(before.id);
      let sequence = (stored.at(-1)?.sequence || 0) + 1;
      const append = (value, origin, createdAt, from = null) =>
        put("styleVersion", {
          id: id(),
          styleId: before.id,
          sequence: sequence++,
          ...content(value),
          source: origin,
          createdAt,
          restoredFrom: from,
        });
      if (
        before.rules?.trim() &&
        (!stored.length ||
          styleVersionToken(stored.at(-1)) !== styleVersionToken(before))
      )
        append(before, "baseline", before.updatedAt || now());
      append(next, source, next.updatedAt || now(), restoredFrom);
    }
    put("style", next);
    afterSave();
    return { style: withStyleVersion(next), changed };
  });
}

export function registerStyleVersions(app) {
  const available = (key) => {
    const style = get("style", key);
    if (!style || style.deletedAt)
      throw Object.assign(new Error("风格不存在或已删除。"), { status: 404 });
    return style;
  };
  app.get("/api/styles/:id/versions", (req, res) =>
    res.json(styleVersions(available(req.params.id))),
  );
  app.post("/api/styles/:id/versions/:vid/restore", (req, res) => {
    const style = available(req.params.id);
    if (typeof req.body.expectedVersion !== "string")
      throw new Error("请先加载当前版本记录，再恢复。");
    assertStyleVersion(style, req.body.expectedVersion);
    if (
      all("job").some(
        (j) =>
          ["style", "trial"].includes(j.type) &&
          j.payload?.styleId === style.id &&
          ["queued", "running"].includes(j.status),
      )
    )
      throw Object.assign(
        new Error("这个风格正在提炼或试做，请完成或停止后再恢复。"),
        { status: 409 },
      );
    const version = styleVersions(style).versions.find(
      (v) => v.id === req.params.vid,
    );
    if (!version)
      throw Object.assign(new Error("这个风格的版本不存在。"), { status: 404 });
    const next = {
      ...style,
      rules: version.rules,
      compositionMode:
        version.compositionMode || content(style).compositionMode,
      updatedAt: now(),
    };
    res.json(saveStyleVersion(style, next, "restore", version.id));
  });
}
