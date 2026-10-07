import { useMemo, useState } from "react";
import { Button } from "./components";
import type { Bootstrap } from "./types";
import type { Capabilities } from "../shared/diagnostics.mjs";
import { runtimeLabels } from "../shared/diagnostics.mjs";
import {
  createOnboardingPreferences,
  onboardingReadiness,
  safeWorkspaceLabel,
  type OnboardingState,
} from "./onboarding";

export function useOnboarding(scope: string) {
  const prefs = useMemo(() => createOnboardingPreferences(scope), [scope]);
  const [snapshot, setSnapshot] = useState({ prefs, value: prefs.read() });
  const value = snapshot.prefs === prefs ? snapshot.value : prefs.read();
  const update = (change: Partial<OnboardingState>) => {
    setSnapshot({ prefs, value: prefs.update(change) });
  };
  return { value, update };
}

export function WorkspaceReadiness({
  data,
  capabilities,
  onStart,
  onSettings,
  onStyles,
  onSkip,
}: {
  data: Bootstrap;
  capabilities: Capabilities;
  onStart: () => void;
  onSettings: () => void;
  onStyles: () => void;
  onSkip: () => void;
}) {
  const state = onboardingReadiness(data, capabilities);
  return (
    <section className="onboarding-card" aria-label="首次工作区准备">
      <div className="onboarding-heading">
        <div>
          <span className="eyebrow">第一次使用</span>
          <h2>先确认工作区，再开始一小段</h2>
        </div>
        <Button variant="ghost" onClick={onSkip}>
          跳过准备
        </Button>
      </div>
      <p>
        {runtimeLabels[data.buildInfo?.runtimeMode || "local-browser"]} ·{" "}
        {safeWorkspaceLabel(data.dataRootLabel)}
      </p>
      <ul className="onboarding-readiness">
        <li>内容模型：{state.textReady ? "已就绪" : "未就绪"}</li>
        <li>图片模型：{state.imageReady ? "已就绪" : "未就绪"}</li>
        <li>
          视觉风格：
          {state.styleReady
            ? "已有可用风格，推荐直接从默认风格开始"
            : "暂无可用风格"}
        </li>
      </ul>
      {state.managed && (
        <p>
          {capabilities.localModelSettings.reason || "模型由管理员统一管理。"}
          {!state.modelsReady && " 请联系管理员准备模型。"}
        </p>
      )}
      {!state.modelsReady && <p>可以先写草稿并保存，生成前才需要模型。</p>}
      {!state.styleReady && (
        <p>先在风格库填写风格提示词并保存，再回来创建演讲；无需先调用模型。</p>
      )}
      <div className="onboarding-actions">
        {state.styleReady ? (
          <Button variant="primary" onClick={onStart}>
            {state.ready ? "开始第一个演讲" : "先写草稿"}
          </Button>
        ) : (
          <Button variant="primary" onClick={onStyles}>
            前往风格库创建
          </Button>
        )}
        {!state.modelsReady && (
          <Button onClick={onSettings}>
            {state.managed ? "查看模型服务状态" : "连接并测试模型"}
          </Button>
        )}
      </div>
    </section>
  );
}

export function PageConcepts({ onDismiss }: { onDismiss: () => void }) {
  return (
    <section className="page-concepts" aria-label="页面三点提示">
      <ol>
        <li>
          <strong>逐字稿</strong>：演讲者说的完整内容。
        </li>
        <li>
          <strong>上屏文案</strong>：观众看到的重点。
        </li>
        <li>
          <strong>重新设计</strong>：可能再次调用模型并产生费用。
        </li>
      </ol>
      <Button variant="ghost" onClick={onDismiss}>
        知道了，关闭提示
      </Button>
    </section>
  );
}
