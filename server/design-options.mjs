import { AUDIENCE_BRIEF_PROMPT } from "./audience-brief.mjs";
// Project/trial choices are independent of the shared visual style.
const text = (value, label, max, required = false) => {
  if (
    typeof value !== "string" ||
    value.length > max ||
    (required && !value.trim())
  )
    throw new Error(`${label}需要填写有效文字，最多 ${max} 字。`);
  return value;
};
export function designOptions(value) {
  if (value == null) return { audience: null, palette: null };
  if (typeof value !== "object" || Array.isArray(value))
    throw new Error("内容倾向与配色设置无效。");
  const audience =
    value.audience == null
      ? null
      : {
          description: text(value.audience.description, "受众简述", 2000, true),
          brief: text(value.audience.brief ?? "", "内容倾向", 10000),
        };
  const palette =
    value.palette == null
      ? null
      : {
          name: text(value.palette.name, "配色名称", 100, true),
          instructions: text(
            value.palette.instructions,
            "配色说明",
            4000,
            true,
          ),
          colors: value.palette.colors ?? [],
        };
  if (
    palette &&
    (!Array.isArray(palette.colors) ||
      palette.colors.length > 12 ||
      palette.colors.some(
        (c) => typeof c !== "string" || !/^#[\da-f]{6}$/i.test(c),
      ))
  )
    throw new Error("配色色值须为 #RRGGBB 格式，最多 12 个。");
  return { audience, palette };
}
export const designOptionsKey = (value) => JSON.stringify(designOptions(value));

export function audiencePrompt(value) {
  const { audience } = designOptions(value);
  if (!audience) return "";
  return `\n\n【内容倾向｜受众与行业语境】
受众简述：${audience.description}
${audience.brief}
以上仅帮助理解受众、选择适切的场景与视觉隐喻，不是本页事实或新增上屏文案来源。内容适合时优先使用相关语境，不生硬地在每页加入行业符号；抽象、数据或文字表达适合时保持原表达。
忠实已确认的上屏文案，保留原意、限定条件及表达程度，不添加原文没有的定义、判断、结论、因果、数字或倾向。必要的辅助联想只能少量、微弱、中性，不引导观众读出原文未表达的意思。语境中的例子不是待加入的案例或事实，不能改写真实附件。`;
}
export function palettePrompt(value) {
  const { palette } = designOptions(value);
  if (!palette) return "";
  return `\n\n【独立配色方案｜${palette.name}】
${palette.instructions}
${palette.colors.length ? `色板：${palette.colors.join("、")}。` : ""}
先判断原风格是否有明确配色：有则以本方案替换其颜色要求；没有则直接采用本方案，不臆造旧配色。本方案仅替换风格原文中冲突的颜色要求，其余字体、材质、光影、视觉层次与设计语言仍按原风格执行。色彩角色按本方案分配，保证文字与背景可读；配色名称和说明不是上屏文案。不因换色改变已确认文案、数据、含义及表达程度。不改动内容附件中承载事实的颜色编码、图例、品牌或产品本色；通过周围排版与背景协调。`;
}

export async function expandAudience(description, model, signal) {
  text(description, "受众简述", 2000, true);
  const out = await model(
    AUDIENCE_BRIEF_PROMPT,
    JSON.stringify({ description }),
    [],
    signal,
  );
  return {
    description,
    brief: text(out?.brief, "生成的内容倾向", 10000, true),
  };
}

export async function extractPalette(rules, model, signal) {
  text(rules, "风格提示词", 30000, true);
  const out = await model(
    `你是风格配色提取器。仅提取输入风格中明确的颜色和颜色角色，不改写完整风格，不推测未指定颜色。返回 {palette:null,evidence:[]} 表示无明确配色；否则返回 {palette:{name:"简短名称",instructions:"仅配色说明",colors:["#RRGGBB"]},evidence:["原文逐字引用"]}。
保留原文的可选关系：例如黑底或白底皆可，不能变成固定黑底。保留背景、文字、强调色的对应关系与色彩使用程度。不把材质、构图、字体或业务语境写入配色说明。只在原文有明确十六进制色值时填入colors，不替颜色词猜色值。每个颜色结论必须来自evidence；原文无配色时不得编造。`,
    JSON.stringify({ rules }),
    [],
    signal,
  );
  if (out?.palette === null) return { palette: null, evidence: [] };
  const { palette } = designOptions({ palette: out?.palette });
  if (
    !palette ||
    !Array.isArray(out.evidence) ||
    !out.evidence.length ||
    out.evidence.length > 20 ||
    out.evidence.some(
      (e) => typeof e !== "string" || !e.trim() || !rules.includes(e),
    ) ||
    palette.colors.some((c) => !rules.toLowerCase().includes(c.toLowerCase()))
  )
    throw new Error("配色提取缺少风格原文依据，请重试或手动填写。");
  return { palette, evidence: out.evidence };
}
