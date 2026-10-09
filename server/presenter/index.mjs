import { assertPaidClaim } from "../operation-context.mjs";
import { createHash } from "node:crypto";
import { mkdir, writeFile, lstat } from "node:fs/promises";
import path from "node:path";
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
import { speakerNotes } from "../manuscript.mjs";
import { narrationForExport, matchNarrationPage } from "../speech/export.mjs";
import {
  MAX_IMAGE,
  validateImage,
  validateVideo,
  videoPath,
  readLocal,
  expectedPlaybackDuration,
  avatarFingerprint,
} from "./media.mjs";
import { configuredProvider } from "./mock.mjs";
import {
  publicPresenterSettings,
  savePresenterSettings,
  testPresenterConnection,
} from "./settings.mjs";

export const placements = [
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
];
export const sizes = ["small", "medium", "large"];
const hash = (value) =>
  createHash("sha256")
    .update(Buffer.isBuffer(value) ? value : JSON.stringify(value))
    .digest("hex");
const running = new Map(),
  creating = new Map();
const validatedVideos = new Map();
const save = (v) => put("presenter", { ...v, updatedAt: now() });
const fail = (message, status = 409) =>
  Object.assign(new Error(message), { status });
const nameOf = (name) => {
  if (typeof name !== "string" || !name.trim() || name.length > 80)
    throw fail("请填写 1–80 字的头像名称", 400);
  return name.trim();
};
export function listAvatars() {
  return all("avatar").filter((a) => !a.deletedAt);
}
export async function createAvatar({ name, bytes, mime }) {
  name = nameOf(name);
  const normalized = await validateImage(bytes, mime),
    sourceAsset = id() + ".png";
  await writeFile(assetPath(sourceAsset), normalized, {
    mode: 0o600,
    flag: "wx",
  });
  return put("avatar", {
    id: id(),
    name,
    sourceAsset,
    previewAsset: sourceAsset,
    kind: "photo",
    provider: "unconfigured",
    createdAt: now(),
    updatedAt: now(),
  });
}
export function renameAvatar(key, name) {
  const avatar = get("avatar", key);
  if (!avatar || avatar.deletedAt) throw fail("头像不存在", 404);
  return put("avatar", { ...avatar, name: nameOf(name), updatedAt: now() });
}
export function deleteAvatar(key) {
  const avatar = get("avatar", key);
  if (!avatar) throw fail("头像不存在", 404);
  // Soft deletion retains immutable source and completed historical versions.
  return put("avatar", { ...avatar, deletedAt: now(), updatedAt: now() });
}
async function canonical(
  value,
  key = "",
  imageHash = async (name) => hash(await readLocal(assetPath(name))),
) {
  if (
    typeof value === "string" &&
    ["image", "asset", "background"].includes(key) &&
    /^[\w-]+\.(png|jpg|webp)$/.test(value)
  )
    return imageHash(value);
  if (Array.isArray(value))
    return Promise.all(value.map((v) => canonical(v, key, imageHash)));
  if (value && typeof value === "object") {
    const entries = await Promise.all(
      Object.keys(value)
        .filter((k) => k !== "id")
        .sort()
        .map(async (k) => [k, await canonical(value[k], k, imageHash)]),
    );
    return Object.fromEntries(entries);
  }
  return value ?? null;
}
export async function presenterSourceFingerprint(slide, imageHash) {
  return hash(
    await canonical(
      {
        image: slide.image,
        scene: slide.scene,
        notes: speakerNotes(slide),
      },
      "",
      imageHash,
    ),
  );
}
export async function pageFingerprints(slide, narrationPage, avatar) {
  const sourceFingerprint = await presenterSourceFingerprint(slide);
  const clips = [];
  for (const c of narrationPage.clips) {
    if (!/^[a-f0-9-]{36}\.mp3$/.test(c.file)) throw fail("口播音频路径无效");
    clips.push({
      bytes: hash(await readLocal(path.join(dataDir, "speech-audio", c.file))),
      text: c.text,
      duration: c.duration,
      pauseAfter: c.pauseAfter || 0,
    });
  }
  return {
    sourceFingerprint,
    audioFingerprint: hash({
      clips,
      silentDuration: narrationPage.silentDuration || 3,
    }),
    avatarFingerprint: avatarFingerprint(
      await readLocal(assetPath(avatar.sourceAsset)),
      avatar,
    ),
  };
}
const matches = (a, b) =>
  ["sourceFingerprint", "audioFingerprint", "avatarFingerprint"].every(
    (k) => a[k] === b[k],
  );
