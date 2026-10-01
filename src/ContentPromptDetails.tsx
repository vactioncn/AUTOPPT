import type { Plan } from "./types";

export function ContentPromptDetails({ plan }: { plan: Plan }) {
  if (!plan.contentPrompt) return null;
  return (
    <details className="copy-review">
      <summary>辅助信息与语义边界</summary>
      <p className="detail-help">
        {plan.screenCopy?.semanticSupport?.length
          ? "下方原稿或附件摘录只供理解，可选作次要标签，不是新的主文案。"
          : "本页没有额外的已确认辅助资料；可用中性标签或准确短译，不替未定义的概念赋义。"}
      </p>
      <div className="rules-text">{plan.contentPrompt}</div>
    </details>
  );
}
