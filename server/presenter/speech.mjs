import { all } from "../store.mjs";
import { voices, optionsFor } from "../speech/index.mjs";
import { speechSettings, providerIdentity } from "../speech/settings.mjs";

// A photo does not identify a voice. Reuse a saved MiniMax selection or the
// most recently used narration voice; never substitute a HeyGen stock voice.
export function presenterSpeech(avatar = {}) {
  const config = speechSettings();
  const available = voices(config);
  const provider = providerIdentity(config);
  let voiceId = avatar.speechVoiceId;
  if (voiceId && avatar.speechProvider !== provider) voiceId = "";
  if (avatar.speechVoiceId === undefined) {
    voiceId = all("narration")
      .filter(
        (n) =>
          n.status === "ready" &&
          available.some((v) => v.id === n.options?.voiceId),
      )
      .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))[0]
      ?.options.voiceId;
    const custom = available.filter((v) => v.custom);
    if (!voiceId && custom.length === 1) voiceId = custom[0].id;
  }
  const voice = available.find((v) => v.id === voiceId);
  return {
    config,
    provider,
    voice,
    options: voice ? optionsFor({ voiceId: voice.id }, config) : null,
  };
}

export function requirePresenterSpeech(avatar) {
  const speech = presenterSpeech(avatar);
  if (!speech.config.apiKey)
    throw new Error("请先在设置的语音与声音中连接 MiniMax，再生成数字人讲解。");
  if (!speech.voice)
    throw new Error(
      "请在数字人工作室选择你的 MiniMax 声音并保存；使用本人声音需先采集演讲者声音。",
    );
  return speech;
}
