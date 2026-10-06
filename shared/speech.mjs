export const SPEECH_VOICES = [
  {
    id: "Chinese (Mandarin)_Male_Announcer",
    name: "播报男声",
    description: "清晰、有分量",
  },
  {
    id: "Chinese (Mandarin)_News_Anchor",
    name: "新闻女声",
    description: "专业、从容",
  },
  {
    id: "Chinese (Mandarin)_Radio_Host",
    name: "电台男主播",
    description: "亲切、适合叙事",
  },
  {
    id: "Chinese (Mandarin)_Gentle_Senior",
    name: "温柔学姐",
    description: "柔和、自然",
  },
];
export const SPEECH_EMOTIONS = [
  { id: "auto", name: "随文表达" },
  { id: "neutral", name: "平稳讲述" },
  { id: "happy", name: "热情愉悦" },
  { id: "sad", name: "低沉感怀" },
  { id: "surprised", name: "惊喜强调" },
];
export const SPEECH_DEFAULTS = {
  voiceId: SPEECH_VOICES[0].id,
  emotion: "auto",
  speed: 1,
};
export function speechOptions(input = {}) {
  const options = { ...SPEECH_DEFAULTS, ...input };
  if (
    typeof options.voiceId !== "string" ||
    !options.voiceId ||
    options.voiceId.length > 256
  )
    throw new Error("请选择一个声音");
  if (!SPEECH_EMOTIONS.some((x) => x.id === options.emotion))
    throw new Error("请选择有效的情绪");
  if (
    !Number.isFinite(options.speed) ||
    options.speed < 0.5 ||
    options.speed > 2
  )
    throw new Error("语速应在 0.5–2 倍之间");
  return {
    voiceId: options.voiceId,
    emotion: options.emotion,
    speed: options.speed,
  };
}
// Keep every character and prefer sentence boundaries. Do not rewrite the speaker's script.
export function splitSpeech(text, limit = 2500) {
  if (!Number.isInteger(limit) || limit < 2) throw new Error("分段长度无效");
  const chars = Array.from(text),
    chunks = [];
  for (let start = 0; start < chars.length;) {
    let end = Math.min(start + limit, chars.length);
    if (end < chars.length) {
      for (let n = end; n > start + limit / 2; n--)
        if (/[。！？；.!?;\n]/u.test(chars[n - 1])) {
          end = n;
          break;
        }
    }
    chunks.push(chars.slice(start, end).join(""));
    start = end;
  }
  return chunks;
}
