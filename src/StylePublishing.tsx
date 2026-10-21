import { useCallback, useEffect, useRef, useState } from "react";
import { api, asset, post, patch, active } from "./api";
import { Button } from "./components";
import type { Style, Trial } from "./types";
import {
  STYLE_SAMPLE_PAGES,
  STYLE_SAMPLE_VERSION,
} from "../shared/style-sample-suite.mjs";
import {
  runSampleSequence,
  sampleSelection,
} from "../shared/style-sample-sequence.mjs";
import "./style-publishing.css";
import { HOSTED_BUILTIN_STYLE_IDS } from "../shared/styles.mjs";

type Samples = { trials: Trial[]; fingerprint: string; preferredIds: string[] };

export function StylePublishing({
  style,
  refresh,
  notify,
  disabled = false,
  onBusy,
}: {
  style: Style;
  refresh: () => Promise<void>;
  notify: (message: string) => void;
  disabled?: boolean;
  onBusy?: (busy: boolean) => void;
}) {
  const [samples, setSamples] = useState<Samples | null>(null);
  const [savingChoice, setSavingChoice] = useState(false);
  const [running, setRunning] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [showPages, setShowPages] = useState(false);
  const mounted = useRef(true);
  const operation = useRef<{ stopped: boolean } | null>(null);
  const requestNumber = useRef(0);
  const appliedRequest = useRef(0);
  const read = useCallback(async () => {
    const request = ++requestNumber.current;
    const result = await api<Samples>(`/styles/${style.id}/trials`);
    if (mounted.current && request > appliedRequest.current) {
      appliedRequest.current = request;
      setSamples(result);
      setLoadError("");
    }
    return result;
  }, [style.id]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (operation.current) operation.current.stopped = true;
    };
  }, []);
  useEffect(() => {
    read().catch((e) => {
      if (mounted.current) setLoadError(e.message);
    });
    const timer = setInterval(() => read().catch(() => {}), 1800);
    return () => clearInterval(timer);
  }, [read, style.updatedAt]);

  const fingerprint = samples?.fingerprint || "";
  const trials = samples?.trials || [];
  const selected = sampleSelection(
    trials,
    fingerprint,
    samples?.preferredIds || [],
  );
  const ready = selected.filter(Boolean).length;
  const pending = trials.find((trial) => active(trial.status));
  const unavailable =
    disabled ||
    publishing ||
    savingChoice ||
    !!pending ||
    !samples ||
    !style.rules?.trim();
  const waiting = !!pending;
  useEffect(() => {
    onBusy?.(running || publishing || savingChoice || waiting);
    return () => onBusy?.(false);
  }, [onBusy, running, publishing, savingChoice, waiting]);

  const choose = async (
    pageId: string,
    trialId: string,
    expectedTrialId: string,
  ) => {
    if (operation.current || unavailable || running) return;
    operation.current = { stopped: false };
    setSavingChoice(true);
    setError("");
    setMessage("正在保存样例选择…");
    try {
      await patch(`/styles/${style.id}/samples/${pageId}`, {
        trialId,
        expectedTrialId,
        fingerprint,
      });
      // Fetch after the write so an older polling response cannot win the race.
      await read();
      await refresh();
      if (mounted.current)
        setMessage(
          "样例选择已保存，效果预览会使用这一版本。发布后客户才会看到更新。",
        );
    } catch (e) {
      if (mounted.current) {
        setMessage("");
        setError((e as Error).message);
      }
      await read().catch(() => {});
    } finally {
      operation.current = null;
      if (mounted.current) setSavingChoice(false);
    }
  };

  const fill = async () => {
    if (operation.current || unavailable || ready === 8) return;
    const current = { stopped: false };
    operation.current = current;
    setRunning(true);
    setError("");
    setMessage("正在检查已有样例，只补齐缺少的页面…");
    try {
      await runSampleSequence({
        read,
        fingerprint,
        stopped: () => current.stopped,
        create: (pageId, expected) =>
          post<Trial>(`/styles/${style.id}/trials`, {
            samplePageId: pageId,
            sampleFingerprint: expected,
            reuseExisting: true,
          }),
        onPage: (page) => {
          if (mounted.current)
            setMessage(`正在补齐第 ${page.number} 页 · ${page.type}`);
        },
        onTrial: (trial) => {
          if (mounted.current)
            setSamples(
              (state) =>
                state && {
                  ...state,
                  trials: state.trials.some((item) => item.id === trial.id)
                    ? state.trials.map((item) =>
                        item.id === trial.id ? trial : item,
                      )
                    : [trial, ...state.trials],
                },
            );
        },
      });
      if (mounted.current && !current.stopped) {
        await read();
        setMessage("八页样例已齐。查看效果后，点击“一键发布”即可让客户使用。");
        setShowPages(true);
      }
    } catch (e) {
      if (mounted.current) {
        setMessage("");
        setError(
          `${(e as Error).message} 已完成页面保留；处理后点击“补齐样例”继续。`,
        );
      }
    } finally {
      operation.current = null;
      if (mounted.current) setRunning(false);
    }
  };
  const publish = async (publish: boolean) => {
    if (operation.current || unavailable || (publish && ready !== 8)) return;
    operation.current = { stopped: false };
    setPublishing(true);
    setError("");
    setMessage("");
    try {
      if (publish)
        await post(`/styles/${style.id}/publish`, {
          trialIds: selected.map((trial) => trial!.id),
        });
      else await api(`/styles/${style.id}/publish`, { method: "DELETE" });
      if (!mounted.current) return;
      await refresh();
      const result = publish
        ? "风格与八页样例已发布，客户刷新风格库即可看到。"
        : "已从客户风格库下架，已有项目仍可继续使用。";
      setMessage(result);
      notify(result);
      await read();
    } catch (e) {
      if (mounted.current) {
        setError((e as Error).message);
        await read().catch(() => {});
      }
    } finally {
      operation.current = null;
      if (mounted.current) setPublishing(false);
    }
  };
  return (
    <section
      className="style-publishing style-publishing-panel"
      aria-label="样例与发布"
    >
      <div className="style-publish-heading">
        <h3>样例与发布</h3>
        <span>{style.publishedAt ? "已发布" : "尚未发布"}</span>
      </div>
      <p className="style-publish-progress" aria-live="polite">
        {samples
          ? `已完成 ${ready} / 8 页${ready < 8 ? ` · 还缺 ${8 - ready} 页` : " · 可以发布"}`
          : "正在读取已有样例…"}
      </p>
      {HOSTED_BUILTIN_STYLE_IDS.includes(style.id) && (
        <p className="detail-help">
          内置样例已公开。这里用于制作当前规则的新样例，原样例会保留。
        </p>
      )}
      <div className="style-publish-actions">
        {running ? (
          <Button
            onClick={() => {
              if (operation.current) operation.current.stopped = true;
              setMessage("已暂停后续页面，已提交的当前页会继续完成并保存。");
            }}
          >
            暂停补齐
          </Button>
        ) : (
          <Button
            variant={ready < 8 ? "primary" : "secondary"}
            disabled={unavailable || ready === 8}
            onClick={fill}
          >
            {ready === 8 ? "样例已齐" : pending ? "当前页制作中…" : "补齐样例"}
          </Button>
        )}
        <Button
          variant={ready === 8 ? "primary" : "secondary"}
          disabled={unavailable || running || ready !== 8}
          loading={publishing}
          onClick={() => publish(true)}
        >
          {style.publishedAt ? "一键更新发布" : "一键发布"}
        </Button>
        {style.publishedAt && (
          <Button
            variant="ghost"
            disabled={unavailable || running}
            onClick={() => publish(false)}
          >
            从客户风格库下架
          </Button>
        )}
      </div>
      <p className="detail-help">
        {ready < 8
          ? "按统一讲稿逐页补齐，只生成缺页，已有样例保留。每张成功出图使用 1 张图片额度。"
          : "已选好每种页面的可用样例。更换版本会自动保存，并同步到效果预览。"}
        生成后不会自动发布。
      </p>
      {(running || pending) && (
        <p className="detail-help">
          离开或刷新会暂停后续提交；当前页继续保存，回来可接着补齐。
        </p>
      )}
      {disabled && (
        <p className="detail-help">
          请先完成当前风格编辑或提炼，再补齐样例与发布。
        </p>
      )}
      {message && (
        <p className="style-publish-message" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {loadError && (
        <p className="error-text" role="alert">
          {loadError}
        </p>
      )}
      {!samples && loadError && (
        <Button
          onClick={() => {
            setLoadError("");
            read().catch((e) => setLoadError(e.message));
          }}
        >
          重新读取样例
        </Button>
      )}
      {samples && (
        <details
          open={showPages}
          onToggle={(event) => setShowPages(event.currentTarget.open)}
          className="style-publish-versions"
        >
          <summary>查看八页样例与版本</summary>
          <div className="style-publish-examples">
            {STYLE_SAMPLE_PAGES.map((page, index) => {
              const choices = trials.filter(
                (trial) =>
                  trial.purpose === "standard-sample" &&
                  trial.samplePageId === page.id &&
                  trial.sampleVersion === STYLE_SAMPLE_VERSION &&
                  trial.baseFingerprint === fingerprint &&
                  trial.status === "completed" &&
                  trial.image,
              );
              const chosen = selected[index];
              const making = trials.some(
                (trial) =>
                  trial.samplePageId === page.id && active(trial.status),
              );
              return (
                <label key={page.id}>
                  <span>
                    {page.number} {page.type}
                  </span>
                  {chosen?.image ? (
                    <a
                      href={asset(chosen.image)}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`查看${page.type}大图`}
                    >
                      <img
                        src={asset(chosen.image)}
                        alt={`${page.type}：${page.title}`}
                      />
                    </a>
                  ) : (
                    <div className="style-publish-missing">
                      {making ? "正在制作…" : "待补齐"}
                    </div>
                  )}
                  <select
                    aria-label={`选择${page.type}样例`}
                    value={chosen?.id || ""}
                    disabled={unavailable || running || !choices.length}
                    onChange={(event) =>
                      void choose(page.id, event.target.value, chosen?.id || "")
                    }
                  >
                    {!choices.length && (
                      <option value="">
                        {making ? "正在制作" : "尚无样例"}
                      </option>
                    )}
                    {choices.map((trial, i) => (
                      <option key={trial.id} value={trial.id}>
                        {page.type} · 版本 {choices.length - i}
                      </option>
                    ))}
                  </select>
                </label>
              );
            })}
          </div>
        </details>
      )}
    </section>
  );
}
