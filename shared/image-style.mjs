// These are saved visual observations, not generic layout templates or image inputs.
export function styleRecipes(style) {
  const observed = (style.referenceProfiles || []).map((p, i) => ({
    id: `reference-${i + 1}`,
    name:
      p.name ||
      p.role?.split(/[。；：]/)[0]?.slice(0, 24) ||
      `视觉方向 ${i + 1}`,
    origin: "reference",
    layout: p.layout || "",
    typography: p.typography || "",
    graphics: p.graphics || "",
    avoid: p.avoid || "",
    // Keep measurements and drawing rules; source wording must never become new slide copy.
    constraints: (p.spec?.constraints || []).map(
      ({ dimension, target, rule }) => ({ dimension, target, rule }),
    ),
    adaptationRules: p.spec?.adaptationRules || [],
  }));
  return [
    ...observed,
    ...(style.imageRecipes || []).map((r, i) => ({
      id: `extended-${i + 1}`,
      name: r.name,
      origin: "extended",
      sourceId: r.sourceId,
      layout: r.layout,
      typography: r.typography,
      graphics: r.graphics,
      avoid: r.avoid,
    })),
  ];
}
