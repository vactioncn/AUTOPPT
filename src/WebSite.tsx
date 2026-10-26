import { appPath } from "../shared/app-path.mjs";
import { useEffect, useState, useId, useRef, type ReactNode } from "react";
import {
  ArrowRight,
  ArrowLeft,
  Check,
  Eye,
  EyeSlash,
  List,
  X,
  Play,
} from "@phosphor-icons/react";
import { Button, Field } from "./components";
import { BackgroundMusicControls } from "./BackgroundMusicControls";
import { post } from "./api";
import {
  navigateWeb,
  workspaceTarget,
  type PublicPage,
} from "../shared/web-routes.mjs";
import { STYLE_SHOWCASE } from "../shared/style-showcase.mjs";
import "./website.css";
import { BRAND } from "../shared/brand.mjs";
import { BrandLockup } from "./BrandLockup";
import { Help } from "./Help";
import type { Bootstrap } from "./types";
import { api } from "./api";
import { NarrationExample } from "./NarrationExample";
import "./brand.css";

export type SiteAccount = {
  hosted?: boolean;
  layeredReady?: boolean;
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
      href={href ? appPath(href) : href}
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
      website: BRAND.descriptor,
      login: "登录",
      register: "邀请注册",
      support: "使用帮助",
      privacy: "数据与隐私说明",
      terms: "使用说明",
      notfound: "页面未找到",
    };
    const previousTitle = document.title;
    document.title =
      page === "website" ? BRAND.title : `${titles[page]} · ${BRAND.name}`;
    const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    const previousIcon = icon?.getAttribute("href");
    const description = document.querySelector<HTMLMetaElement>(
      'meta[name="description"]',
    );
    const previousDescription = description?.content;
    if (page === "website" && description)
      description.content = BRAND.description;
    icon?.setAttribute("href", appPath("/brand/mark.svg"));
    return () => {
      document.title = previousTitle;
      if (previousIcon) icon?.setAttribute("href", previousIcon);
      if (description && previousDescription !== undefined)
        description.content = previousDescription;
    };
  }, [page]);
  const next = workspaceTarget(returnTo);
  const local = account?.hosted === false;
  const canEnter = local || !!account?.user;
  const enter = canEnter
    ? "/#" + next
    : "/login" +
      (next === "projects" ? "" : "?next=" + encodeURIComponent(next));
  return (
    <div className="web-site">
      <a className="web-skip" href="#web-content">
        跳到正文
      </a>
      <header className="web-header">
        <WebLink className="web-brand" href="/website" aria-label="讲好 官网">
          <BrandLockup showVersion />
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
          <WebLink href={enter}>{canEnter ? "返回工作台" : "登录"}</WebLink>
          {!canEnter && (
            <WebLink className="btn primary" href="/register">
              邀请注册 <ArrowRight size={16} />
            </WebLink>
          )}
        </nav>
      </header>
      <main id="web-content">
        {page === "website" ? (
          <Home account={account} enter={enter} />
        ) : page === "support" ? (
          <Support account={account} />
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
            <BrandLockup compact />
          </WebLink>
          <p>{BRAND.tagline}</p>
        </div>
        <nav aria-label="网站页脚">
          <WebLink href="/support">使用帮助</WebLink>
          <WebLink href="/terms">使用说明</WebLink>
          <WebLink href="/privacy">数据与隐私</WebLink>
          <WebLink href={enter}>
            工作区 <ArrowRight size={15} />
          </WebLink>
        </nav>
        <small>{local ? "本机工作区" : "网页版 · 邀请制"}</small>
      </footer>
    </div>
  );
}
function ShowcaseImage({
  id,
  title,
  hero = false,
  folder = "showcase",
  sizes,
}: {
  id: string;
  title: string;
  hero?: boolean;
  folder?: string;
  sizes?: string;
}) {
  return (
    <img
      src={`/${folder}/${id}.webp`}
      srcSet={`/${folder}/${id}-small.webp 800w, /${folder}/${id}.webp 1600w`}
      sizes={
        sizes ||
        (hero
          ? "(max-width: 900px) 90vw, 56vw"
          : "(max-width: 640px) 90vw, 45vw")
      }
      width="1600"
      height="900"
      alt={`讲好实际生成页面：${title}`}
      loading={hero ? "eager" : "lazy"}
      fetchPriority={hero ? "high" : "auto"}
    />
  );
}
function ProductDemo() {
  const video = useRef<HTMLVideoElement>(null);
  const [started, setStarted] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState("");
  async function play() {
    setError("");
    setStarted(true);
    if (video.current?.error) video.current.load();
    try {
      await video.current?.play();
    } catch {
      setError("视频暂时无法播放，请重试，或下载 PPT 查看完整画面。");
      setStarted(false);
    }
  }
  return (
    <figure className="web-demo">
      <div className="web-demo-stage">
        <video
          ref={video}
          controls={started}
          playsInline
          preload="none"
          poster="/product-demo/poster.webp"
          aria-label="讲好产品介绍视频"
          aria-describedby="product-demo-caption"
          onPlay={() => {
            video.current
              ?.closest(".web-site")
              ?.querySelector<HTMLAudioElement>(".narration-example audio")
              ?.pause();
            setPlaying(true);
          }}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onError={() => {
            setPlaying(false);
            setError("视频暂时无法加载，请重试，或下载 PPT 查看。");
            setStarted(false);
          }}
        >
          <source
            src={appPath("/product-demo/jianghao-introduction.mp4")}
            type="video/mp4"
          />
          <track
            kind="captions"
            src={appPath("/product-demo/captions.vtt")}
            srcLang="zh"
            label="中文"
          />
        </video>
        {!started && (
          <button className="web-demo-play" onClick={() => void play()}>
            <Play size={22} weight="fill" /> 播放产品介绍
          </button>
        )}
      </div>
      <figcaption id="product-demo-caption">
        <div>
          <strong>这段演讲，就是用我们的工作台做的。</strong>
          <span>使用讲好制作 · 实际生成页面与 AI 配音</span>
        </div>
        <a href={appPath("/product-demo/讲好-产品介绍.pptx")} download>
          下载这份 PPT <ArrowRight size={16} />
        </a>
      </figcaption>
      <BackgroundMusicControls playing={playing} />
      {error && (
        <p role="alert" className="web-demo-error">
          {error}
        </p>
      )}
      <a className="web-demo-transcript" href={appPath("/product-demo/manuscript.md")}>
        阅读完整介绍稿
      </a>
    </figure>
  );
}

function Home({
  account,
  enter,
}: {
  account: SiteAccount | null;
  enter: string;
}) {
  const local = account?.hosted === false;
  const canEnter = local || !!account?.user;
  const scrollTo = (id: string) =>
    document.getElementById(id)?.scrollIntoView({ block: "start" });
  return (
    <>
      <section className="web-hero web-art-hero">
        <div className="web-hero-copy">
          <h1 aria-label={BRAND.tagline}>
            从一份讲稿，
            <br />
            到一次<span>从容的表达。</span>
          </h1>
          <p>
            整理观点，制作有风格的画面。
            <br />
            把讲稿、演练与交付，放在一个工作台。
          </p>
          <div className="web-actions">
            <WebLink
              className="btn primary"
              href={canEnter ? enter : "/register"}
            >
              {canEnter ? "继续我的演讲" : "用邀请码开始"}
              <ArrowRight size={18} />
            </WebLink>
            <button
              className="web-style-link"
              onClick={() => scrollTo("generated-gallery")}
            >
              看看实际作品 <ArrowRight size={16} />
            </button>
          </div>
          <small>一段逐字稿，就能开始。先试一页，满意再做整场。</small>
        </div>
        <ProductDemo />
      </section>
      <nav className="web-feature-nav" aria-label="从讲稿到交付">
        <button onClick={() => scrollTo("simple-creation")}>
          <strong>写</strong>
          <ArrowRight size={18} />
          <span>把想法整理清楚</span>
        </button>
        <button onClick={() => scrollTo("generated-gallery")}>
          <strong>做</strong>
          <ArrowRight size={18} />
          <span>让观点有好看的画面</span>
        </button>
        <button onClick={() => scrollTo("more-expression")}>
          <strong>练</strong>
          <ArrowRight size={18} />
          <span>找到讲述的节奏</span>
        </button>
        <button onClick={() => scrollTo("delivery-summary")}>
          <strong>交</strong>
          <ArrowRight size={18} />
          <span>把成果完整带走</span>
        </button>
      </nav>
      <section
        className="web-gallery"
        id="generated-gallery"
        aria-labelledby="gallery-heading"
      >
        <div className="web-section-intro">
          <h2 id="gallery-heading">
            好看。
            <br />
            每一页，都值得多看一眼。
          </h2>
          <p>
            四种视觉风格，每种都有不同表达。
            <br />
            故事、观点与过程，都有适合自己的画面。
          </p>
        </div>
        <div className="web-style-gallery">
          {STYLE_SHOWCASE.map((style) => (
            <article
              className="web-style-collection"
              key={style.id}
              aria-labelledby={`showcase-${style.id}`}
            >
              <header>
                <h3 id={`showcase-${style.id}`}>{style.name}</h3>
                <p>{style.description}</p>
              </header>
              <div className="web-style-samples">
                {style.pages.map((page, index) => (
                  <figure
                    key={page.id}
                    className={index === 0 ? "web-style-main" : undefined}
                  >
                    <ShowcaseImage
                      {...page}
                      folder="style-showcase"
                      sizes={
                        index === 0
                          ? "(max-width: 1000px) 90vw, 45vw"
                          : "(max-width: 1000px) 43vw, 22vw"
                      }
                    />
                    <figcaption>{page.expression}</figcaption>
                  </figure>
                ))}
              </div>
            </article>
          ))}
        </div>
        <p className="web-caption">
          以上均使用讲好风格库中的风格实际生成。选择喜欢的风格，即可用于你的演讲。
        </p>
      </section>
      <section
        className="web-simple"
        id="simple-creation"
        aria-labelledby="simple-heading"
      >
        <div className="web-section-intro">
          <h2 id="simple-heading">
            简单。
            <br />
            把话讲好，就很好。
          </h2>
          <p>
            提供演讲逐字稿，选好风格。
            <br />
            从理解内容到生成画面，接下来交给讲好。
          </p>
        </div>
        <ol className="web-creation-steps">
          <li>
            <h3>提取观点，划分演讲单元。</h3>
            <p>
              读懂你想表达什么，按语义整理成适合一页页讲述的单元，让每一页都有重点。
            </p>
          </li>
          <li>
            <h3>上屏的精炼，要讲的完整。</h3>
            <p>
              自动区分观众需要看见的重点，和你需要讲清楚的内容。上屏内容不等于全部内容，完整逐字稿始终保留。
            </p>
          </li>
          <li>
            <h3>智能配图，画面自然成形。</h3>
            <p>
              围绕内容安排图像与构图，再用选定的风格生成页面。先看一页效果，满意后继续整场。
            </p>
          </li>
        </ol>
        <div className="web-script-example">
          <div>
            <h3>你提供逐字稿</h3>
            <p>
              我们做演讲时，最重要的是先想清楚自己想表达的观点。一小段文字可以提炼出一个清楚的观点，再用一页画面把它呈现出来。观众看见重点，演讲者把背后的思考讲完整。
            </p>
            <span>示意讲稿 · 完整正文保留</span>
          </div>
          <figure>
            <ShowcaseImage id="viewpoint" title="把观点讲清楚" />
            <figcaption>观众看见重点，你继续讲完整。</figcaption>
          </figure>
        </div>
        <p className="web-caption">
          {local
            ? "本机版新生成的页面保留照片与设计，把主要文字作为独立图层呈现。"
            : account?.layeredReady
              ? "新页面保留原风格画面，正文独立可编辑；文字与动效在制作台直接调整。"
              : "当前服务器版直接生成包含文字的完整演讲图片；需要调整时，修改内容或画面要求后重新生成。"}
          完整逐字稿保留在讲稿与 PPTX 备注中。
        </p>
      </section>
      <section
        className="web-expression"
        id="more-expression"
        aria-labelledby="expression-heading"
      >
        <div className="web-section-intro">
          <h2 id="expression-heading">
            更多表达。
            <br />
            让演讲，带上你的声音。
          </h2>
          <p>
            从一页画面，到一段有声音的讲述。
            <br />
            让同一份内容，有更多抵达观众的方式。
          </p>
        </div>
        <div className="web-expression-body">
          <NarrationExample />
          <dl>
            <div>
              <dt>
                AI 口播 <span>已开放</span>
              </dt>
              <dd>
                选择声音，先试听当前页，再生成整场。画面与口播同步播放，也可以导出带声音的离线演示。
              </dd>
            </div>
            <div>
              <dt>
                你的专属声音 <span>管理员接入</span>
              </dt>
              <dd>
                已有自己的 MiniMax
                声音，可由管理员接入使用，让演讲保留熟悉的音色。网页版暂不提供自行录制与声音复刻。
              </dd>
            </div>
            <div>
              <dt>
                自动情感编排 <span>已开放</span>
              </dt>
              <dd>
                结合讲稿的设问、转折和重点，安排情绪、语速与停顿。使用你选好的音色，保留完整正文，先试一页，再生成整场。
              </dd>
            </div>
          </dl>
        </div>
      </section>
      <section
        className="web-delivery"
        id="delivery-summary"
        aria-labelledby="delivery-heading"
      >
        <div className="web-section-intro">
          <h2 id="delivery-heading">
            讲稿与画面，
            <br />
            准备齐全。
          </h2>
          <p>
            现场讲，分享给同事，或让观众自己播放。
            <br />
            按这次表达需要的方式，把成果带走。
          </p>
        </div>
        <dl>
          <div>
            <dt>演讲 PPT</dt>
            <dd>每页画面与完整讲稿备注一起导出，打开即可继续准备演讲。</dd>
          </div>
          <div>
            <dt>完整逐字稿</dt>
            <dd>按页整理的 Markdown 讲稿，方便校对、练习和分享。</dd>
          </div>
          <div>
            <dt>有声演示</dt>
            <dd>口播生成后，导出可离线播放的 HTML，让画面和声音一起呈现。</dd>
          </div>
        </dl>
        <p className="web-caption">
          {local
            ? "已分层页面导出为底图加可编辑文字；配置完整字体包后可内嵌字体。历史整图页沿用原画面，原稿与原图保留。"
            : account?.layeredReady
              ? "新生成页可编辑文字、调整动效。PPTX 保留独立文本框并内嵌字体；动效使用网页或 HTML 播放。已有整图和历史版本保留。"
              : "新页面以完整图片导出到 PPTX，讲稿保留在备注中。本次暂不开放独立文字和动效编辑，已有项目与素材保留。"}
        </p>
      </section>
      <section className="web-faq">
        <h2>开始前，你可能想知道</h2>
        <FAQ title={local ? "如何开始使用？" : "如何获得账号？"}>
          {local
            ? "本机工作区无需注册。打开设置，配置内容和图片服务，再用一小段讲稿试做。"
            : "目前采用邀请制。向管理员获取 6 位数字邀请码，创建账号即可进入独立工作区。已有账号可以直接登录。"}
        </FAQ>
        <FAQ title="我需要配置图片模型吗？">
          {local
            ? "本机版在设置中连接自己的内容和图片接口；生成会使用相应供应商额度。"
            : "网页版由管理员统一配置内容和图片服务，你只需要准备讲稿。生成图片消耗账号额度，编辑讲稿和导出不消耗图片额度。"}
        </FAQ>
        <FAQ title="作品展示里的风格都能直接使用吗？">
          这里的四组作品均由风格库中的风格实际生成，新账号都可以直接使用。每组展示三种不同的页面表达；风格由管理员维护，生成结果会随内容和模型而变化。
        </FAQ>
        <FAQ title="可以用自己的声音，或制作数字人吗？">
          口播已开放，也可使用管理员接入的 MiniMax
          专属声音，自动情感编排也已开放。数字人制作仍在实验室阶段，网页版暂未开放。
        </FAQ>
        <FAQ title="网页版与 Mac App 的项目是否同步？">
          两者使用独立工作区。这个网页版不会修改你的 Mac App
          数据，也不会自动将所有 App 内容公开或同步给其他用户。
        </FAQ>
      </section>
      <section className="web-close">
        <h2>
          下一场演讲，
          <br />
          一起准备好。
        </h2>
        <p>{BRAND.tagline}</p>
        <WebLink className="btn primary" href={canEnter ? enter : "/register"}>
          {canEnter ? "进入我的工作区" : "我有邀请码，开始制作"}
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
        <h2>{register ? "邀请注册" : "登录讲好"}</h2>
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
                    inputMode="numeric"
                    required
                    value={invite}
                    onChange={(e) => setInvite(e.target.value)}
                    maxLength={160}
                    placeholder="输入 6 位数字邀请码"
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
                    minLength={register ? 6 : 1}
                    maxLength={128}
                    autoComplete={
                      register ? "new-password" : "current-password"
                    }
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={
                      register ? "至少 6 位，可用纯数字" : "输入密码"
                    }
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
                    minLength={6}
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
function Support({ account }: { account: SiteAccount | null }) {
  const local = account?.hosted === false;
  const [data, setData] = useState<Bootstrap>();
  useEffect(() => {
    if (!local && !account?.user) return;
    let active = true;
    api<Bootstrap>("/bootstrap")
      .then((value) => {
        if (active) setData(value);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [local, account?.user]);
  return (
    <div className="web-support">
      <Help
        data={data}
        hosted={!local}
        guideLabel="工作区诊断与新手引导"
        onBack={() => navigateWeb("/website")}
        onSettings={local ? () => navigateWeb("/#settings") : undefined}
        onGuide={
          local || account?.user ? () => navigateWeb("/#help") : undefined
        }
      />
      {!local && (
        <div className="web-reading">
          <h2 id="access">账号与服务支持</h2>
          <Contact account={account} />
        </div>
      )}
    </div>
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
      {page === "privacy" ? (
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
            生成结果取决于所配置的模型服务，可能存在文字、数据或画面误差。请在演讲或发布前核对内容。已分层页面的
            PPTX 保留独立文字与底图，历史整图页保持原样，完整讲稿写入备注。
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
