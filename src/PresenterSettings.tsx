import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { Button, Field, Status } from "./components";

type Connection = {
  provider: "heygen";
  hasKey: boolean;
  generationAvailable: boolean;
};

export function PresenterSettings({
  notify,
}: {
  notify: (text: string) => void;
}) {
  const [config, setConfig] = useState<Connection | null>(null);
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  useEffect(() => {
    let alive = true;
    api<Connection>("/settings/presenter")
      .then((value) => {
        if (alive) setConfig(value);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, []);
  async function run(action: "save" | "remove" | "test") {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setResult("");
    try {
      if (action === "test") {
        const tested = await api<{ ok: boolean; message: string }>(
          "/settings/presenter/test",
          { method: "POST" },
        );
        if (tested.ok) setResult(tested.message);
        else setError(tested.message);
      } else {
        setConfig(
          await api<Connection>("/settings/presenter", {
            method: "PUT",
            body: JSON.stringify({
              apiKey: key,
              clearKey: action === "remove",
            }),
          }),
        );
        setKey("");
        const message =
          action === "remove"
            ? "HeyGen 密钥已移除。"
            : "HeyGen 密钥已保存在当前本机工作区。";
        setResult(message);
        notify(message);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <section
      className="connection-form"
      id="presenter-settings"
      aria-label="HeyGen 数字人设置"
    >
      <div className="connection-form-heading">
        <div>
          <h2>数字人讲解员 · HeyGen</h2>
          <p>用头像和已有口播制作讲解视频。</p>
        </div>
        <Status tone={config?.hasKey ? "good" : "warm"}>
          {config?.hasKey ? "密钥已保存" : "待配置密钥"}
        </Status>
      </div>
      <p>
        保存密钥后，在项目的演练中心配置并生成数字人口型。测试连接只查询 HeyGen
        账号，不上传头像、音频或生成视频。
      </p>
      {config && (
        <>
          <Field
            label="HeyGen API Key"
            hint="只保存在当前本机工作区，不随项目包导出。留空保存会保留已有密钥。"
          >
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={key}
              disabled={busy}
              placeholder={
                config.hasKey ? "已保存，留空保持" : "填写 HeyGen API Key"
              }
              onChange={(e) => {
                setKey(e.target.value);
                setResult("");
                setError("");
              }}
            />
          </Field>
          <p>
            <a
              href="https://app.heygen.com/developers/api"
              target="_blank"
              rel="noreferrer"
            >
              前往 HeyGen 获取 API Key
            </a>
          </p>
          <div className="connection-actions">
            <Button
              disabled={busy || (!config.hasKey && !key.trim())}
              onClick={() => run("save")}
            >
              保存 HeyGen 设置
            </Button>
            <Button
              disabled={busy || !config.hasKey || !!key.trim()}
              onClick={() => run("test")}
            >
              测试 HeyGen 连接
            </Button>
            {config.hasKey && (
              <Button disabled={busy} onClick={() => run("remove")}>
                移除 HeyGen 密钥
              </Button>
            )}
          </div>
          {!!key.trim() && <p>请先保存新密钥，再测试连接。</p>}
        </>
      )}
      {busy && <p role="status">正在处理，请稍候…</p>}
      {result && <p role="status">{result}</p>}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
