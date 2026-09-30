import type { Style, DesignLanguage } from "./types";
const labels: Record<keyof DesignLanguage, string> = {
  identity: "风格特征",
  typography: "字体与文字层级",
  colorSystem: "色彩组合",
  compositionPrinciples: "构图与留白原则",
  graphicLanguage: "图形画法",
  detailLanguage: "细节与辅助标记",
  adaptationRules: "如何延伸到不同内容",
  avoid: "避免的做法",
};
export function StyleLanguage({ style }: { style: Style }) {
  if (!style.designLanguage) return null;
  return (
    <details className="studio-rules studio-rule-details">
      <summary>查看用于创作的风格规范</summary>
      <p className="detail-help">同一套视觉规则，随内容形成不同的表现。</p>
      {(Object.keys(labels) as (keyof DesignLanguage)[]).map((key) => (
        <div key={key}>
          <h4>{labels[key]}</h4>
          <p>{style.designLanguage![key]}</p>
        </div>
      ))}
    </details>
  );
}
