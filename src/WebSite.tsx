import { useEffect, useState, useId, type ReactNode } from "react";
import {
  ArrowRight,
  ArrowLeft,
  Check,
  Eye,
  EyeSlash,
  List,
  X,
} from "@phosphor-icons/react";
import { Button, Field } from "./components";
import { post } from "./api";
import {
  navigateWeb,
  workspaceTarget,
  type PublicPage,
} from "../shared/web-routes.mjs";
import "./website.css";

export type SiteAccount = {
  user: { name: string } | null;
  signupImageCredits?: number;
  supportEmail?: string;
  supportUrl?: string;
};
export function WebLink({
  href,
  children,
  ...props
}: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a
      {...props}
      href={href}
      onClick={(e) => {
        props.onClick?.(e);
        if (
          !e.defaultPrevented &&
          href?.startsWith("/") &&
          !props.target &&
          !e.metaKey &&
          !e.ctrlKey &&
          !e.shiftKey &&
          !e.altKey &&
          e.button === 0
        ) {
          e.preventDefault();
          navigateWeb(href);
        }
      }}
    >
      {children}
    </a>
  );
}
const examples = [
  ["neo-swiss-strategy", "瑞士编辑", "鲜明的文字层级，让观点成为画面的主角。"],
  ["acid-editorial", "先锋色彩", "大胆的色彩与编辑语言，让主题更醒目。"],
  ["tactile-journal", "质感手账", "纸张、拼贴与手写感，让叙述多一份温度。"],
];
export function WebSite({
  page,
  account,
  error,
  onRetry,
  onAuthenticated,
  returnTo,
}: {
  page: PublicPage;
  account: SiteAccount | null;
  error: string;
  onRetry: () => void;
  onAuthenticated: () => Promise<void>;
  returnTo: string;
}) {
  const [menu, setMenu] = useState(false);
  useEffect(() => {
    setMenu(false);
    window.scrollTo(0, 0);
    if (location.hash === "#access")
      requestAnimationFrame(() =>
        document.getElementById("access")?.scrollIntoView(),
      );
    const titles = {
      website: "让讲稿成为演讲",
      login: "登录",
      register: "邀请注册",
      support: "使用帮助",
      privacy: "数据与隐私说明",
      terms: "使用说明",
      notfound: "页面未找到",
    };
    document.title = `AutoPPT · ${titles[page]}`;
  }, [page]);
  const next = workspaceTarget(returnTo);
  const enter = account?.user
    ? "/#" + next
    : "/login" +
      (next === "projects" ? "" : "?next=" + encodeURIComponent(next));
  return (
    <div className="web-site">
      <a className="web-skip" href="#web-content">
        跳到正文
      </a>
      <header className="web-header">
        <WebLink
          className="web-brand"
          href="/website"
          aria-label="AutoPPT 官网"
        >
          <span className="brand-icon">A</span>AutoPPT
        </WebLink>
        <button
          className="web-menu"
          onClick={() => setMenu(!menu)}
          aria-label={menu ? "关闭导航" : "打开导航"}
          aria-expanded={menu}
          aria-controls="web-navigation"
        >
          {menu ? <X size={22} /> : <List size={22} />}
        </button>
        <nav
          id="web-navigation"
          className={menu ? "open" : ""}
          aria-label="官网导航"
        >
          <WebLink
            href="/website"
            aria-current={page === "website" ? "page" : undefined}
          >
            产品介绍
          </WebLink>
          <WebLink
            href="/support"
            aria-current={page === "support" ? "page" : undefined}
          >
            使用帮助
          </WebLink>
          <WebLink href={enter}>
            {account?.user ? "进入工作区" : "登录"}
          </WebLink>
          {!account?.user && (
            <WebLink className="btn primary" href="/register">
              邀请注册 <ArrowRight size={16} />
            </WebLink>
          )}
        </nav>
      </header>
      <main id="web-content">
        {page === "website" ? (
          <Home account={account} enter={enter} />
        ) : page === "login" || page === "register" ? (
          <Access
            key={page}
            register={page === "register"}
            account={account}
            error={error}
            onRetry={onRetry}
            onAuthenticated={onAuthenticated}
            returnTo={returnTo}
          />
        ) : (
          <Reading page={page} account={account} />
        )}
      </main>
      <footer className="web-footer">
        <div>
          <WebLink className="web-brand" href="/website">
            AutoPPT
          </WebLink>
          <p>从你的原稿开始，把演讲一步步做好。</p>
        </div>
        <nav aria-label="网站页脚">
          <WebLink href="/support">使用帮助</WebLink>
          <WebLink href="/terms">使用说明</WebLink>
          <WebLink href="/privacy">数据与隐私</WebLink>
          <WebLink href={enter}>
            工作区 <ArrowRight size={15} />
          </WebLink>
        </nav>
        <small>网页版 · 邀请制</small>
      </footer>
    </div>
  );
}
function Home({
  account,
  enter,
}: {
  account: SiteAccount | null;
  enter: string;
}) {
  const [style, setStyle] = useState(0);
  const example = examples[style];
  return (
    <>
      <section className="web-hero">
        <div className="web-hero-copy">
          <h1>
            把你的讲稿，
            <br />
            做成你的演讲。
          </h1>
          <p>
            保留完整原稿，提炼画面重点。选择喜欢的视觉风格，先试做一页，满意后再生成整场。
          </p>
          <div className="web-actions">
            <WebLink
              className="btn primary"
              href={account?.user ? enter : "/register"}
            >
              {account?.user ? "继续我的演讲" : "用邀请码开始"}
              <ArrowRight size={18} />
            </WebLink>
            <WebLink href="/support">了解如何开始</WebLink>
          </div>
          <small>浏览器即可制作 · 模型由管理员配置 · 每个账号独立保存</small>
        </div>
        <figure className="web-showcase">
          <img
            src={`/style-covers/${example[0]}.png`}
            alt={`AutoPPT 内置风格示例：${example[1]}`}
            width="1536"
            height="1024"
            fetchPriority="high"
          />
          <figcaption>
            <span>内置风格示例</span>
            <span>{example[2]}</span>
          </figcaption>
          <div className="web-style-switch" aria-label="查看不同风格">
            {examples.map((s, i) => (
              <button
                key={s[0]}
                aria-pressed={style === i}
                onClick={() => setStyle(i)}
              >
                {s[1]}
              </button>
            ))}
          </div>
        </figure>
      </section>
      <section className="web-workflow" aria-labelledby="workflow-title">
        <div>
          <h2 id="workflow-title">
            先看一页效果，
            <br />
            再决定整场怎么做。
          </h2>
          <p>
            从一个小尝试开始。原稿、画面和修改记录都留在项目里，下一次可以接着做。
          </p>
        </div>
        <ol>
          <li>
            <h3>放入你的原稿</h3>
            <p>
              新建演讲，粘贴逐字稿。系统拆页并提炼上屏文案，完整讲稿分别保存。
            </p>
          </li>
          <li>
            <h3>选风格，先试一页</h3>
            <p>
              使用内置风格，或用参考图建立自己的风格。先检查第一张图，随时调整。
            </p>
          </li>
          <li>
            <h3>生成剩余页面，打磨交付</h3>
            <p>
              确认效果后继续生成。逐页编辑、保留旧版本，再导出 PPTX 和讲稿。
            </p>
          </li>
        </ol>
      </section>
      <section className="web-proof">
        <img
          src="/intro/screenshots/manuscript.webp"
          alt="AutoPPT 示例项目中的逐页讲稿与画面工作区"
          width="1440"
          height="1000"
          loading="lazy"
        />
        <div>
          <h2>
            画面可以精炼。
            <br />
            你的原话，要完整。
          </h2>
          <p>
            上屏重点与完整逐字稿分别保存。调整页面、恢复版本，或继续追加内容，都能在同一个项目完成。
          </p>
          <ul>
            <li>
              <Check size={18} />
              完整逐字稿写入 PPTX 演讲者备注
            </li>
            <li>
              <Check size={18} />
              导出独立 Markdown 讲稿与图片
            </li>
            <li>
              <Check size={18} />
              保存历史，随时对照与恢复
            </li>
          </ul>
          <p className="web-caption">
            PPTX
            每页为一张完整图片，文字和图形不能单独编辑。图示来自公开演示项目。
          </p>
        </div>
      </section>
      <section className="web-faq">
        <h2>开始前，你可能想知道</h2>
        <FAQ title="如何获得账号？">
          目前采用邀请制。向邀请你的管理员获取一次性邀请码，创建账号即可进入独立工作区。已有账号可以直接登录。
        </FAQ>
        <FAQ title="我需要配置图片模型吗？">
          网页版由管理员统一配置内容和图片服务，你只需要准备讲稿。生成图片消耗账号额度，编辑文字和导出不消耗图片额度。
        </FAQ>
        <FAQ title="网页版与 Mac App 的项目是否同步？">
          两者使用独立工作区。这个网页版不会修改你的 Mac App
          数据，也不会自动将所有 App 内容公开或同步给其他用户。
        </FAQ>
        <FAQ title="可以做口播、数字人或动态演示吗？">
          网页版支持 MiniMax 口播短试播、整场生成及含声音的离线
          HTML，语音服务由管理员连接。数字人和动态演示制作暂未开放。Mac App
          的已有能力和内容保留。
        </FAQ>
      </section>
      <section className="web-close">
        <h2>
          下一场演讲，
          <br />
          从你的第一段话开始。
        </h2>
        <WebLink
          className="btn primary"
          href={account?.user ? enter : "/register"}
        >
          {account?.user ? "进入我的工作区" : "我有邀请码，开始制作"}
          <ArrowRight size={18} />
        </WebLink>
      </section>
    </>
  );
}
function FAQ({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details>
      <summary>{title}</summary>
      <p>{children}</p>
    </details>
  );
}
function Contact({ account }: { account: SiteAccount | null }) {
  return (
    <p>
      {account?.supportEmail ? (
        <>
          联系管理员：
          <a href={`mailto:${account.supportEmail}`}>{account.supportEmail}</a>
          。
        </>
      ) : (
        "请联系邀请你加入的管理员。"
      )}
      {account?.supportUrl && (
        <>
          {" "}
          <a href={account.supportUrl} target="_blank" rel="noreferrer">
            打开支持页面 <ArrowRight size={14} />
          </a>
        </>
      )}
    </p>
  );
}
function Access({
  register,
  account,
  error: serviceError,
  onRetry,
  onAuthenticated,
  returnTo,
}: {
  register: boolean;
  account: SiteAccount | null;
  error: string;
  onRetry: () => void;
  onAuthenticated: () => Promise<void>;
  returnTo: string;
}) {
  const [name, setName] = useState(""),
    [password, setPassword] = useState(""),
    [confirmation, setConfirmation] = useState(""),
    [invite, setInvite] = useState(() =>
      register ? new URLSearchParams(location.search).get("invite") || "" : "",
    ),
    [visible, setVisible] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const passwordId = useId();
  const next = workspaceTarget(
    new URLSearchParams(location.search).get("next") || returnTo,
  );
  const suffix = next !== "projects" ? `?next=${encodeURIComponent(next)}` : "";
  return (
    <section className="web-access">
      <div className="web-access-story">
        <WebLink className="web-back" href="/website">
          <ArrowLeft size={17} />
          返回官网
        </WebLink>
        <h1>
          {register ? (
            <>
              你的第一场演讲，
              <br />
              从这里开始。
            </>
          ) : (
            <>
              欢迎回来。
              <br />
              接着把演讲做好。
            </>
          )}
        </h1>
        <p>
          {register
            ? "拿到邀请码之后，创建一个账号。你可以直接使用内置风格，先试做一页，再完成整场。"
            : "登录自己的工作区，继续编辑讲稿、查看画面和导出成果。"}
        </p>
        <ul>
          <li>
            <Check size={18} />
            项目与素材保存在你的独立工作区
          </li>
          <li>
            <Check size={18} />
            图片模型由管理员统一配置
          </li>
          <li>
            <Check size={18} />
            先试一页，确认后再生成其余页面
          </li>
        </ul>
        {register && account?.signupImageCredits !== undefined && (
          <p className="web-grant">
            {account.signupImageCredits > 0 ? (
              <>
                新账号获得 <strong>{account.signupImageCredits} 张</strong>
                图片额度
              </>
            ) : (
              "创建账号后，请联系管理员分配图片额度。"
            )}
          </p>
        )}
      </div>
      <form
        className="web-access-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          setError("");
          if (register && password !== confirmation) {
            setError("两次密码不一致，请重新确认。");
            return;
          }
          setBusy(true);
          try {
            await post(register ? "/account/register" : "/account/login", {
              name: name.trim(),
              password,
              invite: invite.trim(),
            });
            setPassword("");
            setConfirmation("");
            await onAuthenticated();
            navigateWeb("/#" + next, true);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
        aria-label={register ? "邀请注册" : "账号登录"}
      >
        <h2>{register ? "邀请注册" : "登录 AutoPPT"}</h2>
        <p>
          {register
            ? "邀请码仅用于首次注册，之后用账号和密码登录。"
            : next !== "projects"
              ? "登录后返回刚才的工作页面。"
              : "输入账号和密码，回到你的项目。"}
        </p>
        {account?.user ? (
          <>
            <p>
              你已登录为 <strong>{account.user.name}</strong>。
            </p>
            <WebLink className="btn primary" href={"/#" + next}>
              进入工作区 <ArrowRight size={17} />
            </WebLink>
          </>
        ) : (
          <>
            <fieldset disabled={busy || !account || !!serviceError}>
              {register && (
                <Field label="邀请码">
                  <input
                    autoComplete="off"
                    required
                    value={invite}
                    onChange={(e) => setInvite(e.target.value)}
                    maxLength={160}
                    placeholder="粘贴管理员发给你的邀请码"
                  />
                </Field>
              )}
              <Field
                label="账号"
                hint={
                  register
                    ? "3–80 位英文字母、数字、点、下划线、连字符或 @，首位须为字母或数字。邮箱只作账号名，无需验证。"
                    : undefined
                }
              >
                <input
                  autoComplete="username"
                  required
                  minLength={register ? 3 : undefined}
                  maxLength={80}
                  pattern={
                    register ? "[a-zA-Z0-9][a-zA-Z0-9_.@\\-]{2,79}" : undefined
                  }
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={
                    register ? "例如 howell 或你的邮箱" : "输入注册时使用的账号"
                  }
                />
              </Field>
              <div className="field">
                <label htmlFor={passwordId}>密码</label>
                <div className="web-password">
                  <input
                    id={passwordId}
                    type={visible ? "text" : "password"}
                    required
                    minLength={register ? 12 : 1}
                    maxLength={128}
                    autoComplete={
                      register ? "new-password" : "current-password"
                    }
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={register ? "至少 12 个字符" : "输入密码"}
                  />
                  <button
                    type="button"
                    onClick={() => setVisible(!visible)}
                    aria-label={visible ? "隐藏密码" : "显示密码"}
                    aria-pressed={visible}
                  >
                    {visible ? <EyeSlash size={20} /> : <Eye size={20} />}
                  </button>
                </div>
              </div>
              {register && (
                <Field label="确认密码">
                  <input
                    type={visible ? "text" : "password"}
                    required
                    minLength={12}
                    maxLength={128}
                    autoComplete="new-password"
                    value={confirmation}
                    onChange={(e) => setConfirmation(e.target.value)}
                    placeholder="再次输入密码"
                  />
                </Field>
              )}
            </fieldset>
            {(error || serviceError) && (
              <p className="account-error" role="alert">
                {error || serviceError}
              </p>
            )}
            {serviceError ? (
              <Button variant="secondary" onClick={onRetry}>
                重新连接账号服务
              </Button>
            ) : (
              <Button type="submit" loading={busy} disabled={!account}>
                {register ? "创建账号，开始制作" : "登录工作区"}
                <ArrowRight size={17} />
              </Button>
            )}
            {!register && (
              <WebLink href="/support#access">忘记密码或无法登录？</WebLink>
            )}
            <p className="web-access-switch">
              {register ? "已有账号？" : "第一次使用？"}
              <WebLink href={(register ? "/login" : "/register") + suffix}>
                {register ? "去登录" : "使用邀请码注册"}
              </WebLink>
            </p>
            <small>
              继续前请了解 <WebLink href="/terms">使用说明</WebLink> 和{" "}
              <WebLink href="/privacy">数据与隐私说明</WebLink>。
            </small>
          </>
        )}
      </form>
    </section>
  );
}
function Reading({
  page,
  account,
}: {
  page: PublicPage;
  account: SiteAccount | null;
}) {
  if (page === "notfound")
    return (
      <article className="web-reading">
        <h1>这个页面没有找到。</h1>
        <p className="web-reading-lead">
          链接可能已更改，请从官网或工作区继续。
        </p>
        <WebLink className="btn primary" href="/website">
          返回官网 <ArrowRight size={17} />
        </WebLink>
      </article>
    );
  return (
    <article className="web-reading">
      <WebLink className="web-back" href="/website">
        <ArrowLeft size={17} />
        返回官网
      </WebLink>
      {page === "support" ? (
        <>
          <h1>准备好讲稿，就可以开始。</h1>
          <p className="web-reading-lead">从注册到交付，在这里找到下一步。</p>
          <h2>第一次使用</h2>
          <ol>
            <li>
              向管理员获取邀请码，在{" "}
              <WebLink href="/register">邀请注册</WebLink>{" "}
              创建账号。已有账号直接 <WebLink href="/login">登录</WebLink>。
            </li>
            <li>在“我的项目”新建演讲，选一个内置风格，再粘贴逐字稿。</li>
            <li>提交时先试做一页。检查文字和画面，满意后生成剩余页面。</li>
            <li>逐页调整并在“交付”导出 PPTX、Markdown 讲稿或图片。</li>
          </ol>
          <h2 id="access">邀请码、账号和密码</h2>
          <FAQ title="还没有邀请码，或邀请码不能使用？">
            邀请码由管理员发放，默认有效期 7
            天且只能使用一次。已用、过期或被撤销时，请向管理员申请新码。创建成功后用账号和密码登录。
          </FAQ>
          <FAQ title="忘记密码怎么办？">
            联系邀请你的管理员，提供注册账号名。管理员核对身份后重置密码，你再用新密码登录并在“账号与额度”修改。此版本未接入邮件验证码或自助重置服务。
          </FAQ>
          <FAQ title="注册时使用邮箱，会收到邮件吗？">
            邮箱可以作为账号名，当前不会发送验证邮件。请保存你的账号名和密码。
          </FAQ>
          <h2>生成与额度</h2>
          <FAQ title="图片额度是怎样计算的？">
            成功生成一张图片使用 1
            张额度，包括风格试做和重新生成。额度不足时，仍可编辑讲稿、保存草稿、查看已有画面和导出。更多额度请联系管理员。
          </FAQ>
          <FAQ title="生成很久、失败或网络中断怎么办？">
            先查看任务状态。未完成的页面可以继续生成；如果结果待核对，请先检查已有图片并请管理员核对用量，再决定重试。不要重复提交同一任务。
          </FAQ>
          <FAQ title="导出的 PPT 文字能单独编辑吗？">
            PPTX
            每页是一张完整图片，保留该页完整讲稿作为演讲者备注。若要改画面文字，请在项目里修改并重新生成。
          </FAQ>
          <h2>需要帮助</h2>
          <Contact account={account} />
        </>
      ) : page === "privacy" ? (
        <>
          <h1>数据与隐私说明</h1>
          <p className="web-reading-lead">说明这一版如何保存和使用你的内容。</p>
          <h2>哪些内容会保存</h2>
          <p>
            账号名、加密后的密码、项目原稿、风格、素材、生成画面、历史版本和使用记录保存在部署服务器。不同账号使用独立工作区；普通用户无法访问其他账号的项目与素材。
          </p>
          <h2>哪些内容会交给模型服务</h2>
          <p>
            当你主动分析讲稿、提炼风格或生成图片时，完成该任务所需的文字、风格规则及相关图片会发送到管理员配置的模型服务。模型密钥仅在服务器保管，不显示给普通用户。
          </p>
          <h2>登录与浏览器存储</h2>
          <p>
            网站使用必要的登录会话 Cookie
            和浏览器本地存储保存界面偏好及草稿，不使用第三方广告追踪。退出登录会注销当前会话；账号密码重置后需要重新登录。
          </p>
          <h2>内容的管理与删除</h2>
          <p>
            你可以在项目中编辑、导出或删除自己的内容。网站运维管理员有权维护服务器、账号、用量与备份；账号数据导出、彻底删除及备份保留期限请向部署方确认。删除项目不表示服务器备份立即清除。
          </p>
          <h2>网页版与 App</h2>
          <p>
            网页版和 Mac App 独立保存数据；网站不会自动读取或修改你电脑上的
            App、项目和模型配置。
          </p>
          <h2>联系部署方</h2>
          <Contact account={account} />
        </>
      ) : (
        <>
          <h1>使用说明</h1>
          <p className="web-reading-lead">邀请制网页版的功能范围和使用约定。</p>
          <h2>当前提供的功能</h2>
          <p>
            讲稿拆页、上屏文案、内置与自建风格、单页试做、图片生成、逐页修改、历史恢复、MiniMax
            口播与演讲交付。数字人、声音复刻与动态演示制作暂未在网页版开放。
          </p>
          <h2>邀请与账号</h2>
          <p>
            使用管理员提供的一次性邀请码创建账号。请妥善保管密码，不共享登录凭据。管理员可分配图片额度、停用账号及核对未明用量。
          </p>
          <h2>模型生成与交付</h2>
          <p>
            生成结果取决于所配置的模型服务，可能存在文字、数据或画面误差。请在演讲或发布前核对内容。PPTX
            使用整页图片，完整讲稿写入备注。
          </p>
          <h2>内容与使用权限</h2>
          <p>
            仅上传你有权使用的讲稿、图片与素材。生成内容的使用条件同时受实际模型服务商的规定影响。网站当前不提供自助购买、公开作品发布或自动账号审批。
          </p>
          <h2>额度与服务支持</h2>
          <p>
            图片额度由管理员发放，不是在线支付余额。成功出图使用额度；结果不明时暂时预留并由管理员核对。服务维护、支持与备份由实际部署方负责。
          </p>
          <Contact account={account} />
        </>
      )}
    </article>
  );
}
