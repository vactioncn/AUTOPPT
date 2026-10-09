import { useEffect, useRef, useState } from "react";
import { api, asset, post } from "./api";
import { Button, Field, Modal, Status } from "./components";
import { PresenterJobs, usePresenterJobs } from "./PresenterJobs";
import type {
  PresenterStudioState,
  PresenterVoice,
  PresenterGeneration,
} from "./presenter-types";
import "./presenter-studio.css";
export function PresenterStudio({
  hasKey,
  notify,
}: {
  hasKey: boolean;
  notify: (text: string) => void;
}) {
  const [state, setState] = useState<PresenterStudioState | null>(null),
    [selected, setSelected] = useState("");
  const [name, setName] = useState(""),
    [style, setStyle] = useState("original"),
    [voiceId, setVoiceId] = useState(""),
    [voices, setVoices] = useState<PresenterVoice[]>([]),
    [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState(
      "你好，欢迎来到我的演讲。让我们一起看看今天的主题。",
    ),
    [busy, setBusy] = useState(false),
    [voiceBusy, setVoiceBusy] = useState(false),
    [error, setError] = useState("");
  const [confirm, setConfirm] = useState<"preview" | "style" | "remove" | null>(
      null,
    ),
    [styleTarget, setStyleTarget] = useState("professional");
  const lock = useRef(false),
    request = useRef<{
      requestId: string;
      avatarId: string;
      text: string;
    } | null>(null),
    fileInput = useRef<HTMLInputElement>(null);
  const {
    jobs,
    error: jobsError,
    setJobs,
    active,
  } = usePresenterJobs("/presenter/previews");
  const avatar = state?.avatars.find((a) => a.id === selected);
  const dirty =
    !!avatar &&
    (avatar.name !== name ||
      avatar.style !== style ||
      avatar.voiceId !== voiceId);
  useEffect(() => {
    let alive = true;
    api<PresenterStudioState>("/presenter/studio")
      .then((s) => {
        if (alive) {
          setState(s);
          setSelected((before) => before || s.defaultAvatarId);
        }
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [hasKey]);
  useEffect(() => {
    setName(avatar?.name || "");
    setStyle(avatar?.style || "original");
    setVoiceId(avatar?.voiceId || "");
    setFile(null);
    if (fileInput.current) fileInput.current.value = "";
    try {
      setText(
        localStorage.getItem("autoppt-presenter-preview:" + selected) ||
          "你好，欢迎来到我的演讲。让我们一起看看今天的主题。",
      );
    } catch {
      /* Draft storage is optional. */
    }
  }, [selected, avatar?.id]);
  useEffect(() => {
    try {
      localStorage.setItem("autoppt-presenter-preview:" + selected, text);
    } catch {
      /* Keep the editable text in memory. */
    }
  }, [selected, text]);
  async function loadVoices(refresh = false) {
    setVoiceBusy(true);
    try {
      setVoices(
        await api<PresenterVoice[]>(
          "/presenter/voices" + (refresh ? "?refresh=1" : ""),
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setVoiceBusy(false);
    }
  }
  useEffect(() => {
    if (hasKey) void loadVoices();
    else setVoices([]);
  }, [hasKey]);
  async function run(
    action: "save" | "default" | "preview" | "style" | "remove",
  ) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      if (action === "preview") {
        if (!request.current)
          request.current = {
            requestId: crypto.randomUUID(),
            avatarId: selected,
            text: text.trim(),
          };
        const job = (await post("/presenter/previews", {
          ...request.current,
          confirmed: true,
        })) as PresenterGeneration;
        request.current = null;
        setJobs((before) => [job, ...before.filter((j) => j.id !== job.id)]);
        setConfirm(null);
        notify("试播已开始，完成后视频会显示在这里。");
      } else {
        let next: PresenterStudioState;
        if (action === "remove")
          next = await api("/presenter/avatars/" + selected, {
            method: "DELETE",
          });
        else if (action === "style")
          next = await post("/presenter/avatars/" + selected + "/style", {
            style: styleTarget,
            confirmed: true,
          });
        else if (avatar)
          next = await api("/presenter/avatars/" + selected, {
            method: "PATCH",
            body: JSON.stringify({
              name,
              style,
              voiceId,
              makeDefault: action === "default",
            }),
          });
        else {
          const body = new FormData();
          body.set("name", name);
          body.set("style", style);
          body.set("voiceId", voiceId);
          body.set("image", file!);
          next = await api("/presenter/avatars", { method: "POST", body });
        }
        setState(next);
        if (action === "remove") setSelected(next.defaultAvatarId);
        else if (!avatar || action === "style")
          setSelected(next.avatars.at(-1)?.id || "");
        setConfirm(null);
        notify(
          action === "style"
            ? "风格头像已作为新的数字人保存。"
            : "数字人设置已保存。",
        );
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const styleName = (id: string) =>
    state?.styles.find((s) => s.id === id)?.name || "原始照片";
  return (
    <div className="presenter-studio">
      <div className="presenter-studio-intro">
        <h3>你的数字人</h3>
        <p>
          在这里准备形象和声音、输入文字试播。满意后，每个项目都可以直接使用。
        </p>
      </div>
      {!hasKey && (
        <p className="journey-warning">
          先在上方连接 HeyGen。头像可以先保存到本机。
        </p>
      )}
      <div className="presenter-studio-layout">
        <aside className="presenter-library" aria-label="数字人列表">
          <Button
            disabled={busy}
            onClick={() => {
              setSelected("");
              setError("");
            }}
          >
            添加数字人
          </Button>
          {state?.avatars.map((a) => (
            <button
              key={a.id}
              className={
                "presenter-library-item" +
                (a.id === selected ? " selected" : "")
              }
              aria-pressed={a.id === selected}
              disabled={busy}
              onClick={() => {
                setSelected(a.id);
                setError("");
              }}
            >
              <img src={asset(a.previewAsset)} alt="" />
              <span>
                <strong>{a.name}</strong>
                <small>
                  {styleName(a.style)}
                  {a.id === state.defaultAvatarId ? " · 默认" : ""}
                </small>
                <small>{a.ready ? a.voiceName : "需要选择声音"}</small>
              </span>
            </button>
          ))}
          {!state?.avatars.length && (
            <p>还没有数字人。上传一张正面清晰的头像开始。</p>
          )}
        </aside>
        <div className="presenter-workbench">
          <details className="presenter-editor" open={!avatar?.ready}>
            <summary className="presenter-editor-heading">
              <h4>{avatar ? "形象与声音" : "创建数字人"}</h4>
              {avatar && (
                <Status tone={avatar.ready ? "good" : "warm"}>
                  {avatar.ready ? "可以试播" : "待选择声音"}
                </Status>
              )}
              {avatar?.ready && <span>已保存 · 点击修改</span>}
            </summary>
            <div className="presenter-identity">
              {avatar && (
                <img
                  className="presenter-portrait"
                  src={asset(avatar.previewAsset)}
                  alt={avatar.name + "头像"}
                />
              )}
              <div className="presenter-identity-fields">
                <Field label="数字人名称">
                  <input
                    value={name}
                    maxLength={80}
                    disabled={busy}
                    onChange={(e) => setName(e.target.value)}
                  />
                </Field>
                {!avatar && (
                  <Field
                    label="上传头像"
                    hint="正面、嘴部清晰。JPEG、PNG 或 WebP，最大 8 MB。"
                  >
                    <input
                      ref={fileInput}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      disabled={busy}
                      onChange={(e) => setFile(e.target.files?.[0] || null)}
                    />
                  </Field>
                )}
                <Field
                  label="头像风格"
                  hint="为上传的图片分类；下方可生成新的风格形象。"
                >
                  <select
                    value={style}
                    disabled={busy}
                    onChange={(e) => setStyle(e.target.value)}
                  >
                    {(
                      state?.styles || [{ id: "original", name: "原始照片" }]
                    ).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="中文声音">
                  <select
                    value={voiceId}
                    disabled={busy || !hasKey || voiceBusy}
                    onChange={(e) => setVoiceId(e.target.value)}
                  >
                    <option value="">
                      {voiceBusy
                        ? "正在读取中文声音…"
                        : hasKey
                          ? "选择中文声音"
                          : "连接 HeyGen 后选择"}
                    </option>
                    {voiceId && !voices.some((v) => v.id === voiceId) && (
                      <option value={voiceId}>
                        {avatar?.voiceName || "已保存声音"}
                      </option>
                    )}
                    {voices.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                        {v.gender
                          ? " · " +
                            (v.gender === "male"
                              ? "男声"
                              : v.gender === "female"
                                ? "女声"
                                : v.gender)
                          : ""}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            </div>
            <div className="presenter-actions">
              <Button
                variant="primary"
                loading={busy && !confirm}
                disabled={
                  !name.trim() || (!avatar && !file) || (!!avatar && !dirty)
                }
                onClick={() => void run("save")}
              >
                {avatar ? "保存形象与声音" : "保存数字人"}
              </Button>
              {avatar && (
                <Button
                  disabled={
                    busy || dirty || state?.defaultAvatarId === selected
                  }
                  onClick={() => void run("default")}
                >
                  设为默认数字人
                </Button>
              )}
              <Button
                disabled={!hasKey || busy || voiceBusy}
                onClick={() => void loadVoices(true)}
              >
                刷新声音列表
              </Button>
            </div>
            {dirty && <p role="status">有未保存的修改，保存后即可试播。</p>}
            {avatar && (
              <details className="presenter-style-tools">
                <summary>创建其他风格形象</summary>
                <p>
                  以当前头像为参考生成新的数字人。也可以用“添加数字人”直接上传卡通、职业照或古装图片。
                </p>
                <Field label="生成风格">
                  <select
                    value={styleTarget}
                    disabled={busy}
                    onChange={(e) => setStyleTarget(e.target.value)}
                  >
                    {state?.styles
                      .filter((s) => s.id !== "original")
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                  </select>
                </Field>
                {!state?.imageAvailable && (
                  <p>
                    生成风格头像需要在“模型服务”连接图片生成服务；已准备好的图片可直接上传。
                  </p>
                )}
                <Button
                  disabled={busy || dirty || !state?.imageAvailable}
                  onClick={() => setConfirm("style")}
                >
                  生成风格头像
                </Button>
              </details>
            )}
          </details>
          <div className="presenter-preview-panel">
            <div className="presenter-editor-heading">
              <h4>文字试播</h4>
              <span>先听声音，再看嘴型</span>
            </div>
            <Field
              label="试播文字"
              hint="1–300 字。使用这个数字人保存的头像和声音，直接生成视频。"
            >
              <textarea
                rows={3}
                value={text}
                maxLength={300}
                disabled={busy || !!request.current}
                onChange={(e) => setText(e.target.value)}
              />
            </Field>
            <div className="presenter-actions">
              <Button
                variant="primary"
                disabled={
                  busy ||
                  active ||
                  !hasKey ||
                  !avatar?.ready ||
                  dirty ||
                  !text.trim()
                }
                onClick={() => setConfirm("preview")}
              >
                {active
                  ? "试播生成中…"
                  : request.current
                    ? "查询上次提交结果"
                    : "生成试播视频"}
              </Button>
              <span>{text.length} / 300 字</span>
            </div>
            {!avatar?.ready && <p>先保存头像和中文声音，试播按钮就会启用。</p>}
            <PresenterJobs
              jobs={jobs.filter((j) => j.avatarId === selected)}
              endpoint="/presenter/previews"
              preview
              onUpdate={(job) =>
                setJobs((before) => [
                  job,
                  ...before.filter((j) => j.id !== job.id),
                ])
              }
            />
          </div>
          {avatar && (
            <Button
              variant="ghost"
              disabled={busy || active}
              onClick={() => setConfirm("remove")}
            >
              将这个数字人移出列表
            </Button>
          )}
        </div>
      </div>
      {(error || jobsError) && (
        <p className="error-text" role="alert">
          {error || jobsError}
        </p>
      )}
      {confirm && (
        <Modal
          title={
            confirm === "preview"
              ? "生成一段试播视频"
              : confirm === "style"
                ? "生成新的风格头像"
                : "移出数字人列表"
          }
          onClose={() => !busy && setConfirm(null)}
        >
          {confirm === "preview" ? (
            <>
              <p>
                {avatar?.name} · {avatar?.voiceName}
              </p>
              <blockquote className="presenter-confirm-text">
                {request.current?.text || text}
              </blockquote>
              <p>
                这张头像和这段文字会发送到 HeyGen，生成声音与嘴型，并按 API
                规则计费。
              </p>
            </>
          ) : confirm === "style" ? (
            <p>
              当前头像将发送到已配置的图片生成服务，制作{styleName(styleTarget)}
              。会按图片服务规则计费，完成后另存一个数字人，原头像保留。
            </p>
          ) : (
            <p>
              这个数字人将不再出现在选择列表中。已有视频、头像文件和项目内容会保留。
            </p>
          )}
          <div className="presenter-actions">
            <Button
              loading={busy}
              variant={confirm === "remove" ? "danger" : "primary"}
              onClick={() => void run(confirm)}
            >
              {confirm === "remove" ? "确认移出" : "确认生成"}
            </Button>
            <Button disabled={busy} onClick={() => setConfirm(null)}>
              取消
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
