import type { Plan } from "./types";
import { ContentPromptDetails } from "./ContentPromptDetails";

export function RawPromptDetails({ plan }: { plan: Plan }) {
  if (!plan.promptMode?.startsWith("verbatim-style-")) return null;
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
      <ContentPromptDetails plan={plan} />
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
