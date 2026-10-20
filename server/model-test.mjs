import sharp from "sharp";
import { publicFetch } from "./public-fetch.mjs";
import { IMAGE_OUTPUT_SIZE, isSlideAspect } from "../shared/image-output.mjs";

// Resolve a draft without saving it. A saved key may only follow its exact endpoint.
export function testConnectionConfig(saved, draft = saved) {
  const baseUrl = String(draft.baseUrl ?? "")
    .trim()
    .replace(/\/+$/, "");
  let url;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error("请填写完整的 HTTP(S) 接口地址。");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("接口地址不能包含密钥、查询参数或片段。");
  const model = String(draft.model ?? "").trim();
  if (!model || model.length > 200)
    throw new Error("请填写 1–200 字的模型名称。");
  const apiKey = draft.clearKey
    ? ""
    : String(draft.apiKey || "").trim() ||
      (baseUrl === saved.baseUrl ? saved.apiKey : "");
  if (!apiKey)
    throw new Error(
      baseUrl !== saved.baseUrl
        ? "接口地址已改变，请填写该地址对应的 API Key 后再测试。"
        : "还没有配置 API Key。",
    );
  return { baseUrl, model, apiKey };
}

async function readJson(response, limit) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of response.body || []) {
    bytes += chunk.length;
    if (bytes > limit) throw new Error("测试响应过大，未确认测试成功。");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error(
      "接口返回的不是有效 JSON，未确认测试成功。请检查接口地址与协议。",
    );
  }
}

function rejection(status, data) {
  // Provider errors can echo credentials; report useful categories, never raw bodies.
  const code = String(data?.error?.code || data?.error?.type || "");
  if (status === 401 || status === 403)
    return `接口拒绝访问（${status}），请检查密钥和模型权限。`;
  if (/model_not_found|invalid_model/.test(code) || status === 404)
    return `没有找到指定模型或接口（${status}），请核对模型名称、地址和权限。`;
  if (/quota|billing|balance/.test(code))
    return `服务额度不足（${status}），本次测试未通过。`;
  if (status === 429) return "服务限流或额度不足（429），本次测试未通过。";
  return `服务拒绝了测试（HTTP ${status}），请核对模型、接口协议和参数。`;
}

