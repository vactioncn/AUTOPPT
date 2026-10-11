import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

test("stopping rehearsal interrupts provider wait, preserves completed clips, and never starts later pages", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "autoppt-rehearsal-stop-"));
  process.env.AUTOPPT_DATA_DIR = dir;
  const store = await import("../server/store.mjs");
  const { saveSpeechSettings } = await import("../server/speech/settings.mjs");
  const { saveRehearsalPlan } = await import("../server/rehearsal-plan.mjs");
  const { createRun, publicRun, stopRehearsalRun, waitForRun } =
    await import("../server/rehearsal.mjs");
  t.after(() => {
    store.db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const project = {
    id: "stop-test",
    title: "original",
    revision: 1,
    draft: "keep",
    batches: [],
    slides: [1, 2, 3].map((i) => ({
      id: String(i),
      notes: `page ${i}`,
      image: "original.png",
    })),
  };
  store.put("project", project);
  saveSpeechSettings({ apiKey: "synthetic-only" });
  saveRehearsalPlan(project.id, {
    actor: "voice",
    voiceId: "Chinese (Mandarin)_News_Anchor",
    pageId: "1",
  });
  const requestId = randomUUID();
  let calls = 0;
  let waiting;
  const reachedWait = new Promise((resolve) => {
    waiting = resolve;
  });
  await createRun(
    project.id,
    {
      confirmed: true,
      requestId,
      revision: 1,
      scope: "all",
      trialLength: "page",
    },
    {
      audioFactory: async (_config, _text, _options, signal, onWait) => {
        calls++;
        if (calls === 1) return { file: "completed.mp3", duration: 2 };
        onWait({ ms: 60000 });
        waiting();
        await delay(60000, undefined, { signal });
        throw new Error("must not reach after stop");
      },
    },
  );
  await reachedWait;
  assert.match(
    (await publicRun(store.get("rehearsal-run", requestId))).message,
    /60/,
  );
  assert.throws(
    () => stopRehearsalRun("other-user-project", requestId),
    /不存在/,
  );
  stopRehearsalRun(project.id, requestId);
  await Promise.race([
    waitForRun(requestId),
    delay(1500).then(() => {
      throw new Error("stop did not interrupt wait");
    }),
  ]);
  const run = store.get("rehearsal-run", requestId);
  assert.equal(calls, 2);
  assert.equal(run.stopRequested, true);
  assert.equal(run.pages[0].clips[0].audioFile, "completed.mp3");
  assert(!run.pages[1].clips[0].audioFile);
  assert(!run.pages[2].clips[0].audioFile);
  assert.equal((await publicRun(run)).status, "interrupted");
  assert.match((await publicRun(run)).message, /已停止/);
  assert.deepEqual(store.get("project", project.id), project);
});
