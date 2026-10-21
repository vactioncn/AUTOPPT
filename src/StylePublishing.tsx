import { useEffect, useState } from "react";
import { api, asset, post } from "./api";
import { Button } from "./components";
import type { Style, Trial } from "./types";

export function StylePublishing({
  style,
  refresh,
  notify,
}: {
  style: Style;
  refresh: () => Promise<void>;
  notify: (message: string) => void;
}) {
  const [trials, setTrials] = useState<Trial[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    api<{ trials: Trial[] }>(`/styles/${style.id}/trials`)
      .then(({ trials }) => {
        if (cancelled) return;
        setTrials(
          trials.filter(
            (t) => t.status === "completed" && t.image && t.purpose !== "cover",
          ),
        );
        setSelected(style.publishedTrialIds || []);
        setLoaded(true);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [style.id]);
  const act = async (publish: boolean) => {
    setBusy(true);
    setError("");
    try {
      if (publish)
        await post(`/styles/${style.id}/publish`, { trialIds: selected });
      else await api(`/styles/${style.id}/publish`, { method: "DELETE" });
      await refresh();
      notify(
        publish
          ? "风格与所选样例已发布，客户刷新风格库即可看到。"
          : "已从客户风格库下架，已有项目仍可继续使用。",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <details className="style-publishing">
      <summary>
        {style.publishedAt ? "已发布 · 管理客户样例" : "发布到客户风格库"}
      </summary>
      <p className="detail-help">
        选中适合公开展示的试做图，再发布。客户会看到风格名称、简介、封面和所选样例；保存或试做不会自动更新已发布版本。
      </p>
      {trials.length > 0 ? (
        <div className="style-publish-examples">
          {trials.map((trial) => (
            <label key={trial.id}>
              <img
                src={asset(trial.image!)}
                alt={trial.plan?.title || "试做样例"}
              />
              <span>
                <input
                  type="checkbox"
                  checked={selected.includes(trial.id)}
                  disabled={busy}
                  onChange={(e) =>
                    setSelected(
                      e.target.checked
                        ? [...selected, trial.id]
                        : selected.filter((id) => id !== trial.id),
                    )
                  }
                />
                {trial.plan?.title || "页面示例"}
              </span>
            </label>
          ))}
        </div>
      ) : (
        <p className="detail-help">
          {loaded
            ? "暂无已完成的图片试做。可以先试做不同内容，再挑选样例；也可以先发布风格。"
            : "正在读取可选样例…"}
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      <div className="style-publish-actions">
        <Button
          disabled={busy || !loaded || selected.length > 12 || !style.rules}
          loading={busy}
          onClick={() => act(true)}
        >
          {style.publishedAt ? "更新已发布风格与样例" : "确认发布给所有客户"}
        </Button>
        {style.publishedAt && (
          <Button disabled={busy} onClick={() => act(false)}>
            从客户风格库下架
          </Button>
        )}
      </div>
    </details>
  );
}
