import test from "node:test";
import assert from "node:assert/strict";
import {
  createStyleFromReferences,
  checkedCreation,
  sectionBody,
  STYLE_SECTIONS,
  checkedStyleContext,
} from "../server/style-creation.mjs";
import {
  observationsFixture,
  creationFixture,
} from "./fixtures/style-creation.mjs";

const style = {
  name: "暖纸手绘",
  rules: "已经保存的原规则",
  refs: ["first.png", "second.png"],
};

test("generated section headings are emitted once without deleting body text", () => {
  const fixture = creationFixture();
  const expected = checkedCreation(fixture);
  for (const prefix of [
    (title) => `${title}。`,
    (title) => `## ${title}\n\n`,
    (title) => `**${title}**：`,
    (title, i) => `${i + 1}. ${title.split("、")[1]}\n`,
    (title) => `第${title.replace("、", "")}：`,
    (title) => `${title}\n\n${title}。`,
  ]) {
    const repeated = structuredClone(fixture);
    STYLE_SECTIONS.forEach(([key, title], i) => {
      repeated.sections[key] = prefix(title, i) + fixture.sections[key];
    });
    assert.deepEqual(checkedCreation(repeated), expected);
  }
  for (const text of [
    "视觉定位决定材料与构图，不应重复统一模板。",
    "1. 先看主标题，再看正文。\n2. 核心信息通过留白强调。",
    "保留这样的引用：一、视觉定位。它是原始材料的一部分。",
  ])
    assert.equal(sectionBody(text, "一、视觉定位"), text);
  assert.equal(sectionBody("**视觉定位**\n正文", "一、视觉定位"), "正文");
  const empty = structuredClone(fixture);
  empty.sections.identity = "二、风格定义。".repeat(10);
  assert.throws(() => checkedCreation(empty), /设计规范不完整/);
});

test("style creation observes every reference before authoring a complete independent prompt", async () => {
  const original = structuredClone(style),
    calls = [],
    stages = [];
  const controller = new AbortController();
  const result = await createStyleFromReferences(style, "保留水彩的温度", {
    signal: controller.signal,
    progress: (stage) => stages.push(stage),
    callModel: async (system, user, refs, signal) => {
      calls.push({ system, data: JSON.parse(user), refs });
      assert.equal(signal, controller.signal);
      return calls.length === 1 ? observationsFixture(2) : creationFixture();
    },
  });
  assert.deepEqual(style, original);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].refs, style.refs);
  assert.deepEqual(calls[1].refs, []);
  assert.deepEqual(
    calls[1].data.observations.referenceProfiles.map((p) => p.ref),
    style.refs,
  );
  assert.equal(calls[1].data.previousRules, style.rules);
  assert.equal(calls[1].data.feedback, "保留水彩的温度");
  assert.match(calls[1].system, /视觉系统逆向工程/);
  assert.match(calls[1].system, /不复制参考图片中的具体版式/);
  assert.match(calls[1].system, /不默认继承任何示例的具体审美/);
  assert.equal(stages.length, 2);
  assert.equal(result.styleAnalysis.version, 2);
  assert.equal(result.referenceProfiles[1].ref, "second.png");
  assert.deepEqual(result.styleAnalysis.sharedTraits[0].references, [1, 2]);
  assert.deepEqual(result.colors, ["#F4EBDD", "#513B30", "#B94535"]);
  assert.match(result.rules, /二、风格定义/);
  assert.match(result.rules, /十九、最终效果标准/);
  assert.match(result.rules, /统一的是设计 DNA，不是版式模板/);
  assert.match(result.rules, /【四级风格规则】/);
  assert.equal(result.styleAnalysis.styles[0].rules, result.rules);
  assert(!result.rules.includes(result.styleAnalysis.direction));
  assert(!result.rules.includes("新瑞士主义"));
  assert.deepEqual(result.imageRecipes, []);
});

