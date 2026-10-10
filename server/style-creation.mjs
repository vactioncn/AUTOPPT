import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const prompt = (name) =>
  readFileSync(new URL(`./prompts/${name}.md`, import.meta.url), "utf8").trim();
export const observationInstructions = prompt("style_observation");
export const creationInstructions = `${prompt("style_prompt_generator")}\n\n${prompt("style_prompt_contract")}`;
export const generationBaselines = prompt("style_generation_baselines");
export const STYLE_SECTIONS = [
  ["role", "一、角色设定"],
  ["identity", "二、风格定义"],
  ["principle", "三、核心设计原则"],
  ["content", "四、内容理解"],
  ["mood", "五、核心视觉气质"],
  ["color", "六、颜色系统"],
  ["typography", "七、字体语言"],
  ["composition", "八、构图与网格"],
  ["imagery", "九、图片与插画语言"],
  ["texture", "十、材质与纹理"],
  ["graphics", "十一、图形与线条"],
  ["data", "十二、数据与信息图"],
  ["details", "十三、微型编辑信息"],
  ["variation", "十四、页面变化与四级规则"],
  ["pageTypes", "十五、页面类型"],
  ["context", "十六、受众与行业语境"],
  ["avoid", "十七、必须避免"],
  ["checks", "十八、生成前自检"],
  ["standard", "十九、最终效果标准"],
];
const text = (value, min = 1, max = 30000) =>
  typeof value === "string" &&
  value.trim().length >= min &&
  value.length <= max;
const texts = (values, min = 0, max = 100) =>
  Array.isArray(values) &&
  values.length >= min &&
  values.length <= max &&
  values.every((v) => text(v));
const profileFields = [
  "name",
  "role",
  "lineage",
  "mood",
  "layout",
  "typography",
  "color",
  "imagery",
  "graphics",
  "texture",
  "density",
  "details",
  "rhythm",
  "useCases",
  "designLogic",
];
const contextKeys = [
  "useCase",
  "industry",
  "audience",
  "topic",
  "strengthen",
  "avoid",
];
export function checkedStyleContext(value = {}) {
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      throw new Error("风格使用信息无法读取。");
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("风格使用信息无效。");
  return Object.fromEntries(
    contextKeys.map((key) => {
      const v = value[key] ?? "";
      if (typeof v !== "string" || v.length > 1000)
        throw new Error("风格使用信息每项最多1000字。");
      return [key, v.trim()];
    }),
  );
}
export function checkedObservations(out, refs) {
  const fail = () => {
    throw new Error("参考图片的逐图分析或共同特征不完整，请重新分析。");
  };
  const refNumbers = (numbers) =>
    Array.isArray(numbers) &&
    numbers.every((n) => Number.isInteger(n) && n >= 1 && n <= refs.length) &&
    new Set(numbers).size === numbers.length;
  if (
    !out ||
    !text(out.summary, 12) ||
    !Array.isArray(out.referenceProfiles) ||
    out.referenceProfiles.length !== refs.length ||
    !Array.isArray(out.sharedTraits) ||
    !out.sharedTraits.length ||
    !texts(out.differences) ||
    !texts(out.uncertainties)
  )
    fail();
  if (
    !["unified", "page-types", "mixed", "outliers", "insufficient"].includes(
      out.relation,
    ) ||
    !text(out.relationReason, 12) ||
    !Array.isArray(out.groups) ||
    !out.groups.length ||
    !refNumbers(out.excludedReferences)
  )
    fail();
  const groups = out.groups.map((group, i) => {
    if (
      !group ||
      !refNumbers(group.references) ||
      !group.references.length ||
      !text(group.rationale, 12)
    )
      fail();
    return {
      id: `style-${i + 1}`,
      references: group.references,
      rationale: group.rationale.trim(),
    };
  });
  const covered = [
    ...groups.flatMap((g) => g.references),
    ...out.excludedReferences,
  ];
  if (
    covered.length !== refs.length ||
    new Set(covered).size !== refs.length ||
    (out.relation === "mixed" ? groups.length < 2 : groups.length !== 1) ||
    (out.relation === "outliers"
      ? !out.excludedReferences.length
      : out.excludedReferences.length > 0)
  )
    fail();
  const referenceProfiles = out.referenceProfiles.map((profile, i) => {
    if (
      !profile ||
      !profileFields.every((key) =>
        text(profile[key], ["name", "role"].includes(key) ? 2 : 12),
      ) ||
      !text(profile.avoid, 12) ||
      !texts(profile.observed, 1) ||
      !texts(profile.inferred)
    )
      fail();
    return {
      ...Object.fromEntries(
        [...profileFields, "avoid"].map((key) => [key, profile[key].trim()]),
      ),
      observed: profile.observed,
      inferred: profile.inferred,
      ref: refs[i],
    };
  });
  const sharedTraits = out.sharedTraits.map((entry) => {
    if (
      !entry ||
      !text(entry.trait, 12) ||
      !refNumbers(entry.references) ||
      !entry.references.length
    )
      fail();
    return { trait: entry.trait.trim(), references: entry.references };
  });
  return {
    summary: out.summary.trim(),
    relation: out.relation,
    relationReason: out.relationReason.trim(),
    groups,
    excludedReferences: out.excludedReferences,
    referenceProfiles,
    sharedTraits,
    differences: out.differences,
    uncertainties: out.uncertainties,
  };
}

