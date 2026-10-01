import type { Plan } from "./types";

export function CopyReview({
  copy,
  stale = false,
}: {
  copy?: Plan["screenCopy"];
  stale?: boolean;
}) {
  if (!copy) return null;
  const { metrics, review } = copy;
  return (
    <details className="copy-review">
      <summary>文字取舍与密度 · 上屏 {metrics.characters} 字</summary>
      <p>
        方案生成时的讲稿 {metrics.sourceCharacters} 字，上屏{" "}
        {metrics.characters} 字，分为 {metrics.groups} 组文字。
        {review.draftCharacters > metrics.characters &&
          ` 复核前为 ${review.draftCharacters} 字。`}
      </p>
      {stale && (
        <p className="small-notice">
          讲稿已修改，以上统计对应旧方案；重新设计后更新。
        </p>
      )}
      {copy.editScope === "details" && (
        <p>本次保留了已认可的主文案，仅复核新增注释。</p>
      )}
      <p>{review.reason}</p>
      {!!metrics.warnings.length && (
        <p>密度提醒：{metrics.warnings.join("、")}。请结合成图检查可读性。</p>
      )}
      {!!review.changes.length && (
        <>
          <h4>本次精简</h4>
          {review.changes.map((change, i) => (
            <p key={i}>{change}</p>
          ))}
        </>
      )}
      {!!copy.mustKeep.length && (
        <>
          <h4>保留的关键信息</h4>
          <p>{copy.mustKeep.map((item) => item.text).join(" · ")}</p>
        </>
      )}
      {!!copy.spokenOnly.length && (
        <>
          <h4>留给口播的展开</h4>
          {copy.spokenOnly.map((item, i) => (
            <p key={i}>
              “{item.sourceQuote}”<br />
              {item.reason}
            </p>
          ))}
        </>
      )}
      {!!review.splitSuggestion && (
        <p className="small-notice">
          拆页建议：{review.splitSuggestion}
          。可在逐字稿中手动拆分，页数不会自动改变。
        </p>
      )}
      <p className="muted">
        统计含标点、不计空白，不含附件图片内的文字。复核评估文案的阅读负担，不代表成图面积或阅读时间测量。
      </p>
    </details>
  );
}
