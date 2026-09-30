import type { Plan } from "./types";
import { asset } from "./api";

export function DesignEvidence({ plan }: { plan: Plan }) {
  if (!plan.referenceId) return null;
  return (
    <div className="design-evidence">
      <h4>参考图与设计依据</h4>
      <a href={asset(plan.referenceId)} target="_blank" rel="noreferrer">
        <img src={asset(plan.referenceId)} alt="本页主要参考图" />
      </a>
      <p>{plan.referenceReason}</p>
      <ul>
        {plan.styleFeatures?.map((feature, i) => (
          <li key={i}>{feature}</li>
        ))}
      </ul>
      {plan.adaptations && (
        <>
          <h4>为这段讲稿作的调整</h4>
          <p>{plan.adaptations}</p>
        </>
      )}
    </div>
  );
}
