import { useEffect, useState } from "react";
import { api, post } from "./api";
import { Button, Field } from "./components";
import { AdminImageConcurrency } from "./AdminImageConcurrency";

type Kind = "text" | "image";
type Connection = { baseUrl: string; model: string; hasKey: boolean };
type ModelServices = { revision: number; text: Connection; image: Connection };

export function AdminModels() {
  const [data, setData] = useState<ModelServices | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = async () => {
    try {
      setError("");
      setData(await api<ModelServices>("/admin/models"));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  return (
    <section className="admin-models" aria-label="模型服务">
      <div className="admin-models-intro">
        <h2>模型服务</h2>
        <p>
          为全站设置文本与图片模型。现有连接已自动读取，API Key 留空即可保留。
        </p>
      </div>
      <AdminImageConcurrency />
      {error && (
        <p className="account-error" role="alert">
          {error}
        </p>
      )}
      {!data ? (
        <Button onClick={load}>重新读取配置</Button>
      ) : (
        <div className="admin-model-grid">
          {(["text", "image"] as const).map((kind) => (
            <ModelForm
              key={kind}
              kind={kind}
              initial={data[kind]}
              revision={data.revision}
              busy={busy}
              setBusy={setBusy}
              onSaved={setData}
              onReload={load}
            />
          ))}
        </div>
      )}
      <p className="admin-models-footnote">
        模型连接保存后供后续任务使用；有生成任务时暂不能更换模型连接。测试连接只检查接口是否可访问，不生成内容，也不核验模型名称。
      </p>
    </section>
  );
}

function ModelForm({
  kind,
  initial,
  revision,
  busy,
  setBusy,
  onSaved,
  onReload,
}: {
  kind: Kind;
  initial: Connection;
  revision: number;
  busy: boolean;
  setBusy: (value: boolean) => void;
  onSaved: (data: ModelServices) => void;
  onReload: () => Promise<void>;
}) {
  const [draft, setDraft] = useState({
    baseUrl: initial.baseUrl,
    model: initial.model,
    apiKey: "",
  });
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [action, setAction] = useState("");
  // Updating the other card keeps unsaved input here. An explicit reload resets
  // only fields that actually changed on the server; secrets are never returned.
  useEffect(() => {
    setDraft({ baseUrl: initial.baseUrl, model: initial.model, apiKey: "" });
  }, [initial.baseUrl, initial.model, initial.hasKey]);
  const change = (name: keyof typeof draft, value: string) => {
    setDraft((previous) => ({ ...previous, [name]: value }));
    setMessage("");
  };
  const submit = async (test: boolean) => {
    setBusy(true);
    setAction(test ? "test" : "save");
    setMessage("");
    setFailed(false);
    try {
      if (test) {
        const result = await post<{ message: string }>(
          `/admin/models/${kind}/test`,
          { ...draft, revision },
        );
        setMessage(result.message);
      } else {
        const result = await post<ModelServices>(`/admin/models/${kind}`, {
          ...draft,
          revision,
        });
        onSaved(result);
        setDraft({
          baseUrl: result[kind].baseUrl,
          model: result[kind].model,
          apiKey: "",
        });
        setMessage(
          "已保存，后续任务使用此配置。项目与风格保持不变。保存不代表连接测试通过。",
        );
        window.dispatchEvent(new Event("autoppt-account-refresh"));
      }
    } catch (e) {
      setFailed(true);
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
      setAction("");
    }
  };
  const title = kind === "text" ? "文本模型" : "图片模型";
  return (
    <form
      className="admin-model-card"
      aria-label={title}
      onSubmit={(e) => {
        e.preventDefault();
        void submit(false);
      }}
    >
      <div className="admin-model-card-heading">
        <div>
          <h3>{title}</h3>
          <p>
            {kind === "text"
              ? "理解讲稿、整理文案与分析风格。"
              : "生成演讲画面与风格效果示例。"}
          </p>
        </div>
        <span
          className={initial.hasKey ? "model-key-saved" : "model-key-missing"}
        >
          {initial.hasKey ? "密钥已保存" : "待配置"}
        </span>
      </div>
      <Field label="接口地址">
        <input
          type="url"
          required
          aria-label={`${title}接口地址`}
          value={draft.baseUrl}
          disabled={busy}
          placeholder="https://api.example.com/v1"
          onChange={(e) => change("baseUrl", e.target.value)}
        />
      </Field>
      <Field label="模型名称">
        <input
          required
          maxLength={200}
          aria-label={`${title}名称`}
          value={draft.model}
          disabled={busy}
          placeholder="填写服务商提供的模型名称"
          onChange={(e) => change("model", e.target.value)}
        />
      </Field>
      <Field label="API Key">
        <input
          type="password"
          autoComplete="new-password"
          maxLength={4096}
          aria-label={`${title} API Key`}
          value={draft.apiKey}
          disabled={busy}
          placeholder={
            initial.hasKey ? "已保存，留空保留原密钥" : "请输入 API Key"
          }
          onChange={(e) => change("apiKey", e.target.value)}
        />
      </Field>
      <p className="admin-key-help">
        密钥仅存于服务器，不会回显。更换接口地址时需填写对应的新密钥。
      </p>
      {message && (
        <p
          className={failed ? "account-error" : "admin-model-message"}
          role={failed ? "alert" : "status"}
        >
          {message}
        </p>
      )}
      <div className="admin-model-actions">
        <Button
          type="submit"
          variant="primary"
          disabled={busy}
          loading={action === "save"}
        >
          保存{title}
        </Button>
        <Button
          type="button"
          disabled={busy}
          loading={action === "test"}
          onClick={() => void submit(true)}
        >
          测试连接
        </Button>
        {failed && (
          <Button type="button" disabled={busy} onClick={onReload}>
            重新读取
          </Button>
        )}
      </div>
    </form>
  );
}
