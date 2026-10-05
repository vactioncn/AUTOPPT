import test from "node:test";
import assert from "node:assert/strict";
import { createStyleFromReferences } from "../server/style-creation.mjs";
import {
  observationsFixture,
  creationFixture,
} from "./fixtures/style-creation.mjs";

const style = {
  name: "暖纸手绘",
  rules: "已经保存的原规则",
  refs: ["first.png", "second.png"],
};

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
  assert.match(calls[1].system, /克制儿童摄影杂志风/);
  assert.match(calls[1].system, /先锋酸性色彩编辑风/);
  assert.match(calls[1].system, /新瑞士主义战略编辑风/);
  assert.match(calls[1].system, /不得默认继承范例/);
  assert.equal(stages.length, 2);
  assert.equal(result.styleAnalysis.version, 1);
  assert.equal(result.referenceProfiles[1].ref, "second.png");
  assert.deepEqual(result.styleAnalysis.sharedTraits[0].references, [1, 2]);
  assert.deepEqual(result.colors, ["#F4EBDD", "#513B30", "#B94535"]);
  assert.match(result.rules, /一、视觉定位/);
  assert.match(result.rules, /十二、设计自检与效果标准/);
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
