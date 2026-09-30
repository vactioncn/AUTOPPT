import { useState } from "react";
import type { ImageReview, ReferenceSpec } from "./types";
import { asset } from "./api";
import { Button, Status } from "./components";

const dimensionLabels: Record<string, string> = {
  layout: "构图与留白",
  typography: "字体与层级",
  color: "色彩",
  graphics: "图形语言",
  density: "信息密度",
  content: "文字与事实",
};
const stageLabels: Record<string, string> = {
  extraction: "提炼",
  planning: "设计方案",
  rendering: "出图",
  uncertain: "暂不能判断",
  none: "未见偏差",
};
export function CalibrationReview({
  review,
  error,
  busy,
  onInspect,
  onSuggestion,
}: {
  review?: ImageReview | null;
  error?: string | null;
  busy?: boolean;
  onInspect?: () => void;
  onSuggestion?: (text: string) => void;
}) {
  return (
    <section className="calibration-review" aria-label="画面偏差检查">
      <div className="studio-section-heading">
        <h2>画面偏差检查</h2>
        <Status>
          {review
            ? review.status === "deviations"
              ? "发现偏差"
              : review.status === "uncertain"
                ? "有待人工核对"
                : "未发现明显偏差"
            : "尚未检查"}
        </Status>
      </div>
      {review ? (
        <>
          <p>{review.summary}</p>
          <p className="studio-caption">
            AI 对照观察，原因仅为判断建议；不代表像素级测量或人工验收。
          </p>
          <div className="calibration-checks">
            {review.checks.map((c) => (
              <details key={c.dimension} open={c.status === "deviation"}>
                <summary>
                  <strong>{dimensionLabels[c.dimension]}</strong>
                  <span>
                    {c.status === "match"
                      ? "基本吻合"
                      : c.status === "deviation"
                        ? "需要调整"
                        : "无法确认"}
                  </span>
                </summary>
                <dl>
                  <div>
                    <dt>参考要求</dt>
                    <dd>{c.expected}</dd>
                  </div>
                  <div>
                    <dt>实际画面</dt>
                    <dd>{c.actual}</dd>
                  </div>
                  <div>
                    <dt>对照依据</dt>
                    <dd>{c.evidence}</dd>
                  </div>
                </dl>
                {c.status !== "match" && (
                  <p>
                    <strong>可能出在：{stageLabels[c.likelyStage]}</strong> ·{" "}
                    {c.suggestion}
                  </p>
                )}
                {onSuggestion && c.status !== "match" && (
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() =>
                      onSuggestion(
                        `${dimensionLabels[c.dimension]}：${c.actual}\n对照参考：${c.expected}\n调整建议：${c.suggestion}`,
                      )
                    }
                  >
                    把这条建议放入反馈
                  </Button>
                )}
              </details>
            ))}
          </div>
        </>
      ) : (
        <p className="studio-caption">
          {error
            ? `图片已保留，检查未完成：${error}`
            : "对照原参考、设计规格和实际图片，检查字重、版面及内容。"}
        </p>
      )}
      {onInspect && (
        <Button disabled={busy} onClick={onInspect}>
          {review ? "重新检查这张图" : "检查这张图"}
        </Button>
      )}
    </section>
  );
}
export function ReferenceSpecView({
  spec,
  reference,
}: {
  spec: ReferenceSpec;
  reference: string;
}) {
  const [selected, setSelected] = useState(spec.regions[0]?.id);
  const region = spec.regions.find((r) => r.id === selected) || spec.regions[0];
  const labels: Record<string, string> = {
    fontFamily: "字体",
    fontWeight: "字重",
    fontSizeRatio: "字高 / 画布高",
    lineHeight: "行距倍数",
    letterSpacingEm: "字距 em",
    strokeWidthRatio: "线宽 / 画布宽",
    color: "颜色",
    fillRatio: "填充占比",
    maxLines: "行数",
  };
  const [sx, sy, sw, sh] = spec.sourceRegion;
  return (
    <div className="reference-spec">
      <p>{spec.sourceDescription}</p>
      <p className="studio-caption">
        坐标与参数来自图片观察，均需视为估计；无法确认的字体或数值保留为“待确认”。
      </p>
      <div className="spec-layout">
        <div className="spec-image">
          <img src={asset(reference)} alt="设计规格的参考依据" />
          {region && (
            <span
              style={{
                left: `${(sx + region.box[0] * sw) * 100}%`,
                top: `${(sy + region.box[1] * sh) * 100}%`,
                width: `${region.box[2] * sw * 100}%`,
                height: `${region.box[3] * sh * 100}%`,
              }}
            />
          )}
        </div>
        <div>
          <div className="spec-regions" aria-label="查看参考图区域">
            {spec.regions.map((r) => (
              <button
                key={r.id}
                aria-pressed={r.id === region?.id}
                onClick={() => setSelected(r.id)}
              >
                {r.label}
              </button>
            ))}
          </div>
          {region && (
            <>
              <p>{region.evidence}</p>
              <p className="studio-caption">
                区域位置 / 大小：
                {region.box.map((v) => `${Math.round(v * 100)}%`).join(" / ")}
              </p>
              <dl className="spec-measurements">
                {Object.entries(region.measurements).map(([k, v]) => (
                  <div key={k}>
                    <dt>{labels[k] || k}</dt>
                    <dd>{v ?? "待确认"}</dd>
                  </div>
                ))}
              </dl>
            </>
          )}
        </div>
      </div>
      <ul>
        {spec.constraints.map((c, i) => (
          <li key={i}>
            <strong>
              {c.locked ? "固定" : "可调整"} · {dimensionLabels[c.dimension]}
            </strong>
            ：{c.rule}
            <span className="spec-evidence">依据：{c.evidence}</span>
          </li>
        ))}
      </ul>
      <p>
        <strong>换内容时：</strong>
        {spec.adaptationRules.join("；")}
      </p>
    </div>
  );
}
