import { useEffect, useRef, useState } from "react";
import { STYLE_SAMPLE_PAGES } from "../shared/style-sample-suite.mjs";
import {
  completedSample,
  runSampleSequence,
} from "../shared/style-sample-sequence.mjs";
import { api, post } from "./api";
import { Button } from "./components";
import type { Style, Trial } from "./types";
import "./style-sample-maker.css";

export function StyleSampleMaker({
  style,
  trials,
  fingerprint,
  disabled,
  onTrial,
  onBusy,
}: {
  style: Style;
  trials: Trial[];
  fingerprint: string;
  disabled: boolean;
  onTrial: (trial: Trial) => void;
  onBusy: (busy: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState("");
  const [adjustments, setAdjustments] = useState<Record<string, string>>({});
  const token = useRef<{ stopped: boolean } | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (token.current) token.current.stopped = true;
    };
  }, []);
  const page = STYLE_SAMPLE_PAGES[index];
  const ready = STYLE_SAMPLE_PAGES.filter((p) =>
    completedSample(trials, p.id, fingerprint),
  ).length;
  const read = () =>
    api<{ trials: Trial[]; fingerprint: string }>(`/styles/${style.id}/trials`);
  const create = (pageId: string, expected: string) =>
    post<Trial>(`/styles/${style.id}/trials`, {
      samplePageId: pageId,
      sampleFingerprint: expected,
    });
  const start = async (single = false) => {
    if (token.current || disabled || !fingerprint) return;
    const current = { stopped: false };
    token.current = current;
    setRunning(true);
    onBusy(true);
    setMessage("");
    try {
      if (single) {
        const trial = await post<Trial>(`/styles/${style.id}/trials`, {
          samplePageId: page.id,
          sampleFingerprint: fingerprint,
          sampleFeedback: adjustments[page.id] || "",
        });
        if (mounted.current) onTrial(trial);
      } else {
        await runSampleSequence({
          read,
          create,
          fingerprint,
          stopped: () => current.stopped,
          onPage: (next) => setIndex(STYLE_SAMPLE_PAGES.indexOf(next)),
          onTrial: (trial) => {
            if (mounted.current) onTrial(trial);
          },
        });
        if (mounted.current && !current.stopped)
          setMessage("八页已分别完成。请逐页检查，满意后到高级设置手动发布。");
      }
    } catch (error) {
      if (mounted.current)
        setMessage(
          (error as Error).message +
            " 已完成的页面保留；继续或重做会产生新的图片请求。",
        );
    } finally {
      token.current = null;
      if (mounted.current) {
        setRunning(false);
        onBusy(false);
      }
    }
  };
  return (
    <section className="style-sample-maker" aria-label="标准样例制作">
      <div className="sample-maker-heading">
        <div>
          <h2>一套风格，八种页面</h2>
          <p>自动填入统一讲稿，按 01–08 逐页生成；上一页完成后才开始下一页。</p>
        </div>
        <Button onClick={() => setOpen(!open)}>
          {open ? "收起标准样例" : "制作标准样例"}
        </Button>
      </div>
      {open && (
        <>
          <div className="sample-maker-pages" aria-label="八页制作进度">
            {STYLE_SAMPLE_PAGES.map((item, i) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={index === i}
                onClick={() => {
                  setIndex(i);
                  const saved = completedSample(trials, item.id, fingerprint);
                  if (saved) onTrial(saved);
                }}
              >
                <span>
                  {item.number} {item.type}
                </span>
                <small>
                  {trials.some(
                    (t) =>
                      t.samplePageId === item.id &&
                      ["queued", "running"].includes(t.status),
                  )
                    ? "制作中"
                    : completedSample(trials, item.id, fingerprint)
                      ? "已完成"
                      : "待制作"}
                </small>
              </button>
            ))}
          </div>
          <div className="sample-maker-copy">
            <h3>
              {page.number} · {page.title}
            </h3>
            <p>{page.objective}</p>
            <details>
              <summary>查看本页内容</summary>
              <p>{page.notes}</p>
              <strong>本页上屏文字</strong>
              <ul>
                {page.displayText.map((text) => (
                  <li key={text}>{text}</li>
                ))}
              </ul>
            </details>
            <label className="sample-maker-feedback">
              这一页的画面调整（可选）
              <textarea
                value={adjustments[page.id] || ""}
                disabled={disabled || running}
                maxLength={10000}
                onChange={(event) =>
                  setAdjustments({
                    ...adjustments,
                    [page.id]: event.target.value,
                  })
                }
                placeholder="例如：图表更清楚、标题更突出。仅用于下方的单页生成或重做，统一文案保持不变。"
              />
            </label>
          </div>
          <div className="sample-maker-actions">
            <span aria-live="polite">已完成 {ready} / 8 页</span>
            {running ? (
              <Button
                onClick={() => {
                  if (token.current) token.current.stopped = true;
                  setMessage("已暂停后续页面，当前页继续完成并保存。");
                }}
              >
                暂停后续页面
              </Button>
            ) : (
              <Button
                variant="primary"
                disabled={
                  disabled ||
                  !fingerprint ||
                  ready === 8 ||
                  !style.rules?.trim()
                }
                onClick={() => start()}
              >
                {ready ? "继续未完成页面" : "开始逐页制作"}
              </Button>
            )}
            <Button
              disabled={
                disabled || running || !fingerprint || !style.rules?.trim()
              }
              onClick={() => start(true)}
            >
              {completedSample(trials, page.id, fingerprint)
                ? "只重做"
                : "只生成"}
              第 {page.number} 页
            </Button>
          </div>
          <p className="detail-help">
            每页独立生成并保存，成功出图按现有规则消耗 1
            张图片额度。失败会暂停；离开或刷新本页后暂停后续页面，回来可继续。制作完成后不会自动发布。
          </p>
          {message && <p role="status">{message}</p>}
        </>
      )}
    </section>
  );
}
