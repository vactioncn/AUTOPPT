import { useEffect, useId, useMemo, useState } from "react";
import { api, post } from "./api";
import { Button } from "./components";
import type { Style } from "./types";
import { textDiff } from "../shared/text-diff.mjs";

type Version = {
  id: string;
  number: number;
  rules: string;
  compositionMode: "direct" | "content-led" | null;
  source: string;
  createdAt: string | null;
  current: boolean;
};
type Versions = { currentToken: string; versions: Version[] };
const sources: Record<string, string> = {
  baseline: "保存起点",
  manual: "手动保存",
  extraction: "重新提炼",
  trial: "试做转正式",
  restore: "恢复版本",
  legacy: "旧版记录",
};
const modeName = (mode: Version["compositionMode"]) =>
  mode === "content-led"
    ? "按内容构思"
    : mode === "direct"
      ? "直接出图"
      : "旧记录未保存构思方式";
const date = (value: string | null) =>
  value
    ? new Date(value).toLocaleString("zh-CN", { hour12: false })
    : "时间未记录";

export function StyleVersions({
  style,
  disabled = false,
  blockedReason,
  onRestored,
  initiallyOpen = false,
}: {
  style: Style;
  disabled?: boolean;
  blockedReason?: string;
  onRestored: (style: Style, changed: boolean) => Promise<void>;
  initiallyOpen?: boolean;
}) {
  const [open, setOpen] = useState(initiallyOpen),
    [data, setData] = useState<Versions | null>(null),
    [selectedId, setSelectedId] = useState(""),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [reload, setReload] = useState(0);
  const selectId = useId();
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    api<Versions>(`/styles/${style.id}/versions`, { signal: controller.signal })
      .then((value) => {
        setData(value);
        setSelectedId((previous) =>
          value.versions.some((v) => v.id === previous)
            ? previous
            : (value.versions.find((v) => !v.current) || value.versions[0])
                ?.id || "",
        );
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [open, style.id, style.versionToken, reload]);
  const selected = data?.versions.find((v) => v.id === selectedId),
    current = data?.versions.find((v) => v.current);
  const lines = useMemo(
    () => (selected && current ? textDiff(selected.rules, current.rules) : []),
    [selected, current],
  );
  const matches =
    selected &&
    current &&
    selected.rules === current.rules &&
    (!selected.compositionMode ||
      selected.compositionMode === current.compositionMode);
  const restore = async () => {
    if (!selected || !data) return;
    setBusy(true);
    setError("");
    try {
      const result = await post<{ style: Style; changed: boolean }>(
        `/styles/${style.id}/versions/${encodeURIComponent(selected.id)}/restore`,
        { expectedVersion: data.currentToken },
      );
      await onRestored(result.style, result.changed);
      setReload((n) => n + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <details
      className="style-versions"
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>
        提示词版本{data ? ` · ${data.versions.length} 个版本` : ""}
      </summary>
      <p className="detail-help">
        每次保存提示词或构思方式都会留存版本。恢复会存为新版本，已有图片保留。旧版记录按实际保存内容显示。
      </p>
      {loading && <p role="status">正在读取版本…</p>}
      {data && !data.versions.length && <p>还没有已保存的提示词。</p>}
      {!!data?.versions.length && (
        <>
          <label htmlFor={selectId}>选择提示词版本</label>
          <select
            id={selectId}
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            disabled={busy || loading}
          >
            {data.versions.map((v) => (
              <option key={v.id} value={v.id}>
                V{v.number}
                {v.current ? " · 当前" : ""} · {sources[v.source] || v.source} ·{" "}
                {date(v.createdAt)}
              </option>
            ))}
          </select>
          {selected && (
            <>
              <p>
                V{selected.number} · {modeName(selected.compositionMode)}
              </p>
              <pre className="version-original" aria-label="所选版本提示词">
                {selected.rules}
              </pre>
              <details className="version-comparison">
                <summary>与当前版本比较</summary>
                <p className="detail-help">
                  所选版本 → 当前版本。− 表示当前已移除，+
                  表示当前新增。逐字保留空格与空行。
                </p>
                {selected.compositionMode !== current?.compositionMode && (
                  <p>
                    构思方式：{modeName(selected.compositionMode)} →{" "}
                    {modeName(current?.compositionMode || null)}
                  </p>
                )}
                {selected.rules === current?.rules ? (
                  <p>提示词文字一致。</p>
                ) : (
                  <div className="version-diff" aria-label="提示词差异">
                    {lines.map((line, i) => (
                      <div className={`diff-${line.kind}`} key={i}>
                        <span aria-hidden="true">
                          {line.kind === "added"
                            ? "+"
                            : line.kind === "removed"
                              ? "−"
                              : " "}
                        </span>
                        <code>{line.text || "\u00a0"}</code>
                      </div>
                    ))}
                  </div>
                )}
              </details>
              <div className="version-actions">
                <Button
                  variant="primary"
                  onClick={restore}
                  loading={busy}
                  disabled={disabled || loading || !!matches}
                >
                  恢复此版本
                </Button>
                <Button
                  onClick={() => setReload((n) => n + 1)}
                  disabled={busy || loading}
                >
                  刷新版本记录
                </Button>
              </div>
              {matches && (
                <p className="detail-help">所选内容与当前一致，无需恢复。</p>
              )}
              {blockedReason && <p className="detail-help">{blockedReason}</p>}
            </>
          )}
        </>
      )}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {error && !data && (
        <Button onClick={() => setReload((n) => n + 1)} disabled={loading}>
          重新读取版本
        </Button>
      )}
    </details>
  );
}
