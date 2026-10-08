// Explain observed failures, without promising that a provider fault can be repaired locally.
export function failureAdvice(error = "") {
  if (/overload|服务.*拥堵|服务.*繁忙/i.test(error))
    return {
      reason: "模型服务拥堵",
      action: "服务方暂时无法处理请求，稍后手动继续；无需修改原稿。",
    };
  if (/auth_unavailable/i.test(error))
    return {
      reason: "模型服务没有可用通道",
      action: "服务方暂无可用模型通道，稍后继续或检查服务商状态；这条提示本身不能证明你的密钥有误。",
    };
  if (
    /401|403|unauthorized|api.?key|权限|密钥|认证/i.test(error)
  )
    return {
      reason: "模型服务认证或权限不可用",
      action: "检查模型与服务中的连接、密钥和模型权限，再继续。",
    };
  if (/429|1002|rate.?limit|限流|额度/i.test(error))
    return {
      reason: "模型服务限制了请求",
      action: "检查账户额度与限流设置，等待后再继续。",
    };
  if (/408|stream.*disconnect|stream.*closed|timeout|超时/i.test(error))
    return {
      reason: "模型响应中断或超时",
      action: "请求可能已被服务商处理，请先核对用量，稍后手动继续。",
    };
  if (/TLS.*handshake|utls|EOF/i.test(error))
    return {
      reason: "模型连接中断",
      action: "本页仍未完成；稍后继续。自动连接重试结束后不会无限重试。",
    };
  if (/500|502|503|504|overload|繁忙/i.test(error))
    return {
      reason: "模型服务暂时不可用",
      action: "稍后手动继续；必要时在设置中检查服务连接。",
    };
  if (/原文|依据|上屏|校验|JSON|内容关系/i.test(error))
    return {
      reason: "模型结果未通过内容检查",
      action: "查看本页原稿与具体提示，调整后继续；不会自动修改你的原文。",
    };
  return { reason: "本次处理未完成", action: "查看具体提示，处理后手动继续。" };
}
