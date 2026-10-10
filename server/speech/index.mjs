import { withUsage, recordCache } from "../usage/index.mjs";
import { createHash } from "node:crypto";
import { mkdirSync, existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import multer from "multer";
import { all, get, put, id, now, dataDir, projectOrThrow } from "../store.mjs";
import { speakerNotes } from "../manuscript.mjs";
import {
  SPEECH_VOICES,
  speechOptions,
  splitSpeech,
} from "../../shared/speech.mjs";
import {
  speechSettings,
  publicSpeechSettings,
  saveSpeechSettings,
  providerIdentity,
} from "./settings.mjs";
import { synthesize, cloneVoice, validateSample } from "./provider.mjs";
import { speechScript, saveSpeechScript } from "./scripts.mjs";
import {
  activePerformanceCount,
  recoverPerformances,
  registerPerformance,
} from "./performance.mjs";
import {
  compilePerformancePage,
  performanceMatches,
} from "../../shared/speech-performance.mjs";
import {
  prepareSpeechText,
  SPEECH_TEXT_VERSION,
} from "../../shared/speech-text.mjs";
const audioDir = path.join(dataDir, "speech-audio");
mkdirSync(audioDir, { recursive: true, mode: 0o700 });
const hash = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const running = (d) => ["queued", "running"].includes(d.status);
const controllers = new Map();
let quickOperation = false,
  draining = false;
export const activeSpeechCount = (projectId = null) =>
  all("narration").filter(
    (d) => running(d) && (!projectId || d.projectId === projectId),
  ).length +
  all("rehearsal-run").filter(
    (r) =>
      r.plan.actor === "voice" &&
      running({ status: r.audioStatus }) &&
      (!projectId || r.projectId === projectId),
  ).length +
  (!projectId && quickOperation ? 1 : 0) +
  activePerformanceCount(projectId) +
  all("presenter-generation").filter(
    (d) =>
      d.mode === "minimax" &&
      running(d) &&
      (!projectId || d.projectId === projectId),
  ).length;
const save = (d) => put("narration", { ...d, updatedAt: now() });
const safeDeck = ({ provider, ...d }) => d;
function deck(key) {
  const d = get("narration", key);
  if (!d) throw new Error("语音演示不存在");
  projectOrThrow(d.projectId);
  return d;
}
function assertIdle() {
  if (activeSpeechCount())
    throw Object.assign(new Error("请等待当前语音任务结束，或先停止生成"), {
      status: 409,
    });
}
export function voices(config) {
  return [
    ...SPEECH_VOICES,
    ...all("speaker")
      .filter((v) => v.provider === providerIdentity(config))
      .map(({ id, name, createdAt }) => ({
        id,
        name,
        createdAt,
        custom: true,
        description: "演讲者的声音",
      })),
  ];
}
export function optionsFor(input, config) {
  const options = speechOptions(input);
  if (!voices(config).some((v) => v.id === options.voiceId))
    throw new Error("这个声音不属于当前语音服务账号，请重新选择或采集");
  return options;
}
function requireKey(config) {
  if (!config.apiKey) throw new Error("请先在模型设置中连接 MiniMax 语音服务");
}
function assetFile(name) {
  if (!/^[a-f0-9-]{36}\.mp3$/.test(name)) throw new Error("音频路径无效");
  return path.join(audioDir, name);
}
export async function cachedAudio(config, text, options, signal, onWait) {
  const key = hash([
    "speech-v1",
    providerIdentity(config),
    config.model,
    text,
    options,
  ]);
  const cached = get("speech-cache", key);
  if (cached && existsSync(assetFile(cached.file))) {
    recordCache(config, cached.duration);
    return cached;
  }
  signal?.throwIfAborted();
  const { audio, duration } = await synthesize(
    config,
    text,
    options,
    signal,
    onWait,
  );
  signal?.throwIfAborted();
  const file = id() + ".mp3";
  await writeFile(assetFile(file), audio, { mode: 0o600 });
  return put("speech-cache", { id: key, file, duration, createdAt: now() });
}
async function drain() {
  if (draining) return;
  draining = true;
  try {
    for (;;) {
      const d = all("narration").find((x) => x.status === "queued");
      if (!d) break;
      const controller = new AbortController(),
        signal = controller.signal;
      controllers.set(d.id, controller);
      try {
        projectOrThrow(d.projectId);
        const config = speechSettings();
        if (d.provider !== providerIdentity(config) || d.model !== config.model)
          throw new Error("语音配置已改变，请用当前配置重新生成");
        d.status = "running";
        save(d);
        for (const p of d.pages) {
          signal.throwIfAborted();
          if (p.status === "ready") continue;
          p.status = "running";
          p.error = "";
          save(d);
          try {
            for (const clip of p.clips) {
              signal.throwIfAborted();
              if (clip.file && existsSync(assetFile(clip.file))) continue;
              d.progress = `正在生成第 ${p.number} 页口播`;
              save(d);
              const audio = await withUsage(
                {
                  projectId: d.projectId,
                  pageId: p.id,
                  taskId: d.id,
                  feature: "整场口播",
                },
                () =>
                  cachedAudio(
                    config,
                    clip.text,
                    { ...d.options, emotion: p.emotion, ...clip.delivery },
                    signal,
                    (waiting) => {
                      d.progress = !waiting
                        ? `正在生成第 ${p.number} 页口播`
                        : waiting.reason === "rate-limit"
                          ? `第 ${p.number} 页遇到 MiniMax 限流，等待 ${Math.ceil(waiting.ms / 1000)} 秒后自动继续（重试 ${waiting.attempt}/${waiting.maxRetries}）`
                          : waiting.reason === "pace"
                            ? `正在控制请求频率，稍后生成第 ${p.number} 页口播`
                            : `语音服务暂时繁忙，等待 ${Math.ceil(waiting.ms / 1000)} 秒后自动继续（重试 ${waiting.attempt}/${waiting.maxRetries}）`;
                      save(d);
                    },
                  ),
              );
              signal.throwIfAborted();
              clip.file = audio.file;
              clip.duration = audio.duration;
              save(d);
            }
            p.status = "ready";
          } catch (e) {
            if (signal.aborted) throw e;
            p.status = "failed";
            p.error = e.message;
            // Stop on a provider failure; don't repeat a bad/expensive request for every page.
            throw e;
          }
          save(d);
        }
        d.status = "ready";
        d.progress = "口播已就绪，可以开始演讲";
      } catch (e) {
        d.status = signal.aborted ? "cancelled" : "partial";
        d.progress = signal.aborted ? "已停止，完成的语音已保留" : e.message;
        for (const p of d.pages)
          if (p.status === "running") p.status = "pending";
      } finally {
        save(d);
        controllers.delete(d.id);
      }
    }
  } finally {
    draining = false;
  }
}
export function recoverSpeech() {
  recoverPerformances();
  for (const run of all("rehearsal-run"))
    if (
      run.plan.actor === "voice" &&
      ["queued", "running"].includes(run.audioStatus)
    )
      put("rehearsal-run", {
        ...run,
        audioStatus: "interrupted",
        error: "上次口播中断。点击继续已有任务，已完成音频会复用。",
        updatedAt: now(),
      });
  for (const d of all("narration").filter(running)) {
    d.status = "interrupted";
    d.progress = "上次生成中断，点击继续才会恢复语音请求";
    for (const p of d.pages) if (p.status === "running") p.status = "pending";
    save(d);
  }
}
export function registerSpeech(app) {
  const localOnly = (_req, _res, next) =>
    process.env.AUTOPPT_WORKER_TOKEN
      ? next(
          Object.assign(new Error("语音功能目前仅在本机版提供"), {
            status: 403,
          }),
        )
      : next();
  app.use(
    [
      "/api/speech",
      "/api/settings/speech",
      "/api/narration",
      "/api/projects/:id/narration",
      "/api/projects/:id/speech-script",
      "/api/projects/:id/speech-performance",
    ],
    localOnly,
  );
  registerPerformance(app, assertIdle);
  app.get("/api/settings/speech", (_req, res) =>
    res.json(publicSpeechSettings()),
  );
  app.put("/api/settings/speech", (req, res) => {
    assertIdle();
    res.json(saveSpeechSettings(req.body));
  });
  app.get("/api/speech/voices", (_req, res) =>
    res.json(voices(speechSettings())),
  );
  app.get("/api/speech/audio/:file", (req, res, next) => {
    const file = path.basename(assetFile(req.params.file));
    res.set("Cache-Control", "private, max-age=31536000, immutable");
    // Resolve the validated filename within the audio root. An absolute path
    // would make sendFile reject a hidden ancestor such as the default .local.
    res.sendFile(file, { root: audioDir, dotfiles: "deny" }, (err) => {
      if (!err) return;
      if (!res.headersSent) res.set("Cache-Control", "no-store");
      next(err);
    });
  });
  app.post("/api/speech/preview", async (req, res) => {
    assertIdle();
    const config = speechSettings();
    requireKey(config);
    let options = optionsFor(req.body.options, config);
    const input = String(req.body.text || "");
    let text = (
      req.body.prepared === true ? input : prepareSpeechText(input).text
    ).trim();
    if (req.body.performanceId) {
      const project = projectOrThrow(req.body.projectId);
      const plan = speechScript(project).performance;
      if (plan?.id !== req.body.performanceId)
        throw new Error("演绎方案已改变，请重新载入");
      const page = plan.pages.find((p) => p.id === req.body.pageId);
      if (!page || page.text !== input)
        throw new Error("本页文本已改变，请重新编排后试听");
      const sample = {
        ...page,
        text: page.units[0]?.text || "",
        units: page.units.slice(0, 1),
      };
      const clip = compilePerformancePage(sample, config.model, options)[0];
      if (!clip) throw new Error("本页没有口播正文");
      text = clip.text;
      options = { ...options, ...clip.delivery };
    }
    if (!text || Array.from(text).length > (req.body.performanceId ? 750 : 300))
      throw new Error("试听文本过长或为空");
    quickOperation = true;
    const controller = new AbortController();
    res.on("close", () => controller.abort());
    try {
      res.json(await cachedAudio(config, text, options, controller.signal));
    } finally {
      quickOperation = false;
    }
  });
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { files: 1, fileSize: 20 * 1024 * 1024 },
  });
  app.post(
    "/api/speech/voices/clone",
    upload.single("audio"),
    async (req, res) => {
      assertIdle();
      const config = speechSettings();
      requireKey(config);
      if (req.body.consent !== "true")
        throw new Error("请先确认这是本人声音或已获得演讲者授权");
      const name = String(req.body.name || "").trim();
      if (!name || name.length > 60)
        throw new Error("请填写 1–60 字的声音名称");
      validateSample(req.file);
      const voiceId = "AutoPPT" + id().replaceAll("-", "");
      quickOperation = true;
      // Finish saving the voice even if the browser closes after the upload.
      try {
        await cloneVoice(config, req.file, voiceId);
        put("speaker", {
          id: voiceId,
          name,
          provider: providerIdentity(config),
          consentAt: now(),
          createdAt: now(),
        });
        res.status(201).json(voices(config));
      } finally {
        quickOperation = false;
      }
    },
  );
  app.get("/api/projects/:id/narration", (req, res) => {
    projectOrThrow(req.params.id);
    res.json(
      all("narration")
        .filter((d) => d.projectId === req.params.id)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map(safeDeck),
    );
  });
  app.get("/api/projects/:id/speech-script", (req, res) =>
    res.json(speechScript(projectOrThrow(req.params.id))),
  );
  app.put("/api/projects/:id/speech-script", (req, res) => {
    res.json(saveSpeechScript(projectOrThrow(req.params.id), req.body));
  });
  app.post("/api/projects/:id/narration", (req, res) => {
    assertIdle();
    const config = speechSettings();
    requireKey(config);
    const p = projectOrThrow(req.params.id);
    if (p.revision !== req.body.revision)
      throw Object.assign(new Error("讲稿已更新，请关闭播放器后重新打开"), {
        status: 409,
      });
    if (!p.slides.length || p.slides.length > 500)
      throw new Error("语音演示支持 1–500 页");
    if (p.batches?.some((b) => !b.slideIds?.length))
      throw new Error("还有讲稿未完成拆页，请先完成内容拆分");
    const options = optionsFor(req.body.options, config);
    const script = req.body.pageTexts
      ? saveSpeechScript(p, req.body)
      : speechScript(p);
    const performance = req.body.performanceId ? script.performance : null;
    if (
      req.body.performanceId &&
      (performance?.id !== req.body.performanceId ||
        !performanceMatches(performance, script.pages))
    )
      throw Object.assign(
        new Error("口播正文已改变，请重新编排演绎或切回普通口播"),
        { status: 409 },
      );
    const emotions = req.body.pageEmotions || {};
    if (
      typeof emotions !== "object" ||
      Array.isArray(emotions) ||
      Object.keys(emotions).some((key) => !p.slides.some((s) => s.id === key))
    )
      throw new Error("逐页情绪设置无效");
    const pages = p.slides.map((s, index) => {
      if (!s.image && !s.scene)
        throw new Error(`第 ${index + 1} 页尚未生成画面`);
      const notes = speakerNotes(s);
      const spokenText = script.pages[index].text;
      const emotion = speechOptions({
        ...options,
        emotion: emotions[s.id] || options.emotion,
      }).emotion;
      return {
        id: s.id,
        number: index + 1,
        title: s.plan?.title || `第 ${index + 1} 页`,
        image: s.image,
        scene: s.scene || null,
        notes,
        sourceFingerprint: createHash("sha256")
          .update(
            JSON.stringify({ image: s.image, scene: s.scene, notes: s.notes }),
          )
          .digest("hex"),
        spokenText,
        speechTextVersion: SPEECH_TEXT_VERSION,
        silentDuration: spokenText ? 0 : 3,
        stale: !!s.stale,
        emotion,
        status: spokenText ? "pending" : "ready",
        clips: performance
          ? compilePerformancePage(
              performance.pages[index],
              config.model,
              options,
            )
          : splitSpeech(spokenText).map((text) => ({ text })),
      };
    });
    const d = save({
      id: id(),
      projectId: p.id,
      title: p.title,
      sourceRevision: p.revision,
      provider: providerIdentity(config),
      model: config.model,
      voiceName: voices(config).find((v) => v.id === options.voiceId).name,
      options,
      ...(performance ? { performance } : {}),
      pages,
      createdAt: now(),
      status: "queued",
      progress: "等待生成口播",
    });
    res.status(202).json(safeDeck(d));
    void drain();
  });
  app.get("/api/narration/:id", (req, res) =>
    res.json(safeDeck(deck(req.params.id))),
  );
  app.post("/api/narration/:id/cancel", (req, res) => {
    const d = deck(req.params.id);
    if (controllers.has(d.id)) controllers.get(d.id).abort();
    else if (running(d)) {
      d.status = "cancelled";
      d.progress = "已停止排队";
      save(d);
    }
    res.json(safeDeck(d));
  });
  app.post("/api/narration/:id/retry", (req, res) => {
    assertIdle();
    const d = deck(req.params.id),
      config = speechSettings();
    requireKey(config);
    if (d.status === "ready") return res.json(safeDeck(d));
    if (d.provider !== providerIdentity(config) || d.model !== config.model)
      throw new Error("语音服务或模型已改变，请重新生成");
    d.status = "queued";
    d.progress = "等待继续";
    save(d);
    res.status(202).json(safeDeck(d));
    void drain();
  });
}
