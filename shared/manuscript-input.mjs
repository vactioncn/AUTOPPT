// Limit each new submission, without truncating drafts or changing old batches.
export const MANUSCRIPT_SUBMISSION_LIMIT = 5000;
export const manuscriptLength = (text) => Array.from(text).length;
export const manuscriptLimitError = (text) => {
  const excess = manuscriptLength(text) - MANUSCRIPT_SUBMISSION_LIMIT;
  return excess > 0
    ? `测试版每次最多提交 5,000 字，当前超出 ${excess.toLocaleString("zh-CN")} 字。全文已保留在输入框，请分段提交。`
    : "";
};
