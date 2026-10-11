const pages = {
  "/": [
    "AutoPPT · 把你的讲稿，做成你的演讲",
    "保留完整原稿，选择视觉风格，先试做一页，再生成整场。邀请制网页版，浏览器即可制作。",
    true,
  ],
  "/website": [
    "AutoPPT · 把你的讲稿，做成你的演讲",
    "保留完整原稿，选择视觉风格，先试做一页，再生成整场。邀请制网页版，浏览器即可制作。",
    true,
  ],
  "/login": [
    "登录 · AutoPPT",
    "登录自己的独立演讲工作区，继续制作讲稿与画面。",
    false,
  ],
  "/register": [
    "邀请注册 · AutoPPT",
    "使用管理员发放的一次性邀请码创建 AutoPPT 账号。",
    false,
  ],
  "/support": [
    "使用帮助 · AutoPPT",
    "了解邀请注册、讲稿制作、图片额度、导出与账号恢复。",
    true,
  ],
  "/privacy": [
    "数据与隐私说明 · AutoPPT",
    "了解内容保存、模型服务、登录会话及数据管理。",
    true,
  ],
  "/terms": [
    "使用说明 · AutoPPT",
    "了解邀请制网页版的功能范围和使用约定。",
    true,
  ],
};
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export function supportConfig(env = process.env) {
  const supportEmail = String(env.AUTOPPT_SUPPORT_EMAIL || "").trim();
  const supportUrl = String(env.AUTOPPT_SUPPORT_URL || "").trim();
  if (
    supportEmail &&
    !/^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(
      supportEmail,
    )
  )
    throw new Error("AUTOPPT_SUPPORT_EMAIL 应为有效邮箱。");
  if (supportUrl) {
    const url = new URL(supportUrl);
    if (url.protocol !== "https:" || url.username || url.password)
      throw new Error("AUTOPPT_SUPPORT_URL 应为不含账号密码的 HTTPS 地址。");
  }
  return { supportEmail, supportUrl };
}
export const websitePaths = Object.keys(pages);
export function renderWebsiteShell(html, pathname, origin) {
  const [title, description, index] = pages[pathname] || [
    "页面未找到 · AutoPPT",
    "链接可能已更改，请从官网继续。",
    false,
  ];
  const canonical = new URL(pathname === "/" ? "/website" : pathname, origin)
    .href;
  const metadata = `<title>${escape(title)}</title><meta name="description" content="${escape(description)}"/><meta name="robots" content="${index ? "index,follow" : "noindex,nofollow"}"/><link rel="canonical" href="${escape(canonical)}"/><meta property="og:type" content="website"/><meta property="og:title" content="${escape(title)}"/><meta property="og:description" content="${escape(description)}"/><meta property="og:url" content="${escape(canonical)}"/>`;
  return html
    .replace(/<title>[^<]*<\/title>/, metadata)
    .replace(
      '<div id="root"></div>',
      `<div id="root"></div><noscript><h1>${escape(title)}</h1><p>${escape(description)}</p><p>制作演讲和登录需要启用 JavaScript。</p><nav><a href="/website">产品介绍</a> · <a href="/login">登录</a> · <a href="/register">邀请注册</a> · <a href="/support">使用帮助</a></nav></noscript>`,
    );
}
export function websiteSitemap(origin) {
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${Object.entries(
    pages,
  )
    .filter(([path, p]) => path !== "/" && p[2])
    .map(
      ([path]) => `<url><loc>${escape(new URL(path, origin).href)}</loc></url>`,
    )
    .join("")}</urlset>`;
}