test("incomplete observations never reach style authoring", async () => {
  for (const mutate of [
    (r) => {
      r.referenceProfiles.pop();
    },
    (r) => {
      delete r.referenceProfiles[0].texture;
    },
    (r) => {
      r.referenceProfiles[0].typography = "高级";
    },
    (r) => {
      r.sharedTraits[0].references = [3];
    },
    (r) => {
      r.sharedTraits = [];
    },
    (r) => {
      r.uncertainties = "无";
    },
  ]) {
    let count = 0;
    await assert.rejects(
      createStyleFromReferences(style, "", {
        callModel: async () => {
          count++;
          const out = observationsFixture(2);
          mutate(out);
          return out;
        },
      }),
      /逐图分析或共同特征不完整/,
    );
    assert.equal(count, 1);
  }
});

test("missing sections, superficial rules and malformed colors cannot replace a saved style", async () => {
  for (const mutate of [
    (r) => {
      delete r.sections.imagery;
    },
    (r) => {
      r.sections.variation = "每页不同";
    },
    (r) => {
      for (const key of Object.keys(r.sections))
        r.sections[key] = "抽象泛泛的风格描述".repeat(6);
    },
    (r) => {
      r.colors = "#FFFFFF";
    },
    (r) => {
      r.colors = ["#FFF", "green"];
    },
    (r) => {
      r.direction = "设计好了";
    },
  ]) {
    let count = 0;
    const original = structuredClone(style);
    await assert.rejects(
      createStyleFromReferences(style, "", {
        callModel: async () => {
          if (++count === 1) return observationsFixture(2);
          const out = creationFixture();
          mutate(out);
          return out;
        },
      }),
      /新风格的设计规范不完整/,
    );
    assert.deepEqual(style, original);
  }
});

test("cancellation between stages and after authoring does not publish partial results", async () => {
  for (const stopAt of [1, 2]) {
    const controller = new AbortController();
    let count = 0;
    await assert.rejects(
      createStyleFromReferences(style, "", {
        signal: controller.signal,
        callModel: async () => {
          count++;
          if (count === stopAt) controller.abort(new Error("test stopped"));
          return count === 1 ? observationsFixture(2) : creationFixture();
        },
      }),
      /test stopped/,
    );
    assert.equal(count, stopAt);
  }
});

test("one reference and the 12-reference limit retain ordered observations; invalid counts call no model", async () => {
  for (const count of [1, 12]) {
    let calls = 0;
    const input = {
      ...style,
      refs: Array.from({ length: count }, (_, i) => `${i}.png`),
    };
    const out = await createStyleFromReferences(input, "", {
      callModel: async () =>
        ++calls === 1 ? observationsFixture(count) : creationFixture(),
    });
    assert.deepEqual(
      out.referenceProfiles.map((p) => p.ref),
      input.refs,
    );
    assert.equal(calls, 2);
  }
  for (const refs of [[], Array(13).fill("a.png")]) {
    await assert.rejects(
      createStyleFromReferences({ ...style, refs }, "", {
        callModel: async () =>
          assert.fail("invalid reference count called model"),
      }),
      /请选择1–12张/,
    );
  }
});

test("mixed systems author independent prompts with isolated visual evidence and explicit context", async () => {
  const observed = observationsFixture(2);
  observed.relation = "mixed";
  observed.groups = [1, 2].map((n) => ({
    references: [n],
    rationale: `第${n}组有独立的材质、字体与色彩逻辑，不能平均混合。`,
  }));
  observed.sharedTraits = observed.groups.map((group) => ({
    trait: "这一组的材质和字体建立独立阅读秩序，不与另一组混合。",
    references: group.references,
  }));
  const calls = [];
  const result = await createStyleFromReferences(
    {
      ...style,
      autoName: true,
      analysisContext: { industry: "文学教学", avoid: "科技HUD" },
    },
    "保持纸面细节",
    {
      callModel: async (system, user, refs) => {
        calls.push({ data: JSON.parse(user), refs });
        if (calls.length === 1) return observed;
        const output = creationFixture();
        output.nameCn = `独立风格${calls.length - 1}`;
        return output;
      },
    },
  );
  assert.equal(calls.length, 3);
  assert.deepEqual(
    calls
      .slice(1)
      .map((c) => c.data.observations.referenceProfiles.map((p) => p.ref)),
    [["first.png"], ["second.png"]],
  );
  assert.deepEqual(
    calls.slice(1).map((c) => c.data.observations.sharedTraits[0].references),
    [[1], [2]],
  );
  assert.equal(calls[2].data.context.industry, "文学教学");
  assert.equal(calls[2].data.context.avoid, "科技HUD");
  assert.equal(result.name, "独立风格1");
  assert.equal(result.styleAnalysis.styles.length, 2);
  assert.notEqual(
    result.styleAnalysis.styles[0].rules,
    result.styleAnalysis.styles[1].rules,
  );
});

