import type { Style, ReferenceProfile } from "./types";
import "./StyleAnalysis.css";

const dimensions: [keyof ReferenceProfile, string][] = [
  ["role", "原图表达"],
  ["layout", "构图与阅读路径"],
  ["typography", "字体与层级"],
  ["color", "色彩与比例"],
  ["imagery", "图像处理"],
  ["graphics", "图形与线条"],
  ["texture", "材质与光影"],
  ["density", "疏密与留白"],
  ["details", "微观细节"],
  ["avoid", "偏离方向"],
];

export function StyleAnalysis({ style }: { style: Style }) {
  const analysis = style.styleAnalysis;
  if (!analysis) return null;
  return (
    <details className="studio-rules studio-rule-details style-analysis">
      <summary>查看参考图分析与创作依据</summary>
      <p className="detail-help">
        记录最近一次提炼时的观察与设计取舍；手动调整或恢复版本后，出图以当前提示词为准。
      </p>
      <p>{analysis.summary}</p>
      <h4>共同视觉特征</h4>
      {analysis.sharedTraits.map((entry, i) => (
        <p key={i}>
          {entry.trait}（参考图 {entry.references.join("、")}）
        </p>
      ))}
      {analysis.differences.length > 0 && <h4>参考图之间的差异</h4>}
      {analysis.differences.map((item, i) => (
        <p key={i}>{item}</p>
      ))}
      {analysis.uncertainties.length > 0 && <h4>尚不能确认的细节</h4>}
      {analysis.uncertainties.map((item, i) => (
        <p key={i}>{item}</p>
      ))}
      <h4>新风格的设计取舍</h4>
      <p>{analysis.direction}</p>
      {style.referenceProfiles?.map((profile, i) => (
        <details className="studio-rule-details" key={profile.ref}>
          <summary>
            参考图 {i + 1} · {profile.name || "视觉观察"}
          </summary>
          {dimensions.map(
            ([key, label]) =>
              typeof profile[key] === "string" && (
                <div key={key}>
                  <h4>{label}</h4>
                  <p>{String(profile[key])}</p>
                </div>
              ),
          )}
        </details>
      ))}
    </details>
  );
}
