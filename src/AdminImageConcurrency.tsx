import { useEffect, useState } from "react";
import { api, post } from "./api";
import { Button, Field } from "./components";

type Concurrency = {
  revision: number;
  imageConcurrency: number;
  otherConcurrency: number;
  activeImages: number;
  waitingImages: number;
};

export function AdminImageConcurrency() {
  const [data, setData] = useState<Concurrency | null>(null);
  const [activity, setActivity] = useState<Concurrency | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const accept = (value: Concurrency) => {
    setData(value);
    setActivity(value);
    setDraft(String(value.imageConcurrency));
    setStale(false);
  };
  const load = async () => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      accept(await api<Concurrency>("/admin/image-concurrency"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    if (!data) return;
    const controller = new AbortController();
    let polling = false;
    const timer = window.setInterval(async () => {
      if (polling || document.hidden) return;
      polling = true;
      try {
        const value = await api<Concurrency>("/admin/image-concurrency", {
          signal: controller.signal,
        });
        if (!controller.signal.aborted) {
          setActivity(value);
          setStale(value.revision !== data.revision);
        }
      } catch {
        if (!controller.signal.aborted) setActivity(null);
      } finally {
        polling = false;
      }
    }, 5000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [data]);
  const save = async () => {
    if (!data) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const value = await post<Concurrency>("/admin/image-concurrency", {
        revision: data.revision,
        imageConcurrency: Number(draft),
      });
      accept(value);
      setMessage(
        `已保存：全站最多同时生成 ${value.imageConcurrency} 张图片。新上限已生效。`,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="admin-model-card admin-image-concurrency"
      aria-label="图片生成并发"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="admin-model-card-heading">
        <div>
          <h3>图片生成并发</h3>
          <p>控制全站所有账号同时调用图片服务的数量，超出上限的请求会排队。</p>
        </div>
        {data && (
          <span className="model-key-saved">
            当前上限 {activity?.imageConcurrency ?? data.imageConcurrency} 张
          </span>
        )}
      </div>
      {data && (
        <>
          <div className="admin-concurrency-controls">
            <Field label="图片并发上限">
              <input
                type="number"
                min={1}
                max={100}
                step={1}
                required
                value={draft}
                aria-describedby="image-concurrency-help"
                disabled={busy}
                onChange={(e) => {
                  setDraft(e.target.value);
                  setMessage("");
                }}
              />
            </Field>
            <Button
              type="submit"
              variant="primary"
              loading={busy}
              disabled={busy || stale}
            >
              保存并发设置
            </Button>
            <Button type="button" disabled={busy} onClick={load}>
              重新读取
            </Button>
          </div>
          <p className="admin-concurrency-activity">
            {activity
              ? `正在生成 ${activity.activeImages} 张 · 排队 ${activity.waitingImages} 个请求`
              : "暂时无法更新运行状态，请重新读取。"}
          </p>
        </>
      )}
      {!data && (
        <Button type="button" disabled={busy} onClick={load}>
          重新读取并发设置
        </Button>
      )}
      <p id="image-concurrency-help" className="admin-key-help">
        可设置
        1–100，保存后立即生效，重启后保留。调低上限时，已开始的图片会继续完成；调高后排队请求可继续执行。请按图片服务商允许的并发量设置。
      </p>
      <p className="admin-key-help">
        这是全站上限；单个制作任务仍按页顺序生成。文本与语音使用独立名额。
      </p>
      {stale && (
        <p className="account-error" role="alert">
          另一处已更新并发设置，请重新读取后再修改。
        </p>
      )}
      {error && (
        <p className="account-error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="admin-model-message" role="status">
          {message}
        </p>
      )}
    </form>
  );
}