function assertProvider(provider) {
  if (!provider)
    throw fail("数字人实时服务将稍后接入；头像与选择已保留，目前不能生成。");
  if (
    !/^[a-z][a-z0-9-]{0,40}$/.test(provider.id) ||
    !provider.idempotent ||
    typeof provider.generate !== "function"
  )
    throw fail("供应商必须支持幂等请求后才能生成数字人");
}
export async function inspectPresenter(version) {
  const project = projectOrThrow(version.projectId),
    narration = get("narration", version.narrationId),
    avatar = get("avatar", version.avatarId);
  const pages = [];
  for (const page of version.pages) {
    let stale = true;
    try {
      const slide = project.slides.find((s) => s.id === page.pageId);
      if (slide && narration?.status === "ready" && avatar) {
        const n = matchNarrationPage(narration, slide);
        stale = !matches(page, await pageFingerprints(slide, n, avatar));
        if (page.status === "ready" && n.clips.length && !page.videoFile)
          stale = true;
        if (!stale && page.videoFile)
          await readPresenterVideo(
            page,
            true,
            expectedPlaybackDuration(n.clips),
          );
      }
    } catch {
      /* Missing or mismatched local sources are stale, never current. */
      stale = true;
    }
    pages.push({ ...page, stale });
  }
  return {
    ...version,
    pages,
    current:
      narration?.status === "ready" &&
      version.status === "ready" &&
      project.slides.length === pages.length &&
      project.slides.every((s) =>
        pages.some(
          (p) => p.pageId === s.id && !p.stale && p.status === "ready",
        ),
      ),
  };
}
export async function createPresenter(projectId, input, provider) {
  assertPaidClaim();
  if (input.confirmed !== true)
    throw fail("请先确认数字人生成的素材发送和费用风险");
  assertProvider(provider);
  if (!/^[a-f0-9-]{36}$/.test(input.requestId || ""))
    throw fail("请求编号无效", 400);
  if (!placements.includes(input.placement) || !sizes.includes(input.size))
    throw fail("数字人位置或大小无效", 400);
  const key = projectId + ":" + input.requestId;
  if (creating.has(key)) {
    await creating.get(key);
    return createPresenter(projectId, input, provider);
  }
  const work = (async () => {
    const project = projectOrThrow(projectId);
    const requestFingerprint = hash([
      input.avatarId,
      input.narrationId,
      input.placement,
      input.size,
      provider.id,
    ]);
    const previous = all("presenter").find(
      (v) => v.projectId === projectId && v.requestId === input.requestId,
    );
    if (previous) {
      if (previous.requestFingerprint !== requestFingerprint)
        throw fail("请求编号已用于其他选择，请重新确认");
      return previous;
    }
    const avatar = get("avatar", input.avatarId);
    if (!avatar || avatar.deletedAt) throw fail("请选择可用头像");
    const narration = narrationForExport(input.narrationId, projectId);
    if (!narration || !project.slides.length)
      throw fail("请选择已就绪且与当前页面一致的口播");
    const pages = [];
    const candidates = all("presenter").filter(
      (v) => v.projectId === projectId && v.provider === provider.id,
    );
    for (const slide of project.slides) {
      const n = matchNarrationPage(narration, slide),
        fingerprints = await pageFingerprints(slide, n, avatar);
      const cached = candidates
        .flatMap((v) => v.pages)
        .find(
          (p) =>
            p.pageId === slide.id &&
            p.status === "ready" &&
            matches(p, fingerprints),
        );
      let ready = cached;
      if (cached?.videoFile) {
        try {
          await readPresenterVideo(
            cached,
            true,
            expectedPlaybackDuration(n.clips),
          );
        } catch {
          ready = null;
        }
      }
      pages.push({
        pageId: slide.id,
        ...fingerprints,
        status: ready || !n.clips.length ? "ready" : "pending",
        ...(ready?.videoFile
          ? {
              videoFile: ready.videoFile,
              videoFingerprint: ready.videoFingerprint,
              duration: ready.duration,
            }
          : {}),
      });
    }
    return save({
      id: id(),
      projectId,
      narrationId: narration.id,
      avatarId: avatar.id,
      sourceRevision: project.revision,
      status: pages.every((p) => p.status === "ready") ? "ready" : "queued",
      progress: pages.every((p) => p.status === "ready")
        ? provider.id === "mock"
          ? "测试样本已就绪（复用）"
          : "数字人已就绪（复用）"
        : "等待生成",
      placement: input.placement,
      size: input.size,
      provider: provider.id,
      requestId: input.requestId,
      requestFingerprint,
      pages,
      createdAt: now(),
    });
  })();
  creating.set(key, work);
  try {
    return await work;
  } finally {
    creating.delete(key);
  }
}
export async function readPresenterVideo(
  page,
  validationOnly = false,
  expectedDuration,
) {
  const file = videoPath(page.videoFile),
    stat = await lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw fail("数字人视频文件无效");
  const stamp = [
    stat.size,
    stat.mtimeMs,
    stat.ctimeMs,
    page.videoFingerprint,
    page.duration,
    expectedDuration,
  ].join(":");
  if (validationOnly && validatedVideos.get(file) === stamp) return;
  const bytes = await readLocal(file);
  validateVideo({
    bytes,
    status: 200,
    contentType: "video/mp4",
    duration: page.duration,
    expectedDuration,
  });
  if (hash(bytes) !== page.videoFingerprint)
    throw fail("数字人视频校验失败，请回演练中心更新");
  if (validatedVideos.size > 512) validatedVideos.clear();
  validatedVideos.set(file, stamp);
  return validationOnly ? undefined : bytes;
}
export async function runPresenter(key, provider) {
  if (running.has(key)) return running.get(key);
  const work = (async () => {
    const v = get("presenter", key);
    if (!v || v.status !== "queued") return;
    assertProvider(provider);
    if (provider.id !== v.provider) throw fail("生成服务已改变，请重新生成");
    v.status = "running";
    save(v);
    try {
      const project = projectOrThrow(v.projectId),
        narration = narrationForExport(v.narrationId, v.projectId),
        avatar = get("avatar", v.avatarId);
      if (!avatar || avatar.deletedAt) throw fail("头像已删除");
      for (let i = 0; i < v.pages.length; i++) {
        const page = v.pages[i];
        if (page.status === "ready") continue;
        const slide = project.slides.find((s) => s.id === page.pageId),
          n = matchNarrationPage(narration, slide);
        if (!matches(page, await pageFingerprints(slide, n, avatar)))
          throw fail("来源已改变");
        page.status = "running";
        v.progress = `正在生成第 ${i + 1} / ${v.pages.length} 页`;
        save(v);
        const clips = await Promise.all(
          n.clips.map(async (c) => ({
            bytes: await readLocal(path.join(dataDir, "speech-audio", c.file)),
            contentType: "audio/mpeg",
            text: c.text,
            duration: c.duration,
            pauseAfter: c.pauseAfter || 0,
          })),
        );
        const expectedDuration = expectedPlaybackDuration(clips);
        assertPaidClaim();
        const result = await provider.generate({
          requestId: hash([
            v.requestId,
            page.pageId,
            page.sourceFingerprint,
            page.audioFingerprint,
            page.avatarFingerprint,
          ]),
          profile: {
            kind: avatar.kind,
            providerAvatarId: avatar.providerAvatarId,
            source: {
              bytes: await readLocal(assetPath(avatar.sourceAsset)),
              contentType: "image/png",
            },
          },
          pageId: page.pageId,
          audio: { clips },
          width: 512,
          height: 512,
          quality: "standard",
        });
        const validated = validateVideo({
            bytes: result.bytes,
            status: result.status,
            contentType: result.contentType,
            expectedDuration,
          }),
          file = id() + ".mp4";
        await mkdir(path.join(dataDir, "presenter-video"), {
          recursive: true,
          mode: 0o700,
        });
        await writeFile(videoPath(file), result.bytes, {
          mode: 0o600,
          flag: "wx",
        });
        Object.assign(page, {
          status: "ready",
          videoFile: file,
          duration: validated.duration,
          videoFingerprint: hash(result.bytes),
        });
        delete page.error;
        save(v);
      }
      v.status = "ready";
      v.progress =
        provider.id === "mock"
          ? "测试视频已完成（不代表真实口型生成）"
          : "数字人已完成";
    } catch {
      v.status = "partial";
      v.progress = "生成未完成，请核对来源后确认重试；已完成页面保留。";
      for (const page of v.pages)
        if (page.status === "running") {
          page.status = "failed";
          page.error = "本页生成或视频校验失败";
        }
      // Provider errors may contain signed URLs or credentials. Never persist/log them.
    } finally {
      save(v);
    }
  })();
  running.set(key, work);
  try {
    await work;
  } finally {
    running.delete(key);
  }
}
export function recoverPresenters() {
  for (const v of all("presenter"))
    if (["running", "queued"].includes(v.status)) {
      v.status = "interrupted";
      v.progress = "上次生成已中断，确认继续后才会发送相同的幂等请求。";
      for (const p of v.pages)
        if (["running", "pending"].includes(p.status)) p.status = "interrupted";
      save(v);
    }
}
export async function retryPresenter(key, confirmed, provider) {
  if (confirmed !== true) throw fail("请先确认继续生成的费用风险");
  assertProvider(provider);
  const v = get("presenter", key);
  if (!v) throw fail("数字人版本不存在", 404);
  if (["ready", "queued", "running"].includes(v.status)) return v;
  if (v.imported)
    throw fail("迁移的未完成请求不会续发，请回演练中心更新数字人并重新确认");
  if ((await inspectPresenter(v)).pages.some((p) => p.stale))
    throw fail("页面已改变，请回演练中心更新数字人");
  if (provider.id !== v.provider) throw fail("服务已改变，请重新生成");
  v.status = "queued";
  v.progress = "等待继续生成";
  for (const p of v.pages) if (p.status !== "ready") p.status = "pending";
  return save(v);
}
export async function presenterForExport(key, projectId, narrationId) {
  if (!key) return null;
  const v = typeof key === "string" && get("presenter", key);
  if (
    !v ||
    v.projectId !== projectId ||
    v.narrationId !== narrationId ||
    !(await inspectPresenter(v)).current
  )
    throw fail(
      "数字人与当前页面或口播不匹配，请回演练中心更新数字人；也可取消数字人选项导出普通 HTML。",
    );
  for (const page of v.pages)
    if (page.videoFile) await readPresenterVideo(page);
  return v;
}
export function registerPresenter(app) {
  app.use(
    [
      "/api/avatars",
      "/api/presenter",
      "/api/projects/:id/presenter",
      "/api/settings/presenter",
    ],
    (_req, _res, next) =>
      process.env.AUTOPPT_WORKER_TOKEN
        ? next(fail("数字人目前仅在本机版提供", 403))
        : next(),
  );
  app.get("/api/settings/presenter", (_req, res) =>
    res.json(publicPresenterSettings()),
  );
  app.put("/api/settings/presenter", (req, res) =>
    res.json(savePresenterSettings(req.body)),
  );
  app.post("/api/settings/presenter/test", async (_req, res) =>
    res.json(await testPresenterConnection()),
  );
  app.get("/api/avatars", (_req, res) => res.json(listAvatars()));
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { files: 1, fileSize: MAX_IMAGE, fields: 1, fieldSize: 320 },
  });
  app.post("/api/avatars", upload.single("image"), async (req, res) =>
    res.status(201).json(
      await createAvatar({
        name: req.body.name,
        bytes: req.file?.buffer,
        mime: req.file?.mimetype,
      }),
    ),
  );
  app.patch("/api/avatars/:id", (req, res) =>
    res.json(renameAvatar(req.params.id, req.body.name)),
  );
  app.delete("/api/avatars/:id", (req, res) => {
    deleteAvatar(req.params.id);
    res.json({ ok: true });
  });
  app.get("/api/projects/:id/presenter", async (req, res) => {
    projectOrThrow(req.params.id);
    res.json({
      hasKey: publicPresenterSettings().hasKey,
      configured: !!(await configuredProvider()),
      testOnly: !!(await configuredProvider()),
      versions: await Promise.all(
        all("presenter")
          .filter((v) => v.projectId === req.params.id)
          .map(inspectPresenter),
      ),
    });
  });
  app.post("/api/projects/:id/presenter", async (req, res) => {
    const provider = await configuredProvider(),
      v = await createPresenter(req.params.id, req.body, provider);
    res.status(201).json(v);
    void runPresenter(v.id, provider).catch(() => {});
  });
  app.post("/api/presenter/:id/retry", async (req, res) => {
    const provider = await configuredProvider(),
      v = await retryPresenter(req.params.id, req.body.confirmed, provider);
    res.json(v);
    void runPresenter(v.id, provider).catch(() => {});
  });
  app.get("/api/presenter/:id/video/:pageId", async (req, res) => {
    const v = get("presenter", req.params.id);
    if (!v) throw fail("数字人不存在", 404);
    const page = (await inspectPresenter(v)).pages.find(
      (p) => p.pageId === req.params.pageId,
    );
    if (!page || page.stale || page.status !== "ready" || !page.videoFile)
      throw fail("本页数字人需更新或尚未完成");
    await readPresenterVideo(page);
    res
      .set("Cache-Control", "no-store")
      .type("mp4")
      .sendFile(videoPath(page.videoFile));
  });
}
