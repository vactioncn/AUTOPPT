import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  statSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ModelConcurrency } from "../server/hosted/model-concurrency.mjs";

function fixture(t, options = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "autoppt-concurrency-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { dir, slots: new ModelConcurrency(dir, options) };
}
const response = () => new EventEmitter();

test("live image limit increases drain FIFO, decreases wait for active work; text/speech use separate capacity", async (t) => {
  const { slots } = fixture(t, { initialConcurrency: 1 });
  const first = await slots.acquire("image", response());
  const order = [];
  const second = slots.acquire("image", response()).then((release) => {
    order.push(2);
    return release;
  });
  const third = slots.acquire("image", response()).then((release) => {
    order.push(3);
    return release;
  });
  const fourth = slots.acquire("image", response()).then((release) => {
    order.push(4);
    return release;
  });
  const text = await slots.acquire("text", response());
  const speech = slots.acquire("speech", response());
  assert.equal(slots.active, 2);
  assert.equal(slots.public().waitingImages, 3);
  slots.save({ revision: 0, imageConcurrency: 3 });
  const releaseSecond = await second,
    releaseThird = await third;
  assert.deepEqual(order, [2, 3]);
  assert.equal(slots.public().activeImages, 3);
  slots.save({ revision: 1, imageConcurrency: 1 });
  first();
  first(); // A duplicate finally cannot free another request's slot.
  releaseSecond();
  await Promise.resolve();
  assert.equal(slots.public().activeImages, 1);
  assert.deepEqual(order, [2, 3]);
  releaseThird();
  const releaseFourth = await fourth;
  assert.deepEqual(order, [2, 3, 4]);
  assert.equal(slots.public().activeImages, 1);
  text();
  const releaseSpeech = await speech;
  releaseFourth();
  releaseSpeech();
  assert.equal(slots.active, 0);
  assert.equal(slots.waiting, 0);
});

test("queued disconnect, timeout and overflow never consume or leak slots", async (t) => {
  const { slots } = fixture(t, {
    initialConcurrency: 1,
    queueLimit: 1,
    waitMs: 20,
  });
  const release = await slots.acquire("image", response());
  const cancelled = response();
  const pending = slots.acquire("image", cancelled);
  await assert.rejects(slots.acquire("image", response()), { status: 429 });
  cancelled.emit("close");
  await assert.rejects(pending, { status: 499 });
  assert.equal(cancelled.listenerCount("close"), 0);
  const timed = response();
  await assert.rejects(slots.acquire("image", timed), /等待模型服务超时/);
  assert.equal(timed.listenerCount("close"), 0);
  const alreadyClosed = Object.assign(response(), { destroyed: true });
  await assert.rejects(slots.acquire("image", alreadyClosed), { status: 499 });
  const closedBeforeDrain = response();
  const late = slots.acquire("image", closedBeforeDrain);
  closedBeforeDrain.destroyed = true;
  release();
  await assert.rejects(late, { status: 499 });
  assert.equal(slots.active, 0);
  assert.equal(slots.waiting, 0);
  (await slots.acquire("image", response()))();
});

test("limits persist atomically, reject stale/invalid input and do not change running settings on write failure", (t) => {
  const { dir, slots } = fixture(t);
  for (const value of [0, -1, 101, 1.5, "3", null, true])
    assert.throws(
      () => slots.save({ revision: 0, imageConcurrency: value }),
      /1–100/,
    );
  assert.throws(() => slots.save({ revision: 9, imageConcurrency: 4 }), {
    status: 409,
  });
  slots.save({ revision: 0, imageConcurrency: 4 });
  assert.equal(statSync(slots.file).mode & 0o777, 0o600);
  const restored = new ModelConcurrency(dir, { initialConcurrency: 2 });
  assert.equal(restored.imageConcurrency, 4);
  assert.equal(restored.otherConcurrency, 2);
  assert.equal(restored.revision, 1);
  mkdirSync(slots.file + ".tmp");
  assert.throws(() => slots.save({ revision: 1, imageConcurrency: 8 }));
  assert.equal(slots.imageConcurrency, 4);
  assert.equal(slots.revision, 1);
  assert.equal(JSON.parse(readFileSync(slots.file)).imageConcurrency, 4);
  writeFileSync(slots.file, "{}");
  assert.throws(() => new ModelConcurrency(dir), /不会自动改用默认/);
});
