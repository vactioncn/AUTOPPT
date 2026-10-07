import { useOnboarding, WorkspaceReadiness } from "./OnboardingUI";
import { safeWorkspaceLabel } from "./onboarding";
import { useAccount, AccountFooter, AccountPage } from "./Account";
import { DeleteItem } from "./DeleteItem";
import {
  DesignOptionsEditor,
  emptyDesignOptions,
  validDesignOptions,
} from "./DesignOptionsEditor";
import { SceneView } from "./SceneView";
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
} from "@phosphor-icons/react";
import { api, post, asset, formatDate, active } from "./api";
import type { Bootstrap, ProjectSummary, Style, Project } from "./types";
import { Button, Modal, Field, StylePreview } from "./components";
import { Workspace } from "./Workspace";
import { projectArea } from "./project-journey";
import { StyleLibrary } from "./StyleLibrary";
import { SettingsPage } from "./Settings";
import { Introduction } from "./Introduction";
import { VersionWorkspace } from "./VersionWorkspace";
import {
  frontendBuildInfo,
  productionBuild,
  resolveCapabilities,
} from "./diagnostics";
import { compareBuildInfo } from "../shared/diagnostics.mjs";
import { DEFAULT_STYLE_ID, defaultStyleId } from "../shared/styles.mjs";

