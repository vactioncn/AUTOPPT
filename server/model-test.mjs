// Test the entered connection without saving it or validating provider model names.
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
  return { baseUrl, apiKey };
}

function rejection(status) {
  if (status === 401 || status === 403)
    return `连接被拒绝（${status}），请检查该接口的密钥和访问权限。`;
  if (status === 404)
    return "接口路径不存在（404），请核对服务方提供的 API 基础地址。";
  if (status === 429) return "接口限流或额度不足（429），请稍后再试。";
  return `接口返回错误（HTTP ${status}），请检查服务状态。`;
}

export async function testConnection(
  config,
  { fetchImpl = fetch, timeoutMs = 20000 } = {},
) {
  const started = Date.now();
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    // Keep the original lightweight GET probe. No inference, model matching or retries.
    const response = await fetchImpl(config.baseUrl + "/models", {
      headers: { Authorization: `Bearer ${config.apiKey}` },
      method: "GET",
      signal,
      redirect: "error",
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(rejection(response.status));
    }
    const chunks = [];
    let bytes = 0,
      truncated = false;
    for await (const chunk of response.body || []) {
      bytes += chunk.length;
      if (bytes > 2 * 1024 * 1024) {
        truncated = true;
        break;
      }
      chunks.push(chunk);
    }
    let data,
      json = false;
    if (!truncated) {
      try {
        data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        json = true;
      } catch {
        /* Reachability does not require a catalog schema. */
      }
    }
    if (data?.error || data?.success === false)
      throw new Error(
        "接口已响应，但服务返回了错误；请检查该接口的配置和密钥。",
      );
    return {
      ok: true,
      status: "connected",
      responseKind: json ? "json" : "other",
      checkedAt: new Date().toISOString(),
      elapsedMs: Date.now() - started,
      message: json
        ? `接口连接成功（HTTP ${response.status}）。模型名称由你的服务定义，此处不做核验。`
        : `服务地址已连通（HTTP ${response.status}），返回的是网页或非 JSON 内容。这里只确认地址可访问；调用模型时请核对服务方提供的 API 基础地址。`,
    };
  } catch (error) {
    if (signal.aborted) throw new Error("连接超时，请检查地址或稍后再试。");
    if (error instanceof TypeError)
      throw new Error("无法连接接口，请检查网络和地址。");
    throw error;
  }
}
