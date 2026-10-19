import test from "node:test";
import assert from "node:assert/strict";
import { AUDIENCE_BRIEF_EXAMPLE } from "../server/audience-brief.mjs";
import {
  DESIGN_PALETTES,
  PALETTE_GROUPS,
  samePalette,
  normalizeHexColor,
} from "../shared/design-palettes.mjs";
import {
  designOptions,
  designOptionsKey,
  audiencePrompt,
  palettePrompt,
  expandAudience,
  extractPalette,
} from "../server/design-options.mjs";

test("expanded presets fit saved design options and have readable body text", () => {
  assert.equal(DESIGN_PALETTES.length, 16);
  assert.equal(
    new Set(DESIGN_PALETTES.map(({ palette }) => palette.name)).size,
    16,
  );
  const luminance = (hex) =>
    hex
      .slice(1)
      .match(/../g)
      .map((h) => {
        const c = parseInt(h, 16) / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      })
      .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
  for (const group of PALETTE_GROUPS)
    assert.equal(DESIGN_PALETTES.filter((p) => p.group === group).length, 4);
  for (const { palette } of DESIGN_PALETTES) {
    assert.deepEqual(designOptions({ palette }).palette, palette);
    const [a, b] = palette.colors
      .slice(0, 2)
      .map(luminance)
      .sort((x, y) => y - x);
    assert((a + 0.05) / (b + 0.05) >= 4.5, palette.name);
    assert.match(palettePrompt({ palette }), /其余字体、材质/);
    assert(
      samePalette(
        {
          colors: palette.colors,
          instructions: palette.instructions,
          name: palette.name,
        },
        palette,
      ),
    );
    assert(
      !samePalette({ ...palette, instructions: "用户修改后的要求" }, palette),
    );
  }
});

test("custom HEX input accepts shorthand but never persists partial or invalid colors", () => {
  assert.equal(normalizeHexColor(" abc "), "#AABBCC");
  assert.equal(normalizeHexColor("#17324d"), "#17324D");
  for (const hex of ["", "#1", "#12345", "red", "#12345678", "#GGGGGG"])
    assert.equal(normalizeHexColor(hex), null);
});

test("optional context and palette preserve legacy defaults and validate independent fields", () => {
  assert.deepEqual(designOptions(), { audience: null, palette: null });
  assert.equal(designOptionsKey(), designOptionsKey({}));
  assert.equal(audiencePrompt(), "");
  assert.equal(palettePrompt(), "");
  for (const invalid of [
    [],
    1,
    { audience: {} },
    { audience: { description: " " } },
    { palette: {} },
    { palette: { name: "配色", instructions: "x", colors: ["#fff"] } },
  ])
    assert.throws(() => designOptions(invalid));
  const audience = {
    description: "运动会观众",
    brief: " 场景可选，不代表赛事事实。\n",
  };
  assert.deepEqual(designOptions({ audience }).audience, audience);
  assert.match(audiencePrompt({ audience }), /不是本页事实/);
  assert.match(audiencePrompt({ audience }), /少量、微弱、中性/);
  assert(!audiencePrompt({ audience }).includes("黑底"));
});

test("audience expansion generalizes across audiences and returns a reviewable draft", async () => {
  for (const description of [
    "儿童影楼管理者",
    "婚纱摄影客户",
    "自行车赛参赛者",
    "运动会志愿者",
    "面向公众，其他信息尚未确定",
  ]) {
    const result = await expandAudience(description, async (system, user) => {
      assert.match(system, /不预设儿童摄影/);
      assert.match(system, /不规定颜色/);
      assert(system.includes(AUDIENCE_BRIEF_EXAMPLE));
      assert.match(system, /不只替换行业名称/);
      assert.match(system, /不把可能的角色写成已确定受众/);
      assert.match(system, /不能套用老板的经营立场/);
      assert.match(system, /每项独占一行/);
      assert.match(system, /最终目标是/);
      assert.equal(JSON.parse(user).description, description);
      return { brief: `受众：${description}。可选场景需服务内容。` };
    });
    assert.equal(result.description, description);
    assert.match(result.brief, /可选场景/);
  }
  await assert.rejects(
    expandAudience(" ", () => assert.fail("invalid input called model")),
  );
  await assert.rejects(expandAudience("运动会", async () => ({ brief: "" })));
});

test("palette extraction requires exact source evidence and does not invent hex codes", async () => {
  const rules = "黑底或白底均可；荧光黄 #DFFF00 用于强调。";
  const output = {
    palette: { name: "黑白荧光黄", instructions: rules, colors: ["#DFFF00"] },
    evidence: [rules],
  };
  assert.deepEqual(await extractPalette(rules, async () => output), output);
  assert.deepEqual(
    await extractPalette("哑光质感", async () => ({ palette: null })),
    { palette: null, evidence: [] },
  );
  for (const invalid of [
    { ...output, evidence: ["固定黑底"] },
    { ...output, evidence: [] },
    { ...output, palette: { ...output.palette, colors: ["#FF0000"] } },
  ])
    await assert.rejects(
      extractPalette(rules, async () => invalid),
      /原文依据/,
    );
  const prompt = palettePrompt({ palette: output.palette });
  assert.match(prompt, /仅替换风格原文中冲突的颜色/);
  assert.match(prompt, /承载事实的颜色编码/);
});
