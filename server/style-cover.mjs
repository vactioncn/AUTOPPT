import { STYLE_COVER, STYLE_COVER_NOTES } from "../shared/style-demo.mjs";
import { styleStamp } from "./core.mjs";
import { DIRECT_PROMPT_MODE } from "./direct-image.mjs";
import { PLANNING_VERSION } from "./content-planning.mjs";
import { imageContentPrompt } from "./image-content.mjs";
import {
  COPY_VERSION,
  screenCopyKey,
  validateScreenCopy,
  copyProfile,
  copyMetrics,
} from "./screen-copy.mjs";

export function unifiedCoverPlan(style) {
  const entries = [STYLE_COVER.title, STYLE_COVER.subtitle].map((text, i) => ({
    text,
    sourceQuote: text,
    role: i ? "support" : "main",
  }));
  const profile = copyProfile({ relationship: "statement" });
  const metrics = copyMetrics(entries, STYLE_COVER_NOTES, profile);
  const screenCopy = {
    ...validateScreenCopy(
      {
        editScope: "composition",
        entries,
        mustKeep: entries.map(({ text }) => ({ text, sourceQuote: text })),
        spokenOnly: [],
        semanticSupport: [],
        rationale: "统一封面固定文案，仅用所选风格表现。",
      },
      { notes: STYLE_COVER_NOTES },
    ),
    version: COPY_VERSION,
    sourceKey: screenCopyKey(STYLE_COVER_NOTES),
    profile,
    metrics,
    displayText: entries.map((e) => e.text),
    review: {
      status: "reviewed",
      draftCharacters: metrics.characters,
      reason: "固定封面示例，原文直接上屏，未调用内容模型改写。",
      changes: [],
      splitSuggestion: "",
    },
  };
  return {
    engine: "image",
    purpose: "cover",
    promptMode: DIRECT_PROMPT_MODE,
    planningVersion: PLANNING_VERSION,
    sourceStyle: styleStamp(style),
    styleRules: style.rules,
    designOptions: { audience: null, palette: null },
    recipeName: style.name,
    attachments: [],
    screenCopy,
    contentPrompt: imageContentPrompt(screenCopy),
    displayText: screenCopy.displayText,
    title: STYLE_COVER.title,
    rationale: screenCopy.rationale,
    layout: "按风格原文自由设计封面，不固定构图。",
    visual: "仅以所选风格表现统一文案。",
    editScope: "composition",
    imageFeedback:
      "只生成一张完整封面。主标题与副标题使用给定原文，不增加其他文案。图像、材质、配色、版式遵循风格原文自由设计。",
  };
}
