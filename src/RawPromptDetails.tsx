import {
  pageNumberTemplate,
  PAGE_NUMBER_TOKEN,
} from "../shared/page-number.mjs";
import type { Plan } from "./types";
import { ContentPromptDetails } from "./ContentPromptDetails";
import { CompositionDetails } from "./CompositionDetails";

export function RawPromptDetails({
  plan,
  currentPageNumber,
}: {
  plan: Plan;
  currentPageNumber?: number;
}) {
  if (!plan.promptMode?.startsWith("verbatim-style-")) return null;
  const numbered = pageNumberTemplate(plan.styleRules).includes(
    PAGE_NUMBER_TOKEN,
  );
  return (
    <>
      <p className="detail-help">
        {plan.purpose === "cover"
          ? "统一封面固定文案直接上屏。"
          : plan.copyReused
            ? "本次复用已提炼的上屏文案。"
            : "上屏文案已单独提炼并复核。"}
        {plan.compositionPlan
          ? "这是旧版按内容构思生成的记录；再次生成将直接使用风格原文。"
          : "风格提示词按原文使用，构图由图片模型完成。"}
      </p>
      {numbered && plan.pageNumber && (
        <p className="detail-help">
          本次传入的页码：{String(plan.pageNumber).padStart(2, "0")}
          。仅替换原有页码描述，其余风格原文保持不变。
          {currentPageNumber && currentPageNumber !== plan.pageNumber
            ? ` 当前已是第 ${currentPageNumber} 页，旧图页码不会自动更新，需重新生成此页。`
            : ""}
        </p>
      )}
      {!numbered && plan.pageNumber && (
        <p className="detail-help">
          当前风格没有明确的动态页码位置，本次未自动添加页码。
        </p>
      )}
      <details className="copy-review">
        <summary>本次风格提示词原文</summary>
        <div className="rules-text">{plan.styleRules}</div>
      </details>
      {plan.designOptions?.audience && (
        <details className="copy-review">
          <summary>本次内容倾向</summary>
          <div className="rules-text">
            {plan.designOptions.audience.description}
            {"\n\n"}
            {plan.designOptions.audience.brief}
          </div>
        </details>
      )}
      {plan.designOptions?.palette && (
        <details className="copy-review">
          <summary>本次独立配色 · {plan.designOptions.palette.name}</summary>
          <div className="rules-text">
            {plan.designOptions.palette.instructions}
          </div>
        </details>
      )}
      <ContentPromptDetails plan={plan} />
      <CompositionDetails plan={plan} />
      {plan.imageRequest?.prompt && (
        <details className="copy-review">
          <summary>实际发送的出图提示词</summary>
          <p className="detail-help">
            请求模型：{plan.imageRequest.model}
            {plan.imageRequest.providerOrigin &&
              ` · 图片服务：${plan.imageRequest.providerOrigin}`}
            {plan.imageRequest.size && ` · 请求尺寸：${plan.imageRequest.size}`}
            {plan.imageRequest.quality &&
              ` · 请求质量：${plan.imageRequest.quality}`}
          </p>
          {plan.imageResponse && (
            <p className="detail-help">
              实际图片：{plan.imageResponse.width}×{plan.imageResponse.height}
              {plan.imageResponse.reportedSize &&
                ` · 服务声明尺寸：${plan.imageResponse.reportedSize}`}
              {plan.imageResponse.reportedQuality &&
                ` · 服务声明质量：${plan.imageResponse.reportedQuality}`}
              {plan.imageResponse.reportedModel
                ? ` · 服务声明模型：${plan.imageResponse.reportedModel}`
                : " · 服务未返回模型标识"}
            </p>
          )}
          <div className="rules-text">{plan.imageRequest.prompt}</div>
          {plan.imageResponse?.revisedPrompt && (
            <>
              <p className="detail-help">图片服务返回的改写提示词</p>
              <div className="rules-text">
                {plan.imageResponse.revisedPrompt}
              </div>
            </>
          )}
        </details>
      )}
    </>
  );
}
