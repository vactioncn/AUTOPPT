import type { Plan } from "./types";

export function ContentPromptDetails({ plan }: { plan: Plan }) {
  if (!plan.contentPrompt) return null;
  return (
    <details className="copy-review">
      <summary>辅助信息与语义边界</summary>
      <p className="detail-help">
        {plan.screenCopy?.semanticSupport?.length
          ? "下方原稿或附件摘录只供理解，可选作次要标签，不是新的主文案。"
          : "以上屏文案为主，保持原意和表达程度；辅助联想只能少量、轻微、中性，不增加判断、倾向或引导。"}
      </p>
      <div className="rules-text">{plan.contentPrompt}</div>
    </details>
  );
}
