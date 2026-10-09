import { createHash } from "node:crypto";
import { all, get, put, id, now, settings, assetPath } from "../store.mjs";
import multer from "multer";
import { createLocalAvatar } from "./project-setup.mjs";
import { presenterSettings, publicPresenterSettings } from "./settings.mjs";
import { createHeyGenProvider } from "./heygen.mjs";
import {
  createPreview,
  publicGeneration,
  resumeGeneration,
  stopGeneration,
} from "./generation.mjs";
import { readLocal } from "./media.mjs";
import { request } from "../models.mjs";
import { publicFetch } from "../public-fetch.mjs";

export const avatarStyles = [
  { id: "original", name: "原始照片" },
  { id: "professional", name: "职业照" },
  { id: "cartoon", name: "卡通" },
  { id: "costume", name: "古装" },
];
const fail = (message, status = 400) =>
  Object.assign(new Error(message), { status });
const publicAvatar = (a) => ({
  id: a.id,
  name: a.name,
  previewAsset: a.previewAsset,
  style: a.style || "original",
  voiceId: a.voiceId || "",
  voiceName: a.voiceName || "未选择声音",
  ready: !!a.voiceId,
  createdAt: a.createdAt,
});
let styleBusy = false;
export const activeAvatarCount = () => (styleBusy ? 1 : 0);
function avatar(id) {
  const a = get("avatar", id);
  if (!a || a.deletedAt) throw fail("数字人已不存在，请重新选择。", 404);
  return a;
}
export function studioState() {
  const avatars = all("avatar")
    .filter((a) => !a.deletedAt)
    .sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""))
    .map(publicAvatar);
  return {
    ...publicPresenterSettings(),
    avatars,
    defaultAvatarId:
      get("presenter-library", "default")?.avatarId || avatars[0]?.id || "",
    styles: avatarStyles,
    imageAvailable: !!settings().image.apiKey,
  };
}
export async function studioVoices(
  refresh = false,
  providerFactory = createHeyGenProvider,
) {
  const { apiKey } = presenterSettings();
  if (!apiKey) throw fail("先连接 HeyGen，再选择数字人的中文声音。");
  const key = createHash("sha256").update(apiKey).digest("hex"),
    cached = get("presenter-voices", key);
  if (!refresh && cached && Date.now() - Date.parse(cached.createdAt) < 600000)
    return cached.voices;
  const voices = await providerFactory({ apiKey }).voices();
  put("presenter-voices", { id: key, voices, createdAt: now() });
  return voices;
}
async function fields(input, old = {}) {
  const name = input.name ?? old.name,
    style = input.style ?? old.style ?? "original",
    voiceId = input.voiceId ?? old.voiceId ?? "";
  if (typeof name !== "string" || !name.trim() || name.trim().length > 80)
    throw fail("请填写 1–80 字数字人名称。");
  if (!avatarStyles.some((s) => s.id === style))
    throw fail("请选择原始照片、职业照、卡通或古装风格。");
  let voiceName = old.voiceName || "";
  if (voiceId && voiceId !== old.voiceId) {
    const voice = (await studioVoices()).find((v) => v.id === voiceId);
    if (!voice)
      throw fail("这个声音不在当前账号的中文列表，请刷新声音列表后重选。");
    voiceName = voice.name;
  }
  return { name: name.trim(), style, voiceId, voiceName };
}
export async function saveAvatar(id, input) {
  const old = avatar(id);
  const next = await fields(input, old);
  put("avatar", { ...old, ...next, updatedAt: now() });
  if (input.makeDefault === true)
    put("presenter-library", { id: "default", avatarId: id, updatedAt: now() });
  return studioState();
}
export async function addAvatar(input, bytes, mime) {
  const extra = await fields(input);
  const added = await createLocalAvatar(extra.name, bytes, mime, extra);
  if (!get("presenter-library", "default"))
    put("presenter-library", {
      id: "default",
      avatarId: added.id,
      updatedAt: now(),
    });
  return studioState();
}
export async function generateAvatarStyle(avatarId, input) {
  if (input.confirmed !== true)
    throw fail("请确认照片上传和图片生成费用后开始。");
  if (styleBusy) throw fail("已有头像风格正在生成，请等待完成。", 409);
  const source = avatar(avatarId),
    extra = await fields(input, source);
  if (extra.style === "original") throw fail("请选择职业照、卡通或古装风格。");
  const config = settings().image;
  if (!config.apiKey)
    throw fail(
      "请先在模型与服务中连接图片生成服务，或直接上传准备好的风格头像。",
    );
  const prompts = {
    professional:
      "真实摄影职业半身照，简洁浅灰背景，得体西装，自然专业，保留本人身份特征",
    cartoon:
      "精致三维卡通半身肖像，保留本人五官特征与眼镜等辨识点，明亮干净背景",
    costume:
      "中国古装人物半身肖像，传统雅致衣冠，保留本人身份与五官特征，简洁背景",
  };
  if (styleBusy) throw fail("已有头像风格正在生成，请等待完成。", 409);
  const variantName =
    input.name ||
    source.name.slice(0, 60) +
      " · " +
      avatarStyles.find((s) => s.id === extra.style).name;
  styleBusy = true;
  try {
    const form = new FormData();
    form.set("model", config.model);
    form.set(
      "prompt",
      prompts[extra.style] +
        "。正面看向镜头，只画一个人，嘴部清晰无遮挡，无文字，适合数字人口型。参考图仅用于本人形象。",
    );
    form.set("size", "1024x1024");
    form.set("n", "1");
    form.append(
      "image[]",
      new Blob([await readLocal(assetPath(source.sourceAsset))], {
        type: "image/png",
      }),
      "portrait.png",
    );
    const result = await request(
        "image",
        "/images/edits",
        form,
        AbortSignal.timeout(180000),
        true,
      ),
      item = result.data?.[0];
    let bytes;
    if (item?.b64_json) bytes = Buffer.from(item.b64_json, "base64");
    else if (item?.url) {
      const r = await publicFetch(item.url, {
        maxBytes: 8 * 1024 * 1024,
        followRedirects: false,
      });
      if (r.status !== 200)
        throw fail("风格头像已生成，但下载未完成，请检查图片服务。");
      bytes = r.body;
    } else
      throw fail(
        "图片服务未返回风格头像，请检查是否支持带照片的 Images Edits 接口。",
      );
    const sharp = (await import("sharp")).default;
    const normalized = await sharp(bytes, { limitInputPixels: 25000000 })
      .rotate()
      .resize(1024, 1024, { fit: "inside" })
      .png()
      .toBuffer();
    await createLocalAvatar(variantName, normalized, "image/png", {
      ...extra,
      name: variantName,
      parentAvatarId: source.id,
    });
    return studioState();
  } finally {
    styleBusy = false;
  }
}
export function registerPresenterLibrary(app) {
  const base = "/api/presenter";
  app.use(
    [base + "/studio", base + "/voices", base + "/avatars", base + "/previews"],
    (_req, _res, next) =>
      process.env.AUTOPPT_WORKER_TOKEN
        ? next(fail("数字人工作室目前仅在本机 App 提供。", 403))
        : next(),
  );
  app.get(base + "/studio", (_req, res) => res.json(studioState()));
  app.get(base + "/voices", async (req, res) =>
    res.json(await studioVoices(req.query.refresh === "1")),
  );
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { files: 1, fileSize: 8 * 1024 * 1024, fields: 3, fieldSize: 320 },
  });
  app.post(base + "/avatars", upload.single("image"), async (req, res) => {
    if (!req.file) throw fail("请选择一张头像图片。");
    res
      .status(201)
      .json(await addAvatar(req.body, req.file.buffer, req.file.mimetype));
  });
  app.patch(base + "/avatars/:id", async (req, res) =>
    res.json(await saveAvatar(req.params.id, req.body)),
  );
  app.delete(base + "/avatars/:id", (req, res) => {
    const a = avatar(req.params.id);
    if (
      all("presenter-generation").some(
        (j) => j.avatarId === a.id && ["queued", "running"].includes(j.status),
      )
    )
      throw fail("这个数字人正在生成，请等待完成后再移出列表。", 409);
    put("avatar", { ...a, deletedAt: now() });
    if (get("presenter-library", "default")?.avatarId === a.id)
      put("presenter-library", {
        id: "default",
        avatarId: "",
        updatedAt: now(),
      });
    res.json(studioState());
  });
  app.post(base + "/avatars/:id/style", async (req, res) =>
    res.json(await generateAvatarStyle(req.params.id, req.body)),
  );
  app.get(base + "/previews", async (_req, res) =>
    res.json(
      await Promise.all(
        all("presenter-generation")
          .filter((j) => j.preview)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .map(publicGeneration),
      ),
    ),
  );
  app.post(base + "/previews", async (req, res) =>
    res.status(202).json(await publicGeneration(await createPreview(req.body))),
  );
  app.post(base + "/previews/:id/resume", async (req, res) =>
    res.json(
      await publicGeneration(
        await resumeGeneration(null, req.params.id, req.body?.confirmed),
      ),
    ),
  );
  app.post(base + "/previews/:id/stop", (req, res) =>
    res.json(stopGeneration(null, req.params.id)),
  );
}
