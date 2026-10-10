import { registerRehearsal } from "../rehearsal.mjs";
import { writeFile, lstat } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import multer from "multer";
import {
  all,
  get,
  put,
  id,
  now,
  assetPath,
  dataDir,
  projectOrThrow,
} from "../store.mjs";
import { matchNarrationPage } from "../speech/export.mjs";
import { publicPresenterSettings } from "./settings.mjs";

const MAX_IMAGE = 8 * 1024 * 1024;
const placements = ["top-left", "top-right", "bottom-left", "bottom-right"];
const sizes = ["small", "medium", "large"];
const fail = (message, status = 400) =>
  Object.assign(new Error(message), { status });
const defaults = {
  avatarId: "",
  narrationId: "",
  placement: "bottom-right",
  size: "small",
};
const profile = (avatar) => ({
  id: avatar.id,
  name: avatar.name,
  previewAsset: avatar.previewAsset,
});

export async function createLocalAvatar(name, bytes, mime, extra = {}) {
  if (typeof name !== "string" || !name.trim() || name.trim().length > 80)
    throw fail("请填写 1–80 字的头像名称");
  const formats = {
    "image/jpeg": "jpeg",
    "image/png": "png",
    "image/webp": "webp",
  };
  if (
    !Buffer.isBuffer(bytes) ||
    !bytes.length ||
    bytes.length > MAX_IMAGE ||
    !formats[mime]
  )
    throw fail("头像应为不超过 8 MB 的静态 JPEG、PNG 或 WebP 图片");
  let normalized;
  try {
    const image = sharp(bytes, {
      limitInputPixels: 25000000,
      failOn: "warning",
    });
    const info = await image.metadata();
    if (
      info.format !== formats[mime] ||
      info.pages > 1 ||
      !info.width ||
      !info.height
    )
      throw new Error("invalid image");
    normalized = await image
      .rotate()
      .resize(1024, 1024, { fit: "inside", withoutEnlargement: true })
      .png()
      .toBuffer();
  } catch {
    throw fail("头像图片无效，请选择完整的静态 JPEG、PNG 或 WebP 图片");
  }
  const sourceAsset = id() + ".png";
  await writeFile(assetPath(sourceAsset), normalized, {
    mode: 0o600,
    flag: "wx",
  });
  // Store normalized local media only; choosing an avatar never uploads it to HeyGen.
  const avatar = put("avatar", {
    id: id(),
    name: name.trim(),
    sourceAsset,
    previewAsset: sourceAsset,
    kind: "photo",
    provider: "unconfigured",
    createdAt: now(),
    updatedAt: now(),
    ...extra,
  });
  return profile(avatar);
}

export async function createProjectAvatar(projectId, name, bytes, mime) {
  projectOrThrow(projectId);
  return createLocalAvatar(name, bytes, mime);
}

async function narrationChoice(project, narration) {
  const result = {
    id: narration.id,
    title: narration.title,
    voiceName: narration.voiceName,
    sourceRevision: narration.sourceRevision,
    available: false,
    reason: "",
  };
  try {
    if (
      !project.slides.length ||
      narration.pages.length !== project.slides.length
    )
      throw new Error("口播页数与当前项目不一致");
    let clips = 0;
    for (const slide of project.slides) {
      const page = matchNarrationPage(narration, slide);
      for (const clip of page.clips) {
        if (!/^[a-f0-9-]{36}\.mp3$/.test(clip.file || ""))
          throw new Error("口播音频路径无效");
        const file = await lstat(path.join(dataDir, "speech-audio", clip.file));
        if (!file.isFile() || file.isSymbolicLink() || !file.size)
          throw new Error("口播音频缺失");
        clips++;
      }
    }
    if (!clips) throw new Error("口播版本没有有声片段");
    result.available = true;
  } catch {
    result.reason = "画面、讲稿或音频与当前项目不匹配，请先更新 AI 口播。";
  }
  return result;
}

export async function projectPresenterSetup(projectId) {
  const project = projectOrThrow(projectId);
  const saved = get("presenter-setup", projectId);
  return {
    ...publicPresenterSettings(),
    setup: {
      ...defaults,
      ...(saved
        ? Object.fromEntries(
            Object.keys(defaults).map((key) => [key, saved[key]]),
          )
        : {}),
    },
    sourceMode: saved?.sourceMode || "text",
    savedAt: saved?.updatedAt || null,
    avatars: all("avatar")
      .filter((a) => !a.deletedAt)
      .map(profile),
    narrations: await Promise.all(
      all("narration")
        .filter((n) => n.projectId === projectId && n.status === "ready")
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((n) => narrationChoice(project, n)),
    ),
  };
}

export async function saveProjectPresenterSetup(projectId, input) {
  projectOrThrow(projectId);
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw fail("项目数字人配置无效");
  for (const key of Object.keys(defaults))
    if (typeof input[key] !== "string") throw fail("项目数字人配置不完整");
  if (!placements.includes(input.placement) || !sizes.includes(input.size))
    throw fail("请选择有效的数字人位置和大小");
  if (input.avatarId) {
    const avatar = get("avatar", input.avatarId);
    if (!avatar || avatar.deletedAt) throw fail("请选择可用的数字人头像");
  }
  if (input.narrationId) {
    const state = await projectPresenterSetup(projectId);
    if (
      !state.narrations.some((n) => n.id === input.narrationId && n.available)
    )
      throw fail("请选择属于本项目、与当前页面匹配的已完成口播");
  }
  put("presenter-setup", {
    id: projectId,
    projectId,
    ...Object.fromEntries(
      Object.keys(defaults).map((key) => [key, input[key]]),
    ),
    sourceMode: input.sourceMode === "audio" ? "audio" : "text",
    updatedAt: now(),
  });
  // This separate record cannot bump revisions or overwrite slides, scripts or voices.
  return projectPresenterSetup(projectId);
}

export function registerProjectPresenterSetup(app) {
  registerRehearsal(app);
  const route = "/api/projects/:id/presenter/setup";
  const avatarRoute = "/api/projects/:id/presenter/avatars";
  app.use([route, avatarRoute], (_req, _res, next) =>
    process.env.AUTOPPT_WORKER_TOKEN
      ? next(fail("数字人项目配置目前仅在本机 App 和本机版提供", 403))
      : next(),
  );
  app.get(route, async (req, res) =>
    res.json(await projectPresenterSetup(req.params.id)),
  );
  app.put(route, async (req, res) =>
    res.json(await saveProjectPresenterSetup(req.params.id, req.body)),
  );
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { files: 1, fileSize: MAX_IMAGE, fields: 1, fieldSize: 320 },
  });
  app.post(
    avatarRoute,
    (req, res, next) => {
      upload.single("image")(req, res, (error) =>
        error
          ? next(
              fail(
                error.code === "LIMIT_FILE_SIZE"
                  ? "头像图片不能超过 8 MB"
                  : "请只上传一张头像图片和头像名称",
              ),
            )
          : next(),
      );
    },
    async (req, res) =>
      res
        .status(201)
        .json(
          await createProjectAvatar(
            req.params.id,
            req.body.name,
            req.file?.buffer,
            req.file?.mimetype,
          ),
        ),
  );
}
