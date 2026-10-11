import { useEffect, useRef, useState } from "react";
import {
  Plus,
  FolderSimple,
  Palette,
  Question,
  Globe,
  ShieldCheck,
  UserCircle,
  List,
  X,
  CaretDown,
  CaretRight,
} from "@phosphor-icons/react";
import { AccountFooter, useAccount } from "./Account";
import { Button } from "./components";
import type { ProjectSummary } from "./types";
import { navigateWeb } from "../shared/web-routes.mjs";
import "./workspace-navigation.css";

export function WorkspaceNavigation({
  route,
  currentId,
  projects,
  styleCount,
  go,
  onCreate,
}: {
  route: string;
  currentId?: string | null;
  projects: ProjectSummary[];
  styleCount: number;
  go: (route: string) => void;
  onCreate: () => void;
}) {
  const { user } = useAccount();
  const [open, setOpen] = useState(false),
    [recent, setRecent] = useState(true);
  const mobileToggle = useRef<HTMLButtonElement>(null);
  const nav = useRef<HTMLElement>(null);
  const visit = (route: string) => {
    go(route);
    setOpen(false);
  };
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const content = nav.current?.parentElement?.querySelector<HTMLElement>(".main");
    const wasInert = content?.inert;
    const previousOverflow = document.body.style.overflow;
    if (content) content.inert = true;
    document.body.style.overflow = "hidden";
    nav.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
      if (e.key === "Tab") {
        const items = Array.from(
          nav.current?.querySelectorAll<HTMLElement>("button, a[href]") || [],
        ).filter(
          (el) => el.getClientRects().length && !el.hasAttribute("disabled"),
        );
        const first = items[0],
          last = items.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("keydown", escape);
      if (content) content.inert = !!wasInert;
      document.body.style.overflow = previousOverflow;
      previous?.focus();
    };
  }, [open]);
  return (
    <>
      <div className="workspace-mobile-bar">
        <button
          ref={mobileToggle}
          className="icon-btn"
          onClick={() => setOpen(true)}
          aria-label="打开工作区导航"
          aria-expanded={open}
          aria-controls="workspace-navigation"
        >
          <List size={24} />
        </button>
        <strong>AutoPPT</strong>
        <button className="icon-btn" aria-label="新建演讲" onClick={onCreate}>
          <Plus size={23} />
        </button>
      </div>
      {open && (
        <button
          className="workspace-nav-backdrop"
          aria-label="关闭工作区导航"
          onClick={() => setOpen(false)}
        />
      )}
      <aside
        ref={nav}
        id="workspace-navigation"
        className={`workspace-navigation ${open ? "open" : ""}`}
        aria-label="工作区导航"
        role={open ? "dialog" : undefined}
        aria-modal={open ? true : undefined}
      >
        <div className="workspace-nav-brand">
          <button
            className="brand"
            onClick={() => visit("projects")}
            aria-label="AutoPPT 我的项目"
          >
            <span className="brand-icon">A</span>
            <span>
              AutoPPT<small>演讲制作工作区</small>
            </span>
          </button>
          <button
            className="workspace-nav-close icon-btn"
            onClick={() => setOpen(false)}
            aria-label="关闭工作区导航"
          >
            <X size={22} />
          </button>
        </div>
        <Button
          className="workspace-nav-create"
          aria-label="新建演讲"
          title="新建演讲"
          onClick={() => {
            onCreate();
            setOpen(false);
          }}
        >
          <Plus size={20} />
          新建演讲
        </Button>
        <nav className="workspace-primary-nav" aria-label="创作">
          <button
            aria-label="我的项目"
            title="我的项目"
            aria-current={route === "projects" ? "page" : undefined}
            onClick={() => visit("projects")}
          >
            <FolderSimple size={21} />
            <span>我的项目</span>
            <small>{projects.length}</small>
          </button>
          <button
            aria-label="风格库"
            title="风格库"
            aria-current={route === "styles" ? "page" : undefined}
            onClick={() => visit("styles")}
          >
            <Palette size={21} />
            <span>风格库</span>
            <small>{styleCount}</small>
          </button>
        </nav>
        <div className="workspace-recents">
          <button
            className="workspace-recents-toggle"
            onClick={() => setRecent(!recent)}
            aria-expanded={recent}
            aria-controls="workspace-recent-list"
          >
            {recent ? <CaretDown size={13} /> : <CaretRight size={13} />}
            最近项目
          </button>
          {recent && (
            <nav id="workspace-recent-list" aria-label="最近项目">
              {projects.slice(0, 6).map((p) => (
                <button
                  key={p.id}
                  title={p.title}
                  aria-current={currentId === p.id ? "page" : undefined}
                  onClick={() => visit("project/" + p.id)}
                >
                  <span className="project-dot" />
                  <span>{p.title}</span>
                </button>
              ))}
              {!projects.length && <p>从第一场演讲开始</p>}
            </nav>
          )}
        </div>
        <div className="workspace-nav-bottom">
          <nav aria-label="支持与管理">
            <button
              aria-label="使用帮助"
              title="使用帮助"
              aria-current={route === "help" ? "page" : undefined}
              onClick={() => visit("help")}
            >
              <Question size={20} />
              <span>使用帮助</span>
            </button>
            <button
              aria-label="官网介绍"
              title="官网介绍"
              onClick={() => {
                navigateWeb("/website");
                setOpen(false);
              }}
            >
              <Globe size={20} />
              <span>官网介绍</span>
            </button>
            {user?.role === "admin" && (
              <button
                aria-label="网站管理"
                title="网站管理"
                aria-current={route === "admin" ? "page" : undefined}
                onClick={() => visit("admin")}
              >
                <ShieldCheck size={20} />
                <span>网站管理</span>
              </button>
            )}
          </nav>
          <AccountFooter onOpen={() => visit("account")} />
          <button
            className="workspace-compact-account"
            aria-label="账号与额度"
            onClick={() => visit("account")}
          >
            <UserCircle size={24} />
          </button>
        </div>
      </aside>
    </>
  );
}