// Strip model-authored repeated headings only, never rewrite user-authored rules.
export function sectionBody(value, title) {
  const name = title.replace(/^[一二三四五六七八九十]+、/, "");
  const heading = new RegExp(
    `^\\s*(?:#{1,6}\\s*)?(?:\\*\\*|__)?(?:第?[一二三四五六七八九十百\\d]+(?:[、.．)）:：]|章|节)?\\s*)?${name}(?:\\*\\*|__)?(?:[。:：.．]\\s*|[ \\t]*\\r?\\n+|$)`,
  );
  let body = value.trim();
  for (;;) {
    const next = body.replace(heading, "").trim();
    if (next === body) return body;
    body = next;
  }
}
export function checkedCreation(out) {
  const fail = () => {
    throw new Error(
      "新风格的设计规范不完整，请重新分析；需要完整章节、视觉 DNA、四级规则与锁定语句。",
    );
  };
  if (
    !out ||
    !text(out.nameCn, 2, 60) ||
    !text(out.nameEn, 2, 120) ||
    !text(out.description, 10) ||
    !text(out.boundary, 12) ||
    !text(out.direction, 30) ||
    !texts(out.visualDna, 5, 10) ||
    !texts(out.lockSentences, 3, 5) ||
    !texts(out.risks, 1, 8) ||
    !out.styleModel ||
    !["mustKeep", "flexible", "rare", "forbidden"].every((key) =>
      texts(out.styleModel[key], 1, 12),
    ) ||
    !out.sections ||
    !STYLE_SECTIONS.every(([key]) =>
      text(out.sections[key], key === "role" ? 12 : 40),
    ) ||
    !Array.isArray(out.colors) ||
    out.colors.length < 2 ||
    out.colors.length > 8 ||
    !out.colors.every((c) => typeof c === "string" && /^#[a-f\d]{6}$/i.test(c))
  )
    fail();
  const chapters = STYLE_SECTIONS.map(([key, title]) => {
    const body = sectionBody(out.sections[key], title);
    if (!text(body, key === "role" ? 12 : 40)) fail();
    return `${title}\n\n${body}`;
  }).join("\n\n");
  if (chapters.length < 1800) fail();
  const styleModel = Object.fromEntries(
    ["mustKeep", "flexible", "rare", "forbidden"].map((key) => [
      key,
      out.styleModel[key].map((s) => s.trim()),
    ]),
  );
  const modelText = [
    ["mustKeep", "必须保持"],
    ["flexible", "可以变化"],
    ["rare", "偶尔使用"],
    ["forbidden", "必须禁止"],
  ]
    .map(([key, label]) => `${label}：\n${styleModel[key].join("\n")}`)
    .join("\n\n");
  const rules = `【风格锁定】\n${out.lockSentences.map((s) => s.trim()).join("\n")}\n\n【风格定义】\n${out.nameCn.trim()} / ${out.nameEn.trim()}\n${out.description.trim()}\n${out.boundary.trim()}\n\n【四级风格规则】\n${modelText}\n\n${chapters}\n\n${generationBaselines}`;
  if (rules.length > 30000) fail();
  return {
    nameCn: out.nameCn.trim(),
    nameEn: out.nameEn.trim(),
    description: out.description.trim(),
    boundary: out.boundary.trim(),
    direction: out.direction.trim(),
    visualDna: out.visualDna.map((s) => s.trim()),
    styleModel,
    lockSentences: out.lockSentences.map((s) => s.trim()),
    risks: out.risks.map((s) => s.trim()),
    colors: [...new Set(out.colors)],
    rules,
  };
}
export async function createStyleFromReferences(
  style,
  feedback,
  { callModel, signal, progress = () => {}, context = style.analysisContext },
) {
  const refs = style.refs || [];
  if (!refs.length || refs.length > 12)
    throw new Error("请选择1–12张参考图片，再分析风格。");
  const analysisContext = checkedStyleContext(context);
  signal?.throwIfAborted();
  progress(`第1步：逐图分析 ${refs.length} 张参考图片，判断视觉系统与分组`);
  const observations = checkedObservations(
    await callModel(
      observationInstructions,
      JSON.stringify({
        name: style.name,
        referenceCount: refs.length,
        context: analysisContext,
        feedback,
      }),
      refs,
      signal,
    ),
    refs,
  );
  signal?.throwIfAborted();
  const styles = [];
  // One complete prompt per group keeps long outputs within the model's response budget.
  // Publish only after all groups pass validation; failed/cancelled calls retain the saved style.
  for (const [index, group] of observations.groups.entries()) {
    progress(
      `第2步：生成风格 ${String.fromCharCode(65 + index)} 的完整提示词（${index + 1} / ${observations.groups.length}）`,
    );
    const groupObservations = {
      summary: group.rationale,
      relation: observations.relation,
      referenceProfiles: group.references.map(
        (n) => observations.referenceProfiles[n - 1],
      ),
      sharedTraits: observations.sharedTraits.filter((t) =>
        t.references.every((n) => group.references.includes(n)),
      ),
      uncertainties: observations.uncertainties,
    };
    const created = checkedCreation(
      await callModel(
        creationInstructions,
        JSON.stringify({
          name: style.name,
          previousRules: style.rules || "",
          feedback,
          context: analysisContext,
          group,
          observations: groupObservations,
        }),
        [],
        signal,
      ),
    );
    signal?.throwIfAborted();
    styles.push({ ...group, ...created });
  }
  const selected = styles[0];
  const { referenceProfiles, ...analysis } = observations;
  return {
    ...(style.autoName ? { name: selected.nameCn } : {}),
    description: selected.description,
    rules: selected.rules,
    colors: selected.colors,
    referenceProfiles,
    imageRecipes: [],
    analysisContext,
    styleAnalysis: {
      version: 2,
      id: randomUUID(),
      ...analysis,
      styles,
      direction: selected.direction,
    },
  };
}
