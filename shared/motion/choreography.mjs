// Expression is independent of visual style. Only animate existing layers;
// never manufacture chart values, evidence, or a layout from a preset.
export const CHOREOGRAPHIES = [
  {
    id: "custom",
    name: "原有编排",
    description: "保留每个图层设置的出场方式与顺序。",
    references: [],
  },
  {
    id: "story",
    name: "叙事镜头",
    description: "底图轻轻落定，文字按讲述步骤逐组出现。适合图文故事。",
    references: ["M06", "M07"],
  },
  {
    id: "focus",
    name: "金句聚焦",
    description: "大字由虚到实，解释稍后跟进，把注意力留给重点。",
    references: ["M03", "M04"],
  },
  {
    id: "chapter",
    name: "章节开场",
    description: "标题舒展落位，副标题与细节依次跟进。",
    references: ["M01", "M02"],
  },
  {
    id: "editorial",
    name: "阅读节奏",
    description: "文字轻移入场，同一步的内容错落衔接，适合安静的长文。",
    references: ["M06", "M09"],
  },
  {
    id: "contrast",
    name: "两侧对话",
    description: "按画面左右位置相向入场，保留已有的对比关系。",
    references: ["M14", "M15"],
  },
  {
    id: "progression",
    name: "层层推进",
    description: "按已有讲述步骤蓄势、上移、落定，适合层级与递进观点。",
    references: ["M05", "M09", "M13"],
  },
];
export function choreography(value = "custom") {
  if (!CHOREOGRAPHIES.some((p) => p.id === value))
    throw new Error("请选择支持的页面动效编排");
  return value;
}

// Serializable: the offline player embeds this exact planner, also covered by tests.
export function planEntrance(
  page,
  layer,
  index,
  incremental = false,
  reduced = false,
) {
  const style = page.choreography || "custom";
  const steps = [...new Set(page.layers.map((l) => l.step))].sort(
    (a, b) => a - b,
  );
  const group = steps.indexOf(layer.step);
  const siblings = page.layers.filter((l) => l.step === layer.step);
  const rank = siblings.findIndex((l) => l.id === layer.id);
  const hero =
    layer.type === "text" &&
    layer.fontSize === Math.max(...page.layers.map((l) => l.fontSize || 0));
  let from = { opacity: 0, transform: "translateY(18px)" },
    duration = 680;
  if (style === "story") {
    from = { opacity: 0, transform: "translateY(28px) scale(.985)" };
    duration = 880;
  }
  if (style === "focus") {
    from = {
      opacity: 0,
      transform: hero ? "scale(.96)" : "translateY(10px)",
      filter: "blur(3px)",
    };
    duration = hero ? 850 : 650;
  }
  if (style === "chapter") {
    from = {
      opacity: 0,
      transform: hero ? "scale(1.06) translateY(10px)" : "translateX(-22px)",
    };
    duration = hero ? 950 : 700;
  }
  if (style === "editorial") {
    from = { opacity: 0, transform: "translateX(16px)" };
    duration = 700;
  }
  if (style === "contrast") {
    from = {
      opacity: 0,
      transform: `translateX(${layer.x + layer.w / 2 < page.width / 2 ? -46 : 46}px)`,
    };
    duration = 820;
  }
  if (style === "progression") {
    from = {
      opacity: 0,
      transform: `translateY(${28 + Math.min(group, 3) * 10}px)`,
    };
    duration = 760;
  }
  const delay = Math.min(
    1400,
    (incremental ? 0 : group * (style === "story" ? 480 : 320)) +
      rank * 95 +
      (style === "focus" && !hero ? 220 : 0),
  );
  return {
    frames: reduced
      ? [{ opacity: 0 }, { opacity: 1 }]
      : [
          from,
          {
            opacity: 1,
            transform: "none",
            ...(from.filter ? { filter: "blur(0px)" } : {}),
          },
        ],
    duration: reduced ? 120 : duration,
    delay: reduced ? 0 : delay,
    easing: "cubic-bezier(.16,1,.3,1)",
  };
}
