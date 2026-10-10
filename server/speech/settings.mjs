import {
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  chmodSync,
} from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { SPEECH_VOICES } from "../../shared/speech.mjs";
import { all, dataDir } from "../store.mjs";
const filename = path.join(dataDir, "speech-settings.json");
export function speechSettings() {
  const saved = existsSync(filename)
    ? JSON.parse(readFileSync(filename, "utf8"))
    : {};
  return {
    baseUrl: "https://api.minimax.cn/v1",
    model: "speech-2.8-hd",
    apiKey: "",
    ...saved,
  };
}
export function publicSpeechSettings() {
  const { apiKey, ...config } = speechSettings();
  return { ...config, hasKey: !!apiKey };
}
export const providerIdentity = (config) =>
  createHash("sha256")
    .update(config.baseUrl + "\n" + config.apiKey)
    .digest("hex");
export function saveSpeechSettings(input) {
  const previous = speechSettings();
  const baseUrl = String(input.baseUrl || previous.baseUrl)
    .trim()
    .replace(/\/+$/, "");
  const url = new URL(baseUrl);
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("请输入完整的 HTTP(S) 接口地址，不含密钥或查询参数");
  if (
    url.protocol !== "https:" &&
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  )
    throw new Error("远程语音服务必须使用 HTTPS");
  const model = String(input.model || previous.model).trim();
  if (!/^speech-[\w.-]{1,80}$/.test(model))
    throw new Error("请填写 MiniMax speech 系列模型名称");
  const apiKey = input.clearKey
    ? ""
    : String(input.apiKey || "").trim() ||
      (baseUrl === previous.baseUrl ? previous.apiKey : "");
  const defaultVoiceId =
    input.defaultVoiceId ??
    (baseUrl === previous.baseUrl && apiKey === previous.apiKey
      ? previous.defaultVoiceId || ""
      : "");
  const provider = providerIdentity({ baseUrl, apiKey });
  if (
    typeof defaultVoiceId !== "string" ||
    (defaultVoiceId &&
      !SPEECH_VOICES.some((v) => v.id === defaultVoiceId) &&
      !all("speaker").some(
        (v) => v.id === defaultVoiceId && v.provider === provider,
      ))
  )
    throw new Error("默认声音不属于当前 MiniMax 账号，请重新选择。");
  writeFileSync(
    filename + ".tmp",
    JSON.stringify({ baseUrl, model, apiKey, defaultVoiceId }, null, 2),
    { mode: 0o600 },
  );
  renameSync(filename + ".tmp", filename);
  chmodSync(filename, 0o600);
  return publicSpeechSettings();
}
