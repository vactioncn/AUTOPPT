// TokenHub Hy 3.5 uses Messages instead of the OpenAI Images wire format.
// Keep the worker protocol unchanged so metering and asset downloads still apply.
const MODEL = "hy-image-v3.5-preview";
const reject = (message) => {
  throw Object.assign(new Error(message), { status: 400 });
};

export function usesTokenHubImage(config) {
  return config.model === MODEL;
}

// Read only a bounded error response. Never log the request prompt, reference
// images, authorization header or a raw provider response.
export async function tokenHubFailureDiagnostic(response, request, apiKey) {
  const input = JSON.parse(request.body);
  const scrub = (value) => {
    let text =
      typeof value === "string" || typeof value === "number"
        ? String(value)
        : "";
    if (apiKey) text = text.split(apiKey).join("[REDACTED]");
    for (const message of input.messages || [])
      for (const part of message.content || [])
        if (part.text) text = text.split(part.text).join("[PROMPT]");
    return text
      .replace(/data:image\/[^\s"']+/gi, "[IMAGE]")
      .replace(/https?:\/\/[^\s"'<>]+/gi, "[URL]")
      .replace(/Bearer\s+[^\s"']+/gi, "Bearer [REDACTED]")
      .replace(/sk-[a-z0-9_-]+/gi, "[REDACTED]")
      .replace(/<[^>]*>/g, " ")
      .replace(/[\x00-\x1f\x7f]/g, " ")
      .slice(0, 600);
  };
  let data = {};
  const reader = response.body?.getReader();
  if (reader) {
    const chunks = [];
    let length = 0;
    try {
      while (length < 32768) {
        const item = await reader.read();
        if (item.done) break;
        const chunk = item.value.subarray(0, 32768 - length);
        chunks.push(chunk);
        length += chunk.length;
      }
      data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      /* Non-JSON/truncated errors are described without relaying HTML. */
    } finally {
      void reader.cancel().catch(() => {});
    }
  }
  const error = data?.error || data?.Response?.Error || {};
  return {
    adapter: "tokenhub-hy35-v2",
    status: response.status,
    route: request.route,
    model: input.model,
    size: input.size,
    referenceCount: input.messages
      .flatMap((message) => message.content || [])
      .filter((part) => part.type === "image_url").length,
    code: scrub(error.code || error.Code || data?.code),
    message:
      scrub(
        error.message ||
          error.Message ||
          (typeof error === "string" ? error : "") ||
          data?.message,
      ) || "No structured provider error; check TokenHub request logs.",
    requestId: scrub(
      data?.request_id ||
        error.request_id ||
        data?.Response?.RequestId ||
        response.headers.get("x-request-id"),
    ),
  };
}

export async function prepareTokenHubImageRequest({
  route,
  body,
  contentType,
  model,
}) {
  let input;
  const images = [];
  if (route === "/images/edits") {
    let form;
    try {
      form = await new Request("http://localhost/", {
        method: "POST",
        headers: { "Content-Type": contentType },
        body,
      }).formData();
    } catch {
      reject("混元图片编辑请求格式无效。");
    }
    if (form.has("mask"))
      reject(
        "混元适配暂不支持 mask 局部修复；请设置 AUTOPPT_LAYERED_ENABLED=0 后重建应用容器。",
      );
    input = Object.fromEntries(form);
    for (const [name, file] of form) {
      if (name !== "image" && name !== "image[]") continue;
      if (
        typeof file === "string" ||
        !/^image\/(png|jpeg|jpg)$/.test(file.type)
      )
        reject("混元参考图仅支持 PNG 或 JPEG 文件。");
      if (file.size > 20 * 1024 * 1024 || !file.size)
        reject("混元参考图必须大于 0 且不超过 20MB。");
      images.push({
        type: "image_url",
        image_url: {
          url: `data:${file.type};base64,${Buffer.from(await file.arrayBuffer()).toString("base64")}`,
        },
      });
    }
    if (!images.length || images.length > 20)
      reject("混元图片编辑需提供 1–20 张参考图。");
  } else if (route === "/images/generations") {
    try {
      input = JSON.parse(body);
    } catch {
      reject("混元图片生成请求不是有效 JSON。");
    }
  } else reject("混元图片接口无效。");

  if (
    !input ||
    input.model !== model ||
    model !== MODEL ||
    typeof input.prompt !== "string" ||
    !input.prompt.trim() ||
    (input.n !== undefined && Number(input.n) !== 1)
  )
    reject("混元图片请求需包含匹配的模型、提示词，且一次只生成一张图片。");
  const size = input.size || "2560x1440";
  const match = /^(\d+)x(\d+)$/.exec(size);
  const width = Number(match?.[1]),
    height = Number(match?.[2]);
  if (
    !match ||
    width < 256 ||
    height < 256 ||
    width > 8192 ||
    height > 8192 ||
    width * height > 16777216
  )
    reject("混元图片尺寸无效。");

  return {
    route: "/wand/hunyuan-image/v35-generation",
    contentType: "application/json",
    body: JSON.stringify({
      model,
      size,
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: input.prompt }, ...images],
        },
      ],
    }),
  };
}

export async function normalizeTokenHubImageResponse(response) {
  // Non-2xx errors are sanitized by the existing gateway.
  if (!response.ok) return response;
  const data = await response.json();
  const image = data?.choices?.[0]?.delta?.image;
  if (data?.error || data?.choices?.[0]?.finish_reason === "error") {
    const filtered = data?.error?.code === "content_filter";
    return Response.json(
      {
        error: {
          message: filtered
            ? "混元图片请求未通过内容审核，请调整提示词或参考图。"
            : "混元未返回成品，本次生成结果待核对。",
        },
      },
      { status: filtered ? 422 : 502 },
    );
  }
  let url;
  try {
    url = new URL(image?.url);
  } catch {
    /* handled below */
  }
  if (!url || url.protocol !== "https:")
    return Response.json(
      { error: { message: "混元未返回有效 HTTPS 成品地址，本次结果待核对。" } },
      { status: 502 },
    );
  // Only return the final image, never intermediate assembled_history images.
  return Response.json({ data: [{ url: url.href }] });
}
