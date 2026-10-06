// MiniMax native speech protocol; deliberately separate from the image/text gateway.
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
    throw new Error(
      `语音服务未完成请求（错误码 ${Number(data.base_resp?.status_code) || "未知"}），请检查额度、模型及音色权限`,
    );
  return data;
}
export async function synthesize(config, text, options, signal) {
  const data = await request(
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
        vol: 1,
        pitch: 0,
        ...(options.emotion === "auto" ? {} : { emotion: options.emotion }),
      },
      audio_setting: {
        sample_rate: 32000,
        bitrate: 128000,
        format: "mp3",
        channel: 1,
      },
    },
    signal,
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
