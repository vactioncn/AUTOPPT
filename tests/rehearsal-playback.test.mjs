import test from "node:test";
import assert from "node:assert/strict";
import {
  matchesRehearsalRun,
  rehearsalPlaybackPieces,
} from "../shared/rehearsal-playback.mjs";
const plan = {
  actor: "voice",
  visual: "original",
  avatarId: "",
  voiceId: "personal",
  emotion: "neutral",
  speed: 1,
  narrationId: "",
  pageId: "one",
  slideIds: [],
};
const context = {
  texts: { one: "完整正文", two: "第二页正文" },
  model: "speech-2.8-hd",
  pageIds: ["one", "two"],
  trialLength: "short",
};
const trial = {
  compatible: true,
  plan,
  scope: "trial",
  trialLength: "short",
  speechModel: context.model,
  pages: [
    {
      id: "one",
      text: "完整",
      fullText: "完整正文",
      clips: [{ audioFile: "one.mp3" }],
    },
  ],
};
test("current playback requires matching text, voice, page, trial length and model", () => {
  assert(matchesRehearsalRun(trial, plan, context));
  for (const change of [
    { voiceId: "another" },
    { speed: 1.25 },
    { emotion: "happy" },
    { pageId: "two" },
  ])
    assert(!matchesRehearsalRun(trial, { ...plan, ...change }, context));
  assert(
    !matchesRehearsalRun(trial, plan, {
      ...context,
      texts: { ...context.texts, one: "改了正文" },
    }),
  );
  assert(
    !matchesRehearsalRun(trial, plan, { ...context, trialLength: "page" }),
  );
  assert(
    !matchesRehearsalRun(trial, plan, { ...context, model: "different-model" }),
  );
  assert(!matchesRehearsalRun({ ...trial, compatible: false }, plan, context));
  assert(!matchesRehearsalRun(trial, null, context));
});
test("whole playback must cover the current page order and scope, including edits on other pages", () => {
  const whole = {
    ...trial,
    scope: "all",
    pages: [...trial.pages, { id: "two", text: context.texts.two, clips: [] }],
  };
  assert(matchesRehearsalRun(whole, { ...plan, pageId: "two" }, context));
  assert(!matchesRehearsalRun(whole, plan, { ...context, pageIds: ["one"] }));
  assert(
    !matchesRehearsalRun(whole, plan, { ...context, pageIds: ["two", "one"] }),
  );
  assert(
    !matchesRehearsalRun(whole, plan, {
      ...context,
      texts: { ...context.texts, two: "修改第二页" },
    }),
  );
  const reuse = { ...whole, plan: { ...plan, narrationId: "saved-narration" } };
  assert(
    matchesRehearsalRun(reuse, reuse.plan, {
      ...context,
      model: "different",
      texts: {},
    }),
  );
});
test("partial playback skips pending clips, retains page identity and never mutates saved records", () => {
  const run = {
    ...trial,
    pages: [
      {
        id: "one",
        clips: [
          { audioFile: "a.mp3" },
          { status: "pending" },
          { audioFile: "b.mp3" },
        ],
      },
      { id: "two", clips: [{ status: "pending" }] },
      { id: "three", clips: [{ audioFile: "c.mp3", file: "c.mp4" }] },
    ],
  };
  const original = JSON.stringify(run);
  assert.deepEqual(
    rehearsalPlaybackPieces(run).map(({ page, clip }) => [
      page.id,
      clip.audioFile,
    ]),
    [
      ["one", "a.mp3"],
      ["one", "b.mp3"],
      ["three", "c.mp3"],
    ],
  );
  assert.equal(JSON.stringify(run), original);
  assert.equal(
    rehearsalPlaybackPieces({ ...run, pages: [{ id: "one", clips: [] }] })
      .length,
    0,
  );
  assert.equal(
    rehearsalPlaybackPieces({
      ...run,
      plan: { actor: "self" },
      pages: [{ id: "one", clips: [] }],
    }).length,
    1,
  );
});
