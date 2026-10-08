import { useEffect, useState } from "react";
import { api, post, active } from "./api";
import { Button, Field } from "./components";
import { failureAdvice } from "../shared/job-feedback.mjs";
import {
  DELIVERY_EMOTIONS,
  DELIVERY_SOUNDS,
  performanceMatches,
  supportsDeliverySounds,
  type SpeechPerformance as Plan,
  type PerformanceTask,
  type PerformanceSettings,
} from "../shared/speech-performance.mjs";
type Script = {
  pages: { id: string; text: string }[];
  performance: Plan | null;
  performanceTask: PerformanceTask | null;
};
export function SpeechPerformance({
  projectId,
  revision,
  pages,
  pageId,
  model,
  plan,
  enabled,
  disabled,
  onPlan,
  onEnabled,
  onWorking,
  onTexts,
  onNext,
}: {
  projectId: string;
  revision: number;
  pages: { id: string; text: string }[];
  pageId: string;
  model: string;
  plan: Plan | null;
  enabled: boolean;
  disabled: boolean;
  onPlan: (plan: Plan | null) => void;
  onEnabled: (value: boolean) => void;
  onWorking: (value: boolean) => void;
  onTexts: (value: Record<string, string>) => void;
  onNext: () => void;
}) {
  const [settings, setSettings] = useState<PerformanceSettings>(
    plan?.settings || {
      style: "natural",
      sounds: true,
    },
  );
  const [task, setTask] = useState<PerformanceTask | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const running = !!task && active(task.status),
    matches = performanceMatches(plan, pages);
  const page = plan?.pages.find((p) => p.id === pageId);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const result = await api<Script>(
          `/projects/${projectId}/speech-script`,
        );
        if (stopped) return;
        onPlan(result.performance);
        setTask(result.performanceTask);
        if (result.performanceTask && active(result.performanceTask.status))
          timer = setTimeout(poll, 1500);
      } catch (e) {
        if (!stopped) setError((e as Error).message);
      }
    }
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [projectId, task?.id, onPlan]);
  useEffect(() => {
    onWorking(running);
  }, [running, onWorking]);
  async function arrange() {
    setBusy(true);
    setError("");
    try {
      const result = await post<Script>(
        `/projects/${projectId}/speech-performance`,
        {
          revision,
          settings,
          pageTexts: Object.fromEntries(pages.map((p) => [p.id, p.text])),
        },
      );
      onPlan(result.performance);
      setTask(result.performanceTask);

      onTexts(Object.fromEntries(result.pages.map((p) => [p.id, p.text])));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function download() {
    if (!plan) return;
    const content = plan.pages
      .map(
        (p, i) =>
          `第 ${i + 1} 页 · ${p.title}\n` +
          p.units
            .map(
              (u) =>
                `〔${DELIVERY_EMOTIONS.find((e) => e.id === u.emotion)?.name} · ${u.pace}×${u.emphasis ? " · 整句强调" : ""}${u.pauseAfter ? ` · 句后停顿 ${u.pauseAfter} 秒` : ""}${u.sound ? " · " + DELIVERY_SOUNDS.find((s) => s.id === u.sound)?.name : ""}〕\n${u.text}`,
            )
            .join("\n"),
      )
      .join("\n\n");
    const url = URL.createObjectURL(
      new Blob([content], { type: "text/plain;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "演讲演绎稿.txt";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <section className="speech-performance" aria-label="演绎编排">
      <h3>
        {running
          ? "正在安排情绪与停顿"
          : matches
            ? "演绎方案已就绪"
            : "推荐：AI 编排演讲表达"}
      </h3>
      <p className="speech-subtle">
        AI 结合上下文编排情绪、停顿与重点句。正文不改写，表达提示不会被念出来。
      </p>
      <details className="speech-expression-settings" open={!matches}>
        <summary>编排设置{matches ? " · 修改后需重新编排" : ""}</summary>
        <Field label="演讲表达风格">
          <select
            value={settings.style}
            disabled={busy || running || disabled}
            onChange={(e) =>
              setSettings({ ...settings, style: e.target.value })
            }
          >
            <option value="natural">自然演讲</option>
            <option value="restrained">沉稳克制</option>
            <option value="vivid">生动有感染力</option>
          </select>
        </Field>
        <label className="speech-check">
          <input
            type="checkbox"
            checked={settings.sounds}
            disabled={busy || running || disabled}
            onChange={(e) =>
              setSettings({ ...settings, sounds: e.target.checked })
            }
          />
          适度加入辅助表达
        </label>
        <p className="speech-subtle">
          笑声、轻叹仅在合适语境使用，每页最多一次；咳嗽、清嗓仅采用原稿明确提示。辅助声音需
          Speech 2.8。
        </p>
      </details>
      {running ? (
        <Button
          onClick={async () => {
            setBusy(true);
            try {
              await post(`/projects/${projectId}/speech-performance/cancel`);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
          disabled={busy}
        >
          停止编排
        </Button>
      ) : (
        <Button
          variant={matches ? "secondary" : "primary"}
          onClick={arrange}
          disabled={disabled || busy || !pages.length}
        >
          {busy ? "正在提交…" : plan ? "重新编排演讲" : "AI 编排整场演讲"}
        </Button>
      )}
      <p className="speech-subtle">
        编排使用已配置的内容分析模型额度，不生成语音；成功后逐页检查，再点击下方“使用方案”进入声音制作。
      </p>
      {task?.status === "failed" ? (
        <div role="alert" className="speech-error">
          <strong>
            表达编排未完成 · {failureAdvice(task.progress).reason}
          </strong>
          <p>编排已停止，不会自动重试。可重新编排，或选择普通口播继续。</p>
          <p>{failureAdvice(task.progress).action}</p>
          <details>
            <summary>具体错误</summary>
            <p className="job-raw-error">{task.progress}</p>
          </details>
        </div>
      ) : (
        task && (
          <p role="status" className="speech-callout">
            {task.progress}
            {running
              ? ` · 已完成 ${task.completed} / ${task.total} 页，无需重复点击。`
              : ""}
          </p>
        )
      )}
      {error && (
        <p role="alert" className="speech-error">
          {error}
        </p>
      )}
      <div className="speech-step-next">
        {matches && (
          <Button
            variant="primary"
            disabled={
              disabled ||
              busy ||
              running ||
              (!supportsDeliverySounds(model) &&
                !!plan?.pages.some((p) => p.units.some((u) => u.sound)))
            }
            onClick={() => {
              onEnabled(true);
              onNext();
            }}
          >
            使用方案 · 选择声音
          </Button>
        )}
        <Button
          variant="ghost"
          disabled={disabled || busy || running}
          onClick={() => {
            onEnabled(false);
            onNext();
          }}
        >
          {enabled && matches
            ? "改用普通口播 · 选择声音"
            : "跳过 AI 编排 · 使用普通口播"}
        </Button>
        <p className="speech-subtle">
          普通口播可直接选情绪和语速，不额外调用内容分析模型。已有音频仍可从左侧播放。
        </p>
      </div>
      {plan && (
        <>
          {!matches && (
            <p role="status" className="speech-callout">
              正文已修改，编排需要更新。请重新编排，或选择普通口播；已有音频仍可播放。
            </p>
          )}
          {!supportsDeliverySounds(model) &&
            plan.pages.some((p) => p.units.some((u) => u.sound)) && (
              <p className="speech-callout">
                当前模型不支持辅助声音。请在设置中选择 Speech
                2.8，或关闭辅助表达后重新编排。
              </p>
            )}
          <details className="speech-delivery-review" open>
            <summary>本页演绎方案 · {page?.units.length || 0} 句</summary>
            {page?.units.map((u) => (
              <article key={u.id}>
                <div className="speech-delivery-tags">
                  <span>
                    {DELIVERY_EMOTIONS.find((e) => e.id === u.emotion)?.name}
                  </span>
                  <span>{u.pace}×</span>
                  {u.emphasis && <span>重点句 · 稍慢、略增强</span>}
                  {u.pauseAfter > 0 && <span>停顿 {u.pauseAfter} 秒</span>}
                  {u.sound && (
                    <span>
                      {DELIVERY_SOUNDS.find((s) => s.id === u.sound)?.name}
                    </span>
                  )}
                </div>
                <p>{u.text}</p>
                <small>{u.reason}</small>
              </article>
            ))}
            {!page?.units.length && <p>本页没有口播正文。</p>}
          </details>
          <Button variant="ghost" onClick={download}>
            下载演绎稿
          </Button>
        </>
      )}
    </section>
  );
}
