import { createHash } from "node:crypto";
import { SPEECH_VOICES } from "../../shared/speech.mjs";

export function hostedSpeechConfig(env, secret) {
  const base = new URL(
    env.AUTOPPT_SPEECH_BASE_URL || "https://api.minimax.cn/v1",
  );
  if (
    !["https:", "http:"].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    (base.protocol !== "https:" &&
      !["localhost", "127.0.0.1"].includes(base.hostname))
  )
    throw new Error(
      "AUTOPPT_SPEECH_BASE_URL 必须为安全的 MiniMax 原生接口地址。",
    );
  const model = env.AUTOPPT_SPEECH_MODEL || "speech-2.8-hd";
  if (!/^speech-[\w.-]{1,80}$/.test(model))
    throw new Error("语音模型必须为 MiniMax speech 系列。");
  const voiceId = env.AUTOPPT_SPEECH_VOICE_ID || SPEECH_VOICES[0].id;
  if (voiceId.length > 256 || /[\r\n]/.test(voiceId))
    throw new Error("默认声音编号无效。");
  const apiKey = secret("AUTOPPT_SPEECH_API_KEY");
  const baseUrl = base.href.replace(/\/+$/, "");
  return {
    baseUrl,
    model,
    apiKey,
    voiceId,
    voiceName: String(env.AUTOPPT_SPEECH_VOICE_NAME || "默认演讲声音").slice(
      0,
      60,
    ),
    providerId: createHash("sha256")
      .update(baseUrl + "\n" + apiKey)
      .digest("hex"),
  };
}
