import { publicFetch } from "../public-fetch.mjs";
import { MAX_VIDEO } from "./media.mjs";

const base = "https://api.heygen.com/v3";
const safeId = (v) => typeof v === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(v);
const failureMessages = {
  insufficient_balance:
    "HeyGen API 余额不足，请检查或补充 API 钱包额度。网页会员额度与 API 余额可能不同。",
  insufficient_credits:
    "HeyGen API 额度不足，请检查或补充 API 钱包额度。已有音频会保留。",
  MOVIO_PAYMENT_INSUFFICIENT_CREDIT:
    "HeyGen API 额度不足，嘴型视频未生成。请检查或补充 HeyGen API 钱包额度；已有音频会保留。",
};
export function heygenFailureMessage(code) {
  return (
    (Object.hasOwn(failureMessages, code) && failureMessages[code]) ||
    "HeyGen 报告此片段生成失败，请在 HeyGen 中检查照片、音频及账号额度。已有片段保留。"
  );
}
export function createHeyGenProvider({
  apiKey,
  fetchApi = fetch,
  fetchMedia = publicFetch,
}) {
  async function request(endpoint, method, body, key) {
    let response;
    try {
      response = await fetchApi(base + endpoint, {
        method,
        body,
        redirect: "error",
        signal: AbortSignal.timeout(60000),
        headers: {
          "X-Api-Key": apiKey,
          ...(key ? { "Idempotency-Key": key } : {}),
          ...(typeof body === "string"
            ? { "Content-Type": "application/json" }
            : {}),
        },
      });
    } catch {
      throw new Error(
        "HeyGen 连接中断。请继续查询；已有提交会使用同一请求编号，不重复创建视频。",
      );
    }
    // Provider bodies can contain signed URLs, account details or credentials. Never log them.
    const result = await response.json().catch(() => null);
    if (!response.ok) {
      const code = result?.error?.code;
      const messages = {
        ...failureMessages,
        invalid_voice:
          "HeyGen 不接受所选声音，请在数字人工作室刷新声音列表并重新选择。",
        voice_not_found: "所选声音已不可用，请在数字人工作室重新选择。",
        invalid_image: "HeyGen 无法识别头像，请使用清晰、正面的单人头像。",
        face_not_detected:
          "HeyGen 未识别到人脸，请在数字人工作室换一张清晰头像。",
      };
      if (Object.hasOwn(messages, code))
        throw Object.assign(new Error(messages[code]), {
          rejected: true,
          failureCode: code,
        });
      throw Object.assign(
        new Error(
          response.status === 401 || response.status === 403
            ? "HeyGen 拒绝访问，请检查密钥及 API 权限。"
            : response.status === 402
              ? "HeyGen 余额不足，请在 HeyGen 账号中检查额度。"
              : response.status === 409
                ? "HeyGen 正在处理同一请求，请稍后继续查询。"
                : response.status === 429
                  ? "HeyGen 请求繁忙，请稍后继续查询。"
                  : "HeyGen 未接受请求，请检查账号额度及照片、音频要求后重试。",
        ),
        {
          rejected: [401, 402, 403].includes(response.status),
          failureCode:
            response.status === 402 ? "insufficient_balance" : "authentication",
        },
      );
    }
    if (!result?.data || result.error)
      throw new Error("HeyGen 返回结果不完整，请稍后继续查询。");
    return result.data;
  }
  return {
    async voices() {
      const data = await request("/voices?language=Chinese&limit=100", "GET");
      if (!Array.isArray(data))
        throw new Error("HeyGen 声音列表暂时不可用，请稍后刷新。");
      return data
        .filter((v) => safeId(v.voice_id))
        .map((v) => ({
          id: v.voice_id,
          name: String(v.name || "中文声音")
            .trim()
            .slice(0, 100),
          language: String(v.language || ""),
          gender: String(v.gender || ""),
          previewUrl:
            typeof v.preview_audio_url === "string"
              ? v.preview_audio_url
              : null,
        }));
    },
    async upload(bytes, filename, mime, key) {
      if (!bytes.length || bytes.length > 32 * 1024 * 1024)
        throw new Error("HeyGen 单个上传素材不能超过 32 MB。");
      const body = new FormData();
      body.set("file", new Blob([bytes], { type: mime }), filename);
      const data = await request("/assets", "POST", body, key);
      if (!safeId(data.asset_id))
        throw new Error("HeyGen 未返回素材编号，请稍后继续查询。");
      return data.asset_id;
    },
    async create(payload, key) {
      const data = await request(
        "/videos",
        "POST",
        JSON.stringify(payload),
        key,
      );
      if (!safeId(data.video_id))
        throw new Error("HeyGen 未返回视频编号，请稍后继续查询。");
      return data.video_id;
    },
    async status(videoId) {
      if (!safeId(videoId)) throw new Error("HeyGen 视频编号无效。");
      const data = await request("/videos/" + videoId, "GET");
      if (
        !["pending", "waiting", "processing", "completed", "failed"].includes(
          data.status,
        )
      )
        throw new Error("HeyGen 未返回有效视频状态，请稍后继续查询。");
      return {
        status: data.status,
        url: data.video_url,
        failureCode: safeId(
          data.failure_code || data.error?.code || data.failure_reason?.code,
        )
          ? data.failure_code || data.error?.code || data.failure_reason?.code
          : undefined,
      };
    },
    async download(url) {
      let parsed;
      try {
        parsed = new URL(url);
      } catch {
        throw new Error("HeyGen 视频地址无效。");
      }
      if (parsed.protocol !== "https:" || parsed.username || parsed.password)
        throw new Error("HeyGen 视频地址不安全。");
      // Pinned public DNS, bounded body; no API Key is sent to the media host.
      // Redirects are rejected rather than allowing HTTPS to downgrade.
      try {
        return await fetchMedia(url, {
          maxBytes: MAX_VIDEO,
          followRedirects: false,
        });
      } catch {
        throw new Error(
          "已生成视频下载中断，请继续查询或下载；不会重新生成这个片段。",
        );
      }
    },
  };
}
