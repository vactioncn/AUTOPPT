import type { Plan } from "./types";

export function RawPromptDetails({ plan }: { plan: Plan }) {
  if (plan.promptMode !== "verbatim-style-v1") return null;
  return (
    <>
      <p className="detail-help">
        {plan.copyReused
          ? "本次复用已提炼的上屏文案。"
          : "上屏文案已单独提炼并复核。"}
        风格提示词按原文使用，构图由图片模型完成。
      </p>
      <details className="copy-review">
        <summary>本次风格提示词原文</summary>
        <div className="rules-text">{plan.styleRules}</div>
      </details>
      {plan.imageRequest?.prompt && (
        <details className="copy-review">
          <summary>实际发送的出图提示词</summary>
          <div className="rules-text">{plan.imageRequest.prompt}</div>
        </details>
      )}
    </>
  );
}
