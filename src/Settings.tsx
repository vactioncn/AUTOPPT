import { useState } from "react";
import {
  Plug,
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
export function SettingsPage({
  initial,
  notify,
  refresh,
}: {
  initial: Settings;
  notify: (s: string) => void;
  refresh: () => Promise<void>;
}) {
  return (
    <div className="page settings-page">
      <div className="page-heading">
        <div>
          <h1>连接你的创作能力。</h1>
          <p>一次设置，供所有演讲项目和风格使用。</p>
        </div>
      </div>
      <div className="settings-intro">
        <Info size={20} />
        <p>
          内容模型负责理解讲稿与设计画面，图片模型按完整设计方案出图。参考图只用于提炼风格。密钥仅保存在本机服务端，不会展示给浏览器。
        </p>
      </div>
      <ConnectionForm
        kind="text"
        title="内容理解与风格分析"
        description="需要支持文本和图片理解的模型。"
        initial={initial.text}
        notify={notify}
        refresh={refresh}
      />
      <ConnectionForm
        kind="image"
        title="图片生成"
        description="按文字设计规范与方案生成图片，不附原参考图。"
        initial={initial.image}
        notify={notify}
        refresh={refresh}
      />
      <p className="settings-footnote">
        接口使用 OpenAI 兼容协议。修改服务地址后，请为新服务重新填写密钥。
      </p>
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
    [visible, setVisible] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [result, setResult] = useState("");
  const update = (key: string, value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
    setResult("");
  };
  const save = async (test = false) => {
    setBusy(true);
    setError("");
    setResult("");
    try {
      const data = await api<Settings>("/settings", {
        method: "PUT",
        body: JSON.stringify({ [kind]: form }),
      });
      setForm({ ...data[kind], apiKey: "" });
      await refresh();
      if (test) {
        const r = await post("/settings/test", { kind });
        setResult(r.message);
      } else notify("模型设置已保存在本机。");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="connection-form">
      <div className="connection-form-heading">
        <div className="connection-icon">
          <Plug size={24} weight="light" />
        </div>
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        <Status tone={form.hasKey ? "good" : "warm"}>
          {form.hasKey ? "已配置密钥" : "待连接"}
        </Status>
      </div>
      <div className="settings-fields">
        <Field label="接口地址" hint="填到 /v1 这一层，无需添加具体接口路径。">
          <input
            value={form.baseUrl}
            onChange={(e) => update("baseUrl", e.target.value)}
            placeholder="https://api.openai.com/v1"
            spellCheck={false}
          />
        </Field>
        <Field label="模型名称">
          <input
            value={form.model}
            onChange={(e) => update("model", e.target.value)}
            list={kind + "-models"}
            spellCheck={false}
          />
          <datalist id={kind + "-models"}>
            {(kind === "image"
              ? ["gpt-image-2.5-sunburst", "gpt-image-2.5-flare", "gpt-image-2"]
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
              type={visible ? "text" : "password"}
              value={form.apiKey}
              onChange={(e) => update("apiKey", e.target.value)}
              autoComplete="off"
              placeholder={form.hasKey ? "•••••••• 已安全保存" : "输入密钥"}
              spellCheck={false}
            />
            <button
              className="icon-btn"
              aria-label={visible ? "隐藏密钥" : "显示密钥"}
              onClick={() => setVisible(!visible)}
            >
              {visible ? <EyeSlash size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </Field>
      </div>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {result && (
        <p className="test-result">
          <CheckCircle size={17} />
          {result}
        </p>
      )}
      <div className="connection-form-actions">
        <Button onClick={() => save(true)} loading={busy}>
          保存并测试连接
          <ArrowRight size={16} />
        </Button>
        <Button variant="primary" onClick={() => save()} loading={busy}>
          <FloppyDisk size={16} />
          保存设置
        </Button>
      </div>
    </section>
  );
}
