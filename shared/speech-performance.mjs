// The model annotates immutable speech units; it cannot supply replacement prose.
import { splitSpeech } from "./speech.mjs";
export const PERFORMANCE_VERSION = 1;
export const DELIVERY_EMOTIONS = [
  { id: "auto", name: "自然表达" },
  { id: "calm", name: "沉稳" },
  { id: "happy", name: "热情" },
  { id: "sad", name: "感怀" },
  { id: "surprised", name: "惊喜" },
  { id: "angry", name: "愤慨" },
];
export const DELIVERY_SOUNDS = [
  { id: "", name: "无辅助声音" },
  { id: "chuckle", name: "轻笑" },
  { id: "laughs", name: "笑声" },
  { id: "sighs", name: "轻叹" },
  { id: "breath", name: "换气" },
  { id: "coughs", name: "咳嗽" },
  { id: "clear-throat", name: "清嗓" },
];
export function performanceSettings(input = {}) {
  const style = input.style || "natural";
  if (
    !["natural", "restrained", "vivid"].includes(style) ||
    (input.sounds !== undefined && typeof input.sounds !== "boolean")
  )
    throw new Error("演绎设置无效");
  return { style, sounds: input.sounds !== false };
}
export function speechUnits(text) {
  const pieces =
    text.match(/[^。！？!?\n]+[。！？!?\n]*|[。！？!?\n]+/gu) || [];
  return pieces
    .flatMap((p) => splitSpeech(p, 600))
    .map((text, i) => ({ id: String(i + 1), text }));
}
const cuePattern =
  /[【（\[(](?:[^】）\])\n]{0,20})(咳嗽|清嗓)[^】）\])\n]*[】）\])]|^\s*(咳嗽|清嗓)[。.]?\s*$/gm;
export function validateDelivery(units, output, settings, notes = "") {
  if (!Array.isArray(output) || output.length !== units.length)
    throw new Error("演绎编排不完整，请重试；正文和已有音频未改变");
  const seen = new Set();
  let sounds = 0;
  let emphasisCount = 0;
  const hasCoughCue = [...notes.matchAll(cuePattern)].some((m) =>
    m[0].includes("咳嗽"),
  );
  const hasThroatCue = [...notes.matchAll(cuePattern)].some((m) =>
    m[0].includes("清嗓"),
  );
  return units.map((unit) => {
    const cue = output.find((c) => c.id === unit.id);
    if (
      !cue ||
      seen.has(cue.id) ||
      !DELIVERY_EMOTIONS.some((e) => e.id === cue.emotion) ||
      !Number.isFinite(cue.pace) ||
      cue.pace < 0.85 ||
      cue.pace > 1.12 ||
      !Number.isFinite(cue.pauseAfter) ||
      cue.pauseAfter < 0 ||
      cue.pauseAfter > 2 ||
      typeof cue.emphasis !== "boolean" ||
      !DELIVERY_SOUNDS.some((s) => s.id === cue.sound) ||
      typeof cue.reason !== "string" ||
      cue.reason.length > 160
    )
      throw new Error("演绎编排包含无效表达指令，请重试");
    if (cue.text !== undefined && cue.text !== unit.text)
      throw new Error("演绎编排试图改写正文，已拒绝使用");
    seen.add(cue.id);
    let sound = settings.sounds ? cue.sound : "";
    if (
      (sound === "coughs" && !hasCoughCue) ||
      (sound === "clear-throat" && !hasThroatCue)
    )
      sound = "";
    // No more than one interjection per page, even when a model over-decorates.
    if (sound && ++sounds > 1) sound = "";
    return {
      ...unit,
      emotion: cue.emotion,
      pace: Math.round(cue.pace * 100) / 100,
      pauseAfter: Math.round(cue.pauseAfter * 100) / 100,
      emphasis: cue.emphasis && ++emphasisCount <= 1,
      sound,
      reason: cue.reason,
    };
  });
}
export const supportsDeliverySounds = (model) =>
  /^speech-2\.8-(?:hd|turbo)$/.test(model);
export function performanceMatches(plan, pages) {
  return (
    !!plan &&
    plan.version === PERFORMANCE_VERSION &&
    plan.pages.length === pages.length &&
    pages.every(
      (p, i) => plan.pages[i].id === p.id && plan.pages[i].text === p.text,
    )
  );
}
export function compilePerformancePage(page, model, options) {
  if (page.units.map((u) => u.text).join("") !== page.text)
    throw new Error("演绎编排与口播正文不一致，请重新编排");
  const units = validateDelivery(
    speechUnits(page.text),
    page.units,
    { sounds: true },
    page.notes || "",
  );
  if (units.some((u) => u.sound) && !supportsDeliverySounds(model))
    throw new Error(
      "当前编排含辅助声音，请在设置中选择 Speech 2.8 模型，或关闭辅助声音后重新编排",
    );
  const clips = [];
  for (const unit of units) {
    // No unsupported SSML or model-generated tags. Emphasis is a gentle whole-sentence treatment.
    if (
      /<#[^]*?#>|\((?:laughs|chuckle|coughs|clear-throat|sighs|breath)\)/i.test(
        unit.text,
      )
    )
      throw new Error("口播正文含声音控制标签，请删除标签后重新编排");
    const delivery = {
      emotion: unit.emotion,
      speed: Math.max(
        0.5,
        Math.min(
          2,
          Math.round(
            options.speed * unit.pace * (unit.emphasis ? 0.94 : 1) * 100,
          ) / 100,
        ),
      ),
      volume: unit.emphasis ? 1.12 : 1,
    };
    const text = unit.text + (unit.sound ? `(${unit.sound})` : "");
    const prev = clips.at(-1);
    if (
      prev &&
      JSON.stringify(prev.delivery) === JSON.stringify(delivery) &&
      prev.text.length + text.length < 2400
    ) {
      // Provider pauses must be between spoken text, never leading/trailing tags.
      prev.text += (prev.pauseAfter ? `<#${prev.pauseAfter}#>` : "") + text;
      prev.spokenText += unit.text;
      prev.pauseAfter = unit.pauseAfter;
    } else
      clips.push({
        text,
        spokenText: unit.text,
        delivery,
        pauseAfter: unit.pauseAfter,
      });
  }
  return clips;
}
