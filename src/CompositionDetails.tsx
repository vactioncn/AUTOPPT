import type { Plan } from "./types";

export function CompositionDetails({ plan }: { plan: Plan }) {
  const composition = plan.compositionPlan;
  if (!composition) return null;
  const labels = {
    layout: "排版",
    whitespace: "留白",
    hierarchy: "视觉层次",
    color: "色彩搭配",
    originality: "原创性",
  };
  return (
    <details className="copy-review">
      <summary>本页构图与五维构思自检</summary>
      <p className="detail-help">
        出图前的构思，已包含在完整出图提示词中；不是对实际成图的验收。
      </p>
      <p>{composition.reason}</p>
      <div className="rules-text">{composition.direction}</div>
      <details>
        <summary>比较过的表达方向</summary>
        {composition.alternatives.map((item, i) => (
          <p key={i}>
            <strong>{item.concept}</strong>
            <br />
            {item.reason}
          </p>
        ))}
      </details>
      {Object.entries(labels).map(([key, label]) => (
        <p key={key}>
          <strong>{label}：</strong>
          {composition.review[key as keyof typeof labels]}
        </p>
      ))}
      {!!composition.recent.length && (
        <p className="detail-help">
          构思时参考了附近 {composition.recent.length}{" "}
          页的构图描述以减少重复；未对这些成图自动判重。
        </p>
      )}
    </details>
  );
}
