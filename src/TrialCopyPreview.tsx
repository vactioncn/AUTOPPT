import { useState } from "react";
import { Copy } from "@phosphor-icons/react";
import type { Trial } from "./types";
import { Button } from "./components";
import { ContentPromptDetails } from "./ContentPromptDetails";
import { CompositionDetails } from "./CompositionDetails";

export function TrialCopyPreview({
  trial,
  notes,
  rules,
  notify,
}: {
  trial?: Trial;
  notes: string;
  rules: string;
  notify: (message: string) => void;
}) {
  const [manualCopy, setManualCopy] = useState("");
  const plan = trial?.plan;
  const text = plan?.displayText?.join("\n\n") || "";
  const prompt = plan?.imageRequest?.prompt;
  // Copy saved inputs for this result, never reconstruct them from edited drafts.
  const styleRules = plan?.styleRules;
  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setManualCopy("");
      notify(`已复制${label}`);
    } catch {
      setManualCopy(value);
    }
  };
  return (
    <section className="trial-copy-preview" aria-label="本次提炼的上屏内容">
      <h3>本次提炼的上屏内容</h3>
      {text ? (
        <>
          <p className="detail-help">
            当前选中试做的出图文案，共 {plan!.displayText.length} 条。
            {plan?.screenCopy ? "已单独提炼并复核。" : "来自历史方案。"}
          </p>
          {trial!.notes !== notes && (
            <p className="small-notice">
              讲稿已修改，下方仍是上一次试做的文案；再次生成后更新。
            </p>
          )}
          {trial!.styleSnapshot.rules !== rules && (
            <p className="small-notice">
              风格提示词已修改，复制的仍是本次试做实际使用的版本。
            </p>
          )}
          <textarea aria-label="本次上屏文案" value={text} readOnly rows={5} />
          <ContentPromptDetails plan={plan!} />
          <CompositionDetails plan={plan!} />
          <div className="web-studio-actions">
            <Button onClick={() => copy(text, "上屏文案")}>
              <Copy size={16} />
              复制上屏文案
            </Button>
            <Button
              disabled={!plan?.contentPrompt}
              onClick={() =>
                copy(plan!.contentPrompt!, "内容部分（含辅助信息）")
              }
            >
              复制内容部分（含辅助信息）
            </Button>
            <Button
              disabled={!styleRules}
              onClick={() => copy(styleRules!, "本次风格提示词")}
            >
              复制本次风格提示词
            </Button>
            <Button
              disabled={!prompt}
              onClick={() => copy(prompt!, "完整出图提示词")}
            >
              复制完整出图提示词
            </Button>
          </div>
          <p className="detail-help">
            对照测试时，可将完整出图提示词直接粘贴到 ChatGPT；
            {plan?.compositionPlan
              ? "本次开启了按内容构思，对照时请复制完整提示词，以包含本页构图方案。"
              : "分开复制时，使用“本次风格提示词”和“内容部分（含辅助信息）”。"}
            内容部分包含主文案、可选辅助资料和语义边界。只复制主文案会遗漏这些依据。
            {!plan?.contentPrompt && "此历史记录未保存独立的内容部分。"}
            {!prompt && "本次尚无已保存的出图请求，完整提示词暂不可复制。"}
          </p>
        </>
      ) : (
        <p className="detail-help">
          {trial && ["queued", "running"].includes(trial.status)
            ? "正在提炼上屏文案，完成后会显示在这里。"
            : trial
              ? "这条记录没有保存上屏文案。再次生成试做后可在这里查看和复制。"
              : "生成试做后，这里会显示从讲稿中提炼的上屏文案，并可复制用于对照。"}
        </p>
      )}
      {manualCopy && (
        <div>
          <p role="alert">
            浏览器未允许复制。点击下方文字全选，再按 ⌘C 或 Ctrl+C。
          </p>
          <textarea
            aria-label="待手动复制的内容"
            value={manualCopy}
            readOnly
            onFocus={(event) => event.target.select()}
          />
        </div>
      )}
    </section>
  );
}
