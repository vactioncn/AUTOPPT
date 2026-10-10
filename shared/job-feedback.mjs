// Explain observed failures, without promising that a provider fault can be repaired locally.
export function failureAdvice(
  error = "",
  { hosted = false, uncertain = false } = {},
) {
  if (uncertain)
    return {
      reason: "生成结果需要核对",
      action: hosted
        ? "服务可能已处理这次请求，额度记录已保留。请联系管理员核对生成与用量，再决定是否重新提交；不会自动重复请求。"
        : "服务可能已处理这次请求，请先核对服务商的生成与用量记录，再决定是否重新提交；不会自动重复请求。",
    };
  if (/overload|服务.*拥堵|服务.*繁忙/i.test(error))
    return {
      reason: "模型服务拥堵",
      action: "服务方暂时无法处理请求，稍后手动继续；无需修改原稿。",
    };
  if (/auth_unavailable/i.test(error))
    return {
      reason: "模型服务没有可用通道",
      action:
        "服务方暂无可用模型通道，稍后继续或检查服务商状态；这条提示本身不能证明你的密钥有误。",
    };
  if (/401|403|unauthorized|api.?key|权限|密钥|认证/i.test(error))
    return {
      reason: "模型服务认证或权限不可用",
      action: hosted
        ? "请联系管理员检查模型服务的连接与权限；你的稿件和已有图片已保留。"
        : "检查模型与服务中的连接、密钥和模型权限，再继续。",
    };
  if (/429|1002|rate.?limit|限流|额度/i.test(error))
    return {
      reason: "模型服务限制了请求",
      action: hosted
        ? "先查看账号设置中的可用和预留额度；额度不足或服务限流时，请联系管理员处理。"
        : "检查账户额度与限流设置，等待后再继续。",
    };
  if (/408|stream.*disconnect|stream.*closed|timeout|超时/i.test(error))
    return {
      reason: "模型响应中断或超时",
      action: hosted
        ? "请求可能已被服务商处理，请联系管理员先核对用量，再决定是否继续。"
        : "请求可能已被服务商处理，请先核对用量，稍后手动继续。",
    };
  if (/TLS.*handshake|utls|EOF/i.test(error))
    return {
      reason: "模型连接中断",
      action: "本页仍未完成；稍后继续。自动连接重试结束后不会无限重试。",
    };
  if (/500|502|503|504|overload|繁忙/i.test(error))
    return {
      reason: "模型服务暂时不可用",
      action: hosted
        ? "稍后手动继续；持续失败时，请联系管理员检查模型服务。"
        : "稍后手动继续；必要时在设置中检查服务连接。",
    };
  if (/原文|依据|上屏|校验|JSON|内容关系/i.test(error))
    return {
      reason: "模型结果未通过内容检查",
      action: "查看本页原稿与具体提示，调整后继续；不会自动修改你的原文。",
    };
  return { reason: "本次处理未完成", action: "查看具体提示，处理后手动继续。" };
}

export function elapsedLabel(start, currentTime = Date.now()) {
  const parsed = Date.parse(start);
  if (!Number.isFinite(parsed)) return "";
  const seconds = Math.max(0, Math.floor((currentTime - parsed) / 1000));
  return seconds < 60
    ? `${seconds} 秒`
    : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}

export function retrySeconds(retry, currentTime = Date.now()) {
  const parsed = Date.parse(retry?.retryAt || "");
  return Number.isFinite(parsed)
    ? Math.max(0, Math.ceil((parsed - currentTime) / 1000))
    : retry?.seconds || 0;
}
