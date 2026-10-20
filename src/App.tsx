import { FirstPicture } from "./FirstPicture";
import { BRAND } from "../shared/brand.mjs";
import { BrandLockup } from "./BrandLockup";
import { UsagePage } from "./Usage";
import { Help } from "./Help";
import { useOnboarding, WorkspaceReadiness } from "./OnboardingUI";
import {
  onboardingReadiness,
  safeWorkspaceLabel,
  unknownModelStatus,
} from "./onboarding";
import { useAccount, AccountFooter, AccountPage } from "./Account";
import { DeleteItem } from "./DeleteItem";
import { NewProject, type NewProjectDraft } from "./NewProject";
import { SceneView } from "./SceneView";
import { LayeredView } from "./LayeredView";
import { useState, useEffect, useCallback, useRef } from "react";
import {
  Trash,
  SquaresFour,
  Palette,
  SlidersHorizontal,
  Plus,
  ArrowUpRight,
  ArrowRight,
  CheckCircle,
  WarningCircle,
  Presentation,
  Stack,
  ArrowLeft,
  FolderSimple,
  Info,
  SpinnerGap,
  Coins,
} from "@phosphor-icons/react";
import { api, asset, formatDate, active } from "./api";
import type { Bootstrap, ProjectSummary, Style, Project } from "./types";
import { Button, StylePreview } from "./components";
import { Workspace } from "./Workspace";
import { projectArea } from "./project-journey";
import { StyleLibrary } from "./StyleLibrary";
import { SettingsPage, type SettingsSection } from "./Settings";
import { WorkspaceNavigation } from "./WorkspaceNavigation";
import { visiblePublicPage, navigateWeb } from "../shared/web-routes.mjs";
import { VersionWorkspace } from "./VersionWorkspace";
import {
  frontendBuildInfo,
  productionBuild,
  resolveCapabilities,
} from "./diagnostics";
import { compareBuildInfo } from "../shared/diagnostics.mjs";
import {
  DEFAULT_STYLE_ID,
  defaultStyleId,
  offeredStyles,
} from "../shared/styles.mjs";

