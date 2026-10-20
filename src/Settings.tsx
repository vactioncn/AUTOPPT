import { useEffect, useRef, useState } from "react";
import {
  CheckCircle,
  ArrowRight,
  Eye,
  EyeSlash,
  Info,
  FloppyDisk,
} from "@phosphor-icons/react";
import type { Settings, Connection } from "./types";
import { api, post } from "./api";
import { Button, Field, Status } from "./components";
import { SpeechSettings } from "./SpeechSettings";
import { PresenterSettings } from "./PresenterSettings";
import "./settings.css";

export type SettingsSection = "models" | "speech" | "labs";
const sections: { id: SettingsSection; label: string }[] = [
  { id: "models", label: "模型服务" },
  { id: "speech", label: "语音与声音" },
  { id: "labs", label: "实验室" },
];
export function SettingsPage({
  initial,
  notify,
  refresh,
  section = "models",
  onSectionChange,
}: {
  initial: Settings;
  notify: (s: string) => void;
  refresh: () => Promise<void>;
  section?: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
}) {
  const [visited, setVisited] = useState<SettingsSection[]>([section]);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (
      sessionStorage.getItem("autoppt-settings-focus") !== "presenter-settings"
    )
      return;
    sessionStorage.removeItem("autoppt-settings-focus");
    onSectionChange("labs");
  }, [onSectionChange]);
  useEffect(() => {
    setVisited((before) =>
      before.includes(section) ? before : [...before, section],
    );
    root.current
      ?.querySelectorAll<HTMLMediaElement>("[hidden] audio, [hidden] video")
      .forEach((media) => media.pause());
  }, [section]);
  return (
    <div className="page settings-page" ref={root}>
      <div className="page-heading">
        <div>
          <h1>设置</h1>
          <p>管理常用服务和默认声音，供所有项目使用。</p>
        </div>
      </div>
      <div className="settings-tabs" role="tablist" aria-label="设置分类">
        {sections.map((item, index) => (
          <button
            key={item.id}
            id={`settings-tab-${item.id}`}
            type="button"
            role="tab"
            aria-selected={section === item.id}
            aria-controls={`settings-panel-${item.id}`}
            tabIndex={section === item.id ? 0 : -1}
            onClick={() => onSectionChange(item.id)}
            onKeyDown={(event) => {
              const next =
                event.key === "ArrowRight"
                  ? (index + 1) % sections.length
                  : event.key === "ArrowLeft"
                    ? (index + sections.length - 1) % sections.length
                    : event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? sections.length - 1
                        : null;
              if (next === null) return;
              event.preventDefault();
              onSectionChange(sections[next].id);
              document
                .getElementById(`settings-tab-${sections[next].id}`)
                ?.focus();
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div
        id="settings-panel-models"
        role="tabpanel"
        aria-labelledby="settings-tab-models"
        hidden={section !== "models"}
      >
        <div className="settings-intro" id="model-settings">
          <Info size={18} aria-hidden="true" />
          <p>
            内容服务理解讲稿、提炼风格；图片服务生成画面。密钥仅保存在本机。
          </p>
        </div>
        <ConnectionForm
          kind="text"
          title="内容理解与风格分析"
          description="理解讲稿、提炼上屏文案和参考图风格。"
          initial={initial.text}
          notify={notify}
          refresh={refresh}
        />
        <ConnectionForm
          kind="image"
          title="图片生成"
          description="使用已保存的风格原文和上屏文案出图。"
          initial={initial.image}
          notify={notify}
          refresh={refresh}
        />
        <details className="settings-protocol-help">
          <summary>接口填写说明</summary>
          <p>
            支持自建的 OpenAI 兼容接口。填写服务方提供的 API
            基础地址和模型名称或别名。更换服务地址后，请重新填写对应密钥。
          </p>
        </details>
      </div>
      <div
        id="settings-panel-speech"
        role="tabpanel"
        aria-labelledby="settings-tab-speech"
        hidden={section !== "speech"}
      >
        {(visited.includes("speech") || section === "speech") && (
          <SpeechSettings notify={notify} active={section === "speech"} />
        )}
      </div>
      <div
        id="settings-panel-labs"
        role="tabpanel"
        aria-labelledby="settings-tab-labs"
        hidden={section !== "labs"}
      >
        <p className="settings-lab-note">
          这里是仍在完善的实验功能，可按需试用。数字人的等待时间和生成效果还需要继续优化，建议先试一段。
        </p>
        {(visited.includes("labs") || section === "labs") && (
          <PresenterSettings notify={notify} />
        )}
      </div>
    </div>
  );
}
function ConnectionForm({
  kind,
  title,
  description,
  initial,
  notify,
  refresh,
}: {
  kind: "text" | "image";
  title: string;
  description: string;
  initial: Connection;
  notify: (s: string) => void;
  refresh: () => Promise<void>;
}) {
  const [form, setForm] = useState({ ...initial, apiKey: "" }),
    [saved, setSaved] = useState(initial),
    [expanded, setExpanded] = useState(!initial.hasKey),
    [visible, setVisible] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [result, setResult] = useState<{
      message: string;
      responseKind: "json" | "other";
    } | null>(null);
  const update = (key: string, value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
    setResult(null);
    setError("");
  };
  const test = async () => {
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const response = await post("/settings/test", {
        kind,
        mode: "connection",
        connection: form,
      });
      setResult(response);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const data = await api<Settings>("/settings", {
        method: "PUT",
        body: JSON.stringify({ [kind]: form }),
      });
      setForm({ ...data[kind], apiKey: "" });
      setSaved(data[kind]);
      await refresh();
      setExpanded(false);
      notify("模型设置已保存在本机。保存不代表测试通过。");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="connection-form" aria-label={title}>
      <div className="connection-form-heading">
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        <Status tone={form.hasKey ? "good" : "warm"}>
          {form.hasKey ? "已配置密钥" : "待连接"}
        </Status>
      </div>
      <div className="settings-connection-summary">
        <strong>{saved.model || "尚未设置模型"}</strong>
        <span>{saved.baseUrl}</span>
      </div>
      <details
        className="settings-connection-editor"
        open={expanded}
        onToggle={(event) => setExpanded(event.currentTarget.open)}
      >
        <summary>{saved.hasKey ? "修改连接配置" : "填写连接配置"}</summary>
        <div className="settings-fields">
          <Field
            label="接口地址"
            hint="填写服务方提供的 API 基础地址，常见以 /v1 结尾。"
          >
            <input
              disabled={busy}
              value={form.baseUrl}
              onChange={(e) => update("baseUrl", e.target.value)}
              placeholder="https://api.openai.com/v1"
              spellCheck={false}
            />
          </Field>
          <Field
            label="模型名称"
            hint="使用你的 API 中配置的名称或别名，不做名称核验。"
          >
            <input
              disabled={busy}
              value={form.model}
              onChange={(e) => update("model", e.target.value)}
              list={kind + "-models"}
              spellCheck={false}
            />
            <datalist id={kind + "-models"}>
              {(kind === "image"
                ? [
                    "gpt-image-2.5-sunburst",
                    "gpt-image-2.5-flare",
                    "gpt-image-2",
                  ]
                : ["gpt-5.4-mini", "gpt-6-luna", "gpt-6-sol"]
              ).map((m) => (
                <option value={m} key={m} />
              ))}
            </datalist>
          </Field>
          <Field
            label="API Key"
            hint={
              form.hasKey
                ? "已配置，留空保留当前密钥。"
                : "填写对应服务的 API Key。"
            }
          >
            <div className="secret-input">
              <input
                disabled={busy}
                type={visible ? "text" : "password"}
                value={form.apiKey}
                onChange={(e) => update("apiKey", e.target.value)}
                autoComplete="off"
                placeholder={form.hasKey ? "•••••••• 已安全保存" : "输入密钥"}
                spellCheck={false}
              />
              <button
                className="icon-btn"
                disabled={busy}
                aria-label={visible ? "隐藏密钥" : "显示密钥"}
                onClick={() => setVisible(!visible)}
              >
                {visible ? <EyeSlash size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </Field>
        </div>
        {(form.baseUrl !== saved.baseUrl ||
          form.model !== saved.model ||
          !!form.apiKey) && (
          <p className="settings-draft-note">
            有未保存的修改，切换分类会保留当前输入。
          </p>
        )}
        <div className="connection-form-actions">
          <Button onClick={test} disabled={busy}>
            测试连接
            <ArrowRight size={16} />
          </Button>
          <Button variant="primary" onClick={() => save()} loading={busy}>
            <FloppyDisk size={16} />
            保存设置
          </Button>
        </div>
        <p className="settings-test-help" role={busy ? "status" : undefined}>
          {busy
            ? "正在处理，请等待本次结果。"
            : "仅检查接口连接，不核验模型名、不调用生成，也不自动保存。"}
        </p>
      </details>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {result && (
        <div className="model-test-result" role="status">
          <p>
            <CheckCircle size={18} />
            <strong>
              {result.responseKind === "json"
                ? "接口连接成功"
                : "服务地址已连通"}
            </strong>
          </p>
          <p>{result.message}</p>
        </div>
      )}
    </section>
  );
}
