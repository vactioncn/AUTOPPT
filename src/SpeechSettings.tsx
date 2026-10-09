import { VoiceCapture } from "./VoiceCapture";
import "./speech.css";
import { useEffect, useState } from "react";
import { Button, Field, Status } from "./components";
import { api } from "./api";
import type { SpeechConnection } from "./speech-types";
export function SpeechSettings({ notify }: { notify: (text: string) => void }) {
  const [config, setConfig] = useState<SpeechConnection | null>(null);
  const [key, setKey] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    api<SpeechConnection>("/settings/speech")
      .then(setConfig)
      .catch((e) => setError(e.message));
  }, []);
  async function save(clearKey = false) {
    setBusy(true);
    setError("");
    try {
      setConfig(
        await api("/settings/speech", {
          method: "PUT",
          body: JSON.stringify({ ...config, apiKey: key, clearKey }),
        }),
      );
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
      {config && (
        <>
          <div className="settings-fields">
            <Field label="语音接口地址" hint="MiniMax 原生语音接口，填到 /v1。">
              <input
                value={config.baseUrl}
                onChange={(e) =>
                  setConfig({ ...config, baseUrl: e.target.value })
                }
              />
            </Field>
            <Field label="语音模型">
              <input
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
          <p>
            试听、生成口播和声音复刻会使用你的语音服务额度。播放已生成的声音不再调用模型。声音复刻需在供应商平台完成实名认证。
          </p>
          <div className="connection-actions">
            <Button disabled={busy} onClick={() => save()}>
              保存语音设置
            </Button>
            {config.hasKey && (
              <Button disabled={busy} onClick={() => save(true)}>
                移除语音密钥
              </Button>
            )}
          </div>
        </>
      )}
      <VoiceCapture
        disabled={busy || !config?.hasKey}
        onRecordingStart={() => setError("")}
        onVoices={() => {
          window.dispatchEvent(new Event("autoppt-speech-updated"));
          notify("声音已保存，可在演播台或数字人工作室选择。");
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
