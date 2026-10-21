import { useEffect, useState } from "react";
import { api, asset, post } from "./api";
import { Button } from "./components";
import type { Style, Trial } from "./types";
import {
  STYLE_SAMPLE_PAGES,
  STYLE_SAMPLE_VERSION,
} from "../shared/style-sample-suite.mjs";

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
    api<{ trials: Trial[]; fingerprint: string }>(`/styles/${style.id}/trials`)
      .then(({ trials, fingerprint }) => {
        if (cancelled) return;
        const available = trials.filter(
          (t) =>
            t.status === "completed" &&
            t.image &&
            t.purpose === "standard-sample" &&
            t.sampleVersion === STYLE_SAMPLE_VERSION &&
            t.baseFingerprint === fingerprint,
        );
        setTrials(available);
        setSelected(
          STYLE_SAMPLE_PAGES.map((page) => {
            const choices = available.filter(
              (trial) => trial.samplePageId === page.id,
            );
            return (
              choices.find((trial) =>
                style.publishedTrialIds?.includes(trial.id),
              )?.id ||
              choices[0]?.id ||
              ""
            );
          }),
        );
        setLoaded(true);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [style.id, style.updatedAt]);
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
        用同一篇「讲好」介绍准备完整的 8 种页面，每种选 1
        张再发布。客户会看到风格名称、简介、封面和这 8
        张样例；保存或试做不会自动更新已发布版本。
      </p>
      {loaded ? (
        <div className="style-publish-examples">
          {STYLE_SAMPLE_PAGES.map((page, index) => {
            const choices = trials.filter(
              (trial) => trial.samplePageId === page.id,
            );
            const chosen = choices.find(
              (trial) => trial.id === selected[index],
            );
            return (
              <label key={page.id}>
                <span>
                  {page.number} {page.type}
                </span>
                {chosen?.image ? (
                  <img
                    src={asset(chosen.image)}
                    alt={`${page.type}：${page.title}`}
                  />
                ) : (
                  <div className="style-publish-missing">
                    请先生成这一页标准样例
                  </div>
                )}
                <select
                  aria-label={`选择${page.type}样例`}
                  value={selected[index] || ""}
                  disabled={busy || !choices.length}
                  onChange={(event) =>
                    setSelected(
                      selected.map((id, i) =>
                        i === index ? event.target.value : id,
                      ),
                    )
                  }
                >
                  <option value="">尚未选择</option>
                  {choices.map((trial, i) => (
                    <option key={trial.id} value={trial.id}>
                      {page.title} · 版本 {choices.length - i}
                    </option>
                  ))}
                </select>
              </label>
            );
          })}
        </div>
      ) : (
        <p className="detail-help">正在读取可选样例…</p>
      )}
      {loaded && (
        <p className="detail-help">
          已准备 {selected.filter(Boolean).length} / 8
          页。缺少的页面可在“试做一页 → 制作标准样例”中逐页生成。
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      <div className="style-publish-actions">
        <Button
          disabled={
            busy ||
            !loaded ||
            selected.length !== 8 ||
            selected.some((id) => !id) ||
            !style.rules
          }
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
