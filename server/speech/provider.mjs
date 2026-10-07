// MiniMax native speech protocol; deliberately separate from the image/text gateway.
import { createHash } from "node:crypto";
import { createSpeechRequestPolicy } from "./request-policy.mjs";

const scheduleSpeech = createSpeechRequestPolicy();
const errorMessages = {
  1001: "MiniMax 语音请求超时，请稍后继续；已发出的请求可能计费",
  1002: "MiniMax 语音请求频率超限（错误码 1002），请稍后继续，已完成的音频会保留",
  1004: "MiniMax 语音密钥验证失败（错误码 1004），请检查 API Key",
  1008: "MiniMax 账户余额不足（错误码 1008），请检查账户余额后继续",
  2013: "MiniMax 语音请求参数有误（错误码 2013），请检查模型与语音设置",
  20132: "MiniMax 录音样本或音色编号有误（错误码 20132），请检查复刻声音",
  2038: "MiniMax 尚未开放该账号的声音复刻功能（错误码 2038），请检查实名认证",
  2042: "MiniMax 账号无权使用这个音色（错误码 2042），请选择当前账号的声音",
  2045: "MiniMax 语音请求增长过快（错误码 2045），请稍后继续，已完成的音频会保留",
  2049: "MiniMax 语音密钥无效（错误码 2049），请检查 API Key",
};
function serviceError(code, response) {
  const header = response.headers.get("retry-after");
  const retryAfterMs = header
    ? /^\d+(\.\d+)?$/.test(header)
      ? Number(header) * 1000
      : Date.parse(header) - Date.now()
    : 0;
  return Object.assign(
    new Error(
      errorMessages[code] ||
        (response.status === 429
          ? "MiniMax 语音请求频率超限（HTTP 429），请稍后继续，已完成的音频会保留"
          : `语音服务未完成请求（错误码 ${code || "未知"}），请核对服务设置或联系服务方`),
    ),
    {
      providerCode: code,
      rateLimited: code === 1002 || code === 2045 || response.status === 429,
      retryAfterMs: Number.isFinite(retryAfterMs)
        ? Math.max(0, retryAfterMs)
        : 0,
    },
  );
}
async function request(config, endpoint, body, signal) {
  if (!config.apiKey)
    throw new Error("请先在模型设置中配置 MiniMax 语音服务密钥");
  const form = body instanceof FormData;
  let response;
  try {
    response = await fetch(config.baseUrl + endpoint, {
      method: "POST",
      redirect: "error",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        ...(!form ? { "Content-Type": "application/json" } : {}),
      },
      body: form
        ? body
        : JSON.stringify(body).replace(/"file_id":"(\d+)"/, '"file_id":$1'),
      signal: AbortSignal.any([
        signal || new AbortController().signal,
        AbortSignal.timeout(180000),
      ]),
    });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new Error(
      "语音服务连接失败或超时，请检查接口地址和网络；已发出请求可能计费",
    );
  }
  if (response.status === 429) throw serviceError(null, response);
  if (!response.ok)
    throw new Error(
      `语音服务请求失败（HTTP ${response.status}），请检查密钥、额度与权限`,
    );
  const raw = await response.text();
  let data;
  try {
    data = JSON.parse(raw.replace(/"file_id"\s*:\s*(\d+)/g, '"file_id":"$1"'));
  } catch {
    throw new Error("语音服务返回了无效响应");
  }
  if (data.base_resp?.status_code !== 0)
    throw serviceError(Number(data.base_resp?.status_code), response);
  return data;
}
export async function synthesize(config, text, options, signal, onWait) {
  const account = createHash("sha256")
    .update(config.baseUrl + "\n" + config.apiKey)
    .digest("hex");
  const data = await scheduleSpeech(
    account,
    () =>
      request(
        config,
        "/t2a_v2",
        {
          model: config.model,
          text,
          stream: false,
          output_format: "hex",
          language_boost: "auto",
          voice_setting: {
            voice_id: options.voiceId,
            speed: options.speed,
            vol: options.volume ?? 1,
            pitch: 0,
            ...(options.emotion === "auto"
              ? {}
              : {
                  // Keep the saved/UI value stable; MiniMax names neutral delivery "calm".
                  emotion:
                    options.emotion === "neutral" ? "calm" : options.emotion,
                }),
          },
          audio_setting: {
            sample_rate: 32000,
            bitrate: 128000,
            format: "mp3",
            channel: 1,
          },
        },
        signal,
      ),
    { signal, onWait },
  );
  const hex = data.data?.audio;
  if (
    data.data?.status !== 2 ||
    typeof hex !== "string" ||
    !hex.length ||
    hex.length > 100 * 1024 * 1024 ||
    hex.length % 2 ||
    !/^[0-9a-f]+$/i.test(hex)
  )
    throw new Error("语音服务未返回完整的 MP3 音频");
  return {
    audio: Buffer.from(hex, "hex"),
    duration: Number(data.extra_info?.audio_length || 0) / 1000,
  };
}
export function validateSample(file) {
  if (!file || file.buffer.length > 20 * 1024 * 1024)
    throw new Error("请选择 20 MB 以内的 WAV、MP3 或 M4A 录音");
  const b = file.buffer;
  const wav =
    b.subarray(0, 4).toString() === "RIFF" &&
    b.subarray(8, 12).toString() === "WAVE";
  const mp3 =
    b.subarray(0, 3).toString() === "ID3" ||
    (b[0] === 255 && (b[1] & 224) === 224);
  const m4a = b.subarray(4, 8).toString() === "ftyp";
  if (!wav && !mp3 && !m4a)
    throw new Error("录音格式无效，请选择 WAV、MP3 或 M4A 文件");
  // Browser recordings are PCM WAV: validate actual duration, not client metadata.
  if (wav) {
    let rate = 0,
      bytes = 0;
    for (let at = 12; at + 8 <= b.length;) {
      const size = b.readUInt32LE(at + 4),
        tag = b.subarray(at, at + 4).toString();
      if (at + 8 + size > b.length) throw new Error("WAV 录音不完整");
      if (tag === "fmt " && size >= 16) rate = b.readUInt32LE(at + 16);
      if (tag === "data") bytes += size;
      at += 8 + size + (size % 2);
    }
    const seconds = bytes / rate;
    if (!Number.isFinite(seconds) || seconds < 10 || seconds > 300)
      throw new Error("录音应为 10 秒至 5 分钟");
  }
  return wav ? "wav" : mp3 ? "mp3" : "m4a";
}
export async function cloneVoice(config, file, voiceId, signal) {
  const extension = validateSample(file);
  const form = new FormData();
  form.set("purpose", "voice_clone");
  form.set("file", new Blob([file.buffer]), `speaker.${extension}`);
  const uploaded = await request(config, "/files/upload", form, signal);
  const fileId = uploaded.file?.file_id;
  if (!/^\d+$/.test(String(fileId)))
    throw new Error("语音服务没有返回有效的录音编号");
  await request(
    config,
    "/voice_clone",
    {
      file_id: String(fileId),
      voice_id: voiceId,
      need_noise_reduction: true,
      need_volume_normalization: true,
    },
    signal,
  );
}