export default function App() {
  const account = useAccount();
  const [data, setData] = useState<Bootstrap | null>(null),
    [route, setRoute] = useState(location.hash.slice(1) || "projects"),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [creating, setCreating] = useState(false),
    [initialStyle, setInitialStyle] = useState(DEFAULT_STYLE_ID);
  const onboarding = useOnboarding(
    `${data?.buildInfo?.runtimeMode || (account.hosted ? "hosted" : "local-browser")}:${account.hosted ? account.user?.id || "signed-out" : "local"}`,
  );
  const previousRoute = useRef(route === "intro" ? "projects" : route);
  const contentRoute = route === "intro" ? previousRoute.current : route;
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
      const next = location.hash.slice(1) || "projects";
      if (next !== "intro") previousRoute.current = next;
      setRoute(next);
    };
    window.addEventListener("hashchange", hash);
    return () => {
      clearInterval(timer);
      window.removeEventListener("hashchange", hash);
    };
  }, [refresh]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(t);
  }, [toast]);
  const go = (to: string) => {
    if (to !== "intro") previousRoute.current = to;
    location.hash = to;
    setRoute(to);
  };
  const create = (styleId = DEFAULT_STYLE_ID) => {
    const available = data?.styles.filter((s) => !s.deletedAt && s.rules) || [];
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
  const currentArea = projectArea(contentRoute.split("/")[2]);
  const notify = (text: string) => setToast(text);
  if (!data)
    return (
      <div className="boot">
        <div className="brand-icon">A</div>
        <h1>AutoPPT</h1>
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
  const current = data.projects.find((p) => p.id === currentId);
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => go("projects")}>
          <span className="brand-icon">A</span>
          <span>
            AutoPPT<small>你的演讲制作室</small>
          </span>
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
              route !== "intro" && (route === "projects" || currentId)
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
          <button
            className={route === "intro" ? "active" : ""}
            onClick={() => go("intro")}
          >
            <Info size={20} />
            帮助与介绍
          </button>
          <button
            className={route === "settings" ? "active" : ""}
            onClick={() => go("settings")}
          >
            <SlidersHorizontal size={20} />
            模型与服务
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
      <main className="main">
        <header className="topbar">
          <div className="breadcrumb">
            <span>工作空间</span>
            <span>/</span>
            <strong>
              {route === "intro"
                ? "产品介绍"
                : current?.title ||
                  (route === "styles"
                    ? "风格库"
                    : route === "account"
                      ? "账号与额度"
                      : route === "settings"
                        ? "模型与服务"
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
        {route === "intro" && (
          <>
            <div className="onboarding-help">
              <Button
                onClick={() =>
                  onboarding.update({ workspace: "pending", page: "pending" })
                }
              >
                重新查看新手引导
              </Button>
              <span>
                重看工作区准备；下次打开页面详情时会再次显示三点提示。
              </span>
            </div>
            {onboarding.value.workspace === "pending" && (
              <WorkspaceReadiness
                data={data}
                capabilities={capabilities}
                onStart={() => create()}
                onSettings={() => go("settings")}
                onStyles={() => go("styles")}
                onSkip={() => onboarding.update({ workspace: "skipped" })}
              />
            )}
            <Introduction
              data={data}
              onBack={() => go(previousRoute.current)}
            />
          </>
        )}
        <div hidden={route === "intro"} className="workspace-content">
          {contentRoute === "projects" &&
            route !== "intro" &&
            onboarding.value.workspace === "pending" && (
              <WorkspaceReadiness
                data={data}
                capabilities={capabilities}
                onStart={() => create()}
                onSettings={() => go("settings")}
                onStyles={() => go("styles")}
                onSkip={() => onboarding.update({ workspace: "skipped" })}
              />
            )}
          {currentId ? (
            <Workspace
              capabilities={capabilities}
              dataRootLabel={safeWorkspaceLabel(data.dataRootLabel)}
              hosted={data.buildInfo?.runtimeMode === "hosted"}
              onboarding={onboarding.value}
              onOnboardingChange={onboarding.update}
              area={currentArea}
              onAreaChange={(area) => go(`project/${currentId}/${area}`)}
              key={currentId}
              id={currentId}
              styles={data.styles}
              settings={data.settings}
              notify={notify}
              onRefresh={refresh}
              onSettings={() => go("settings")}
            />
          ) : contentRoute === "styles" ? (
            <StyleLibrary
              urlImportAvailable={!!data.features?.styleUrlImport}
              styles={data.styles}
              jobs={data.jobs}
              refresh={refresh}
              notify={notify}
              onUse={(styleId) => create(styleId)}
            />
          ) : contentRoute === "account" ? (
            <AccountPage />
          ) : contentRoute === "settings" ? (
            !capabilities.localModelSettings.enabled ? (
              <section className="page" aria-label="模型与服务">
                <div className="page-heading">
                  <div>
                    <h1>模型与服务</h1>
                    <p>{capabilities.localModelSettings.reason}</p>
                  </div>
                </div>
                <p>
                  {account.modelReady
                    ? "内容与图片服务已配置，可返回项目继续制作。"
                    : "内容与图片服务尚未就绪，请联系管理员配置。"}
                </p>
                <p className="detail-help">{capabilities.aiNarration.reason}</p>
                <Button onClick={() => go("account")}>账号与额度</Button>
              </section>
            ) : (
              <SettingsPage
                initial={data.settings}
                notify={notify}
                refresh={refresh}
              />
            )
          ) : (
            <ProjectHome
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
          styles={data.styles}
          initialStyle={initialStyle}
          onStyles={() => {
            setCreating(false);
            go("styles");
          }}
          onClose={() => setCreating(false)}
          onCreated={async (p) => {
            setCreating(false);
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
  packageCapability,
  refresh,
  projects,
  styles,
  onCreate,
  onOpen,
  onStyles,
}: {
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
          <p>从一段逐字稿开始，把你的想法一步步变成演讲。</p>
          <Button variant="primary" onClick={onCreate}>
            <Plus size={18} />
            新建演讲项目
            <ArrowUpRight size={17} />
          </Button>
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
                    {p.coverScene ? (
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
                  </div>
                </button>
                <button
                  className="card-delete"
                  aria-label={`删除项目：${p.title}`}
                  onClick={() => setDeleting(p)}
                >
                  <Trash size={16} />
                  删除
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
              创建第一个项目
              <ArrowRight size={17} />
            </Button>
          </div>
        )}
      </section>
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
    </div>
  );
}
function NewProject({
  styles,
  initialStyle,
  onStyles,
  onClose,
  onCreated,
}: {
  styles: Style[];
  initialStyle: string;
  onStyles: () => void;
  onClose: () => void;
  onCreated: (p: Project) => void;
}) {
  const [advanced, setAdvanced] = useState(false);
  const [choices, setChoices] = useState(emptyDesignOptions);
  const [optionsBusy, setOptionsBusy] = useState(false);
  const [title, setTitle] = useState(""),
    [styleId, setStyleId] = useState(initialStyle),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (
      busy ||
      optionsBusy ||
      !title.trim() ||
      !validDesignOptions(choices) ||
      !styles.some((s) => s.id === styleId && s.rules && !s.deletedAt)
    )
      return;
    setBusy(true);
    setError("");
    try {
      onCreated(
        await post("/projects", { title, styleId, designOptions: choices }),
      );
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <Modal
      title="开始一场新的演讲"
      subtitle="先写主题就能开始。风格、受众和配色以后都能修改。"
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <Field label="演讲主题">
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="例如：儿童摄影行业的下一步"
            maxLength={100}
            required
          />
        </Field>
        <div className="new-project-style">
          <div>
            <span>当前默认风格</span>
            <strong>
              {styles.find((s) => s.id === styleId && s.rules && !s.deletedAt)
                ?.name || "暂无可用风格"}
            </strong>
          </div>
          <Button
            type="button"
            variant="ghost"
            onClick={() => setAdvanced(true)}
          >
            更换
          </Button>
        </div>
        {!styles.some((s) => s.rules && !s.deletedAt) && (
          <div className="small-notice">
            <p>
              风格库还没有可用风格。填写风格提示词并保存后，即可回来创建演讲。
            </p>
            <Button type="button" onClick={onStyles}>
              前往风格库创建
            </Button>
          </div>
        )}
        <details
          className="new-project-options"
          open={advanced}
          onToggle={(event) => setAdvanced(event.currentTarget.open)}
        >
          <summary>个性化设置，可稍后修改</summary>
          <div className="field">
            <span>选择视觉风格</span>
            <div className="style-choice-grid">
              {styles
                .filter((s) => !!s.rules && !s.deletedAt)
                .map((s) => (
                  <button
                    type="button"
                    className={`style-choice ${styleId === s.id ? "chosen" : ""}`}
                    key={s.id}
                    aria-pressed={styleId === s.id}
                    onClick={() => setStyleId(s.id)}
                  >
                    <StylePreview style={s} compact />
                    <span>
                      {s.name}
                      {s.id === DEFAULT_STYLE_ID && " · 内置默认"}
                      {styleId === s.id && (
                        <CheckCircle weight="fill" size={17} />
                      )}
                    </span>
                  </button>
                ))}
            </div>
            <small>
              {styles.some((s) => s.rules && !s.deletedAt)
                ? "后续添加的页面将沿用这个风格。"
                : "风格库暂时没有可用风格，请先填写提示词创建风格。"}
            </small>
          </div>
          <DesignOptionsEditor
            value={choices}
            onChange={setChoices}
            styleId={styleId}
            disabled={busy}
            onBusyChange={setOptionsBusy}
          />
        </details>
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <Button onClick={onClose} type="button">
            取消
          </Button>
          <Button
            type="submit"
            variant="primary"
            loading={busy}
            disabled={
              optionsBusy ||
              !validDesignOptions(choices) ||
              !title.trim() ||
              !styles.some((s) => s.id === styleId && s.rules && !s.deletedAt)
            }
          >
            创建并写第一段
            <ArrowRight size={17} />
          </Button>
        </div>
      </form>
    </Modal>
  );
}
