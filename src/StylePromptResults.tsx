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
  if (!candidate) return <div className="rules-text">{style.rules}</div>;
  const changed = !active;
  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      notify("提示词已复制。");
    } catch {
      notify("无法访问剪贴板，请选中提示词文字复制。");
    }
  };
  return (
    <section
      className="style-prompt-results"
      aria-label="视觉风格提示词生成结果"
    >
      <p className="detail-help">{style.styleAnalysis?.relationReason}</p>
      {!!style.styleAnalysis?.excludedReferences?.length && (
        <p className="detail-help">
          离群参考图 {style.styleAnalysis.excludedReferences.join("、")}{" "}
          未并入主体风格。
        </p>
      )}
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
              STYLE {String.fromCharCode(65 + i)} · {entry.nameCn}
              {active?.id === entry.id && " · 当前采用"}
            </button>
          ))}
        </div>
      )}
      {active && active.id !== candidate.id && (
        <p className="detail-help">
          当前采用「{active.nameCn}
          」。正在预览的提示词需点击“采用这组风格”后才用于试做与制作。
        </p>
      )}
      <h3>{candidate.nameCn}</h3>
      <p className="style-result-english">{candidate.nameEn}</p>
      <p>{candidate.description}</p>
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
      <details className="studio-rule-details">
        <summary>四级风格规则</summary>
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
      </details>
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
      <div className="style-result-actions">
        <Button onClick={() => void copy(candidate.rules)}>
          复制完整提示词
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
      {changed && (
        <p className="detail-help">
          当前提示词已手动调整或恢复，以下为最近分析记录；试做与制作使用下方当前正式提示词。采用一组风格会保存新版本。
        </p>
      )}
      <details
        className="style-full-prompt"
        open={candidates.length === 1 && !changed}
        key={candidate.id}
      >
        <summary>完整可复制提示词 · {candidate.nameCn}</summary>
        <div className={changed ? "candidate-prompt" : "rules-text"}>
          {candidate.rules}
        </div>
      </details>
      {changed && (
        <details className="style-full-prompt" open>
          <summary>当前正式提示词</summary>
          <Button onClick={() => void copy(style.rules)}>
            复制当前正式提示词
          </Button>
          <div className="rules-text">{style.rules}</div>
        </details>
      )}
    </section>
  );
}
