import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

// Exercise the real trial transaction and persisted coordinator without models.
test("persistent batches reuse images, survive client absence, and stop safely", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "autoppt-sample-batches-"));
  process.env.AUTOPPT_DATA_DIR = dir;
  const { all, get, put, db, assetPath } = await import("../server/store.mjs");
  const { styleStamp } = await import("../server/core.mjs");
  const { createTrial } = await import("../server/trials.mjs");
  const { createSampleBatches } =
    await import("../server/style-sample-batches.mjs");
  const { sampleProgress, sampleTrials, activeSampleBatchCount } =
    await import("../server/style-sample-state.mjs");
  const enqueue = (type, projectId, payload) =>
    put("job", {
      id: randomUUID(),
      type,
      projectId,
      payload,
      status: "queued",
    });
  const create = (styleId, body, options) =>
    createTrial(styleId, body, enqueue, options);
  const batch = createSampleBatches({ createTrial: create });
  const style = (id) =>
    put("style", { id, name: id, rules: "fixed rules", colors: [], refs: [] });
  const start = (s, more = {}) =>
    batch.start(s.id, {
      fingerprint: styleStamp(s).fingerprint,
      requestId: randomUUID(),
      ...more,
    });
  const finish = (trial) => {
    const image = trial.id + ".png";
    writeFileSync(assetPath(image), "saved-image");
    put("trial", { ...trial, status: "completed", image });
    put("job", { ...get("job", trial.jobId), status: "completed" });
  };
  const work = (id) => all("trial").filter((x) => x.styleId === id);
  const drain = () => {
    for (let n = 0; n < 10; n++) {
      batch.tick();
      for (const job of all("job").filter((j) => j.status === "queued"))
        finish(get("trial", job.payload.trialId));
    }
  };
  try {
    await t.test(
      "existing completed and active samples are reused; no browser polling needed",
      () => {
        const s = style("existing");
        const first = create(s.id, { samplePageId: "cover" });
        finish(first);
        const second = create(s.id, { samplePageId: "point" });
        const requestId = randomUUID();
        start(s, { requestId });
        start(s, { requestId });
        start(s);
        assert.equal(activeSampleBatchCount(), 1);
        batch.tick();
        assert.equal(work(s.id).length, 2);
        finish(second);
        drain();
        assert.equal(work(s.id).length, 8);
        assert.equal(sampleProgress(s).done, 8);
        assert.equal(sampleProgress(s).status, "completed");
        assert.equal(get("trial", first.id).image, first.id + ".png");
        start(s);
        drain();
        assert.equal(work(s.id).length, 8);
        assert.equal(get("style", s.id).publishedAt, undefined);
      },
    );
    await t.test(
      "failure is persisted; replay cannot retry; explicit continuation skips done pages",
      () => {
        const s = style("failed"),
          requestId = randomUUID();
        start(s, { requestId });
        batch.tick();
        finish(work(s.id)[0]);
        batch.tick();
        const failed = get("trial", get("sample-batch", s.id).currentTrialId);
        put("job", {
          ...get("job", failed.jobId),
          status: "failed",
          error: "provider rejected page",
        });
        batch.tick();
        assert.equal(sampleProgress(s).status, "failed");
        assert.equal(sampleProgress(s).done, 1);
        assert.equal(sampleProgress(s).currentPage.id, "point");
        assert.match(sampleProgress(s).error, /provider rejected/);
        start(s, { requestId });
        batch.tick();
        assert.equal(work(s.id).length, 2);
        start(s);
        drain();
        assert.equal(work(s.id).length, 9);
        assert.equal(sampleProgress(s).done, 8);
      },
    );
    await t.test(
      "pause lets current page save; resuming active page never duplicates it",
      () => {
        const s = style("paused");
        start(s);
        batch.tick();
        batch.pause(s.id);
        batch.tick();
        assert.equal(work(s.id).length, 1);
        start(s);
        batch.tick();
        assert.equal(work(s.id).length, 1);
        batch.pause(s.id);
        finish(work(s.id)[0]);
        batch.tick();
        assert.equal(sampleProgress(s).done, 1);
        assert.equal(sampleProgress(s).status, "paused");
        start(s);
        drain();
        assert.equal(work(s.id).length, 8);
      },
    );
    await t.test(
      "restart pauses persisted work and requires review before uncertain retry",
      () => {
        const s = style("restart");
        start(s);
        batch.tick();
        const child = work(s.id)[0];
        put("job", { ...get("job", child.jobId), status: "interrupted" });
        const recovered = createSampleBatches({ createTrial: create });
        recovered.recover();
        recovered.tick();
        assert.equal(work(s.id).length, 1);
        assert.equal(sampleProgress(s).status, "paused");
        assert.equal(sampleProgress(s).uncertain, true);
        // A pause requested before restart must not hide an interrupted image call.
        put("sample-batch", { ...get("sample-batch", s.id), uncertain: false });
        assert.equal(sampleProgress(s).uncertain, true);
        assert.throws(() => start(s), /再次计费/);
        start(s, { acknowledgeUncertain: true });
        drain();
        assert.equal(sampleProgress(s).done, 8);
      },
    );
    await t.test(
      "multiple styles progress independently; mutations cannot interleave pages",
      () => {
        const styles = Array.from({ length: 5 }, (_, i) =>
          style("parallel-" + i),
        );
        for (const s of styles) start(s);
        assert.equal(activeSampleBatchCount(), 5);
        assert.throws(
          () => create(styles[0].id, { purpose: "cover" }),
          /正在提炼或试做/,
        );
        drain();
        for (const s of styles) {
          assert.equal(sampleProgress(s).done, 8);
          assert.equal(work(s.id).length, 8);
        }
        assert.equal(activeSampleBatchCount(), 0);
      },
    );
    await t.test(
      "missing asset is a visible failure; changed fingerprint stops submission",
      () => {
        const s = style("missing");
        start(s);
        batch.tick();
        const current = work(s.id)[0];
        finish(current);
        rmSync(assetPath(current.id + ".png"));
        batch.tick();
        assert.equal(sampleProgress(s).status, "failed");
        assert.equal(sampleProgress(s).done, 0);
        assert.match(sampleProgress(s).error, /文件不可用/);
        const changed = style("changed");
        start(changed);
        put("style", { ...changed, rules: "changed" });
        batch.tick();
        assert.equal(work(changed.id).length, 0);
        assert.equal(get("sample-batch", changed.id).status, "failed");
      },
    );
    await t.test(
      "one request snapshot preserves failures, missing images and finished sample progress",
      () => {
        const snapshot = {
          trials: all("trial"),
          jobs: new Map(all("job").map((job) => [job.id, job])),
        };
        for (const s of all("style")) {
          const trials = sampleTrials(s.id, snapshot);
          assert.deepEqual(trials, sampleTrials(s.id));
          assert.deepEqual(sampleProgress(s, trials), sampleProgress(s));
        }
      },
    );
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
