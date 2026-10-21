import { useEffect, useRef, useState } from "react";
import { ArrowRight, CheckCircle } from "@phosphor-icons/react";
import { Button, Field, StylePreview } from "./components";
import { useAccount } from "./Account";
import { api, post } from "./api";
import { createGenerationRequest, exampleManuscript } from "./onboarding";
import { manuscriptTitle } from "../shared/first-picture.mjs";
import { HOSTED_BUILTIN_STYLE_IDS, defaultStyleId } from "../shared/styles.mjs";
import type { Project, Style } from "./types";
import "./first-picture.css";

type Draft = { text: string; title: string; styleId: string };
export function FirstPicture({
  scope,
  styles,
  initialStyle,
  example,
  creditsPerPage = 1,
  onCreated,
}: {
  scope: string;
  styles: Style[];
  initialStyle?: string;
  example: boolean;
  creditsPerPage?: number;
  onCreated: (project: Project, message: string) => void;
}) {
  const account = useAccount();
  const key = `autoppt-first-picture:v1:${account.user!.id}`;
  const available = styles.filter(
    (s) => (s.canUse ?? !!s.rules) && !s.deletedAt,
  );
  const [draft, setDraft] = useState<Draft>(() => {
    let saved: Partial<Draft> = {};
    try {
      saved = JSON.parse(localStorage.getItem(key) || "{}") || {};
    } catch {
      /* Use an empty form. */
    }
    return {
      text:
        typeof saved.text === "string"
          ? saved.text
          : example
            ? exampleManuscript
            : "",
      title: typeof saved.title === "string" ? saved.title : "",
      styleId: available.some((s) => s.id === initialStyle)
        ? initialStyle!
        : available.some((s) => s.id === saved.styleId)
          ? saved.styleId!
          : defaultStyleId(available),
    };
  });
  const [localSaved, setLocalSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState("");
  const [error, setError] = useState("");
  const [personal, setPersonal] = useState(false);
  const lock = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [request] = useState(() =>
    createGenerationRequest(`first-picture:${account.user!.id}`),
  );
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(draft));
      setLocalSaved(true);
    } catch {
      setLocalSaved(false);
    }
  }, [draft, key]);
  const chosen = available.find((s) => s.id === draft.styleId);
  const featured = available.filter((s) =>
    HOSTED_BUILTIN_STYLE_IDS.includes(s.id),
  );
  const own = available.filter((s) => !HOSTED_BUILTIN_STYLE_IDS.includes(s.id));
  const start = async (generate: boolean) => {
    if (lock.current || !draft.text.trim() || !chosen) return;
    lock.current = true;
    setBusy(true);
    setError("");
    let project: Project | undefined;
    try {
      if (generate) {
        const fresh = await api<{
          modelReady?: boolean;
          user: { available: number } | null;
        }>("/account");
        if (!fresh.user)
          throw new Error("登录已失效，请重新登录。讲稿仍保留在此浏览器。");
        if (!fresh.modelReady)
          throw new Error("生成服务暂未就绪，可以先保存讲稿，稍后继续。");
        if (fresh.user.available < creditsPerPage)
          throw new Error("图片额度不足，可以先保存讲稿，再联系管理员补充。");
      }
      setStage("正在保存完整讲稿…");
      const body = {
        title: draft.title.trim() || manuscriptTitle(draft.text),
        styleId: draft.styleId,
        draft: draft.text,
      };
      const requestId = await request.forText(JSON.stringify(body));
      project = await post<Project>("/projects", { ...body, requestId });
      // Creation acknowledges durable storage before generation. Network retries
      // use the same identity for both calls; reopening never starts paid work.
      let message = "讲稿已保存，随时可以继续生成第一张画面。";
      if (generate) {
        setStage("正在提交第一页制作…");
        // Share the pending identity with Workspace so a lost batch response
        // can be retried there, including after a browser restart.
        const generation = createGenerationRequest(
          JSON.stringify([scope, project.id]),
        );
        const generationId = await generation.forText(draft.text, "preview");
        const accepted = await post<{ accepted: boolean }>(
          `/projects/${project.id}/batches`,
          {
            text: draft.text,
            requestId: generationId,
            generationMode: "preview",
          },
        );
        if (!accepted.accepted)
          throw new Error("生成请求尚未确认，请在演讲内查看进度后继续。");
        generation.accepted();
        message = "讲稿已保存，正在制作第一张画面。";
      }
      request.accepted();
      try {
        localStorage.removeItem(key);
      } catch {
        /* Project already saved. */
      }
      if (mounted.current) onCreated(project, message);
    } catch (e) {
      if (project) {
        request.accepted();
        try {
          localStorage.removeItem(key);
        } catch {
          /* Project already saved. */
        }
        if (mounted.current)
          onCreated(
            project,
            `讲稿已保存。${(e as Error).message} 请查看制作进度后再继续。`,
          );
      } else if (mounted.current) setError((e as Error).message);
    } finally {
      lock.current = false;
      if (mounted.current) {
        setBusy(false);
        setStage("");
      }
    }
  };
  return (
    <div className="page first-picture">
      <header className="first-picture-heading">
        <h1>先做一张，看看效果。</h1>
        <p>放入你准备讲的话，选个喜欢的风格。满意后，再生成其余页面。</p>
      </header>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void start(true);
        }}
      >
        <fieldset disabled={busy} className="first-picture-layout">
          <section className="first-picture-manuscript">
            <div className="first-picture-field-heading">
              <label htmlFor="first-manuscript">你准备讲什么？</label>
              {!draft.text && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() =>
                    setDraft({ ...draft, text: exampleManuscript })
                  }
                >
                  填入示例讲稿
                </Button>
              )}
            </div>
            <textarea
              id="first-manuscript"
              value={draft.text}
              maxLength={200000}
              onChange={(e) => setDraft({ ...draft, text: e.target.value })}
              placeholder="粘贴一小段或完整讲稿，不需要自己拆页。"
              required
            />
            <div className="first-picture-draft-state" role="status">
              <span>
                {draft.text.length.toLocaleString()} 字
                {draft.text === exampleManuscript
                  ? " · 示例讲稿，可直接改写"
                  : ""}
              </span>
              <span>
                {draft.text
                  ? localSaved
                    ? "暂存于此浏览器"
                    : "尚未保存，请保留此页面"
                  : "先写一小段也可以"}
              </span>
            </div>
            <details className="first-picture-name">
              <summary>演讲名称（自动填写，可修改）</summary>
              <Field label="演讲名称">
                <input
                  value={draft.title}
                  onChange={(e) =>
                    setDraft({ ...draft, title: e.target.value })
                  }
                  maxLength={100}
                  placeholder={manuscriptTitle(draft.text)}
                />
              </Field>
            </details>
          </section>
          <section className="first-picture-styles" aria-label="选择画面风格">
            <h2>选一个喜欢的风格</h2>
            <p>从风格库选择，选中即可开始。</p>
            <div className="first-picture-style-grid">
              {featured.map((style) => (
                <button
                  key={style.id}
                  type="button"
                  className="first-picture-style"
                  aria-pressed={draft.styleId === style.id}
                  onClick={() => setDraft({ ...draft, styleId: style.id })}
                >
                  <StylePreview style={style} compact />
                  <span>
                    {style.name}
                    {draft.styleId === style.id && (
                      <CheckCircle size={18} weight="fill" />
                    )}
                  </span>
                </button>
              ))}
            </div>
            {!!own.length && (
              <details
                open={
                  personal ||
                  (!!chosen && !HOSTED_BUILTIN_STYLE_IDS.includes(chosen.id))
                }
                onToggle={(e) => setPersonal(e.currentTarget.open)}
                className="first-picture-personal"
              >
                <summary>更多风格</summary>
                <Field label="更多风格">
                  <select
                    value={
                      own.some((s) => s.id === draft.styleId)
                        ? draft.styleId
                        : ""
                    }
                    onChange={(e) =>
                      setDraft({ ...draft, styleId: e.target.value })
                    }
                  >
                    <option value="" disabled>
                      选择已保存的风格
                    </option>
                    {own.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </Field>
              </details>
            )}
            {!chosen && (
              <p className="error-text">暂无可用风格，请联系管理员。</p>
            )}
          </section>
        </fieldset>
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        {!account.modelReady && (
          <p className="first-picture-service" role="status">
            生成服务暂未就绪。可以先保存讲稿，稍后继续。
          </p>
        )}
        <footer className="first-picture-actions">
          <div>
            <strong>{chosen?.name || "请选择风格"}</strong>
            <p>
              {busy
                ? stage
                : `完整讲稿会保存到我的演讲；先试做 1 页，预估 ${creditsPerPage} 张图片额度（出图与底图修复按实际成功调用扣减）。当前可用 ${account.user?.available ?? 0} 张。`}
            </p>
          </div>
          <div className="first-picture-buttons">
            <Button
              type="button"
              disabled={busy || !draft.text.trim() || !chosen}
              onClick={() => void start(false)}
            >
              只保存讲稿
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={busy}
              disabled={
                !draft.text.trim() ||
                !chosen ||
                !account.modelReady ||
                !account.user?.available
              }
            >
              生成第一张画面
              <ArrowRight size={18} />
            </Button>
          </div>
        </footer>
      </form>
    </div>
  );
}
