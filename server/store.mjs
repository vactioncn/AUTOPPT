import { DatabaseSync } from "node:sqlite";
import {
  mkdirSync,
  chmodSync,
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
} from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DEFAULT_STYLE_ID } from "../shared/styles.mjs";

export const dataDir = path.resolve(process.env.AUTOPPT_DATA_DIR || ".local");
export const assetsDir = path.join(dataDir, "assets");
mkdirSync(assetsDir, { recursive: true, mode: 0o700 });
chmodSync(dataDir, 0o700);
export const db = new DatabaseSync(path.join(dataDir, "autoppt.sqlite"));
db.exec(
  "PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(kind,id));",
);
export const id = () => randomUUID();
export const now = () => new Date().toISOString();
export function get(kind, key) {
  const row = db
    .prepare("SELECT data FROM records WHERE kind=? AND id=?")
    .get(kind, key);
  return row ? JSON.parse(row.data) : null;
}
export function all(kind) {
  return db
    .prepare("SELECT data FROM records WHERE kind=?")
    .all(kind)
    .map((r) => JSON.parse(r.data));
}
export function put(kind, value) {
  db.prepare(
    "INSERT INTO records(kind,id,data) VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data",
  ).run(kind, value.id, JSON.stringify(value));
  return value;
}
export function transaction(fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
export function projectOrThrow(key) {
  const p = get("project", key);
  if (!p || p.deletedAt)
    throw Object.assign(new Error("这个项目不存在或已删除。"), { status: 404 });
  return p;
}
export function saveProject(p) {
  p.updatedAt = now();
  p.revision = (p.revision || 0) + 1;
  return put("project", p);
}
export function assetPath(filename) {
  if (
    typeof filename !== "string" ||
    !/^[a-zA-Z0-9_-]+\.(png|jpg|webp)$/.test(filename)
  )
    throw new Error("图片路径无效");
  return path.join(assetsDir, filename);
}
const settingsPath = path.join(dataDir, "settings.json");
const officialBase = (
  process.env.OPENAI_BASE_URL || "https://api.openai.com/v1"
).replace(/\/$/, "");
export function settings() {
  const saved = existsSync(settingsPath)
    ? JSON.parse(readFileSync(settingsPath, "utf8"))
    : {};
  const resolve = (kind, model) => {
    const s = saved[kind] || {};
    const baseUrl = s.baseUrl || officialBase;
    return {
      ...s,
      baseUrl,
      model: s.model || model,
      apiKey:
        s.apiKey ||
        (baseUrl === officialBase && !s.clearKey
          ? process.env.OPENAI_API_KEY || ""
          : ""),
    };
  };
  return {
    text: resolve("text", "gpt-5.4-mini"),
    image: resolve("image", "gpt-image-2.5-sunburst"),
  };
}
export function publicSettings() {
  const s = settings();
  return Object.fromEntries(
    Object.entries(s).map(([k, v]) => [
      k,
      { baseUrl: v.baseUrl, model: v.model, hasKey: !!v.apiKey },
    ]),
  );
}
export function updateSettings(input) {
  const saved = existsSync(settingsPath)
    ? JSON.parse(readFileSync(settingsPath, "utf8"))
    : {};
  for (const kind of ["text", "image"]) {
    if (!input[kind]) continue;
    const incoming = input[kind];
    const before = settings()[kind];
    const baseUrl = String(incoming.baseUrl || before.baseUrl).replace(
      /\/+$/,
      "",
    );
    const url = new URL(baseUrl);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error("请输入完整的 HTTP(S) 接口地址，不要带密钥或查询参数。");
    if (!String(incoming.model || "").trim())
      throw new Error("请填写模型名称。");
    const endpointChanged = baseUrl !== before.baseUrl;
    saved[kind] = {
      ...saved[kind],
      baseUrl,
      model: String(incoming.model).trim(),
    };
    if (endpointChanged) {
      delete saved[kind].apiKey;
      saved[kind].clearKey = true;
    }
    if (incoming.apiKey?.trim()) {
      saved[kind].apiKey = incoming.apiKey.trim();
      saved[kind].clearKey = false;
    }
    if (incoming.clearKey) {
      delete saved[kind].apiKey;
      saved[kind].clearKey = true;
    }
  }
  writeFileSync(settingsPath + ".tmp", JSON.stringify(saved, null, 2), {
    mode: 0o600,
  });
  renameSync(settingsPath + ".tmp", settingsPath);
  chmodSync(settingsPath, 0o600);
  return publicSettings();
}

const defaults = [
  {
    id: DEFAULT_STYLE_ID,
    name: "克制极简风格",
    description: "黑白基底、荧光强调与鲜明的中文层次，按内容自由构图。",
    colors: [
      "#050505",
      "#FCFCFA",
      "#D7FF00",
      "#F5F500",
      "#0743D7",
      "#777982",
      "#CFD2DA",
    ],
    compositionMode: "direct",
    rules: readFileSync(
      new URL("./styles/restrained-minimal.txt", import.meta.url),
      "utf8",
    ),
  },
  {
    id: "editorial",
    name: "极简叙事",
    description: "让一个观点，成为画面的主角。",
    colors: ["#f5f2e9", "#252c26", "#bc5236"],
    rules:
      "暖白纸色底，深墨色中文无衬线标题，赤陶色仅用于一个重点。每页保留一个核心观点，标题不超过两行；大片留白、清晰对齐。观点页以大字和极简线性图形表达；数字页放大真实数字与必要口径；对比页用明确的两列；过程页用简洁路径。避免装饰渐变、密集小字和泛化配图。每页根据含义重新构图。",
  },
  {
    id: "bold",
    name: "数字聚焦",
    description: "把关键变化，放大到一眼可见。",
    colors: ["#f4f6ef", "#233c32", "#a9c76c"],
    rules:
      "浅灰绿底，极深绿色正文，酸橙绿作为强调。粗体无衬线大数字，严谨网格，短标签。数字必须来自原稿，保留分母、单位和时间范围；没有数字的页面用大观点和几何关系，绝不编造数值。用对比、比例、进展表达变化；克制图形，充分留白。",
  },
  {
    id: "night",
    name: "深色舞台",
    description: "为舞台上的重点，留下一束光。",
    colors: ["#202930", "#f4f2e8", "#eab06c"],
    rules:
      "深蓝黑底，暖白大字，琥珀色极少量强调。舞台远距离可读，强烈明暗对比，一页一个重点。概念页用大型短句和精确抽象图形，故事页使用有意义的主体构图，数据页突出原稿中的真实数字。避免发光特效、细碎线条、过密信息与无意义装饰。",
  },
];
export function seedBuiltinStyles() {
  for (const s of defaults)
    if (!get("style", s.id))
      put("style", {
        ...s,
        refs: [],
        status: "ready",
        builtin: true,
        createdAt: now(),
        updatedAt: now(),
      });
}
seedBuiltinStyles();
