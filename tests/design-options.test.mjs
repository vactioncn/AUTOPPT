import test from "node:test";
import assert from "node:assert/strict";
import {
  designOptions,
  designOptionsKey,
  audiencePrompt,
  palettePrompt,
  expandAudience,
  extractPalette,
} from "../server/design-options.mjs";

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
  ]) {
    const result = await expandAudience(description, async (system, user) => {
      assert.match(system, /不预设儿童摄影/);
      assert.match(system, /不规定颜色/);
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
