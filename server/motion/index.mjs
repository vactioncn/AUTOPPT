import { withUsage } from "../usage/index.mjs";
import {
  withModelRequestProgress,
  recoveryReason,
} from "../model-request-policy.mjs";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import multer from "multer";
import sharp from "sharp";
import {
  all,
  get,
  put,
  id,
  now,
  projectOrThrow,
  assetPath,
  settings,
} from "../store.mjs";
import { renderSceneSvg } from "../../shared/slides.mjs";
import { validateLayers, MOTION_VERSION } from "../../shared/motion/schema.mjs";
import { analyzeImage, extractLayers } from "./extract.mjs";
import { renderMotionHtml, writeMotionHtml } from "./render.mjs";
import { sendHtmlDownload } from "../html-download.mjs";
import { exportFilename } from "../export.mjs";
import { narrationForExport } from "../speech/export.mjs";
const controllers = new Map();
let draining = false;
const isActive = (d) => ["queued", "running"].includes(d.status);
export const activeMotionCount = (projectId = null) =>
  all("motion").filter(
    (d) => isActive(d) && (!projectId || d.projectId === projectId),
  ).length;
const save = (d) => {
  d.updatedAt = now();
  d.revision = (d.revision || 0) + 1;
  return put("motion", d);
};
const publicDeck = (d) => ({
  ...d,
  customFont: d.customFont ? { name: d.customFont.name } : null,
});
function getDeck(key) {
  const d = get("motion", key);
  if (!d) throw Object.assign(new Error("动态演示不存在"), { status: 404 });
  projectOrThrow(d.projectId);
  return d;
}
function idle(d) {
  if (isActive(d))
    throw Object.assign(new Error("请等待转换完成或停止后再校准"), {
      status: 409,
    });
}
function revision(d, req) {
  if (req.body.revision !== d.revision)
    throw Object.assign(
      new Error("演示已在其他窗口更新，请重新载入后再保存；当前输入仍保留"),
      { status: 409 },
    );
}
function sanitizeError(e) {
  return String(e.message || "转换失败")
    .replace(/(?:sk-|Bearer\s+)[A-Za-z0-9_.-]+/g, "[密钥已隐藏]")
    .slice(0, 600);
}
function withRecovery(d, operation) {
  let stage;
  return withModelRequestProgress((waiting) => {
    if (waiting) {
      stage ??= d.progress;
      d.progress = `${stage}；${recoveryReason(waiting.reason)}，${Math.ceil(waiting.ms / 1000)} 秒后自动重试（${waiting.attempt}/${waiting.maxRetries}）`;
    } else if (stage !== undefined) {
      d.progress = stage;
      stage = undefined;
    }
    save(d);
  }, operation);
}
async function drain() {
  if (draining) return;
  draining = true;
  try {
    for (;;) {
      const d = all("motion").find((x) => x.status === "queued");
      if (!d) break;
      const controller = new AbortController();
      controllers.set(d.id, controller);
      const signal = controller.signal;
      try {
        projectOrThrow(d.projectId);
        d.status = "running";
        save(d);
        for (const p of d.pages) {
          signal.throwIfAborted();
          if (p.status === "ready" || p.status === "failed") continue;
          p.status = "running";
          p.error = null;
          d.progress = `第 ${p.number} 页：识别文字与可动元素`;
          save(d);
          try {
            if (!p.analysis) {
              p.analysis = await withUsage(
                {
                  projectId: d.projectId,
                  pageId: p.id,
                  taskId: d.id,
                  feature: "动态页面识别",
                },
                () => withRecovery(d, () => analyzeImage(p.source, signal)),
              );
              save(d);
            }
            signal.throwIfAborted();
            d.progress = `第 ${p.number} 页：分离图层`;
            save(d);
            const result = await withUsage(
              {
                projectId: d.projectId,
                pageId: p.id,
                taskId: d.id,
                feature: "动态页面图层提取",
              },
              () =>
                withRecovery(d, () =>
                  extractLayers(p.source, p.analysis, signal, (message) => {
                    d.progress = `第 ${p.number} 页：${message}`;
                    save(d);
                  }),
                ),
            );
            signal.throwIfAborted();
            Object.assign(p, result, { status: "ready", reviewed: false });
            delete p.analysis;
            // Raster sources cannot prove a font identity. Always keep the result reviewable.
            p.warnings = [
              ...new Set([
                ...p.warnings,
                "字体由图片估计，请对照原图核对字形、位置和背景残留；可导入原稿字体。",
              ]),
            ];
          } catch (e) {
            if (signal.aborted) throw e;
            p.status = "failed";
            p.error = sanitizeError(e);
          }
          save(d);
        }
        d.status = d.pages.every((p) => p.status === "ready")
          ? "ready"
          : "partial";
        d.progress =
          d.status === "ready"
            ? "转换完成，请逐页校对"
            : "部分页面未完成，可单独重试";
        save(d);
      } catch (e) {
        d.status = signal.aborted ? "cancelled" : "failed";
        d.progress = signal.aborted
          ? "已停止，完成的页面已保留"
          : sanitizeError(e);
        d.pages.forEach((p) => {
          if (p.status === "running") p.status = "pending";
        });
        save(d);
      } finally {
        controllers.delete(d.id);
      }
    }
  } finally {
    draining = false;
  }
}
export function recoverMotion() {
  for (const d of all("motion").filter(isActive)) {
    d.status = "interrupted";
    d.progress = "服务曾中断；已完成页面保留，点击继续才会恢复模型调用";
    d.pages.forEach((p) => {
      if (p.status === "running") p.status = "pending";
    });
    save(d);
  }
}
export function registerMotion(app) {
  app.get("/api/projects/:id/motion", (req, res) => {
    projectOrThrow(req.params.id);
    res.json(
      all("motion")
        .filter((d) => d.projectId === req.params.id)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map(publicDeck),
    );
  });
  app.post("/api/projects/:id/motion", async (req, res) => {
    const project = projectOrThrow(req.params.id);
    if (all("motion").some((d) => d.projectId === project.id && isActive(d)))
      throw new Error("本项目已有动态演示正在转换，请先查看现有任务");
    if (req.body.revision !== project.revision)
      throw Object.assign(new Error("项目已更新，请刷新后重新选择页面"), {
        status: 409,
      });
    const requested = req.body.slideIds;
    if (
      !Array.isArray(requested) ||
      !requested.length ||
      requested.length > 500 ||
      new Set(requested).size !== requested.length
    )
      throw new Error("请选择 1–500 页且不要重复");
    if (requested.some((sid) => !project.slides.some((s) => s.id === sid)))
      throw new Error("部分页面已不存在，请重新选择");
    const selected = project.slides.filter((s) => requested.includes(s.id));
    const missing = selected.filter((s) => !s.image && !s.scene);
    if (missing.length)
      throw new Error(`所选页面中有 ${missing.length} 页尚未生成图片`);
    const config = settings();
    if (!config.text.apiKey || !config.image.apiKey)
      throw new Error(
        "请先配置内容分析与图片生成模型；复杂背景需要图片编辑接口",
      );
    const pages = [];
    for (const s of selected) {
      let image = s.image;
      if (s.scene) {
        image = id() + ".png";
        await writeFile(
          assetPath(image),
          await sharp(
            Buffer.from(
              renderSceneSvg(s.scene).replace(
                'width="100%" height="100%"',
                'width="1600" height="900"',
              ),
            ),
          )
            .png()
            .toBuffer(),
        );
      }
      const metadata = await sharp(await readFile(assetPath(image))).metadata();
      if (metadata.orientation && metadata.orientation !== 1) {
        const name = id() + ".png";
        await sharp(await readFile(assetPath(image)))
          .rotate()
          .png()
          .toFile(assetPath(name));
        image = name;
      }
      pages.push({
        id: s.id,
        number: project.slides.indexOf(s) + 1,
        title: s.plan?.title || `第 ${project.slides.indexOf(s) + 1} 页`,
        status: "pending",
        source: {
          image,
          notes: s.notes || "",
          displayText: s.plan?.displayText || [],
          stale: !!s.stale,
          fingerprint: createHash("sha256")
            .update(
              JSON.stringify({
                image: s.image,
                scene: s.scene,
                notes: s.notes,
              }),
            )
            .digest("hex"),
        },
        layers: [],
      });
    }
    const current = projectOrThrow(project.id);
    if (current.revision !== project.revision)
      throw Object.assign(new Error("准备期间项目已更新，请重试"), {
        status: 409,
      });
    if (all("motion").some((d) => d.projectId === project.id && isActive(d)))
      throw new Error("本项目已有动态演示正在转换");
    const d = save({
      id: id(),
      version: MOTION_VERSION,
      projectId: project.id,
      sourceRevision: project.revision,
      title: project.title,
      createdAt: now(),
      status: "queued",
      progress: "等待转换",
      pages,
      customFont: null,
    });
    res.status(202).json(publicDeck(d));
    void drain();
  });
  app.get("/api/motion/:id", (req, res) =>
    res.json(publicDeck(getDeck(req.params.id))),
  );
  app.post("/api/motion/:id/cancel", (req, res) => {
    const d = getDeck(req.params.id);
    if (!isActive(d)) return res.json(publicDeck(d));
    if (controllers.has(d.id)) {
      controllers.get(d.id).abort();
      res.json({
        ...publicDeck(d),
        progress: "正在停止；已发出的模型请求可能仍计费",
      });
    } else {
      d.status = "cancelled";
      d.progress = "已停止排队";
      save(d);
      res.json(publicDeck(d));
    }
  });
  app.post("/api/motion/:id/retry", (req, res) => {
    const d = getDeck(req.params.id);
    idle(d);
    if (
      all("motion").some(
        (other) => other.projectId === d.projectId && isActive(other),
      )
    )
      throw new Error("请等待本项目另一项转换完成");
    const ids =
      req.body.pageIds ??
      d.pages.filter((p) => p.status !== "ready").map((p) => p.id);
    if (
      !Array.isArray(ids) ||
      !ids.length ||
      ids.some(
        (key) => !d.pages.some((p) => p.id === key && p.status !== "ready"),
      )
    )
      throw new Error("请选择未完成的页面重试");
    for (const p of d.pages)
      if (ids.includes(p.id)) {
        p.status = "pending";
        p.error = null;
      }
    d.status = "queued";
    d.progress = "等待继续";
    save(d);
    res.status(202).json(publicDeck(d));
    void drain();
  });
  app.patch("/api/motion/:id/pages/:pageId", (req, res) => {
    const d = getDeck(req.params.id);
    idle(d);
    revision(d, req);
    const p = d.pages.find((p) => p.id === req.params.pageId);
    if (!p || p.status !== "ready") throw new Error("页面未完成");
    const layers = validateLayers(req.body.layers, p.width, p.height);
    if (
      layers.length !== p.layers.length ||
      layers.some(
        (l) =>
          !p.layers.some(
            (old) =>
              old.id === l.id &&
              old.type === l.type &&
              (l.type !== "image" || old.asset === l.asset),
          ),
      )
    )
      throw new Error("不能添加或替换已分离的图片图层");
    if (layers.some((l) => l.font === "custom") && !d.customFont)
      throw new Error("请先导入原稿字体");
    p.layers = layers;
    p.reviewed = req.body.reviewed === true;
    save(d);
    res.json(publicDeck(d));
  });
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  });
  app.post("/api/motion/:id/font", upload.single("font"), (req, res) => {
    const d = getDeck(req.params.id);
    idle(d);
    if (Number(req.body.revision) !== d.revision)
      throw Object.assign(new Error("演示已更新，请刷新后重试"), {
        status: 409,
      });
    if (!req.file || req.file.buffer.subarray(0, 4).toString() !== "wOF2")
      throw new Error("请上传有效的 WOFF2 字体（最多 8 MB）");
    d.customFont = {
      name: req.file.originalname.slice(0, 120),
      data: req.file.buffer.toString("base64"),
    };
    d.pages.forEach((p) => (p.reviewed = false));
    save(d);
    res.json(publicDeck(d));
  });
  app.post("/api/motion/:id/pages/:pageId/preview", async (req, res) => {
    const d = getDeck(req.params.id),
      p = d.pages.find((p) => p.id === req.params.pageId);
    if (!p || p.status !== "ready") throw new Error("页面未完成");
    const layers = validateLayers(req.body.layers, p.width, p.height);
    if (
      layers.length !== p.layers.length ||
      layers.some(
        (l) =>
          !p.layers.some(
            (old) =>
              old.id === l.id &&
              old.type === l.type &&
              (l.type !== "image" || old.asset === l.asset),
          ),
      )
    )
      throw new Error("图层来源不匹配");
    if (layers.some((l) => l.font === "custom") && !d.customFont)
      throw new Error("请先导入原稿字体");
    res
      .type("html")
      .send(
        await renderMotionHtml(
          { ...d, pages: [{ ...p, layers }] },
          { preview: true, compare: true, includeNotes: false },
        ),
      );
  });
  app.get("/api/motion/:id/html", async (req, res) => {
    const d = getDeck(req.params.id),
      preview = req.query.preview === "1";
    const pageId =
      typeof req.query.pageId === "string" ? req.query.pageId : null;
    await sendHtmlDownload(
      res,
      exportFilename(d.title).replace(/\.pptx$/, "-动态演示.html"),
      req.query.download === "1",
      (file, signal) =>
        writeMotionHtml(
          d,
          {
            preview,
            pageId,
            includeNotes: req.query.notes === "1",
            compare: preview,
            narration: preview
              ? null
              : narrationForExport(req.query.narration, d.projectId),
          },
          file,
          { signal },
        ),
    );
  });
}
