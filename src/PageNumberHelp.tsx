import {
  pageNumberTemplate,
  PAGE_NUMBER_TOKEN,
} from "../shared/page-number.mjs";

export function PageNumberHelp({ rules }: { rules: string }) {
  const supported = pageNumberTemplate(rules).includes(PAGE_NUMBER_TOKEN);
  return (
    <p className="detail-help">
      {supported
        ? "动态页码：只在原有页码描述处填入整份演讲的实际页序，字体、位置与装饰沿用当前风格。单页试做及统一封面使用 01。"
        : "未识别到明确的动态页码位置，出图时不自动添加。若需要，可在原有页码描述处填写“微型页码，显示为 {{page_number}}”；章节、照片或流程编号不会替换。"}
      {supported &&
        " 插页、删页或调整顺序后，旧图片里的页码不会自动改变，需要重新生成受影响页面。"}
    </p>
  );
}
