import { useCallback, useEffect, useRef, useState } from "react";
import { api, asset, post, patch, active } from "./api";
import { Button } from "./components";
import type { Style, Trial, SampleProgress } from "./types";
import {
  STYLE_SAMPLE_PAGES,
  STYLE_SAMPLE_VERSION,
} from "../shared/style-sample-suite.mjs";
import { sampleSelection } from "../shared/style-sample-sequence.mjs";
import "./style-publishing.css";
import { StyleSampleProgress } from "./StyleSampleProgress";
import { HOSTED_BUILTIN_STYLE_IDS } from "../shared/styles.mjs";

type Samples = {
  trials: Trial[];
  fingerprint: string;
  preferredIds: string[];
  progress: SampleProgress;
};

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
  const [submitting, setSubmitting] = useState(false);
  const [acknowledgeUncertain, setAcknowledgeUncertain] = useState(false);
  const startRequest = useRef<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [showPages, setShowPages] = useState(false);
  const mounted = useRef(true);
  const operation = useRef(false);
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
  const progress = samples?.progress;
  const running = !!progress?.background;
  const pending = trials.find((trial) => active(trial.status));
  const unavailable =
    disabled ||
    publishing ||
    savingChoice ||
    submitting ||
    !!pending ||
    !samples ||
    !style.rules?.trim();
  const waiting = !!pending;
  useEffect(() => {
    onBusy?.(running || submitting || publishing || savingChoice || waiting);
    return () => onBusy?.(false);
  }, [onBusy, running, submitting, publishing, savingChoice, waiting]);

  const choose = async (
    pageId: string,
    trialId: string,
    expectedTrialId: string,
  ) => {
    if (operation.current || unavailable || running) return;
    operation.current = true;
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
      operation.current = false;
      if (mounted.current) setSavingChoice(false);
    }
  };

  const fill = async () => {
    if (
      operation.current ||
      running ||
      disabled ||
      submitting ||
      publishing ||
      savingChoice ||
      !samples ||
      !style.rules?.trim() ||
      ready === 8
    )
      return;
    operation.current = true;
    setSubmitting(true);
    setError("");
    startRequest.current ||= crypto.randomUUID();
    try {
      await post(`/styles/${style.id}/sample-batch`, {
        fingerprint,
        requestId: startRequest.current,
        acknowledgeUncertain,
      });
      startRequest.current = null;
      if (mounted.current) {
        setAcknowledgeUncertain(false);
        setMessage(
          "已交给后台逐页补齐。关闭详情、切换风格或刷新页面都可继续。",
        );
      }
      await read();
      await refresh();
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
      await read().catch(() => {});
    } finally {
      operation.current = false;
      if (mounted.current) setSubmitting(false);
    }
  };
  const pause = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError("");
    try {
      await post(`/styles/${style.id}/sample-batch/pause`, {});
      await read();
      await refresh();
      if (mounted.current) setMessage("已暂停后续页面，当前页继续完成并保存。");
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    } finally {
      if (mounted.current) setSubmitting(false);
    }
  };
  const publish = async (publish: boolean) => {
    if (operation.current || unavailable || running || (publish && ready !== 8))
      return;
    operation.current = true;
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
      operation.current = false;
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
      {progress ? (
        <StyleSampleProgress progress={progress} />
      ) : (
        <p>正在读取已有样例…</p>
      )}
      {progress?.uncertain && !running && (
        <label className="sample-retry-confirm">
          <input
            type="checkbox"
            checked={acknowledgeUncertain}
            onChange={(e) => setAcknowledgeUncertain(e.target.checked)}
          />
          已核对上次请求，确认继续可能再次计费
        </label>
      )}
      {HOSTED_BUILTIN_STYLE_IDS.includes(style.id) && (
        <p className="detail-help">
          内置样例已公开。这里用于制作当前规则的新样例，原样例会保留。
        </p>
      )}
      <div className="style-publish-actions">
        {running ? (
          <Button onClick={pause} loading={submitting}>
            暂停补齐
          </Button>
        ) : (
          <Button
            variant={ready < 8 ? "primary" : "secondary"}
            disabled={
              disabled ||
              publishing ||
              savingChoice ||
              submitting ||
              !samples ||
              !style.rules?.trim() ||
              ready === 8 ||
              (!!progress?.uncertain && !acknowledgeUncertain)
            }
            loading={submitting}
            onClick={fill}
          >
            {ready === 8
              ? "样例已齐"
              : ["failed", "paused"].includes(progress?.status || "")
                ? "继续补齐"
                : "后台补齐样例"}
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
      {running && (
        <p className="detail-help">
          关闭详情、切换风格或刷新页面后，后台仍会逐页补齐。可在风格库查看进度。
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
