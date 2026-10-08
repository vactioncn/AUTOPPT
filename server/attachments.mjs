import multer from "multer";
import { screenImage } from "./image-storage.mjs";
import { unlink, writeFile } from "node:fs/promises";
import {
  id,
  now,
  get,
  put,
  transaction,
  assetPath,
  projectOrThrow,
} from "./store.mjs";

export function resolveAttachments(projectId, ids) {
  if (!Array.isArray(ids) || ids.length > 4 || new Set(ids).size !== ids.length)
    throw new Error("每页最多添加 4 张不同的内容附件。");
  return ids.map((key) => {
    const item = typeof key === "string" && get("attachment", key);
    if (!item || item.projectId !== projectId)
      throw new Error("附件不存在或不属于这个项目，请重新添加。");
    return {
      id: item.id,
      name: item.name,
      filename: item.filename,
      width: item.width,
      height: item.height,
    };
  });
}
export const attachmentKey = (items = []) => items.map((a) => a.id).join(",");
export function validateAttachmentPlacements(placements, attachments) {
  if (!attachments.length) return [];
  if (
    !Array.isArray(placements) ||
    placements.length !== attachments.length ||
    new Set(placements.map((p) => p?.id)).size !== attachments.length
  )
    throw new Error("设计方案没有安排全部内容附件，已停止出图，请重试。");
  return attachments.map((item) => {
    const placement = placements.find((p) => p?.id === item.id);
    if (
      !placement ||
      !["role", "placement", "preserve"].every(
        (k) => typeof placement[k] === "string" && placement[k].trim(),
      )
    )
      throw new Error("设计方案缺少附件的用途、位置或保留要求，请重试。");
    return {
      id: item.id,
      role: placement.role,
      placement: placement.placement,
      preserve: placement.preserve,
    };
  });
}

export function registerAttachments(app, { assertIdle }) {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { files: 4, fileSize: 12 * 1024 * 1024 },
    fileFilter(req, file, cb) {
      if (!["image/png", "image/jpeg", "image/webp"].includes(file.mimetype))
        return cb(new Error("附件仅支持 PNG、JPG、WebP 图片。"));
      cb(null, true);
    },
  });
  app.post(
    "/api/projects/:id/slides/:sid/attachments",
    (req, res, next) => {
      const p = projectOrThrow(req.params.id);
      assertIdle(p.id, [req.params.sid]);
      if (!p.slides.some((s) => s.id === req.params.sid))
        throw new Error("页面不存在。");
      next();
    },
    upload.array("images", 4),
    async (req, res) => {
      if (!req.files?.length) throw new Error("请选择 1–4 张内容附件。");
      const files = [],
        records = [];
      try {
        for (const file of req.files) {
          // Reference screenshots may contain fine data; keep their source
          // dimensions while using the same high-quality JPEG encoding.
          const { data, extension, width, height } = await screenImage(
            file.buffer,
            { resize: false, force: true },
          );
          const filename = id() + "." + extension;
          if (data.length > 30 * 1024 * 1024)
            throw new Error("附件解码后过大，请适当缩小图片再添加。");
          await writeFile(assetPath(filename), data);
          files.push(filename);
          const decoded = Buffer.from(file.originalname, "latin1").toString(
            "utf8",
          );
          const name = (decoded.includes("�") ? file.originalname : decoded)
            .replace(/[\x00-\x1f]/g, "")
            .slice(0, 120);
          records.push({
            id: id(),
            projectId: req.params.id,
            filename,
            name,
            width,
            height,
            createdAt: now(),
          });
        }
        assertIdle(req.params.id, [req.params.sid]);
        if (
          !projectOrThrow(req.params.id).slides.some(
            (s) => s.id === req.params.sid,
          )
        )
          throw new Error("页面已调整，请重新打开页面添加附件。");
        transaction(() => records.forEach((item) => put("attachment", item)));
        res.status(201).json({
          attachments: resolveAttachments(
            req.params.id,
            records.map((item) => item.id),
          ),
        });
      } catch (e) {
        await Promise.allSettled(files.map((file) => unlink(assetPath(file))));
        throw e;
      }
    },
  );
}