export default function App() {
  const account = useAccount();
  const [data, setData] = useState<Bootstrap | null>(null),
    [route, setRoute] = useState(
      visiblePublicPage(location.pathname, location.hash, account.hosted)
        ? "projects"
        : location.hash.slice(1) || "projects",
    ),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [creating, setCreating] = useState(false),
    [initialStyle, setInitialStyle] = useState(DEFAULT_STYLE_ID);
  const onboardingScope = `${data?.buildInfo?.runtimeMode || (account.hosted ? "hosted" : "local-browser")}:${account.hosted ? account.user?.id || "signed-out" : "local"}`;
  const onboarding = useOnboarding(onboardingScope);
  const [creationDraft, setCreationDraft] = useState<NewProjectDraft | null>(
    null,
  );
  const [styleRepair, setStyleRepair] = useState(false);
  const previousRoute = useRef(
    ["intro", "help"].includes(route) ? "projects" : route,
  );
  const informationRoute = ["intro", "help"].includes(route);
  const contentRoute = informationRoute ? previousRoute.current : route;
  const offered = offeredStyles(data?.styles || [], account.hosted);
  const refresh = useCallback(async () => {
    try {
      setData(await api("/bootstrap"));
      setError("");
    } catch {
      setError("无法连接工作区，请检查服务是否启动后重试。");
    }
  }, []);
  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 2500);
    const hash = () => {
      if (visiblePublicPage(location.pathname, location.hash, account.hosted))
        return;
      const next = location.hash.slice(1) || "projects";
      if (next !== "styles") {
        setCreationDraft(null);
        setStyleRepair(false);
      }
      if (!["intro", "help"].includes(next)) previousRoute.current = next;
      setRoute(next);
    };
    window.addEventListener("hashchange", hash);
    window.addEventListener("popstate", hash);
    return () => {
      clearInterval(timer);
      window.removeEventListener("hashchange", hash);
      window.removeEventListener("popstate", hash);
    };
  }, [refresh]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(t);
  }, [toast]);
  const go = (to: string, continueCreation = false) => {
    if (!continueCreation) {
      setCreationDraft(null);
      setStyleRepair(false);
    }
    if (!["intro", "help"].includes(to)) previousRoute.current = to;
    navigateWeb("/#" + to);
    setRoute(to);
  };
  const create = (styleId = DEFAULT_STYLE_ID, restoreDraft = false) => {
    if (account.hosted) {
      go("new" + (styleId !== DEFAULT_STYLE_ID ? "/" + styleId : ""));
      return;
    }
    if (!restoreDraft) setCreationDraft(null);
    setStyleRepair(false);
    const available = offered.filter((s) => s.rules);
    setInitialStyle(
      available.some((s) => s.id === styleId)
        ? styleId
        : defaultStyleId(available),
    );
    setCreating(true);
  };
  const currentId = contentRoute.startsWith("project/")
    ? contentRoute.slice(8).split("/")[0]
    : null;
  const currentArea = projectArea(
    contentRoute.split("/")[2] || (account.hosted ? "studio" : "overview"),
  );
  useEffect(() => {
    if (visiblePublicPage(location.pathname, location.hash, account.hosted))
      return;
    document.title = `${BRAND.name} · ${route.startsWith("new") ? "开始制作" : route.startsWith("project/") ? data?.projects.find((p) => p.id === route.split("/")[1])?.title || "我的演讲" : route === "styles" ? "风格库" : "我的演讲"}`;
  }, [account.hosted, route, data?.projects]);
  const notify = (text: string) => setToast(text);
  if (!data)
    return (
      <div className="boot">
        <h1>
          <BrandLockup compact />
        </h1>
        {error ? (
          <>
            <p>{error}</p>
            <Button onClick={refresh}>重新连接</Button>
          </>
        ) : (
          <SpinnerGap className="spin" size={22} />
        )}
      </div>
    );
  const consistency = compareBuildInfo(
    frontendBuildInfo,
    data.buildInfo,
    productionBuild,
  );
  if (consistency.blocked)
    return (
      <main className="compatibility-gate">
        <VersionWorkspace data={data} blocked />
      </main>
    );
  const capabilities = resolveCapabilities(data);
  const readiness = onboardingReadiness(
    { ...data, styles: offered },
    capabilities,
    account,
  );
  const current = data.projects.find((p) => p.id === currentId);
  return (
    <div className={account.hosted ? "app-shell hosted-shell" : "app-shell"}>
      {account.hosted ? (
        <WorkspaceNavigation
          route={route}
          currentId={currentId}
          projects={data.projects}
          styleCount={offered.length}
          go={go}
          onCreate={() => create()}
        />
      ) : (
        <aside className="sidebar">
          <button
            className="brand"
            onClick={() => go("projects")}
            aria-label={`${BRAND.name} 我的演讲`}
          >
            <BrandLockup />
          </button>
          <Button
            variant="primary"
            className="new-project-side"
            onClick={() => create()}
          >
            <Plus size={18} />
            新建演讲项目
          </Button>
          <nav className="main-nav" aria-label="主导航">
            <button
              className={
                !informationRoute && (route === "projects" || currentId)
                  ? "active"
                  : ""
              }
              onClick={() => go("projects")}
            >
              <SquaresFour size={20} />
              项目
            </button>
            <button
              className={route === "styles" ? "active" : ""}
              onClick={() => go("styles")}
            >
              <Palette size={20} />
              风格库
              <span className="nav-count">
                {data.styles.filter((s) => !s.deletedAt).length}
              </span>
            </button>
            <button onClick={() => navigateWeb("/website")}>
              <Info size={20} />
              官网与帮助
            </button>
            {!account.hosted && (
              <button
                className={route === "usage" ? "active" : ""}
                onClick={() => go("usage")}
              >
                <Coins size={20} />
                用量与账单
              </button>
            )}
            <button
              className={route.split("/")[0] === "settings" ? "active" : ""}
              onClick={() => go("settings")}
            >
              <SlidersHorizontal size={20} />
              {account.hosted ? "账号设置" : "设置"}
            </button>
          </nav>
          <div className="side-projects">
            <span className="side-label">最近项目</span>
            {data.projects.slice(0, 7).map((p) => (
              <button
                key={p.id}
                className={p.id === currentId ? "current" : ""}
                onClick={() => go("project/" + p.id)}
              >
                <span className="project-dot" />
                <span>{p.title}</span>
              </button>
            ))}
            {!data.projects.length && (
              <p className="side-empty">从第一场演讲开始</p>
            )}
          </div>
          <div className="sidebar-footer">
            {account.hosted ? (
              <AccountFooter onOpen={() => go("account")} />
            ) : (
              <>
                <div className="local-label">
                  <span className="connection-dot" />
                  本机工作空间<span>LOCAL</span>
                </div>
              </>
            )}
          </div>
        </aside>
      )}
      <main className="main">
        <header className="topbar">
          <div className="breadcrumb">
            <span>工作空间</span>
            <span>/</span>
            <strong>
              {route === "intro"
                ? "产品介绍"
                : route === "help"
                  ? "使用帮助"
                  : current?.title ||
                    (route === "usage"
                      ? "用量与账单"
                      : route === "styles"
                        ? "风格库"
                        : route === "admin"
                          ? "网站管理"
                          : route === "account"
                            ? "账号与额度"
                            : route.split("/")[0] === "settings"
                              ? account.hosted
                                ? "账号设置"
                                : "设置"
                              : contentRoute.startsWith("new")
                                ? "开始制作"
                                : account.hosted
                                  ? "我的演讲"
                                  : "项目")}
            </strong>
          </div>
          <span className="top-hint">
            <CheckCircle size={15} />
            {account.hosted ? "内容保存在你的独立工作区" : "内容保存在本机"}
          </span>
        </header>
        {error && (
          <div className="connection-banner">
            <WarningCircle size={18} />
            {error}
            <button onClick={refresh}>重试连接</button>
          </div>
        )}
        {consistency.status === "mismatch" && (
          <div className="connection-banner" role="alert">
            {consistency.message}
          </div>
        )}
        {route === "help" && (
          <>
            {onboarding.value.workspace === "pending" && (
              <WorkspaceReadiness
                data={{ ...data, styles: offered }}
                account={account}
                capabilities={capabilities}
                onStart={() => create()}
                onSettings={() => go("settings")}
                onStyles={() => {
                  setStyleRepair(true);
                  go("styles", true);
                }}
                onSkip={() => onboarding.update({ workspace: "skipped" })}
              />
            )}
            <Help
              data={data}
              onBack={() => go(previousRoute.current)}
              onSettings={() => go("settings")}
              onGuide={() => {
                onboarding.update({ workspace: "pending", page: "pending" });
                requestAnimationFrame(() =>
                  document
                    .querySelector('[aria-label="首次工作区准备"]')
                    ?.scrollIntoView({ behavior: "smooth" }),
                );
              }}
            />
          </>
        )}
        <div hidden={informationRoute} className="workspace-content">
          {contentRoute === "projects" &&
            !informationRoute &&
            !account.hosted &&
            onboarding.value.workspace === "pending" && (
              <WorkspaceReadiness
                data={{ ...data, styles: offered }}
                account={account}
                capabilities={capabilities}
                onStart={() => create()}
                onSettings={() => go("settings")}
                onStyles={() => {
                  setStyleRepair(true);
                  go("styles", true);
                }}
                onSkip={() => onboarding.update({ workspace: "skipped" })}
              />
            )}
          {account.hosted && contentRoute.split("/")[0] === "new" ? (
            <FirstPicture
              scope={onboardingScope}
              key={account.user?.id}
              styles={offered}
              initialStyle={contentRoute.split("/")[1]}
              example={contentRoute.split("/")[1] === "example"}
              onCreated={(p, message) => {
                void refresh();
                onboarding.update({ workspace: "complete" });
                go("project/" + p.id + "/studio");
                notify(message);
              }}
            />
          ) : currentId ? (
            <Workspace
              capabilities={capabilities}
              dataRootLabel={safeWorkspaceLabel(data.dataRootLabel)}
              hosted={
                account.hosted || data.buildInfo?.runtimeMode === "hosted"
              }
              modelsReady={readiness.modelsReady}
              modelStatusUnknown={!!account.modelStatusUnknown}
              generationScope={JSON.stringify([onboardingScope, currentId])}
              onboarding={onboarding.value}
              onOnboardingChange={onboarding.update}
              area={currentArea}
              onAreaChange={(area) => go(`project/${currentId}/${area}`)}
              key={JSON.stringify([onboardingScope, currentId])}
              id={currentId}
              styles={data.styles}
              settings={data.settings}
              notify={notify}
              onRefresh={refresh}
              onSettings={() => go("settings")}
            />
          ) : contentRoute === "styles" ? (
            <StyleLibrary
              curated={account.hosted}
              promptRepair={styleRepair}
              onReturn={
                creationDraft
                  ? (styleId) => create(styleId || creationDraft.styleId, true)
                  : undefined
              }
              urlImportAvailable={!!data.features?.styleUrlImport}
              styles={offered}
              jobs={data.jobs}
              refresh={refresh}
              notify={notify}
              onUse={(styleId) => create(styleId)}
            />
          ) : contentRoute === "usage" && !account.hosted ? (
            <UsagePage />
          ) : contentRoute === "admin" && account.hosted ? (
            <AccountPage adminOnly />
          ) : contentRoute === "account" ? (
            <AccountPage />
          ) : contentRoute.split("/")[0] === "settings" ? (
            !capabilities.localModelSettings.enabled ? (
              <AccountPage />
            ) : (
              <SettingsPage
                initial={data.settings}
                notify={notify}
                refresh={refresh}
                section={
                  (["models", "speech", "labs"].includes(
                    contentRoute.split("/")[1],
                  )
                    ? contentRoute.split("/")[1]
                    : "models") as SettingsSection
                }
                onSectionChange={(section) => go("settings/" + section)}
              />
            )
          ) : (
            <ProjectHome
              hosted={account.hosted}
              onExample={() => go("new/example")}
              packageCapability={capabilities.projectPackages}
              refresh={refresh}
              projects={data.projects}
              styles={data.styles}
              onCreate={() => create()}
              onOpen={(id) => go("project/" + id)}
              onStyles={() => go("styles")}
            />
          )}
        </div>
      </main>
      {creating && (
        <NewProject
          styles={offered}
          initialStyle={initialStyle}
          initialDraft={creationDraft}
          onStyles={(draft) => {
            setCreationDraft(draft);
            setStyleRepair(true);
            setCreating(false);
            go("styles", true);
          }}
          onClose={() => {
            setCreating(false);
            setCreationDraft(null);
            setStyleRepair(false);
          }}
          onCreated={async (p) => {
            setCreating(false);
            setCreationDraft(null);
            await refresh();
            onboarding.update({ workspace: "complete" });
            go("project/" + p.id + "/studio");
            notify("项目已创建，开始添加第一段逐字稿吧。");
          }}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          <CheckCircle size={19} />
          {toast}
        </div>
      )}
    </div>
  );
}
function ProjectHome({
  hosted,
  onExample,
  packageCapability,
  refresh,
  projects,
  styles,
  onCreate,
  onOpen,
  onStyles,
}: {
  hosted: boolean;
  onExample: () => void;
  packageCapability: import("../shared/diagnostics.mjs").Capability;
  refresh: () => Promise<void>;
  projects: ProjectSummary[];
  styles: Style[];
  onCreate: () => void;
  onOpen: (id: string) => void;
  onStyles: () => void;
}) {
  const [deleting, setDeleting] = useState<ProjectSummary | null>(null);
  const [importing, setImporting] = useState(false),
    [importError, setImportError] = useState("");
  const importFile = useRef<HTMLInputElement>(null);
  return (
    <div className="page home">
      {deleting && (
        <DeleteItem
          kind="project"
          id={deleting.id}
          name={deleting.title}
          onClose={() => setDeleting(null)}
          onDeleted={refresh}
        />
      )}
      <section className="home-intro">
        <div>
          <h1>
            让讲述，自然成页<span>。</span>
          </h1>
          <p>
            {hosted
              ? "放入讲稿，先看一页效果。满意后再做整份 PPT。"
              : "从一段逐字稿开始，把你的想法一步步变成演讲。"}
          </p>
          <div className={hosted ? "hosted-home-actions" : undefined}>
            <Button variant="primary" onClick={onCreate}>
              <Plus size={18} />
              {hosted ? "用我的讲稿开始" : "新建演讲项目"}
              <ArrowUpRight size={17} />
            </Button>
            {hosted && (
              <Button variant="ghost" onClick={onExample}>
                用示例体验
              </Button>
            )}
          </div>
        </div>
        <div className="intro-composition" aria-hidden="true">
          <div className="intro-script">
            <span>我的演说稿</span>
            <i />
            <i />
            <i />
            <i />
            <i />
          </div>
          <div className="intro-slide">
            <span>好的演讲</span>
            <strong>
              从一个
              <br />
              想法开始。
            </strong>
            <div>
              <span>YOUR NEXT TALK</span>
              <ArrowUpRight size={24} />
            </div>
          </div>
        </div>
      </section>
      <section className="project-section">
        <input
          ref={importFile}
          hidden
          type="file"
          accept=".autoppt.zip,.zip"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            setImporting(true);
            setImportError("");
            try {
              if (file.size > 1024 * 1024 * 1024)
                throw new Error("项目包不能超过 1 GB。");
              const body = new FormData();
              body.append("project", file);
              const result = await api<{ project: Project }>(
                "/projects/import",
                { method: "POST", body },
              );
              await refresh();
              onOpen(result.project.id);
            } catch (error) {
              setImportError((error as Error).message);
            } finally {
              setImporting(false);
            }
          }}
        />
        {importError && (
          <p className="error-text" role="alert">
            {importError}
          </p>
        )}
        <div className="section-heading">
          <div>
            <h2>
              我的演讲{" "}
              <span>{projects.length.toString().padStart(2, "0")}</span>
            </h2>
            <p>每一次追加，都离完整的演讲更近一点。</p>
          </div>
          <div className="home-project-actions">
            <Button
              disabled={importing || !packageCapability.enabled}
              title={packageCapability.reason}
              onClick={() => importFile.current?.click()}
            >
              {importing ? "正在导入项目…" : "导入项目包"}
            </Button>
            {projects.length > 0 && (
              <Button onClick={onCreate}>
                <Plus size={16} />
                新建项目
              </Button>
            )}
          </div>
        </div>
        {projects.length ? (
          <div className="project-grid">
            {projects.map((p) => (
              <article className="project-card-wrap" key={p.id}>
                <button className="project-card" onClick={() => onOpen(p.id)}>
                  <div className="project-cover">
                    {p.coverLayered ? (
                      <LayeredView page={p.coverLayered} label={p.title} />
                    ) : p.coverScene ? (
                      <SceneView scene={p.coverScene} label={p.title} />
                    ) : p.cover ? (
                      <img src={asset(p.cover)} alt={p.title} />
                    ) : styles.length ? (
                      <StylePreview
                        style={
                          styles.find((s) => s.id === p.styleId) || styles[0]
                        }
                        compact
                      />
                    ) : (
                      <div className="style-preview">
                        <Palette size={30} />
                        <span>尚未生成画面</span>
                      </div>
                    )}
                    <span className="project-open">
                      <ArrowUpRight size={20} />
                    </span>
                  </div>
                  <div className="project-card-content">
                    <h3>{p.title}</h3>
                    <p>
                      {p.pageCount} 页画面<span>·</span>
                      {p.batchCount} 段讲稿<span>·</span>
                      {formatDate(p.updatedAt)}
                    </p>
                    {hosted && p.continuation && (
                      <p className="project-continuation">
                        {p.continuation.label}
                      </p>
                    )}
                  </div>
                </button>
                <button
                  className="card-delete"
                  aria-label={`删除项目：${p.title}`}
                  title="删除项目"
                  onClick={() => setDeleting(p)}
                >
                  <Trash size={16} aria-hidden="true" />
                </button>
              </article>
            ))}
            <button className="project-add" onClick={onCreate}>
              <Plus size={26} weight="light" />
              <span>开始一场新的演讲</span>
            </button>
          </div>
        ) : (
          <div className="project-empty">
            <div className="empty-icon">
              <Presentation size={32} weight="light" />
            </div>
            <div>
              <h3>你的第一场演讲，从这里开始</h3>
              <p>不用准备整篇文稿。先给一小段，看看它会变成什么。</p>
            </div>
            <Button onClick={onCreate}>
              {hosted ? "放入第一段讲稿" : "创建第一个项目"}
              <ArrowRight size={17} />
            </Button>
          </div>
        )}
      </section>
      {!hosted && (
        <>
          <section className="workflow-strip" aria-label="制作流程">
            {[
              {
                title: "添加一段逐字稿",
                text: "按你的节奏，随时续写",
                icon: FolderSimple,
              },
              {
                title: "自动设计成页",
                text: "理解观点，延续选定风格",
                icon: Stack,
              },
              {
                title: "调整，再继续",
                text: "重新设计、合并、手动拆分",
                icon: SlidersHorizontal,
              },
              {
                title: "保存满意的图片",
                text: "原稿与画面，逐页对应",
                icon: Presentation,
              },
            ].map((s, i) => (
              <div className="workflow-step" key={s.title}>
                <div className="workflow-number">{i + 1}</div>
                <div>
                  <strong>{s.title}</strong>
                  <span>{s.text}</span>
                </div>
                {i < 3 && <ArrowRight className="workflow-arrow" size={16} />}
              </div>
            ))}
          </section>
          <div className="style-callout">
            <Palette size={23} />
            <div>
              <strong>让每一页，都有你的风格。</strong>
              <span>上传喜欢的参考图，建立可以反复使用的视觉语言。</span>
            </div>
            <Button variant="ghost" onClick={onStyles}>
              探索风格库
              <ArrowRight size={16} />
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
