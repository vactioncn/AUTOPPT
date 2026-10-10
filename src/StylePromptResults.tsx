import { useState } from "react";
import type { Style, GeneratedStyle } from "./types";
import { Button } from "./components";

export function StylePromptResults({
  style,
  disabled,
  onApply,
  notify,
}: {
  style: Style;
  disabled: boolean;
  onApply: (candidate: GeneratedStyle) => void;
  notify: (message: string) => void;
}) {
  const candidates = style.styleAnalysis?.styles || [];
  const active = candidates.find((entry) => entry.rules === style.rules);
  const [previewId, setPreviewId] = useState<string>();
  const candidate =
    candidates.find((entry) => entry.id === previewId) ||
    active ||
    candidates[0];
  if (!candidate) return null;
  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      notify("这组分析结果的提示词已复制，当前使用的提示词未改变。");
    } catch {
      notify("无法访问剪贴板，请选中提示词文字复制。");
    }
  };
  return (
    <section
      className="style-prompt-results"
      aria-label="视觉风格提示词生成结果"
    >
      <p className="detail-help">
        最近一次提炼记录。查看正在使用的完整原文，请切回“提示词”。
      </p>
      {candidates.length > 1 && (
        <div
          className="style-result-switch"
          role="group"
          aria-label="分析得到的独立风格"
        >
          {candidates.map((entry, i) => (
            <button
              key={entry.id}
              aria-pressed={candidate.id === entry.id}
              onClick={() => setPreviewId(entry.id)}
            >
              风格 {String.fromCharCode(65 + i)} · {entry.nameCn}
              {active?.id === entry.id && " · 当前采用"}
            </button>
          ))}
        </div>
      )}
      {active?.id !== candidate.id && (
        <p className="detail-help">
          {active
            ? `当前采用「${active.nameCn}」。`
            : "当前提示词已手动调整或恢复版本。"}
          这组分析结果尚未采用；点击“采用这组风格”才会更新提示词，并保留原版本。
        </p>
      )}
      <h3>{candidate.nameCn}</h3>
      <p className="style-result-english">{candidate.nameEn}</p>
      <p>{candidate.description}</p>
      <div className="style-result-actions">
        <Button onClick={() => void copy(candidate.rules)}>
          复制这组分析提示词
        </Button>
        {active?.id !== candidate.id && (
          <Button
            disabled={disabled}
            variant="primary"
            onClick={() => onApply(candidate)}
          >
            采用这组风格
          </Button>
        )}
      </div>
      <details className="studio-rule-details">
        <summary>查看风格判断与提炼要点</summary>
        <p className="detail-help">{style.styleAnalysis?.relationReason}</p>
        {!!style.styleAnalysis?.excludedReferences?.length && (
          <p className="detail-help">
            离群参考图 {style.styleAnalysis.excludedReferences.join("、")}{" "}
            未并入主体风格。
          </p>
        )}
        <p>{candidate.boundary}</p>
        <p className="detail-help">
          参考图 {candidate.references.join("、")} · {candidate.rationale}
        </p>
        <h4>核心视觉 DNA</h4>
        <ul>
          {candidate.visualDna.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
        <h4>四级风格规则</h4>
        {(
          [
            ["mustKeep", "必须保持"],
            ["flexible", "可以变化"],
            ["rare", "偶尔使用"],
            ["forbidden", "必须禁止"],
          ] as const
        ).map(([key, label]) => (
          <div key={key}>
            <h4>{label}</h4>
            <ul>
              {candidate.styleModel[key].map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </div>
        ))}
        <h4>风格锁定语句</h4>
        <ul>
          {candidate.lockSentences.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
        <h4>连续生成时的风险提醒</h4>
        <ul>
          {candidate.risks.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      </details>
      <details className="style-full-prompt" key={candidate.id}>
        <summary>查看这组完整提示词</summary>
        <div className="candidate-prompt">{candidate.rules}</div>
      </details>
    </section>
  );
}