test("outlier references are observed but excluded from the primary prompt", async () => {
  const observed = observationsFixture(3);
  observed.relation = "outliers";
  observed.groups[0].references = [1, 2];
  observed.excludedReferences = [3];
  observed.sharedTraits[0].references = [1, 2];
  let count = 0;
  const result = await createStyleFromReferences(
    { ...style, refs: ["a.png", "b.png", "outlier.png"] },
    "",
    {
      callModel: async (_system, user) => {
        if (++count === 1) return observed;
        const data = JSON.parse(user);
        assert.deepEqual(
          data.observations.referenceProfiles.map((p) => p.ref),
          ["a.png", "b.png"],
        );
        return creationFixture();
      },
    },
  );
  assert.equal(count, 2);
  assert.deepEqual(result.styleAnalysis.excludedReferences, [3]);
  assert.equal(result.referenceProfiles.length, 3);
});

test("missing, overlapping and inconsistent groups never reach prompt generation", async () => {
  for (const mutate of [
    (r) => {
      r.groups[0].references = [1];
    },
    (r) => {
      r.groups[0].references = [1, 1, 2];
    },
    (r) => {
      r.relation = "mixed";
    },
    (r) => {
      r.excludedReferences = [2];
    },
    (r) => {
      r.groups[0].references = [0, 1];
    },
    (r) => {
      delete r.referenceProfiles[0].designLogic;
    },
    (r) => {
      r.referenceProfiles[0].observed = [];
    },
  ]) {
    let calls = 0;
    await assert.rejects(
      createStyleFromReferences(style, "", {
        callModel: async () => {
          calls++;
          const out = observationsFixture(2);
          mutate(out);
          return out;
        },
      }),
      /逐图分析/,
    );
    assert.equal(calls, 1);
  }
});

test("all output parts are required and a failed last group retains the source", async () => {
  for (const mutate of [
    (r) => {
      r.visualDna.pop();
    },
    (r) => {
      r.lockSentences = ["只有一句"];
    },
    (r) => {
      delete r.styleModel.rare;
    },
    (r) => {
      r.nameCn = "";
    },
    (r) => {
      r.risks = [];
    },
  ]) {
    const out = creationFixture();
    mutate(out);
    assert.throws(() => checkedCreation(out), /设计规范不完整/);
  }
  const before = structuredClone(style);
  const observed = observationsFixture(2);
  observed.relation = "mixed";
  observed.groups = [1, 2].map((n) => ({
    references: [n],
    rationale: "本组有独立的视觉语言与设计逻辑，应分别生成提示词。",
  }));
  let calls = 0;
  await assert.rejects(
    createStyleFromReferences(style, "", {
      callModel: async () => {
        calls++;
        if (calls === 1) return observed;
        return calls === 2 ? creationFixture() : { description: "失败结果" };
      },
    }),
    /设计规范不完整/,
  );
  assert.deepEqual(style, before);
  assert.equal(calls, 3);
});

test("optional context is bounded and supports multipart and JSON creation", () => {
  assert.equal(checkedStyleContext('{"audience":"  学生  "}').audience, "学生");
  assert.equal(checkedStyleContext().industry, "");
  for (const input of [
    "not JSON",
    null,
    [],
    { audience: 42 },
    { industry: "x".repeat(1001) },
  ])
    assert.throws(() => checkedStyleContext(input), /信息/);
});
