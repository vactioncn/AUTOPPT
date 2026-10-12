import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { mkdtemp, writeFile, symlink, rm, mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { registerBackgroundMusic } from "../server/background-music.mjs";
import { createBackgroundMusicPlayer } from "../shared/background-music.mjs";

function harness() {
  const audios = [],
    ramps = [],
    timers = new Map(),
    errors = [];
  let serial = 0;
  const context = {
    currentTime: 0,
    state: "running",
    destination: {},
    closed: false,
    createMediaElementSource: () => ({ connect() {}, disconnect() {} }),
    createGain() {
      const param = {
        value: 0,
        cancelScheduledValues() {},
        setValueAtTime(v) {
          param.value = v;
        },
        linearRampToValueAtTime(value, at) {
          ramps.push({ value, at });
        },
      };
      return { gain: param, connect() {}, disconnect() {} };
    },
    async resume() {
      context.state = "running";
    },
    async close() {
      context.closed = true;
    },
  };
  const player = createBackgroundMusicPlayer({
    createContext: () => context,
    createAudio() {
      const events = {};
      const audio = {
        paused: true,
        duration: 10,
        currentTime: 0,
        plays: 0,
        async play() {
          if (audio.reject) throw new Error("blocked");
          audio.paused = false;
          audio.plays++;
        },
        pause() {
          audio.paused = true;
        },
        load() {},
        removeAttribute() {},
        addEventListener(name, callback) {
          events[name] = callback;
        },
        emit(name) {
          events[name]?.();
        },
      };
      audios.push(audio);
      return audio;
    },
    setTimer(fn) {
      const id = ++serial;
      timers.set(id, fn);
      return id;
    },
    clearTimer(id) {
      timers.delete(id);
    },
    onError: (e) => errors.push(e),
  });
  const flush = () => {
    const all = [...timers.values()];
    timers.clear();
    all.forEach((fn) => fn());
  };
  return { player, audios, ramps, context, flush, errors };
}

test("music is opt-in; pause fades before stopping and resumes at the same position", async () => {
  const h = harness();
  await h.player.update({ url: "/track.mp3", playing: true });
  assert.equal(h.audios.length, 0);
  await h.player.update({ enabled: true });
  const a = h.audios[0];
  assert.equal(a.loop, true);
  assert.equal(a.paused, false);
  a.currentTime = 6;
  h.context.currentTime = 3;
  a.emit("timeupdate");
  assert.equal(h.ramps.at(-1).value, 0.12);
  await h.player.update({ playing: false });
  assert.equal(h.ramps.at(-1).value, 0);
  assert.equal(a.paused, false);
  // A quick resume cancels the pending pause instead of cutting the music off.
  await h.player.update({ playing: true });
  h.flush();
  assert.equal(a.paused, false);
  assert.equal(a.currentTime, 6);
  await h.player.update({ playing: false });
  h.flush();
  assert.equal(a.paused, true);
  assert.equal(a.currentTime, 6);
  h.player.dispose();
  h.flush();
  assert.equal(h.context.closed, true);
});

test("a song change fades out the old stream; loop edges fade without affecting the narration", async () => {
  const h = harness();
  await h.player.update({ url: "/one.mp3", enabled: true, playing: true });
  await h.player.update({ url: "/two.mp3" });
  h.flush();
  assert.equal(h.audios[0].paused, true);
  assert.equal(h.audios[1].paused, false);
  const a = h.audios[1];
  a.currentTime = 9.8;
  a.emit("timeupdate");
  const tail = h.ramps.at(-1).value;
  a.currentTime = 0.1;
  a.emit("timeupdate");
  const head = h.ramps.at(-1).value;
  a.currentTime = 3;
  a.emit("timeupdate");
  assert(tail < 0.03);
  assert(head < 0.02);
  assert.equal(h.ramps.at(-1).value, 0.12);
  await h.player.update({ volume: 99 });
  a.emit("timeupdate");
  assert.equal(h.ramps.at(-1).value, 0.4);
  h.player.dispose();
  h.flush();
  assert(h.audios.every((a) => a.paused));
});

test("closing while a stream is still starting releases it when play resolves", async () => {
  const h = harness();
  await h.player.update({ url: "/one.mp3", enabled: true, playing: true });
  let resolve;
  h.audios[0].play = () =>
    new Promise((r) => {
      resolve = () => {
        h.audios[0].paused = false;
        r();
      };
    });
  const start = h.player.update({ volume: 0.1 });
  await Promise.resolve();
  await Promise.resolve();
  h.player.dispose();
  h.flush(); // The stream may resolve even after the fade and context teardown.
  resolve();
  await start;
  h.flush();
  assert.equal(h.audios[0].paused, true);
  assert.equal(h.context.closed, true);
});

test("music load failures disable just music and allow a later retry", async () => {
  const h = harness();
  await h.player.update({ url: "/one.mp3", enabled: true, playing: true });
  h.audios[0].emit("error");
  h.flush();
  assert.equal(h.audios[0].paused, true);
  assert.equal(h.errors.length, 1);
  await h.player.update({ enabled: true });
  assert.equal(h.audios[0].paused, false);
  h.player.dispose();
  h.flush();
});

test("playlist only serves imported MP3s, supports Range, and excludes missing or escaping files", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "autoppt-music-"));
  const directory = path.join(parent, ".playlist");
  await mkdir(directory);
  const outside = path.join(
    directory,
    "..",
    "outside-" + path.basename(directory) + ".mp3",
  );
  const id = "a".repeat(24),
    missing = "b".repeat(24),
    escape = "c".repeat(24);
  await writeFile(path.join(directory, id + ".mp3"), Buffer.alloc(100, 7));
  await writeFile(outside, "private");
  await symlink(outside, path.join(directory, escape + ".mp3"));
  await writeFile(
    path.join(directory, "index.json"),
    JSON.stringify([
      { id, name: "Piano" },
      { id: missing, name: "Missing" },
      { id: escape, name: "Private" },
      { id: "../secret", name: "Bad" },
    ]),
  );
  const app = express();
  registerBackgroundMusic(app, directory);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = "http://127.0.0.1:" + server.address().port;
  try {
    const list = await (await fetch(base + "/api/background-music")).json();
    assert.deepEqual(
      list.tracks.map((t) => t.name),
      ["Piano"],
    );
    const r = await fetch(base + list.tracks[0].url, {
      headers: { Range: "bytes=10-19" },
    });
    assert.equal(r.status, 206);
    assert.equal(r.headers.get("content-type"), "audio/mpeg");
    assert.equal((await r.arrayBuffer()).byteLength, 10);
    assert.equal(
      (await fetch(base + "/api/background-music/" + escape + ".mp3")).status,
      404,
    );
    await rm(path.join(directory, "index.json"));
    assert.deepEqual(
      await (await fetch(base + "/api/background-music")).json(),
      { tracks: [] },
    );
  } finally {
    await new Promise((r) => server.close(r));
    await rm(directory, { recursive: true, force: true });
    await rm(outside);
    await rm(parent, { recursive: true, force: true });
  }
});
