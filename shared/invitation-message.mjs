export function invitationMessage({
  origin,
  code,
  expires,
  signupImageCredits,
}) {
  const link = `${origin}/register?invite=${encodeURIComponent(code)}`;
  const expiry = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(expires));
  const credits =
    Number.isSafeInteger(signupImageCredits) && signupImageCredits > 0
      ? `当前新账号可获 ${signupImageCredits} 张图片生成额度，欢迎带上自己的内容试一试（以注册页显示为准）。\n\n`
      : "";
  return `「讲好」体验邀请

邀请你体验「讲好」AI 演讲工作台，从一份讲稿，到一次从容的表达。

无论是工作汇报、课程分享，还是产品介绍，都可以把想讲的内容写下来，选择喜欢的视觉风格，生成演讲画面，再导出 PPT 或网页放映。

不妨先试做一页，看看你的内容可以怎样被呈现。打开网页即可开始，无需安装软件或配置模型。

${credits}立即体验：${link}
专属邀请码：${code}
请在 ${expiry}（北京时间）前注册。邀请码仅供一个新账号使用。

期待你的作品，也欢迎把使用感受告诉我。`;
}
