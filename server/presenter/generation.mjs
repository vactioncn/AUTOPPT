import path from "node:path";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import {
  all,
  get,
  put,
  id,
  now,
  dataDir,
  assetPath,
  projectOrThrow,
} from "../store.mjs";
import { matchNarrationPage } from "../speech/export.mjs";
import { presenterSettings } from "./settings.mjs";
import { readLocal, videoPath, validateVideo } from "./media.mjs";
import { createHeyGenProvider } from "./heygen.mjs";
import { speakerNotes } from "../manuscript.mjs";
import { prepareSpeechText } from "../../shared/speech-text.mjs";
import { splitSpeech } from "../../shared/speech.mjs";

const kind = "presenter-generation";
const running = new Map();
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fail = (message, status = 400) =>
  Object.assign(new Error(message), { status });
const uuid = (v) =>
  typeof v === "string" &&
  /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const pageStamp = (slide) =>
  hash(JSON.stringify([slide.image, slide.scene || null, speakerNotes(slide)]));
export const textClip = (text, imageHash, voiceId, index = 0) => ({
  index,
  text,
  duration: 0,
  fingerprint: hash(JSON.stringify(["heygen-text", imageHash, voiceId, text])),
});

async function textSources(projectId) {
  const project = projectOrThrow(projectId);
  const setup = get("presenter-setup", projectId) || {};
  const avatar = get(
    "avatar",
    setup.avatarId || get("presenter-library", "default")?.avatarId,
  );
  if (!avatar || avatar.deletedAt)
    throw fail("请先在设置的数字人工作室保存一个头像，再回来选择。");
  if (!avatar.voiceId)
    throw fail("这个数字人还没有声音，请到数字人工作室选择中文声音并保存。");
  const image = await readLocal(assetPath(avatar.sourceAsset));
  const imageHash = hash(image);
  if (!image.length || image.length > 8 * 1024 * 1024)
    throw fail("头像文件缺失或过大，请到数字人工作室重新保存。");
  const pages = project.slides.map((s, index) => {
    const text = prepareSpeechText(speakerNotes(s)).text;
    return {
      id: s.id,
      number: index + 1,
      title: s.plan?.title || `第 ${index + 1} 页`,
      sourceFingerprint: pageStamp(s),
      clips: splitSpeech(text, 800)
        .filter((t) => t.trim())
        .map((t, i) => textClip(t, imageHash, avatar.voiceId, i)),
    };
  });
  return { project, avatar, imageHash, narration: { id: "" }, setup, pages };
}

async function sources(projectId, setup = get("presenter-setup", projectId)) {
  const project = projectOrThrow(projectId);
  const avatar = get("avatar", setup?.avatarId);
  const narration = get("narration", setup?.narrationId);
  if (
    !avatar ||
    avatar.deletedAt ||
    !narration ||
    narration.projectId !== projectId ||
    narration.status !== "ready"
  )
    throw fail("请先保存本项目的头像及已完成口播版本。");
  const image = await readLocal(assetPath(avatar.sourceAsset));
  if (!image.length || image.length > 8 * 1024 * 1024)
    throw fail("头像文件缺失或过大。");
  if (
    !project.slides.length ||
    narration.pages.length !== project.slides.length
  )
    throw fail("口播与当前项目不匹配，请先更新 AI 口播。");
  const pages = [];
  const imageHash = hash(image);
  for (const slide of project.slides) {
    const page = matchNarrationPage(narration, slide);
    const clips = [];
    for (const [index, clip] of page.clips.entries()) {
      if (
        !uuid((clip.file || "").replace(/\.mp3$/, "")) ||
        !clip.file.endsWith(".mp3") ||
        !Number.isFinite(clip.duration) ||
        clip.duration <= 0 ||
        clip.duration > 1800
      )
        throw fail("口播文件或时长无效，请先更新 AI 口播。");
      const audio = await readLocal(
        path.join(dataDir, "speech-audio", clip.file),
      );
      if (!audio.length || audio.length > 32 * 1024 * 1024)
        throw fail("口播文件缺失，或单个片段超过 HeyGen 的 32 MB 限制。");
      const audioHash = hash(audio);
      clips.push({
        index,
        audioFile: clip.file,
        audioHash,
        duration: clip.duration,
        fingerprint: hash(
          JSON.stringify([imageHash, audioHash, clip.duration]),
        ),
      });
    }
    pages.push({
      id: slide.id,
      title: page.title || slide.plan?.title || "页面",
      clips,
    });
  }
  return { project, avatar, imageHash, narration, setup, pages };
}

