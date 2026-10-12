import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

test("directed rehearsal resumes planning, preserves text and voice, applies delivery and exports pauses", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "autoppt-expression-"));
  process.env.AUTOPPT_DATA_DIR = dir;
  const store = await import("../server/store.mjs");
  const plans = await import("../server/rehearsal-plan.mjs");
  const runs = await import("../server/rehearsal.mjs");
  const { saveSpeechSettings } = await import("../server/speech/settings.mjs");
  t.after(() => {
    store.db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const project = {
    id: "demo",
    title: "原稿保留",
    revision: 1,
    batches: [],
    slides: [
      { id: "one", notes: "为什么要做？因为表达值得认真。", image: "one.png" },
      { id: "two", notes: "欢迎试一页。", image: "two.png" },
    ],
  };
  store.put("project", project);
  store.updateSettings({
    text: {
      baseUrl: "https://example.com/v1",
      model: "test",
      apiKey: "synthetic",
    },
  });
  saveSpeechSettings({ apiKey: "synthetic-speech" });
  plans.saveRehearsalPlan(project.id, {
    actor: "voice",
    voiceId: "Chinese (Mandarin)_Male_Announcer",
    expression: "directed",
  });
  let calls = 0;
  const model = async (_prompt, text) => {
    calls++;
    const input = JSON.parse(text);
    if (input.stage === "planning")
      return {
        overview: "先设问，后解释",
        sections: [{ startPage: 1, endPage: 2, direction: "自然克制" }],
      };
    if (calls === 2) throw new Error("暂时中断");
    return {
      units: input.units.map((u, i) => ({
        id: u.id,
        emotion: "calm",
        pace: 0.95,
        pauseAfter: i === 0 ? 0.6 : 0,
        emphasis: false,
        sound: "",
        reason: "",
      })),
    };
  };
  const audioCalls = [];
  const audioFactory = async (_config, text, options) => {
    audioCalls.push({ text, options });
    return { file: randomUUID() + ".mp3", duration: 2 };
  };
  const requestId = randomUUID();
  const input = {
    confirmed: true,
    requestId,
    revision: 1,
    scope: "all",
    trialLength: "page",
  };
  await runs.createRun(project.id, input, {
    expressionModel: model,
    audioFactory,
  });
  await runs.waitForRun(requestId);
  const interrupted = store.get("rehearsal-run", requestId);
  assert.equal(interrupted.audioStatus, "interrupted");
  assert(interrupted.expressionCheckpoint.director.plan);
  assert.equal(
    audioCalls.length,
    0,
    "planning failure does not generate flat fallback audio",
  );
  // Reuse the immutable run checkpoint, just as explicit continuation does.
  const { prepareRehearsalExpression } =
    await import("../server/rehearsal-expression.mjs");
  await prepareRehearsalExpression(
    interrupted,
    (r) => store.put("rehearsal-run", r),
    undefined,
    model,
  );
  assert.equal(calls, 3, "completed global planning is not billed again");
  assert.equal(
    interrupted.pages[0].clips[0].spokenText,
    project.slides[0].notes,
  );
  assert(interrupted.pages[0].clips[0].text.includes("<#0.6#>"));
  assert.equal(interrupted.pages[0].clips[0].delivery.speed, 0.95);
  assert.equal(interrupted.pages[0].clips[0].delivery.emotion, "calm");
  assert.equal(
    interrupted.options.voiceId,
    "Chinese (Mandarin)_Male_Announcer",
  );
  // Completed run publication retains pauses needed by portable HTML playback.
  interrupted.pages.forEach((p) =>
    p.clips.forEach((c) => {
      c.audioFile = "test.mp3";
      c.pauseAfter = 0.6;
    }),
  );
  const { publishRehearsalNarration } =
    await import("../server/rehearsal-narration.mjs");
  publishRehearsalNarration(interrupted);
  assert.equal(
    store.get("narration", requestId).pages[0].clips[0].pauseAfter,
    0.6,
  );
  assert.deepEqual(store.get("project", project.id), project);
});
