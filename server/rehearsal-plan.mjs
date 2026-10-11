import { all, get, put, now, projectOrThrow } from "./store.mjs";
import { speechSettings, providerIdentity } from "./speech/settings.mjs";
import { voices, optionsFor } from "./speech/index.mjs";
import { speechScript } from "./speech/scripts.mjs";
import { presenterSpeech } from "./presenter/speech.mjs";
import { matchNarrationPage } from "./speech/export.mjs";

const fail = (message) => Object.assign(new Error(message), { status: 400 });
// Project choices contain references and delivery preferences, never connection settings.
export function rehearsalPlan(projectId) {
  const project = projectOrThrow(projectId),
    saved = get("rehearsal-plan", projectId);
  const old = get("presenter-setup", projectId);
  const avatarId =
    saved?.avatarId ??
    old?.avatarId ??
    get("presenter-library", "default")?.avatarId ??
    "";
  const avatar = get("avatar", avatarId);
  const available = voices(speechSettings());
  const latest = all("narration")
    .filter((n) => n.projectId === projectId && n.status === "ready")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const preferred =
    speechSettings().defaultVoiceId ||
    presenterSpeech(avatar || {}).voice?.id ||
    latest?.options?.voiceId ||
    "";
  const plan = {
    id: projectId,
    actor: old?.avatarId ? "digital" : "self",
    visual: "original",
    avatarId,
    voiceId: available.some((v) => v.id === preferred) ? preferred : "",
    emotion: "auto",
    speed: 1,
    placement: old?.placement || "bottom-right",
    size: old?.size || "small",
    narrationId: "",
    pageId: project.slides[0]?.id || "",
    slideIds: [],
    ...saved,
  };
  // Imported desktop choices stay stored, but unsupported modes cannot become web defaults.
  return process.env.AUTOPPT_WORKER_TOKEN
    ? {
        ...plan,
        actor: plan.actor === "digital" ? "voice" : plan.actor,
        visual: "original",
        avatarId: "",
      }
    : plan;
}
export function saveRehearsalPlan(projectId, input) {
  const project = projectOrThrow(projectId);
  const allowed = [
    "actor",
    "visual",
    "avatarId",
    "voiceId",
    "emotion",
    "speed",
    "placement",
    "size",
    "narrationId",
    "pageId",
    "slideIds",
  ];
  if (
    !input ||
    typeof input !== "object" ||
    Object.keys(input).some((k) => !allowed.includes(k))
  )
    throw fail("本场演讲只保存选择，不接受服务密钥或地址。");
  const plan = { ...rehearsalPlan(projectId), ...input };
  if (
    process.env.AUTOPPT_WORKER_TOKEN &&
    (plan.actor === "digital" || plan.visual !== "original" || plan.avatarId)
  )
    throw Object.assign(new Error("网页版暂不开放数字人和动态演示制作。"), {
      status: 403,
    });
  if (
    !["self", "voice", "digital"].includes(plan.actor) ||
    !["original", "motion"].includes(plan.visual) ||
    !["top-left", "top-right", "bottom-left", "bottom-right"].includes(
      plan.placement,
    ) ||
    !["small", "medium", "large"].includes(plan.size)
  )
    throw fail("演练选项无效。");
  for (const key of ["avatarId", "voiceId", "narrationId", "pageId"])
    if (typeof plan[key] !== "string") throw fail("演练选择无效。");
  if (plan.voiceId)
    optionsFor(
      { voiceId: plan.voiceId, emotion: plan.emotion, speed: plan.speed },
      speechSettings(),
    );
  if (
    plan.avatarId &&
    (!get("avatar", plan.avatarId) || get("avatar", plan.avatarId).deletedAt)
  )
    throw fail("头像已不可用，请重新选择。");
  if (
    !Array.isArray(plan.slideIds) ||
    new Set(plan.slideIds).size !== plan.slideIds.length ||
    [...plan.slideIds, ...(plan.pageId ? [plan.pageId] : [])].some(
      (sid) => !project.slides.some((s) => s.id === sid),
    )
  )
    throw fail("页面范围已改变，请重新选择。");
  if (
    plan.narrationId &&
    !all("narration").some(
      (n) =>
        n.id === plan.narrationId &&
        n.projectId === projectId &&
        n.status === "ready",
    )
  )
    throw fail("请选择本项目的已完成口播。");
  return put("rehearsal-plan", {
    id: projectId,
    ...Object.fromEntries(allowed.map((k) => [k, plan[k]])),
    updatedAt: now(),
  });
}
export function rehearsalContext(projectId) {
  const config = speechSettings();
  return {
    plan: rehearsalPlan(projectId),
    script: speechScript(projectOrThrow(projectId)),
    voices: voices(config),
    speech: { hasKey: !!config.apiKey, model: config.model },
    provider: providerIdentity(config),
    narrations: all("narration")
      .filter((n) => n.projectId === projectId && n.status === "ready")
      .map((n) => {
        let available = true;
        try {
          projectOrThrow(projectId).slides.forEach((s) =>
            matchNarrationPage(n, s),
          );
        } catch {
          available = false;
        }
        return { id: n.id, voiceName: n.voiceName, available };
      }),
  };
}
