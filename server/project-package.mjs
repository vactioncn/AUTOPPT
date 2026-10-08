import JSZip from "jszip";
import multer from "multer";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  readFile,
  writeFile,
  mkdtemp,
  rm,
  mkdir,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import {
  all,
  get,
  put,
  id,
  now,
  dataDir,
  assetPath,
  projectOrThrow,
  transaction,
} from "./store.mjs";
import { exportFilename } from "./export.mjs";
import { screenImage } from "./image-storage.mjs";
import { validateLayers } from "../shared/motion/schema.mjs";
import { validateScene } from "../shared/slides.mjs";
import {
  compilePerformancePage,
  performanceSettings,
} from "../shared/speech-performance.mjs";

const MAX_ZIP = 1024 * 1024 * 1024,
  MAX_TOTAL = 1024 * 1024 * 1024,
  MAX_FILE = 64 * 1024 * 1024;
const kinds = new Set([
  "project",
  "style",
  "styleVersion",
  "attachment",
  "motion",
  "narration",
  "speech-script",
  "speaker",
]);
const assetKeys = new Set([
  "image",
  "filename",
  "background",
  "asset",
  "cover",
  "ref",
  "referenceId",
  "sourceId",
  "refs",
  "imageRefs",
  "designRefs",
]);
const idKeys = new Set([
  "id",
  "projectId",
  "styleId",
  "batchId",
  "slideId",
  "slideIds",
  "batchIds",
  "sourceIds",
  "replacementIds",
  "sourceId",
  "referenceId",
  "attachmentId",
]);
const secretKeys =
  /^(?:apiKey|accessKey|secret|password|authorization|workerToken|desktopToken)$/i;
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const imageName = (name) =>
  typeof name === "string" && /^[\w-]+\.(png|jpg|webp)$/.test(name);
const audioName = (name) =>
  typeof name === "string" && /^[a-f0-9-]{36}\.mp3$/.test(name);
