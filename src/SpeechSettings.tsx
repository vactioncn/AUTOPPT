import { SpeechVoiceDefault } from "./SpeechVoiceDefault";
import { VoiceCapture } from "./VoiceCapture";
import "./speech.css";
import { useEffect, useState } from "react";
import { Button, Field, Status } from "./components";
import { api } from "./api";
import type { SpeechConnection } from "./speech-types";
export function SpeechSettings({
  notify,
  active = true,
}: {
  notify: (text: string) => void;
  active?: boolean;
}) {
  const [config, setConfig] = useState<SpeechConnection | null>(null);
  const [saved, setSaved] = useState<SpeechConnection | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [key, setKey] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    api<SpeechConnection>("/settings/speech")
      .then((value) => {
        setConfig(value);
        setSaved(value);
        setExpanded(!value.hasKey);
      })
      .catch((e) => setError(e.message));
  }, []);
  async function save(clearKey = false) {
    setBusy(true);
    setError("");
    try {
      const value = await api<SpeechConnection>("/settings/speech", {
        method: "PUT",
        body: JSON.stringify({ ...config, apiKey: key, clearKey }),
      });
      setConfig(value);
      setSaved(value);
      setExpanded(!value.hasKey);
      setKey("");
      window.dispatchEvent(new Event("autoppt-speech-updated"));
      notify(
        clearKey ? "语音密钥已移除。" : "语音设置已保存；可在播放演讲中试听。",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="connection-form" id="speech-settings">
      <div className="connection-form-heading">
        <div>
          <h2>语音与声音 · MiniMax</h2>
          <p>富有情感的中文口播，支持播音员与演讲者声音复刻。</p>
        </div>
        <Status tone={config?.hasKey ? "good" : "warm"}>
          {config?.hasKey ? "已配置密钥" : "待连接"}
        </Status>
      </div>
      {!config && !error && <p role="status">正在读取语音配置…</p>}
      {config && (
        <>
          <div className="settings-connection-summary">
            <strong>{saved?.model}</strong>
            <span>{saved?.baseUrl}</span>
          </div>
          <details
            className="settings-connection-editor"
            open={expanded}
            onToggle={(event) => setExpanded(event.currentTarget.open)}
          >
            <summary>
              {config.hasKey ? "修改 MiniMax 连接" : "连接 MiniMax"}
            </summary>
            <div className="settings-fields">
              <Field
                label="语音接口地址"
                hint="MiniMax 原生语音接口，填到 /v1。"
              >
                <input
                  disabled={busy}
                  value={config.baseUrl}
                  onChange={(e) =>
                    setConfig({ ...config, baseUrl: e.target.value })
                  }
                />
              </Field>
              <Field label="语音模型">
                <input
                  disabled={busy}
                  value={config.model}
                  onChange={(e) =>
                    setConfig({ ...config, model: e.target.value })
                  }
                />
              </Field>
              <Field
                label="语音 API Key"
                hint="独立保存于本机；更换地址后需要重新填写密钥。"
              >
                <input
                  disabled={busy}
                  type="password"
                  autoComplete="off"
                  value={key}
                  placeholder={
                    config.hasKey ? "已保存，留空保持" : "填写 MiniMax API Key"
                  }
                  onChange={(e) => setKey(e.target.value)}
                />
              </Field>
            </div>
            {(config.baseUrl !== saved?.baseUrl ||
              config.model !== saved?.model ||
              !!key) && (
              <p className="settings-draft-note">
                有未保存的修改，切换分类会保留当前输入。
              </p>
            )}
            <div className="connection-actions">
              <Button variant="primary" disabled={busy} onClick={() => save()}>
                保存语音设置
              </Button>
            </div>
            {config.hasKey && (
              <details className="settings-maintenance">
                <summary>连接管理</summary>
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => save(true)}
                >
                  移除语音密钥
                </Button>
              </details>
            )}
          </details>
        </>
      )}
      <p className="detail-help settings-voice-help">
        先选默认声音；需要使用本人的声音时，再展开录音采集。试听、生成与复刻会使用
        MiniMax 额度，播放已有音频不再调用模型。
      </p>
      <SpeechVoiceDefault notify={notify} />
      <VoiceCapture
        disabled={busy || !config?.hasKey}
        active={active}
        onRecordingStart={() => setError("")}
        onVoices={() => {
          window.dispatchEvent(new Event("autoppt-speech-updated"));
          notify("声音已保存，可在演练中心选择。");
        }}
      />
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
