// One public error boundary. Never quote an upstream diagnostic back to a user.
const fallback = "操作没有完成，请检查当前内容或服务状态后重试。";
export function userError(value, options = {}) {
  const text = typeof value === "string" ? value : value?.message || "";
  const status = options.status || value?.status;
  if (value?.code === "EADDRINUSE")
    return "启动端口已被占用（EADDRINUSE），请检查已有服务。";
  const rules = [
    [
      /insufficient.?quota|quota.exceeded|insufficient.?(balance|credits)|no credits|billing|余额|额度不足/i,
      "模型账户余额或额度不足，请补充额度或更换可用服务后继续。",
    ],
    [
      /invalid.?api.?key|unauthorized|authentication|凭据|密钥|API Key/i,
      "模型服务凭据不可用，请在模型与服务中检查配置后继续。",
    ],
    [
      /permission.denied|forbidden|access.denied|权限/i,
      "服务权限不足，请检查账号权限或联系管理员。",
    ],
    [
      /overload|rate.?limit|too many requests|temporarily unavailable|限流|拥堵|繁忙/i,
      "模型服务繁忙或限流，请稍后确认重试；已完成内容会保留。",
    ],
    [
      /timeout|timed.out|ECONN|ENOTFOUND|fetch failed|network|TLS|超时|网络|连接中断/i,
      "网络连接或服务响应中断，结果可能已产生费用。请先查看已完成内容，再确认重试。",
    ],
    [
      /corrupt|invalid.*(image|audio|video|zip)|unsupported.*(format|image)|ENOENT|decode|损坏|解码/i,
      "文件缺失、损坏或格式不受支持，请重新选择有效文件。",
    ],
  ];
  for (const [pattern, message] of rules)
    if (pattern.test(text)) return message;
  if (options.external && status === 401) return rules[1][1];
  if (options.external && status === 403) return rules[2][1];
  if (options.external && (status === 429 || status === 503))
    return rules[3][1];
  // Provider text is never trusted, even if it happens to be Chinese.
  if (options.external) return options.fallback || fallback;
  // Reject whole diagnostics rather than guessing the length of a secret.
  if (
    !text ||
    /bearer|basic\s+|authorization|\b(?:key|token|secret|password|signature|credential)\b|\b[a-z_-]*(?:key|token|secret|password|signature|credential)[a-z_-]*\s*[:=]|api[_-]?key|access[_-]?key|[?&][\w%.-]+=|https?:\/\/|\b[^\s@]+@[^\s@]+\.[^\s@]+|(?:^|[\s"'(=:])\/(?:[^\s/]+\/)*[^\s]*|[a-z]:[\\/]|\\\\|\b(?:sk|pk|AKIA)[-_\w]+|[a-z\d_=-]{28,}|provider|worker|requestId/iu.test(
      text,
    )
  )
    return options.fallback || fallback;
  // Ordinary application validation messages are authored in Chinese. Unknown
  // English/native/runtime messages are diagnostics, not a public contract.
  if (!/[\u3400-\u9fff]/u.test(text)) return options.fallback || fallback;
  return text.slice(0, 600);
}
export function sanitizeErrorFields(value) {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    value.forEach(sanitizeErrorFields);
    return value;
  }
  for (const [key, item] of Object.entries(value)) {
    if (
      (/^(?:error|reviewError|lastError|errorMessage)$/.test(key) ||
        (key === "progress" &&
          ["failed", "partial", "error", "interrupted"].includes(
            value.status,
          ))) &&
      item
    ) {
      value[key] = userError(item);
    } else if (item && typeof item === "object") sanitizeErrorFields(item);
  }
  return value;
}
