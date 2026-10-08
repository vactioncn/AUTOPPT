import { userError } from "../shared/user-error.mjs";
import { useEffect, useRef, useState } from "react";
import { api, asset, post } from "./api";
import { Button, Field, Modal } from "./components";
import { Feedback } from "./Feedback";
import { createGenerationRequest } from "./onboarding";
import type { Project } from "./types";
import type { Narration } from "./speech-types";
import {
  presenterVideo,
  presenterPositions as positions,
  presenterSizes as sizes,
  type AvatarProfile,
  type PresenterState,
} from "./presenter-types";
import "./presenter.css";

export function AvatarPresenter({
  project,
  onDelivery,
}: {
  project: Project;
  onDelivery: () => void;
}) {
  const storageKey = "autoppt-presenter-setup:" + project.id;
  const [selection, setSelection] = useState(() => {
    try {
      return {
        avatarId: "",
        narrationId: "",
        placement: "bottom-right",
        size: "small",
        ...JSON.parse(localStorage.getItem(storageKey) || "{}"),
      };
    } catch {
      return {
        avatarId: "",
        narrationId: "",
        placement: "bottom-right",
        size: "small",
      };
    }
  });
  const [avatars, setAvatars] = useState<AvatarProfile[]>([]);
  const [narrations, setNarrations] = useState<Narration[]>([]);
  const [state, setState] = useState<PresenterState>({
    configured: false,
    testOnly: false,
    versions: [],
  });
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [rename, setRename] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState<"new" | string | null>(null);
  const [versionId, setVersionId] = useState("");
  const [pageId, setPageId] = useState("");
  const [request] = useState(() =>
    createGenerationRequest("presenter:" + project.id),
  );
  const mutationLock = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  async function refresh() {
    const [profiles, voices, versions] = await Promise.all([
      api<AvatarProfile[]>("/avatars"),
      api<Narration[]>("/projects/" + project.id + "/narration"),
      api<PresenterState>("/projects/" + project.id + "/presenter"),
    ]);
    setAvatars(profiles);
    setNarrations(voices.filter((n) => n.status === "ready"));
    setState(versions);
  }
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const [profiles, voices, versions] = await Promise.all([
          api<AvatarProfile[]>("/avatars"),
          api<Narration[]>("/projects/" + project.id + "/narration"),
          api<PresenterState>("/projects/" + project.id + "/presenter"),
        ]);
        if (alive) {
          setAvatars(profiles);
          setNarrations(voices.filter((n) => n.status === "ready"));
          setState(versions);
        }
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    };
    void load();
    const timer = setInterval(load, 2500);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [project.id, project.revision]);
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(selection));
    } catch {
      /* In-memory selections remain usable when browser storage is unavailable. */
    }
  }, [selection, storageKey]);
  const choose = (key: string, value: string) =>
    setSelection({ ...selection, [key]: value });
  const selectedAvatar = avatars.find((a) => a.id === selection.avatarId);
  const version =
    state.versions.find((v) => v.id === versionId) || state.versions.at(-1);
  const previewPages =
    version?.pages.filter(
      (p) => p.status === "ready" && !p.stale && p.videoFile,
    ) || [];
  const preview =
    previewPages.find((p) => p.pageId === pageId) || previewPages[0];
  const running = state.versions.some((v) =>
    ["queued", "running"].includes(v.status),
  );
  async function mutate(action: () => Promise<unknown>) {
    if (mutationLock.current) return;
    mutationLock.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      mutationLock.current = false;
      setBusy(false);
    }
  }
  async function generate() {
    await mutate(async () => {
      if (confirmation === "new") {
        const key = JSON.stringify({
          ...selection,
          revision: project.revision,
        });
        const requestId = await request.forText(key);
        const v = await post("/projects/" + project.id + "/presenter", {
          ...selection,
          requestId,
          confirmed: true,
        });
        setVersionId(v.id);
        request.accepted();
      } else if (confirmation)
        await post("/presenter/" + confirmation + "/retry", {
          confirmed: true,
        });
      setConfirmation(null);
    });
  }
  return (
    <section
      className="journey-secondary avatar-presenter"
      aria-label="数字人讲解员"
      id="avatar-presenter"
    >
      <h3>
        数字人讲解员 <span>可选增强</span>
      </h3>
      <p>
        上传或选择头像 → 选择已就绪口播 →
        生成逐页数字人。圆形视频独立叠加在页面角落。
      </p>
      {!state.configured && (
        <Feedback
          kind="blocking"
          id="presenter-service-status"
          title="数字人服务尚未接入"
        >
          暂不能生成，但可以先预配置；已选头像、口播版本和位置会保留。
          服务接入并就绪后即可生成。
        </Feedback>
      )}
      {state.testOnly && (
        <p className="journey-warning">
          测试模式：使用本地样本视频，不代表真实口型生成。
        </p>
      )}
      <div className="presenter-setup">
        <Field label="数字人头像">
          <select
            value={selection.avatarId}
            onChange={(e) => choose("avatarId", e.target.value)}
            disabled={busy}
          >
            <option value="">选择头像</option>
            {avatars.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="数字人口播版本">
          <select
            value={selection.narrationId}
            onChange={(e) => choose("narrationId", e.target.value)}
            disabled={busy}
          >
            <option value="">选择已就绪口播</option>
            {narrations.map((n) => (
              <option key={n.id} value={n.id}>
                {n.voiceName} · 项目版本 {n.sourceRevision}
              </option>
            ))}
          </select>
        </Field>
        <Field label="数字人位置">
          <select
            value={selection.placement}
            onChange={(e) => choose("placement", e.target.value)}
            disabled={busy}
          >
            {Object.entries(positions).map(([v, n]) => (
              <option key={v} value={v}>
                {n}
              </option>
            ))}
          </select>
        </Field>
        <Field label="数字人大小">
          <select
            value={selection.size}
            onChange={(e) => choose("size", e.target.value)}
            disabled={busy}
          >
            {Object.entries(sizes).map(([v, n]) => (
              <option key={v} value={v}>
                {n}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {!narrations.length && (
        <p>请先在 AI 口播中完成一个与当前页面一致的口播版本。</p>
      )}
      <Button
        variant="primary"
        disabled={
          busy ||
          running ||
          !state.configured ||
          !selectedAvatar ||
          !selection.narrationId
        }
        aria-describedby={
          !state.configured ? "presenter-service-status-description" : undefined
        }
        onClick={() => setConfirmation("new")}
      >
        生成数字人
      </Button>
      {selectedAvatar && (
        <img
          className="presenter-avatar"
          src={asset(selectedAvatar.previewAsset)}
          alt={selectedAvatar.name}
        />
      )}
      <details className="presenter-manage">
        <summary>创建 / 管理头像</summary>
        <Field label="新头像名称">
          <input
            value={name}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label="头像图片">
          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />
        </Field>
        <p>JPEG、PNG、WebP，最大 8 MB；上传后会校验并归一化为本地图片。</p>
        <Button
          disabled={busy || !file || !name.trim()}
          onClick={() =>
            void mutate(async () => {
              const form = new FormData();
              form.set("name", name);
              form.set("image", file!);
              const a = await api<AvatarProfile>("/avatars", {
                method: "POST",
                body: form,
              });
              choose("avatarId", a.id);
              setName("");
              setFile(null);
              if (fileInput.current) fileInput.current.value = "";
            })
          }
        >
          保存头像
        </Button>
        {selectedAvatar && (
          <div className="presenter-manage-actions">
            <Field label="头像新名称">
              <input
                value={rename}
                maxLength={80}
                onChange={(e) => setRename(e.target.value)}
              />
            </Field>
            <Button
              disabled={busy || !rename.trim()}
              onClick={() =>
                void mutate(() =>
                  api("/avatars/" + selectedAvatar.id, {
                    method: "PATCH",
                    body: JSON.stringify({ name: rename }),
                  }),
                )
              }
            >
              重命名
            </Button>
            <Button
              disabled={busy}
              onClick={() =>
                void mutate(async () => {
                  await api("/avatars/" + selectedAvatar.id, {
                    method: "DELETE",
                  });
                  choose("avatarId", "");
                })
              }
            >
              删除头像
            </Button>
            <p>删除后，已完成版本引用的头像和视频仍会保留。</p>
          </div>
        )}
      </details>
      {version && (
        <div className="presenter-result">
          {preview && (
            <div className="presenter-next-actions">
              <Button
                onClick={() =>
                  document
                    .getElementById("presenter-video-preview")
                    ?.scrollIntoView({ block: "center", behavior: "smooth" })
                }
              >
                预览数字人
              </Button>
              <Button onClick={onDelivery}>前往交付中心</Button>
            </div>
          )}
          <Field label="数字人版本">
            <select
              value={version.id}
              onChange={(e) => setVersionId(e.target.value)}
            >
              {state.versions.map((v) => (
                <option key={v.id} value={v.id}>
                  {new Date(v.createdAt).toLocaleString("zh-CN")} ·{" "}
                  {v.current ? "已完成" : "待完成或更新"}
                  {v.provider === "mock" ? " · 测试样本" : ""}
                </option>
              ))}
            </select>
          </Field>
          <p role="status">
            {version.progress}
            {version.pages.some((p) => p.stale)
              ? " · 来源已改变，仅不匹配页面需要更新。"
              : ""}
          </p>
          <ol className="presenter-pages">
            {version.pages.map((p, i) => (
              <li key={p.pageId}>
                第 {i + 1} 页 ·{" "}
                {p.stale
                  ? "已过期"
                  : p.status === "ready"
                    ? p.videoFile
                      ? "视频已完成"
                      : "无口播，按静默时长播放"
                    : (
                        {
                          running: "生成中",
                          pending: "等待",
                          queued: "等待",
                          interrupted: "已中断",
                          failed: "失败",
                        } as Record<string, string>
                      )[p.status] || p.status}
                {p.error && " · " + userError(p.error)}
              </li>
            ))}
          </ol>
          {["partial", "interrupted"].includes(version.status) &&
            !version.pages.some((p) => p.stale) && (
              <Button
                disabled={busy || !state.configured}
                onClick={() => setConfirmation(version.id)}
              >
                确认继续 / 重试失败页
              </Button>
            )}
          {preview && (
            <>
              <Field label="数字人预览页面">
                <select
                  value={preview.pageId}
                  onChange={(e) => setPageId(e.target.value)}
                >
                  {previewPages.map((p) => (
                    <option key={p.pageId} value={p.pageId}>
                      第 {version.pages.indexOf(p) + 1} 页
                    </option>
                  ))}
                </select>
              </Field>
              <video
                id="presenter-video-preview"
                className="presenter-preview"
                key={version.id + preview.pageId}
                src={presenterVideo(version.id, preview.pageId)}
                controls
                playsInline
                preload="metadata"
                aria-label="数字人本地视频预览"
              />
              {version.provider === "mock" && (
                <p>本地测试样本，仅用于校验播放与导出。</p>
              )}
            </>
          )}
        </div>
      )}
      {error && <Feedback kind="blocking">{error}</Feedback>}
      {confirmation && (
        <Modal
          title="确认生成数字人"
          onClose={() => {
            if (!busy) setConfirmation(null);
          }}
        >
          <Feedback kind="risk" title="确认素材、范围与费用">
            <p>
              头像：
              {confirmation === "new"
                ? selectedAvatar?.name
                : avatars.find((a) => a.id === version?.avatarId)?.name ||
                  "此版本头像"}
              ；口播：
              {narrations.find(
                (n) =>
                  n.id ===
                  (confirmation === "new"
                    ? selection.narrationId
                    : version?.narrationId),
              )?.voiceName || "此版本口播"}
              。
            </p>
            <p>
              将向数字人服务发送所选头像与已就绪的逐页口播音频。真实服务可能按视频时长收费；失败重试使用同一请求编号，供应商的幂等与计费规则仍需核验。
            </p>
            <p>
              本次项目共 {project.slides.length}{" "}
              页；已完成且内容一致的页面会复用。
            </p>
            {state.testOnly && (
              <p>当前为测试模式，仅生成本地样本，不发送网络请求或产生费用。</p>
            )}
          </Feedback>
          <div className="presenter-confirm-actions">
            <Button disabled={busy} onClick={() => setConfirmation(null)}>
              取消
            </Button>
            <Button
              variant="primary"
              loading={busy}
              onClick={() => void generate()}
            >
              确认并生成
            </Button>
          </div>
          {error && <p role="alert">{error}</p>}
        </Modal>
      )}
    </section>
  );
}