function walk(value, visit, key = "", depth = 0) {
  if (depth > 60) throw new Error("项目数据层级过深");
  if (Array.isArray(value))
    return value.map((v) => walk(v, visit, key, depth + 1));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => {
        if (
          ["__proto__", "constructor", "prototype"].includes(k) ||
          secretKeys.test(k)
        )
          throw new Error("项目包包含不允许的配置字段");
        return [k, walk(v, visit, k, depth + 1)];
      }),
    );
  return visit(value, key);
}
function assetsOf(records) {
  const files = new Set();
  walk(records, (value, key) => {
    if (assetKeys.has(key) && imageName(value)) files.add("assets/" + value);
    if (key === "file" && audioName(value)) files.add("speech-audio/" + value);
    return value;
  });
  return files;
}
function filePath(name) {
  if (name.startsWith("assets/") && imageName(name.slice(7)))
    return assetPath(name.slice(7));
  if (name.startsWith("speech-audio/") && audioName(name.slice(13)))
    return path.join(dataDir, name);
  throw new Error("项目包素材路径无效");
}
function collect(project) {
  const records = [{ kind: "project", value: project }];
  for (const kind of ["attachment", "motion", "narration", "speech-script"])
    records.push(
      ...all(kind)
        .filter((r) => r.projectId === project.id)
        .map((value) => ({ kind, value })),
    );
  const styles = new Set([project.styleId]);
  walk(records, (v, k) => {
    if (k === "styleId" && typeof v === "string") styles.add(v);
    return v;
  });
  for (const styleId of styles) {
    const s = get("style", styleId);
    if (!s) throw new Error("项目引用的风格缺失，无法制作完整迁移包");
    records.push({ kind: "style", value: s });
    records.push(
      ...all("styleVersion")
        .filter((v) => v.styleId === styleId)
        .map((value) => ({ kind: "styleVersion", value })),
    );
  }
  const voices = new Set(
    records
      .filter((r) => r.kind === "narration")
      .map((r) => r.value.options.voiceId),
  );
  records.push(
    ...all("speaker")
      .filter((v) => voices.has(v.id))
      .map((value) => ({ kind: "speaker", value })),
  );
  return records;
}
// Filenames participate in snapshot identity. Translate snapshots together with
// asset references so existing narration and motion remain compatible.
function remapSnapshots(records, remap) {
  const fingerprints = new Map();
  function collectFingerprints(value) {
    if (!value || typeof value !== "object") return;
    if (typeof value.notes === "string" && (value.image || value.scene)) {
      const snapshot = {
        image: value.image,
        scene: value.scene,
        notes: value.notes,
      };
      fingerprints.set(
        hash(JSON.stringify(snapshot)),
        hash(JSON.stringify(remap(snapshot))),
      );
    }
    Object.values(value).forEach(collectFingerprints);
  }
  collectFingerprints(records);
  return walk(remap(records), (v, k) =>
    ["fingerprint", "sourceFingerprint"].includes(k) && fingerprints.has(v)
      ? fingerprints.get(v)
      : v,
  );
}
export async function exportProjectPackage(project, assertIdle = () => {}) {
  assertIdle(project.id);
  const source = collect(project),
    files = [],
    names = new Map(),
    paths = new Set(),
    originals = [],
    zip = new JSZip();
  for (const name of assetsOf(source)) {
    let bytes;
    try {
      bytes = await readFile(filePath(name));
    } catch {
      throw new Error(`项目素材缺失，无法完整导出：${name}`);
    }
    if (bytes.length > MAX_FILE)
      throw new Error("单个素材超过 64 MB，暂不支持迁移");
    let dest = name,
      converted = false;
    if (name.startsWith("assets/")) {
      // Keep editor/motion coordinates and evidence attachments at their actual
      // dimensions. New page images are already capped by the screen profile.
      const stored = await screenImage(bytes, { resize: false });
      if (stored.data !== bytes) {
        bytes = stored.data;
        const filename = `image-${hash(bytes)}.${stored.extension}`;
        names.set(path.posix.basename(name), filename);
        dest = "assets/" + filename;
        converted = true;
      }
    }
    if (paths.has(dest)) continue;
    paths.add(dest);
    files.push({ path: dest, size: bytes.length, sha256: hash(bytes) });
    if (converted) zip.file(dest, bytes, { compression: "STORE" });
    else originals.push({ name, dest });
  }
  if (
    files.length > 20000 ||
    files.reduce((n, f) => n + f.size, 0) > 960 * 1024 * 1024
  )
    throw new Error("项目素材超过 960 MB，请精简后再导出迁移包");
  const records = remapSnapshots(source, (value) =>
    walk(value, (v, k) =>
      assetKeys.has(k) && names.has(v) ? names.get(v) : v,
    ),
  );
  const manifest = {
    format: "AutoPPT-project",
    version: 1,
    createdAt: now(),
    projectId: project.id,
    records,
    files,
  };
  const json = JSON.stringify(manifest);
  if (Buffer.byteLength(json) > 32 * 1024 * 1024)
    throw new Error("项目历史记录超过 32 MB，暂不支持迁移");
  zip.file("manifest.json", json);
  assertIdle(project.id);
  if (projectOrThrow(project.id).revision !== project.revision)
    throw new Error("打包期间项目已更新，请重新导出");
  // Open streams only after validation, avoiding leaked handles on a failed export.
  for (const { name, dest } of originals)
    zip.file(dest, createReadStream(filePath(name)), { compression: "STORE" });
  return zip;
}
async function boundedRead(entry, max) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    const stream = entry.internalStream("nodebuffer");
    stream
      .on("data", (chunk) => {
        size += chunk.length;
        if (size > max) {
          stream.pause();
          reject(new Error("项目包解压内容超过限制"));
          return;
        }
        chunks.push(chunk);
      })
      .on("error", reject)
      .on("end", () => resolve(Buffer.concat(chunks)))
      .resume();
  });
}
function validateRecords(records, projectId) {
  if (!Array.isArray(records) || records.length > 10000)
    throw new Error("项目包记录数量无效");
  const seen = new Set();
  for (const { kind, value: v } of records) {
    if (
      !kinds.has(kind) ||
      !v ||
      typeof v.id !== "string" ||
      !/^[\w-]{1,256}$/.test(v.id)
    )
      throw new Error("项目包记录类型或编号无效");
    if (seen.has(kind + ":" + v.id)) throw new Error("项目包记录重复");
    seen.add(kind + ":" + v.id);
    if (["speech-script", "narration"].includes(kind) && v.performance) {
      const plan = v.performance;
      if (
        plan.version !== 1 ||
        !Array.isArray(plan.pages) ||
        plan.pages.length > 500
      )
        throw new Error("项目包演绎方案无效");
      performanceSettings(plan.settings);
      for (const page of plan.pages) {
        if (
          typeof page.text !== "string" ||
          page.text.length > 100000 ||
          !Array.isArray(page.units) ||
          page.units.length > 10000
        )
          throw new Error("项目包演绎正文无效");
        compilePerformancePage(page, "speech-2.8-hd", { speed: 1 });
      }
    }
    if (
      ["motion", "narration", "attachment", "speech-script"].includes(kind) &&
      v.projectId !== projectId
    )
      throw new Error("项目包混入了其他项目的记录");
    if (
      kind === "style" &&
      (typeof v.name !== "string" ||
        typeof v.rules !== "string" ||
        !Array.isArray(v.refs))
    )
      throw new Error("风格记录无效");
    if (kind === "motion") {
      if (!Array.isArray(v.pages) || v.pages.length > 500)
        throw new Error("动态页面数量无效");
      for (const p of v.pages)
        if (p.status === "ready") {
          validateLayers(p.layers, p.width, p.height);
          if (!imageName(p.background) || !imageName(p.source?.image))
            throw new Error("动态演示的素材引用无效");
        }
      if (
        v.customFont &&
        (!/^[A-Za-z0-9+/=]+$/.test(v.customFont.data) ||
          v.customFont.data.length > 12 * 1024 * 1024 ||
          Buffer.from(v.customFont.data, "base64").subarray(0, 4).toString() !==
            "wOF2")
      )
        throw new Error("内嵌字体无效");
    }
    if (kind === "narration") {
      if (
        !Array.isArray(v.pages) ||
        v.pages.length > 500 ||
        !v.options ||
        typeof v.voiceName !== "string"
      )
        throw new Error("口播记录无效");
      for (const p of v.pages) {
        if (
          !Array.isArray(p.clips) ||
          p.clips.length > 1000 ||
          typeof p.notes !== "string"
        )
          throw new Error("口播片段无效");
        if (p.status === "ready" && p.clips.some((c) => !audioName(c.file)))
          throw new Error("已完成口播缺少音频");
        if (
          p.clips.some(
            (c) =>
              typeof c.text !== "string" ||
              (c.pauseAfter !== undefined &&
                (!Number.isFinite(c.pauseAfter) ||
                  c.pauseAfter < 0 ||
                  c.pauseAfter > 2)) ||
              (c.file && !audioName(c.file)) ||
              (c.duration !== undefined &&
                (!Number.isFinite(c.duration) || c.duration < 0)),
          )
        )
          throw new Error("口播片段数据无效");
      }
    }
  }
  const projects = records.filter((r) => r.kind === "project");
  const p = projects[0]?.value;
  if (
    projects.length !== 1 ||
    p.id !== projectId ||
    typeof p.title !== "string" ||
    !Array.isArray(p.slides) ||
    p.slides.length > 500 ||
    !Array.isArray(p.batches) ||
    !Number.isSafeInteger(p.revision)
  )
    throw new Error("项目包主体无效");
  if (new Set(p.slides.map((s) => s.id)).size !== p.slides.length)
    throw new Error("页面编号重复");
  for (const s of p.slides)
    if (
      typeof s.id !== "string" ||
      typeof s.notes !== "string" ||
      !Array.isArray(s.versions) ||
      !Array.isArray(s.batchIds)
    )
      throw new Error("页面记录不完整");
  const styleIds = new Set(
    records.filter((r) => r.kind === "style").map((r) => r.value.id),
  );
  walk(records, (v, k) => {
    if (k === "styleId" && !styleIds.has(v))
      throw new Error("项目包缺少引用的风格");
    return v;
  });
  function check(v) {
    if (!v || typeof v !== "object") return;
    for (const [k, x] of Object.entries(v)) {
      if (k === "scene" && x) validateScene(x);
      if (
        assetKeys.has(k) &&
        typeof x === "string" &&
        ["image", "filename", "asset", "cover", "ref"].includes(k) &&
        x &&
        !imageName(x)
      )
        throw new Error("项目包含非法素材引用");
      check(x);
    }
  }
  check(records);
  return p;
}
export async function importProjectPackage(buffer) {
  if (!buffer?.length || buffer.length > MAX_ZIP)
    throw new Error("项目包应为不超过 1 GB 的 AutoPPT 项目 ZIP");
  const zip = await JSZip.loadAsync(buffer);
  const entries = Object.values(zip.files);
  if (entries.length > 22000) throw new Error("项目包文件数量过多");
  for (const entry of entries) {
    if (entry.unsafeOriginalName && entry.unsafeOriginalName !== entry.name)
      throw new Error("项目包包含非法路径");
    if (
      entry.name.includes("\\") ||
      entry.name.startsWith("/") ||
      entry.name.split("/").some((v) => v === ".." || v === ".")
    )
      throw new Error("项目包包含非法路径");
    if (entry.dir) {
      if (!["assets/", "speech-audio/"].includes(entry.name))
        throw new Error("项目包目录无效");
      continue;
    }
    if (entry.name !== "manifest.json") filePath(entry.name);
    if (
      entry.unixPermissions &&
      (Number(entry.unixPermissions) & 0o170000) === 0o120000
    )
      throw new Error("项目包不支持符号链接");
  }
  const entry = zip.file("manifest.json");
  if (!entry) throw new Error("不是 AutoPPT 项目包：缺少 manifest.json");
  const m = JSON.parse(
    (await boundedRead(entry, 32 * 1024 * 1024)).toString("utf8"),
  );
  if (m.format !== "AutoPPT-project" || m.version !== 1)
    throw new Error("不支持这个项目包版本，请使用更新版 AutoPPT");
  walk(m, (v) => v);
  const source = validateRecords(m.records, m.projectId);
  if (!Array.isArray(m.files) || m.files.length > 20000)
    throw new Error("项目包文件清单无效");
  let size = 0;
  const expected = assetsOf(m.records),
    listed = new Set();
  for (const f of m.files) {
    filePath(f.path);
    if (
      listed.has(f.path) ||
      !Number.isSafeInteger(f.size) ||
      f.size <= 0 ||
      f.size > MAX_FILE ||
      !/^[a-f0-9]{64}$/.test(f.sha256)
    )
      throw new Error("项目包素材清单无效");
    listed.add(f.path);
    size += f.size;
    if (size > MAX_TOTAL) throw new Error("项目包解压后超过 1 GB");
    if (!zip.file(f.path)) throw new Error("项目包缺少素材：" + f.path);
  }
  if (
    expected.size !== listed.size ||
    [...expected].some((f) => !listed.has(f)) ||
    entries.filter((e) => !e.dir).length !== listed.size + 1
  )
    throw new Error("项目包素材与记录不一致");
  const ids = new Map(),
    names = new Map(),
    written = [];
  walk(m.records, (v, k) => {
    if (k === "id" && typeof v === "string" && !ids.has(v)) ids.set(v, id());
    return v;
  });
  // Speaker IDs belong to MiniMax, rather than the local database namespace.
  for (const r of m.records.filter((r) => r.kind === "speaker"))
    ids.delete(r.value.id);
  const records = m.records.map((r) => ({
    kind: r.kind,
    value: structuredClone(r.value),
  }));
  await mkdir(path.join(dataDir, "speech-audio"), {
    recursive: true,
    mode: 0o700,
  });
  try {
    for (const f of m.files) {
      const bytes = await boundedRead(zip.file(f.path), f.size);
      if (bytes.length !== f.size || hash(bytes) !== f.sha256)
        throw new Error("项目包素材校验失败：" + f.path);
      const old = path.posix.basename(f.path),
        name = id() + path.extname(old);
      names.set(old, name);
      const dest = f.path.startsWith("assets/")
        ? assetPath(name)
        : path.join(dataDir, "speech-audio", name);
      await writeFile(dest, bytes, { flag: "wx", mode: 0o600 });
      written.push(dest);
    }
    const remap = (value) =>
      walk(value, (v, k) => {
        if ((assetKeys.has(k) || k === "file") && names.has(v))
          return names.get(v);
        if (idKeys.has(k) && ids.has(v)) return ids.get(v);
        return v;
      });
    const remapped = remapSnapshots(m.records, remap);
    for (const [index, r] of records.entries()) {
      r.value = remapped[index].value;
      const v = r.value;
      // Unit IDs are sentence ordinals, not database identities.
      if (["speech-script", "narration"].includes(r.kind) && v.performance)
        for (const page of v.performance.pages)
          page.units.forEach((unit, index) => {
            unit.id = String(index + 1);
          });
      if (r.kind === "project") {
        v.title = source.title + "（导入）";
        v.createdAt = now();
        v.updatedAt = now();
        delete v.deletedAt;
      }
      if (r.kind === "style") {
        v.builtin = false;
        v.name += "（项目导入）";
        delete v.deletedAt;
        v.status = v.rules ? "ready" : "draft";
      }
      if (
        ["motion", "narration"].includes(r.kind) &&
        ["queued", "running"].includes(v.status)
      ) {
        v.status = "interrupted";
        v.progress = "由项目包导入，已完成内容保留；点击继续才会调用模型";
        for (const p of v.pages)
          if (p.status === "running") p.status = "pending";
      }
      if (r.kind === "project")
        for (const p of v.slides)
          if (["queued", "running"].includes(p.status))
            p.status = p.image || p.scene ? "ready" : "pending";
      if (
        r.kind === "speech-script" &&
        ["queued", "running"].includes(v.performanceTask?.status)
      ) {
        v.performanceTask.status = "interrupted";
        v.performanceTask.progress =
          "导入的编排任务已暂停；点击编排才会调用模型";
      }
    }
    transaction(() => {
      for (const { kind, value } of records) {
        if (kind === "speaker" && get(kind, value.id)) continue;
        put(kind, value);
      }
      // Rebuild cache keys from the imported snapshots; account fingerprints
      // allow reuse only after the same speech account has been configured.
      for (const { value: n } of records.filter((r) => r.kind === "narration"))
        for (const p of n.pages)
          for (const c of p.clips) {
            if (!c.file || !n.provider) continue;
            const key = hash(
              JSON.stringify([
                "speech-v1",
                n.provider,
                n.model,
                c.text,
                { ...n.options, emotion: p.emotion, ...c.delivery },
              ]),
            );
            if (!get("speech-cache", key))
              put("speech-cache", {
                id: key,
                file: c.file,
                duration: c.duration,
                createdAt: now(),
              });
          }
    });
  } catch (e) {
    await Promise.allSettled(written.map((f) => unlink(f)));
    throw e;
  }
  const project = records.find((r) => r.kind === "project").value;
  return {
    project,
    warnings: [
      "已导入为新项目。模型密钥需在这台电脑单独配置；已有图片和口播可直接使用。",
    ],
  };
}
export function registerProjectPackages(app, { assertIdle }) {
  app.get("/api/projects/:id/package", async (req, res, next) => {
    const p = projectOrThrow(req.params.id);
    if (req.query.revision !== String(p.revision))
      throw Object.assign(new Error("项目已更新，请重新打开导出窗口"), {
        status: 409,
      });
    const zip = await exportProjectPackage(p, assertIdle);
    res.attachment(exportFilename(p.title).replace(/\.pptx$/, ".autoppt.zip"));
    zip
      .generateNodeStream({ streamFiles: true, compression: "DEFLATE" })
      .on("error", (e) => {
        if (res.headersSent) res.destroy(e);
        else next(e);
      })
      .pipe(res);
  });
  app.post("/api/projects/import", async (req, res) => {
    const folder = await mkdtemp(path.join(tmpdir(), "autoppt-import-"));
    try {
      const upload = multer({
        dest: folder,
        limits: { files: 1, fileSize: MAX_ZIP },
      });
      await new Promise((resolve, reject) =>
        upload.single("project")(req, res, (error) =>
          error ? reject(error) : resolve(),
        ),
      );
      if (!req.file) throw new Error("请选择 AutoPPT 项目包");
      res
        .status(201)
        .json(await importProjectPackage(await readFile(req.file.path)));
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });
}