export async function testModel(
  kind,
  config,
  {
    mode = "catalog",
    confirmed = false,
    fetchImpl = fetch,
    meter = (_body, run) => run(() => {}),
    timeoutMs = mode === "catalog" ? 20000 : kind === "image" ? 180000 : 60000,
    download = (url, signal) =>
      publicFetch(url, { signal, maxBytes: 40 * 1024 * 1024 }),
  } = {},
) {
  if (!["text", "image"].includes(kind))
    throw new Error("请选择内容或图片服务。");
  if (!["catalog", "invocation"].includes(mode))
    throw new Error("测试方式无效。");
  if (mode === "invocation" && !confirmed)
    throw new Error("实际调用可能计费，请先确认测试范围。");
  const started = Date.now();
  const signal = AbortSignal.timeout(timeoutMs);
  const route =
    mode === "catalog"
      ? "/models"
      : kind === "text"
        ? "/chat/completions"
        : "/images/generations";
  const body =
    mode === "catalog"
      ? null
      : kind === "text"
        ? {
            model: config.model,
            messages: [
              {
                role: "user",
                content: '这是接口测试。只返回 JSON 对象 {"ok":true}。',
              },
            ],
            response_format: { type: "json_object" },
            max_completion_tokens: 1024,
          }
        : {
            model: config.model,
            prompt:
              "Interface test: a plain opaque white 16:9 landscape canvas with a small solid blue circle in the center, no text.",
            size: IMAGE_OUTPUT_SIZE,
            quality: "high",
            background: "opaque",
            n: 1,
          };
  async function send(capture = () => {}) {
    let response;
    try {
      response = await fetchImpl(config.baseUrl + route, {
        method: body ? "POST" : "GET",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal,
        redirect: "error",
      });
      capture(null, response.status);
      const data = await readJson(
        response,
        kind === "image" && body ? 56 * 1024 * 1024 : 2 * 1024 * 1024,
      );
      capture(data, response.status);
      if (!response.ok || data?.error)
        throw new Error(rejection(response.status, data));
      return data;
    } catch (error) {
      if (signal.aborted)
        throw new Error(
          "测试超时，未确认成功；实际调用可能已由服务处理，本次不会自动重试。",
        );
      if (error instanceof TypeError)
        throw new Error(
          "无法读取接口，请检查网络、地址与协议；未确认测试成功。",
        );
      throw error;
    }
  }
  // One explicit provider attempt. Catalog checks never invoke a model or meter usage.
  const data = body ? await meter(body, send) : await send();
  const evidence = {
    mode,
    requestedModel: config.model,
    checkedAt: new Date().toISOString(),
    elapsedMs: Date.now() - started,
  };
  if (mode === "catalog") {
    if (
      !Array.isArray(data?.data) ||
      data.data.some((item) => typeof item?.id !== "string")
    )
      return {
        ...evidence,
        ok: false,
        status: "unverified",
        modelFound: false,
        message:
          "接口有响应，但未返回可识别的模型列表。模型名称未核实，也未实际调用。",
      };
    const found = data.data.some((item) => item.id === config.model);
    return {
      ...evidence,
      ok: found,
      status: found ? "listed" : "unverified",
      modelFound: found,
      message: found
        ? "连接正常，模型名称已在服务列表中核对；尚未实际调用，不能据此确认生成可用。"
        : "连接正常，但列表中没有这个模型。名称未核实，不能判定通过；服务可能使用别名或未公开完整列表，可继续做实际调用测试。",
    };
  }
  let sample;
  if (kind === "text") {
    const content = data?.choices?.[0]?.message?.content;
    let parsed;
    try {
      parsed = JSON.parse(
        typeof content === "string"
          ? content.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "")
          : "",
      );
    } catch {
      /* Valid JSON is required by the production text protocol. */
    }
    if (parsed?.ok !== true)
      throw new Error("内容模型未返回测试要求的有效 JSON，实际调用未通过。");
    sample = { text: '{"ok":true}' };
  } else {
    const item = data?.data?.[0];
    let bytes;
    if (typeof item?.b64_json === "string" && item.b64_json.length)
      bytes = Buffer.from(item.b64_json, "base64");
    else if (typeof item?.url === "string") {
      let url;
      try {
        url = new URL(item.url);
      } catch {
        throw new Error("图片地址无效，实际调用未通过。");
      }
      if (url.protocol !== "https:")
        throw new Error("图片地址无效，实际调用未通过。");
      const response = await download(url.href, signal);
      if (response.status !== 200)
        throw new Error("服务返回了图片地址，但图片无法下载，未确认生成成功。");
      bytes = response.body;
    } else throw new Error("图片模型没有返回图片，实际调用未通过。");
    try {
      const image = sharp(bytes, { limitInputPixels: 40000000 });
      const { width, height } = await image.metadata();
      if (!isSlideAspect(width, height)) throw new Error("aspect");
      if (!(await image.stats()).isOpaque) throw new Error("transparent");
      sample = {
        width,
        height,
        image: `data:image/jpeg;base64,${(await image.resize({ width: 480 }).jpeg({ quality: 75 }).toBuffer()).toString("base64")}`,
      };
    } catch (error) {
      throw new Error(
        error.message === "aspect"
          ? "返回图片不是横向 16:9，未通过当前 PPT 出图要求。"
          : error.message === "transparent"
            ? "返回图片包含透明背景，未通过当前 PPT 出图要求。"
            : "返回内容不是可解码的有效图片，实际调用未通过。",
      );
    }
  }
  const reportedModel =
    typeof data.model === "string"
      ? data.model.replaceAll(config.apiKey, "[密钥已隐藏]").slice(0, 200)
      : "";
  const matched = reportedModel === config.model;
  return {
    ...evidence,
    elapsedMs: Date.now() - started,
    ok: matched,
    status: matched ? "verified" : "unverified",
    invocationSucceeded: true,
    reportedModel,
    sample,
    message: matched
      ? `${kind === "text" ? "内容" : "图片"}实际调用成功，收到有效${kind === "text" ? " JSON" : "横向图片"}，返回模型名称与填写一致。此结果仅覆盖本次测试。`
      : reportedModel
        ? `收到有效结果，但服务返回的模型是“${reportedModel}”，与填写名称不同；指定模型未核实。`
        : "收到有效结果，但服务未返回模型标识；调用有结果，实际使用的型号仍未核实。",
  };
}
