import {
  STYLE_SAMPLE_PAGES,
  STYLE_SAMPLE_VERSION,
  sampleSource,
} from "../shared/style-sample-suite.mjs";
import { unifiedCoverPlan } from "./style-cover.mjs";
import { imageContentPrompt } from "./image-content.mjs";
import {
  COPY_VERSION,
  screenCopyKey,
  validateScreenCopy,
  copyProfile,
  copyMetrics,
} from "./screen-copy.mjs";

export function standardSamplePlan(style, pageId) {
  const page = STYLE_SAMPLE_PAGES.find((p) => p.id === pageId);
  if (!page) throw new Error("标准样例页不存在。");
  const source = sampleSource(page);
  const entries = page.displayText.map((text, i) => ({
    text,
    sourceQuote: text,
    role:
      i === 0
        ? "main"
        : /非效率统计|非真实客户/.test(text)
          ? "qualifier"
          : "support",
  }));
  const profile = copyProfile({ relationship: page.relationship });
  const metrics = copyMetrics(entries, source, profile);
  const copy = {
    ...validateScreenCopy(
      {
        editScope: "composition",
        entries,
        mustKeep: entries.map(({ text }) => ({ text, sourceQuote: text })),
        spokenOnly: [],
        semanticSupport: [],
        rationale: "统一八页产品介绍，锁定内容与语义关系，仅比较视觉风格。",
      },
      { notes: source },
    ),
    version: COPY_VERSION,
    sourceKey: screenCopyKey(source),
    profile,
    metrics,
    displayText: page.displayText,
    review: {
      status: "reviewed",
      draftCharacters: metrics.characters,
      reason: "已编写并核对的标准样例文案，不调用内容模型改写。",
      changes: [],
      splitSuggestion: "",
    },
  };
  return {
    ...unifiedCoverPlan(style),
    purpose: "standard-sample",
    samplePageId: page.id,
    sampleVersion: STYLE_SAMPLE_VERSION,
    pageNumber: Number(page.number),
    screenCopy: copy,
    contentPrompt: imageContentPrompt(copy),
    displayText: page.displayText,
    title: page.title,
    rationale: copy.rationale,
    layout: "由本页内容关系决定结构，依据风格原文自由设计。",
    visual: page.visualBrief,
    imageFeedback: `本页是统一产品介绍的第${page.number}页，类型为${page.type}。${page.visualBrief}\n只生成一张完整横向演讲页面。逐项保留所有给定上屏文案，包括最后的结论与限定；不把讲稿全文放上画面。不把页型名称、测试说明或设计要求印在画面上。各页内容不同，构图应相应变化；沿用风格视觉语言，不重复同一布局。讲好面向一般演讲场景，不能沿用风格例句里的行业定位：不要增加“FOR CHILD PHOTOGRAPHY”“CHILDREN PHOTOGRAPHY”等不属于本页的文字。可以不显示页码；若显示，本页只能为${page.number}，总页数为08，不混淆页码与数据。\n\n【最终成品逐字核对｜优先于风格描述中的一切示例文案】\n下面 ${page.displayText.length} 组文字就是本页唯一确定的内容，全部必须可读地出现在画面中。只允许换行与排版，不允许改写、替换、遗漏或增加中文段落。不要出现“好的影像会继续生长”等风格示例中的旧文案。\n${page.displayText.map((text, index) => `${index + 1}. ${JSON.stringify(text)}`).join("\n")}\n逐项确认全部出现后再完成图片；清单编号和本条检查要求不上屏。`,
  };
}
