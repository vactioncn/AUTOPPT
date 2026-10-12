// Runtime context is request metadata, never a replacement for source dates.
export const DATE_BOUNDARY = `年份与日期属于内容事实，不是默认装饰。原稿、已复核上屏文案和内容附件中的事件年份、统计范围、图表时间轴及界面日期必须忠实保留，不得用当前年份替换。
风格样例、参考图、素材边缘的装饰年份、版权年份或 PORTFOLIO 年份不是本页事实；不要把它们沿用或重复到新页面的页眉、页脚、标签或新绘制的界面。素材本身承载真实信息的日期仍保留，不能借此篡改截图或图表。
没有本页内容依据或用户明确要求时，省略新增年份与日期；不要从上传文件名、截图文件名、模型常识或训练记忆推测日期。本次运行日期只是理解时间的上下文，不自动写入画面、讲稿或风格规则。
仅当用户明确要求使用今天、本年或当前年份时，按本次运行日期理解；原稿中的“今年”“当时”等相对时间遵循原稿的事件语境，不擅自改成生成时的年份。`;

export function dateContextPrompt(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type) => parts.find((part) => part.type === type).value;
  const date = `${value("year")}-${value("month")}-${value("day")}`;
  return `【日期与年份依据｜仅供理解，不作为上屏或口播文案】\n本次运行日期（Asia/Shanghai）：${date}\n${DATE_BOUNDARY}`;
}