export function activePresenterCount(projectId) {
  return all(kind).filter(
    (j) =>
      (!projectId || j.projectId === projectId) &&
      ["queued", "running"].includes(j.status),
  ).length;
}
export function recoverPresenters() {
  for (const job of all(kind))
    if (["queued", "running"].includes(job.status))
      put(kind, {
        ...job,
        status: "interrupted",
        message: "App 已重新打开。点击继续查询或下载，恢复已提交的任务。",
        updatedAt: now(),
      });
}
async function compatible(job) {
  try {
    if (job.mode === "text") {
      const avatar = get("avatar", job.avatarId);
      if (
        !avatar ||
        avatar.deletedAt ||
        hash(await readLocal(assetPath(avatar.sourceAsset))) !== job.imageHash
      )
        return false;
      if (job.preview) return true;
      const project = projectOrThrow(job.projectId);
      return job.pages.every((p) =>
        project.slides.some(
          (s) => s.id === p.id && pageStamp(s) === p.sourceFingerprint,
        ),
      );
    }
    const source = await sources(job.projectId, job);
    return (
      source.imageHash === job.imageHash &&
      job.pages.every((page) => {
        const current = source.pages.find((p) => p.id === page.id);
        return (
          current &&
          current.clips.length === page.clips.length &&
          page.clips.every(
            (c, i) => c.fingerprint === current.clips[i].fingerprint,
          )
        );
      })
    );
  } catch {
    return false;
  }
}
export async function publicGeneration(job) {
  return {
    id: job.id,
    narrationId: job.narrationId,
    avatarId: job.avatarId,
    avatarName: job.avatarName,
    voiceName: job.voiceName,
    mode: job.mode || "audio",
    preview: !!job.preview,
    placement: job.placement,
    size: job.size,
    scope: job.scope,
    status: job.status,
    message: job.message || "",
    createdAt: job.createdAt,
    compatible: await compatible(job),
    pages: job.pages.map((p) => ({
      id: p.id,
      title: p.title,
      number: p.number,
      clips: p.clips.map((c) => ({
        index: c.index,
        duration: c.duration,
        text: job.mode === "text" ? c.text : undefined,
        status: c.status,
        file: c.status === "ready" ? c.videoFile : undefined,
      })),
    })),
  };
}
export async function listGenerations(projectId) {
  projectOrThrow(projectId);
  return Promise.all(
    all(kind)
      .filter((j) => j.projectId === projectId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(publicGeneration),
  );
}

// Test injection only through function arguments. Production routes cannot choose an endpoint or provider.
export async function createGeneration(
  projectId,
  input,
  providerFactory = createHeyGenProvider,
  options = {},
) {
  if (
    !input ||
    input.confirmed !== true ||
    !uuid(input.requestId) ||
    !["page", "all"].includes(input.scope) ||
    (input.scope === "page" && typeof input.pageId !== "string")
  )
    throw fail("请确认生成范围及 HeyGen 计费后再开始。");
  const findRequest = () =>
    all(kind).find(
      (j) => j.projectId === projectId && j.requestId === input.requestId,
    );
  const previous = findRequest();
  if (previous) {
    if (
      previous.scope !== input.scope ||
      previous.pageId !== (input.pageId || "")
    )
      throw fail("同一请求编号不能更改生成范围。", 409);
    return previous;
  }
  if (activePresenterCount(projectId))
    throw fail("本项目已有数字人生成任务，请等待完成或停止后续生成。", 409);
  const { apiKey } = presenterSettings();
  if (!apiKey) throw fail("请先在设置中保存 HeyGen API Key。");
  const source =
    input.mode === "text"
      ? await textSources(projectId)
      : await sources(projectId);
  const pages = source.pages.filter(
    (p) => input.scope === "all" || p.id === input.pageId,
  );
  if (!pages.length || !pages.some((p) => p.clips.length))
    throw fail(
      input.mode === "text"
        ? "所选页面还没有逐页讲稿，请先填写讲稿。"
        : "所选页面没有可生成的口播音频。",
    );
  const wanted = new Set(
    pages.flatMap((p) => p.clips.map((c) => c.fingerprint)),
  );
  if (
    all(kind).some(
      (j) =>
        j.projectId === projectId &&
        j.pages.some((p) =>
          p.clips.some(
            (c) =>
              wanted.has(c.fingerprint) &&
              c.videoRequest &&
              c.status !== "ready" &&
              !c.remoteFailed,
          ),
        ),
    )
  )
    throw fail(
      "这些口播片段已有未确认完成的 HeyGen 提交，请先继续查询或下载原任务，避免重复计费。",
      409,
    );
  // No await between the second lock check and insertion: simultaneous requests cannot double-submit.
  if (findRequest()) return findRequest();
  if (activePresenterCount(projectId))
    throw fail("本项目已有数字人生成任务。", 409);
  const job = put(kind, {
    id: id(),
    projectId,
    requestId: input.requestId,
    pageId: input.pageId || "",
    scope: input.scope,
    avatarId: source.avatar.id,
    imageAsset: source.avatar.sourceAsset,
    imageHash: source.imageHash,
    narrationId: source.narration.id,
    mode: input.mode === "text" ? "text" : "audio",
    avatarName: source.avatar.name,
    voiceName: source.avatar.voiceName,
    voiceId: input.mode === "text" ? source.avatar.voiceId : undefined,
    placement: source.setup.placement || "bottom-right",
    size: source.setup.size || "small",
    accountHash: hash(apiKey),
    status: "queued",
    createdAt: now(),
    updatedAt: now(),
    pages: pages.map((p) => ({
      ...p,
      clips: p.clips.map((c) => ({ ...c, status: "pending" })),
    })),
  });
  start(job, providerFactory({ apiKey }), options);
  return job;
}

export async function createPreview(
  input,
  providerFactory = createHeyGenProvider,
  options = {},
) {
  if (
    input?.confirmed !== true ||
    !uuid(input.requestId) ||
    typeof input.text !== "string" ||
    !input.text.trim() ||
    input.text.length > 300
  )
    throw fail("请输入 1–300 字试播文本，确认上传和费用后再生成。");
  const previous = all(kind).find(
    (j) => j.preview && j.requestId === input.requestId,
  );
  if (previous) return previous;
  if (
    all(kind).some((j) => j.preview && ["queued", "running"].includes(j.status))
  )
    throw fail("已有试播正在生成，请稍候或停止后续生成。", 409);
  const avatar = get("avatar", input.avatarId);
  if (!avatar || avatar.deletedAt || !avatar.voiceId)
    throw fail("请先保存数字人的头像和声音，再进行试播。");
  const { apiKey } = presenterSettings();
  if (!apiKey) throw fail("请先在数字人工作室连接 HeyGen。");
  const imageHash = hash(await readLocal(assetPath(avatar.sourceAsset)));
  const repeated = all(kind).find(
    (j) => j.preview && j.requestId === input.requestId,
  );
  if (repeated) return repeated;
  const clip = textClip(input.text.trim(), imageHash, avatar.voiceId);
  if (
    all(kind).some(
      (j) =>
        j.preview &&
        j.pages.some((p) =>
          p.clips.some(
            (c) =>
              c.fingerprint === clip.fingerprint &&
              c.videoRequest &&
              c.status !== "ready" &&
              !c.remoteFailed,
          ),
        ),
    )
  )
    throw fail("相同试播已有未完成提交，请继续查询原任务，避免重复计费。", 409);
  if (
    all(kind).some((j) => j.preview && ["queued", "running"].includes(j.status))
  )
    throw fail("已有试播正在生成。", 409);
  const job = put(kind, {
    id: id(),
    requestId: input.requestId,
    projectId: null,
    preview: true,
    mode: "text",
    scope: "page",
    avatarId: avatar.id,
    avatarName: avatar.name,
    imageAsset: avatar.sourceAsset,
    imageHash,
    voiceId: avatar.voiceId,
    voiceName: avatar.voiceName,
    narrationId: "",
    accountHash: hash(apiKey),
    status: "queued",
    createdAt: now(),
    updatedAt: now(),
    pages: [
      {
        id: "preview",
        title: "数字人试播",
        clips: [{ ...clip, status: "pending" }],
      },
    ],
  });
  start(job, providerFactory({ apiKey }), options);
  return job;
}

function start(job, provider, options) {
  if (running.has(job.id)) return running.get(job.id);
  const task = run(job, provider, options).finally(() =>
    running.delete(job.id),
  );
  running.set(job.id, task);
  return task;
}
export async function waitForGeneration(jobId) {
  await running.get(jobId);
  return get(kind, jobId);
}
export async function resumeGeneration(
  projectId,
  jobId,
  confirmed,
  providerFactory = createHeyGenProvider,
  options = {},
) {
  if (projectId) projectOrThrow(projectId);
  const job = get(kind, jobId);
  if (!job || job.projectId !== projectId)
    throw fail("数字人任务不存在。", 404);
  if (confirmed !== true) throw fail("请确认继续处理尚未完成的片段。");
  if (job.status === "ready" || running.has(job.id)) return job;
  if (activePresenterCount(projectId))
    throw fail("请先等待本项目的数字人任务结束。", 409);
  if (!(await compatible(job)))
    throw fail(
      "照片、页面或口播已改变，请按当前配置重新生成；已有视频会保留。",
      409,
    );
  // Compatibility reads are asynchronous; another resume may have started meanwhile.
  if (running.has(job.id)) return get(kind, job.id);
  if (activePresenterCount(projectId))
    throw fail("请先等待本项目的数字人任务结束。", 409);
  const { apiKey } = presenterSettings();
  if (!apiKey || hash(apiKey) !== job.accountHash)
    throw fail(
      "请使用生成此任务时的 HeyGen 密钥继续，避免跨账号重复提交。",
      409,
    );
  if (job.pages.some((p) => p.clips.some((c) => c.remoteFailed)))
    throw fail(
      "HeyGen 已明确报告生成失败。请重新选择生成范围并确认新任务计费。",
      409,
    );
  job.stopRequested = false;
  job.status = "queued";
  put(kind, job);
  start(job, providerFactory({ apiKey }), options);
  return job;
}
export function stopGeneration(projectId, jobId) {
  if (projectId) projectOrThrow(projectId);
  const job = get(kind, jobId);
  if (!job || job.projectId !== projectId)
    throw fail("数字人任务不存在。", 404);
  if (["queued", "running"].includes(job.status))
    put(kind, { ...job, stopRequested: true });
  return { stopped: true };
}

async function run(job, provider, { pollMs = 10000, maxPolls = 180 } = {}) {
  const save = () => {
    job.stopRequested = get(kind, job.id)?.stopRequested || false;
    job.updatedAt = now();
    put(kind, job);
  };
  const checkStop = () => {
    if (get(kind, job.id)?.stopRequested)
      throw fail(
        "后续生成已停止。已被 HeyGen 接受的任务仍可能完成并计费，之后可继续查询。",
        499,
      );
  };
  const checkpoint = (owner, key) => {
    if (!owner[key]) {
      owner[key] = { key: id(), at: now() };
      save();
    }
    if (Date.now() - Date.parse(owner[key].at) > 23 * 60 * 60 * 1000)
      throw fail(
        "此提交已超过安全重试时限。请先到 HeyGen 核对任务，避免重复计费；已有视频仍保留。",
        409,
      );
    return owner[key].key;
  };
  try {
    job.status = "running";
    job.message = "正在准备数字人口型";
    save();
    for (const page of job.pages)
      for (const clip of page.clips) {
        checkStop();
        if (clip.status === "ready") continue;
        // Match immutable media fingerprints, not page numbers or titles.
        let reused = false;
        for (const old of all(kind)) {
          const cached = old.pages
            .flatMap((p) => p.clips)
            .find(
              (c) => c.status === "ready" && c.fingerprint === clip.fingerprint,
            );
          if (!cached) continue;
          try {
            const bytes = await readLocal(videoPath(cached.videoFile));
            if (hash(bytes) !== cached.videoHash) continue;
            validateVideo({
              bytes,
              status: 200,
              contentType: "video/mp4",
              expectedDuration: job.mode === "text" ? undefined : clip.duration,
            });
            Object.assign(clip, {
              status: "ready",
              videoFile: cached.videoFile,
              videoHash: cached.videoHash,
              duration: cached.duration,
            });
            save();
            reused = true;
            break;
          } catch {
            /* Missing or damaged video is never reused. */
          }
        }
        if (reused) continue;
        if (!clip.providerVideoId) {
          const image = await readLocal(assetPath(job.imageAsset));
          const audio =
            job.mode === "text"
              ? null
              : await readLocal(
                  path.join(dataDir, "speech-audio", clip.audioFile),
                );
          if (
            hash(image) !== job.imageHash ||
            (audio && hash(audio) !== clip.audioHash)
          )
            throw fail("素材发生变化，请按当前配置重新生成。");
          if (!job.imageUploadId) {
            job.message = "正在上传头像";
            save();
            job.imageUploadId = await provider.upload(
              image,
              "presenter.png",
              "image/png",
              checkpoint(job, "imageRequest"),
            );
            save();
          }
          checkStop();
          if (audio && !clip.audioUploadId) {
            job.message = "正在上传所选口播片段";
            save();
            clip.audioUploadId = await provider.upload(
              audio,
              "narration.mp3",
              "audio/mpeg",
              checkpoint(clip, "audioRequest"),
            );
            save();
          }
          checkStop();
          clip.payload ||= {
            type: "image",
            image: { type: "asset_id", asset_id: job.imageUploadId },
            ...(job.mode === "text"
              ? { script: clip.text, voice_id: job.voiceId }
              : { audio_asset_id: clip.audioUploadId }),
            title: "AutoPPT presenter",
            resolution: "720p",
            aspect_ratio: "1:1",
            output_format: "mp4",
          };
          job.message = "正在提交数字人口型生成";
          clip.status = "processing";
          save();
          clip.providerVideoId = await provider.create(
            clip.payload,
            checkpoint(clip, "videoRequest"),
          );
          save();
        }
        let result;
        for (let i = 0; i < maxPolls; i++) {
          checkStop();
          job.message = "HeyGen 正在生成数字人口型，请稍候";
          save();
          result = await provider.status(clip.providerVideoId);
          if (result.status === "failed") {
            clip.remoteFailed = true;
            save();
            throw fail(
              "HeyGen 报告此片段生成失败，请在 HeyGen 中检查照片、音频及账号额度。已有片段保留。",
            );
          }
          if (result.status === "completed") break;
          await sleep(pollMs);
        }
        if (result?.status !== "completed")
          throw fail("HeyGen 仍在处理。请稍后继续查询，已有提交不会重新生成。");
        checkStop();
        job.message = "正在保存已生成视频";
        save();
        const media = await provider.download(result.url);
        const validated = validateVideo({
          bytes: media.body,
          status: media.status,
          contentType: media.headers["content-type"],
          expectedDuration: job.mode === "text" ? undefined : clip.duration,
        });
        await mkdir(path.join(dataDir, "presenter-video"), {
          recursive: true,
          mode: 0o700,
        });
        const filename = id() + ".mp4";
        await writeFile(videoPath(filename), media.body, {
          mode: 0o600,
          flag: "wx",
        });
        Object.assign(clip, {
          status: "ready",
          videoFile: filename,
          videoHash: hash(media.body),
          duration: validated.duration,
        });
        save();
      }
    job.status = "ready";
    job.message = "数字人口型已完成，可以预览并打开演讲播放器。";
    save();
  } catch (error) {
    job.status = error.status === 499 ? "stopped" : "interrupted";
    job.message = error.message;
    save();
  }
}

export function registerPresenterGeneration(app) {
  const route = "/api/projects/:id/presenter/generations";
  const media = "/api/presenter/video/:file";
  app.use([route, media], (_req, _res, next) =>
    process.env.AUTOPPT_WORKER_TOKEN
      ? next(fail("数字人生成目前仅在本机 App 和本机版提供。", 403))
      : next(),
  );
  app.get(route, async (req, res) =>
    res.json(await listGenerations(req.params.id)),
  );
  app.post(route, async (req, res) =>
    res
      .status(202)
      .json(
        await publicGeneration(await createGeneration(req.params.id, req.body)),
      ),
  );
  app.post(route + "/:jobId/resume", async (req, res) =>
    res.json(
      await publicGeneration(
        await resumeGeneration(
          req.params.id,
          req.params.jobId,
          req.body?.confirmed,
        ),
      ),
    ),
  );
  app.post(route + "/:jobId/stop", (req, res) =>
    res.json(stopGeneration(req.params.id, req.params.jobId)),
  );
  app.get(media, async (req, res) => {
    const owner = all(kind).find(
      (j) =>
        (j.preview ||
          (get("project", j.projectId) &&
            !get("project", j.projectId).deletedAt)) &&
        j.pages.some((p) =>
          p.clips.some(
            (c) => c.status === "ready" && c.videoFile === req.params.file,
          ),
        ),
    );
    if (!owner) throw fail("数字人视频不存在。", 404);
    if (!owner.preview) projectOrThrow(owner.projectId);
    const bytes = await readLocal(videoPath(req.params.file));
    res.set({
      "Content-Type": "video/mp4",
      "Cache-Control": "private, max-age=3600",
      "Accept-Ranges": "bytes",
      "X-Content-Type-Options": "nosniff",
    });
    // Range support is required for seeking and video/audio synchronization in WebKit/Chromium.
    const range = req.headers.range;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      const start = match?.[1]
        ? Number(match[1])
        : Math.max(0, bytes.length - Number(match?.[2]));
      const end = match?.[1] && match[2] ? Number(match[2]) : bytes.length - 1;
      if (
        !match ||
        (!match[1] && !match[2]) ||
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) ||
        start < 0 ||
        end < start ||
        start >= bytes.length ||
        end >= bytes.length
      )
        return res
          .status(416)
          .set("Content-Range", `bytes */${bytes.length}`)
          .end();
      return res
        .status(206)
        .set("Content-Range", `bytes ${start}-${end}/${bytes.length}`)
        .send(bytes.subarray(start, end + 1));
    }
    res.send(bytes);
  });
}
