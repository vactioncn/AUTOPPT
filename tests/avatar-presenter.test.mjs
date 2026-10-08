import test, { after } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import sharp from "sharp";
import { silenceMp3 } from "./helpers/speech-audio.mjs";

const dir = mkdtempSync(path.join(tmpdir(), "autoppt-presenter-"));
process.env.AUTOPPT_DATA_DIR = dir;
const store = await import("../server/store.mjs");
const p = await import("../server/presenter/index.mjs");
const { mockProvider } = await import("../server/presenter/mock.mjs");
const { validateImage, validateVideo, videoPath, MAX_IMAGE, expectedPlaybackDuration, validatePlaybackDuration, avatarFingerprint } =
  await import("../server/presenter/media.mjs");
const avatarBytes = readFileSync(
  new URL("./fixtures/presenter/avatar.png", import.meta.url),
);
const videoBytes = readFileSync(
  new URL("./fixtures/presenter/presenter.mp4", import.meta.url),
);
after(() => {
  store.db.close();
  rmSync(dir, { recursive: true, force: true });
});
mkdirSync(path.join(dir, "speech-audio"), { recursive: true });
function seed() {
  const project = {
    id: randomUUID(),
    title: "数字人测试",
    revision: 1,
    styleId: "clean-light",
    slides: [],
    batches: [],
  };
  const narration = {
    id: randomUUID(),
    projectId: project.id,
    title: project.title,
    status: "ready",
    voiceName: "测试声音",
    options: { voiceId: "test" },
    pages: [],
  };
  store.put("style", {
    id: "clean-light",
    name: "测试",
    rules: "测试",
    refs: [],
  });
  store.assetPath("fixture.png");
  writeFileSync(store.assetPath("fixture.png"), avatarBytes);
  for (let i = 0; i < 3; i++) {
    const slide = {
      id: randomUUID(),
      title: `第 ${i + 1} 页`,
      notes: `测试 ${i}`,
      manuscriptVersion: 1,
      image: "fixture.png",
      scene: null,
      versions: [],
      batchIds: [],
      status: "ready",
    };
    const file = randomUUID() + ".mp3";
    writeFileSync(path.join(dir, "speech-audio", file), silenceMp3);
    project.slides.push(slide);
    narration.pages.push({
      ...slide,
      clips: i === 2 ? [] : [{ text: slide.notes, file, duration: 2 }],
      silentDuration: 0.2,
    });
  }
  store.put("project", project);
  store.put("narration", narration);
  return { project, narration };
}
async function setup() {
  const records = seed();
  const avatar = await p.createAvatar({
    name: "本地测试头像",
    bytes: avatarBytes,
    mime: "image/png",
  });
  return {
    ...records,
    avatar,
    input: {
      avatarId: avatar.id,
      narrationId: records.narration.id,
      placement: "top-right",
      size: "small",
      requestId: randomUUID(),
      confirmed: true,
    },
  };
}
test("image bytes, declared MIME, size and path safety", async () => {
  for (const format of ["png", "jpeg", "webp"]) {
    const bytes = await sharp(avatarBytes)[format]().toBuffer();
    assert.ok((await validateImage(bytes, `image/${format}`)).length);
  }
  await assert.rejects(validateImage(Buffer.from("<svg/>"), "image/png"));
  await assert.rejects(validateImage(avatarBytes, "image/jpeg"));
  await assert.rejects(validateImage(Buffer.alloc(MAX_IMAGE + 1), "image/png"));
  assert.throws(() => videoPath("../escape.mp4"));
  assert.throws(() => videoPath("https://example.com/video.mp4"));
});
test("avatar CRUD retains immutable source assets referenced by completed versions", async () => {
  const { project, input, avatar } = await setup();
  const version = await p.createPresenter(project.id, input, mockProvider);
  await p.runPresenter(version.id, mockProvider);
  p.renameAvatar(avatar.id, "新名字");
  assert.equal(p.listAvatars().find((a) => a.id === avatar.id).name, "新名字");
  p.deleteAvatar(avatar.id);
  assert.ok(!p.listAvatars().some((a) => a.id === avatar.id));
  assert.ok(existsSync(store.assetPath(avatar.sourceAsset)));
  assert.equal(
    (await p.presenterForExport(version.id, project.id, input.narrationId)).id,
    version.id,
  );
});
test("stable replay, conflict prevention, per-page content/audio/avatar staleness", async () => {
  const { project, narration, avatar, input } = await setup();
  let calls = 0;
  const provider = {
    ...mockProvider,
    async generate(request) {
      calls++;
      return mockProvider.generate(request);
    },
  };
  const version = await p.createPresenter(project.id, input, provider);
  const same = await p.createPresenter(project.id, input, provider);
  assert.equal(same.id, version.id);
  await Promise.all([
    p.runPresenter(version.id, provider),
    p.runPresenter(version.id, provider),
  ]);
  assert.equal(calls, 2);
  await p.runPresenter(version.id, provider);
  assert.equal(calls, 2);
  await assert.rejects(
    p.createPresenter(project.id, { ...input, size: "large" }, provider),
    /请求/,
  );
  project.slides[0].notes += " 修改";
  store.put("project", project);
  let viewed = await p.inspectPresenter(store.get("presenter", version.id));
  assert.deepEqual(
    viewed.pages.map((p) => p.stale),
    [true, false, false],
  );
  await assert.rejects(
    p.presenterForExport(version.id, project.id, narration.id),
    /演练中心/,
  );
  project.slides[0].notes = narration.pages[0].notes;
  store.put("project", project);
  narration.pages[1].clips[0].pauseAfter = 0.2;
  store.put("narration", narration);
  viewed = await p.inspectPresenter(store.get("presenter", version.id));
  assert.deepEqual(
    viewed.pages.map((p) => p.stale),
    [false, true, false],
  );
  const updated = await p.createPresenter(
    project.id,
    { ...input, requestId: randomUUID() },
    provider,
  );
  await p.runPresenter(updated.id, provider);
  assert.equal(calls, 3);
  assert.equal(
    store.get("presenter", updated.id).pages[0].videoFile,
    store.get("presenter", version.id).pages[0].videoFile,
  );
  const changed = {
    ...avatar,
    sourceAsset: "changed.png",
    previewAsset: "changed.png",
  };
  writeFileSync(
    store.assetPath("changed.png"),
    await sharp(avatarBytes).tint("red").png().toBuffer(),
  );
  store.put("avatar", changed);
  assert.ok(
    (await p.inspectPresenter(store.get("presenter", updated.id))).pages.every(
      (p) => p.stale,
    ),
  );
});
test("risk confirmation, interrupted recovery and explicit idempotent retry", async () => {
  const { project, input } = await setup();
  await assert.rejects(
    p.createPresenter(project.id, { ...input, confirmed: false }, mockProvider),
    /确认/,
  );
  await assert.rejects(p.createPresenter(project.id, input, null), /稍后接入/);
  const v = await p.createPresenter(project.id, input, mockProvider);
  const running = store.get("presenter", v.id);
  running.status = "running";
  running.pages[0].status = "running";
  store.put("presenter", running);
  p.recoverPresenters();
  assert.equal(store.get("presenter", v.id).status, "interrupted");
  await p.runPresenter(v.id, mockProvider);
  assert.equal(store.get("presenter", v.id).status, "interrupted");
  await assert.rejects(p.retryPresenter(v.id, false, mockProvider), /确认/);
  await p.retryPresenter(v.id, true, mockProvider);
  await p.runPresenter(v.id, mockProvider);
  assert.equal(store.get("presenter", v.id).status, "ready");
  assert.equal(store.get("presenter", v.id).requestId, input.requestId);
});
test("provider outputs validate HTTP status, MIME, MP4 structure and duration; sanitize failures", async () => {
  assert.equal(
    validateVideo({
      bytes: videoBytes,
      contentType: "video/mp4",
      status: 200,
      duration: 2,
    }).duration,
    2,
  );
  for (const delta of [
    { status: 403 },
    { contentType: "text/html" },
    { bytes: Buffer.from("fake") },
    { duration: Infinity },
    { duration: 200 },
  ])
    assert.throws(() =>
      validateVideo({
        bytes: videoBytes,
        status: 200,
        contentType: "video/mp4",
        duration: 2,
        ...delta,
      }),
    );
  const { project, input } = await setup();
  const bad = {
    ...mockProvider,
    async generate() {
      throw new Error("https://provider.invalid/?token=secret private-key");
    },
  };
  const v = await p.createPresenter(project.id, input, bad);
  await p.runPresenter(v.id, bad);
  const saved = store.get("presenter", v.id);
  assert.equal(saved.status, "partial");
  assert.doesNotMatch(
    JSON.stringify(saved),
    /provider.invalid|secret|private-key/,
  );
});

export { setup, dir, store, p, mockProvider, videoBytes };

// Deliberately inconsistent headers for hostile-container tests. Playback and
// positive validation always use the unchanged, decodable fixture.
function movieDuration(seconds) {
  const bytes = Buffer.from(videoBytes);
  const begin = bytes.indexOf(Buffer.from("mvhd")) + 4;
  const scale = bytes.readUInt32BE(begin + 12);
  bytes.writeUInt32BE(Math.round(seconds * scale), begin + 16);
  return bytes;
}
test("input clips and all pauses define duration; inclusive tolerance has a floor and cap", () => {
  assert.equal(expectedPlaybackDuration([
    { duration: 0.7, pauseAfter: 0.2 },
    { duration: 0.8, pauseAfter: 0.3 },
  ]), 2);
  for (const clips of [[], [{ duration: NaN }], [{ duration: 0 }],
    [{ duration: 2, pauseAfter: -1 }], [{ duration: 2, pauseAfter: Infinity }]])
    assert.throws(() => expectedPlaybackDuration(clips));
  for (const [expected, tolerance] of [[2, 0.25], [10, 0.5], [60, 1]]) {
    for (const offset of [-tolerance, 0, tolerance])
      assert.doesNotThrow(() => validatePlaybackDuration(expected + offset, expected));
    for (const offset of [-tolerance - 0.001, tolerance + 0.001])
      assert.throws(() => validatePlaybackDuration(expected + offset, expected), /口播及停顿/);
  }
});

function mp4Box(type, payload) {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(payload.length + 8);
  header.write(type, 4, "ascii");
  return Buffer.concat([header, payload]);
}
function fixtureBox(type, from = 0) {
  const start = videoBytes.indexOf(Buffer.from(type), from) - 4;
  return videoBytes.subarray(start, start + videoBytes.readUInt32BE(start));
}
function corruptField(type, offset, value, wide = false) {
  const bytes = Buffer.from(videoBytes), start = bytes.indexOf(Buffer.from(type)) + 4;
  if (wide) bytes.writeBigUInt64BE(value, start + offset);
  else bytes.writeUInt32BE(value, start + offset);
  return bytes;
}
const validateFixture = (bytes = videoBytes, expectedDuration = 2) =>
  validateVideo({ bytes, status: 200, contentType: "video/mp4", expectedDuration });

// Structural fixtures reuse real codec descriptions/headers, but their one-byte
// samples are not decodable media. Playback/brand tests below use videoBytes.
function sampleTableMovie(specs, seconds = 2, payloadSize) {
  const words = (...values) => {
    const bytes = Buffer.alloc(values.length * 4);
    values.forEach((value, i) => bytes.writeUInt32BE(value >>> 0, i * 4));
    return bytes;
  };
  const table = (type, rows, version = 0) =>
    mp4Box(type, words(version << 24, rows.length, ...rows.flat()));
  const mvhd = Buffer.from(fixtureBox("mvhd"));
  mvhd.writeUInt32BE(seconds * 1000, 24);
  function track(spec, index, offset) {
    const { samples, audio = false, chunks = 1, timing = [[samples, 1]],
      composition, signed = false, variable = false } = spec;
    const ticks = timing.reduce((sum, [count, delta]) => sum + count * delta, 0);
    const tkhd = Buffer.from(fixtureBox("tkhd"));
    tkhd.writeUInt32BE(index + 1, 20);
    tkhd.writeUInt32BE(seconds * 1000, 28);
    const mdhd = Buffer.from(fixtureBox("mdhd"));
    mdhd.writeUInt32BE(ticks / seconds, 20);
    mdhd.writeUInt32BE(ticks, 24);
    const hdlr = Buffer.from(fixtureBox("hdlr"));
    hdlr.write(audio ? "soun" : "vide", 16);
    const stsz = mp4Box("stsz", Buffer.concat([
      words(0, variable ? 0 : 1, samples),
      variable ? Buffer.alloc(samples * 4) : Buffer.alloc(0),
    ]));
    if (variable) for (let i = 0; i < samples; i++) stsz.writeUInt32BE(1, 20 + i * 4);
    const stco = mp4Box("stco", Buffer.alloc(8 + chunks * 4));
    stco.writeUInt32BE(chunks, 12);
    for (let i = 0; i < chunks; i++) stco.writeUInt32BE(offset + i * samples / chunks, 16 + i * 4);
    return mp4Box("trak", Buffer.concat([
      tkhd,
      mp4Box("mdia", Buffer.concat([
        mdhd, hdlr,
        mp4Box("minf", Buffer.concat([
          fixtureBox(audio ? "smhd" : "vmhd"), fixtureBox("dinf"),
          mp4Box("stbl", Buffer.concat([
            mp4Box("stsd", Buffer.concat([words(0, 1), fixtureBox(audio ? "mp4a" : "avc1", 32)])),
            table("stts", timing),
            ...(composition ? [table("ctts", composition, signed ? 1 : 0)] : []),
            table("stsc", [[1, samples / chunks, 1]]), stsz, stco,
          ])),
        ])),
      ])),
    ]));
  }
  const ftyp = fixtureBox("ftyp");
  const headerSize = ftyp.length + mp4Box("moov", Buffer.concat([
    mvhd, ...specs.map((spec, i) => track(spec, i, 0)),
  ])).length + 8;
  let offset = headerSize;
  const tracks = specs.map((spec, i) => {
    const result = track(spec, i, offset);
    // Small hostile declarations never allocate samples-sized payloads.
    offset += payloadSize === undefined ? spec.samples : 0;
    return result;
  });
  return Buffer.concat([
    ftyp, mp4Box("moov", Buffer.concat([mvhd, ...tracks])),
    mp4Box("mdat", Buffer.alloc(payloadSize ?? offset - headerSize, 1)),
  ]);
}

test("MP4 accepts real 2-second iso6 and supported compatible brands", () => {
  for (const major of ["isom", "iso2", "iso4", "iso5", "iso6", "mp41", "mp42", "avc1", "zzzz"]) {
    const bytes = Buffer.from(videoBytes);
    bytes.write(major, 8);
    assert.equal(validateFixture(bytes, 2).duration, 2, major);
  }
  const unknown = Buffer.from(videoBytes);
  unknown.write("zzzz", 8);
  for (let at = 16; at < fixtureBox("ftyp").length; at += 4) unknown.write("zzzz", at);
  unknown.write("isom", 12); // minor_version cannot grant compatibility
  assert.throws(() => validateFixture(unknown), /完整的 MP4/);
  const iso6Only = Buffer.from(unknown);
  iso6Only.write("iso6", 8);
  assert.equal(validateFixture(iso6Only).duration, 2);
});

test("MP4 accepts a real final size=0 mdat but rejects swallowed boxes, data and nested size=0", () => {
  const bytes = Buffer.from(videoBytes), mdat = bytes.indexOf(Buffer.from("mdat")) - 4;
  assert.equal(mdat + bytes.readUInt32BE(mdat), bytes.length);
  bytes.writeUInt32BE(0, mdat);
  assert.equal(validateFixture(bytes, 2).duration, 2);
  bytes.write("iso6", 8);
  assert.equal(validateFixture(bytes, 2).duration, 2);
  const fakeHeader = Buffer.from(fixtureBox("mvhd"));
  fakeHeader.writeUInt32BE(20000, 24);
  for (const tail of [mp4Box("moov", fakeHeader), fixtureBox("moov"),
    mp4Box("free", Buffer.alloc(0)), Buffer.from([1]), Buffer.alloc(32)]) {
    const attack = Buffer.concat([bytes, tail]);
    assert.throws(() => validateFixture(attack, 2), /完整的 MP4/);
    assert.throws(() => validateFixture(attack, 20), /完整的 MP4/);
  }
  // An EOF mdat before the moov must not hide the mandatory movie box.
  assert.throws(() => validateFixture(Buffer.concat([
    fixtureBox("ftyp"), bytes.subarray(mdat), fixtureBox("moov"),
  ])), /完整的 MP4/);
  for (const type of ["moov", "trak", "mdia", "stbl", "stts", "url "])
    assert.throws(() => validateFixture(corruptField(type, -8, 0)), /完整的 MP4/, type);
  const nested = mp4Box("mdat", Buffer.from([1]));
  nested.writeUInt32BE(0);
  assert.throws(() => validateFixture(Buffer.concat([
    fixtureBox("ftyp"), mp4Box("moov", nested), fixtureBox("mdat"),
  ])), /完整的 MP4/);
});

test("MP4 preflights hostile counts before any sample/chunk allocation", (t) => {
  const huge = sampleTableMovie([{ samples: 30000000 }, { samples: 30000000, audio: true }], 2, 1);
  const manyTracks = sampleTableMovie(Array.from({ length: 17 }, () => ({ samples: 30000000 })), 2, 1);
  const totalSamples = sampleTableMovie(Array.from({ length: 5 }, () => ({ samples: 500000 })), 2, 500000);
  const tooManyBoxes = Buffer.concat([videoBytes, Buffer.alloc(4097 * 8)]);
  for (let at = videoBytes.length; at < tooManyBoxes.length; at += 8) {
    tooManyBoxes.writeUInt32BE(8, at);
    tooManyBoxes.write("free", at + 4);
  }
  const attacks = [huge, manyTracks, totalSamples, tooManyBoxes,
    ...["stts", "ctts", "stsc", "stco", "stss"].map((type) => corruptField(type, 4, 30000000))];
  assert.ok(huge.length < 4096);
  assert.ok(manyTracks.length < 16384);
  assert.ok(attacks.every((bytes) => bytes.length < 520000));
  // A regression cannot actually allocate a giant typed array: trip the guard
  // before allocation. Even the bounded chunk buffer must await preflight.
  for (const name of ["Uint32Array", "Float64Array"])
    t.mock.method(globalThis, name, function () { throw new Error("premature typed array allocation"); });
  const start = performance.now();
  for (const bytes of attacks) assert.throws(() => validateFixture(bytes), /完整的 MP4/);
  assert.ok(performance.now() - start < 1000, "small declarations must reject within 1 second");
});

test("MP4 budgets cover 30-minute 240fps video and 192kHz/960 AAC with one chunk per sample", (t) => {
  const bytes = sampleTableMovie([
    { samples: 432000, chunks: 432000 },
    { samples: 360000, chunks: 360000, audio: true, variable: true },
  ], 1800);
  assert.ok(bytes.length < 6 * 1024 * 1024);
  t.mock.method(globalThis, "Uint32Array", function () { throw new Error("per-sample array allocation"); });
  assert.equal(validateFixture(bytes, 1800).duration, 1800);
});

test("MP4 run intersections preserve variable decode deltas and signed composition offsets", () => {
  const movie = (composition, signed = false) => sampleTableMovie([
    { samples: 6, timing: [[2, 2], [4, 4]], composition, signed },
    { samples: 20, audio: true },
  ], 2);
  for (const composition of [undefined, [[3, 0], [3, 0]], [[1, 2], [1, -2], [4, 0]]])
    assert.equal(validateFixture(movie(composition, true)).duration, 2);
  for (const composition of [[[3, 0], [2, 0]], [[3, 0], [4, 0]], [[3, 0], [3, 5]], [[6, -2]]])
    assert.throws(() => validateFixture(movie(composition, true)), /完整的 MP4/);
});

test("MP4 rejects the exact appended 20-second moov attack on the real 2-second fixture", () => {
  const fakeHeader = Buffer.from(fixtureBox("mvhd"));
  fakeHeader.writeUInt32BE(20000, 24);
  const attack = Buffer.concat([videoBytes, mp4Box("moov", fakeHeader)]);
  assert.equal(validateFixture().duration, 2);
  assert.throws(() => validateFixture(attack, 20), /完整的 MP4/);
  assert.throws(() => validateFixture(Buffer.concat([videoBytes, videoBytes]), 2), /完整的 MP4/);
});

test("MP4 rejects duplicate and misplaced movie/track headers and arbitrary handler markers", () => {
  const mvhd = fixtureBox("mvhd"), moov = fixtureBox("moov");
  const prefix = fixtureBox("ftyp"), tail = videoBytes.subarray(32 + moov.length);
  for (const bytes of [
    Buffer.concat([prefix, mp4Box("moov", Buffer.concat([moov.subarray(8), mvhd])), tail]),
    Buffer.concat([prefix, mp4Box("moov", Buffer.concat([moov.subarray(8), mp4Box("trak", mvhd)])), tail]),
    Buffer.concat([prefix, mp4Box("moov", Buffer.concat([moov.subarray(8), mp4Box("udta", mvhd)])), tail]),
    Buffer.concat([prefix, mp4Box("moov", Buffer.concat([moov.subarray(8), mp4Box("trak", moov)])), tail]),
    Buffer.concat([videoBytes, mvhd]),
    Buffer.concat([prefix, mp4Box("moov", Buffer.concat([mvhd, fixtureBox("hdlr")])), tail]),
    Buffer.concat([prefix, mp4Box("moov", Buffer.concat([mvhd, mp4Box("trak", fixtureBox("hdlr"))])), tail]),
  ]) assert.throws(() => validateFixture(bytes), /完整的 MP4/);
  // Duplicate required boxes inside an otherwise intact hierarchy.
  for (const type of ["tkhd", "mdhd", "hdlr", "stts", "stsz", "stsc", "stco", "elst"]) {
    const duplicate = fixtureBox(type), start = videoBytes.indexOf(Buffer.from(type)) - 4;
    const bytes = Buffer.concat([videoBytes.subarray(0, start), duplicate, videoBytes.subarray(start)]);
    function growAncestors(at, end) {
      while (at < end) {
        const size = videoBytes.readUInt32BE(at), kind = videoBytes.toString("ascii", at + 4, at + 8);
        if (at < start && start < at + size && ["moov", "trak", "mdia", "minf", "stbl", "edts"].includes(kind)) {
          bytes.writeUInt32BE(size + duplicate.length, at);
          growAncestors(at + 8, at + size);
        }
        at += size;
      }
    }
    growAncestors(0, videoBytes.length);
    assert.throws(() => validateFixture(bytes), /完整的 MP4/, type);
  }
});

test("MP4 binds movie duration to track presentation, media samples, edit lists and local chunk bytes", () => {
  const shiftedWithoutEdit = Buffer.from(videoBytes);
  shiftedWithoutEdit.write("free", shiftedWithoutEdit.indexOf(Buffer.from("edts")));
  const forgedAllHeaders = movieDuration(20);
  for (const type of ["tkhd", "mdhd"]) {
    let at = 0;
    while ((at = forgedAllHeaders.indexOf(Buffer.from(type), at)) !== -1) {
      const begin = at + 4;
      const scale = type === "tkhd" ? 1000 : forgedAllHeaders.readUInt32BE(begin + 12);
      forgedAllHeaders.writeUInt32BE(20 * scale, begin + (type === "tkhd" ? 20 : 16));
      at += 4;
    }
  }
  for (const bytes of [
    movieDuration(20), movieDuration(0.5), forgedAllHeaders, shiftedWithoutEdit,
    corruptField("tkhd", 20, 20000), corruptField("mdhd", 16, 204800),
    corruptField("elst", 8, 20000), corruptField("elst", 12, 0x7fffffff),
    corruptField("elst", 16, 0), corruptField("stts", 12, 10240),
    corruptField("stts", 8, 0xffffffff), corruptField("ctts", 12, 0x7fffffff),
    corruptField("stsc", 12, 0xffffffff), corruptField("stco", 8, 0),
    corruptField("stco", 8, videoBytes.length - 1), corruptField("stsz", 12, 0xffffffff),
    corruptField("dref", 4, 0), corruptField("stsd", 4, 0),
  ]) assert.throws(() => validateFixture(bytes, 20), /完整的 MP4/);
});

test("MP4 rejects truncation, invalid time fields, unsupported versions and overflowing box sizes", () => {
  const overflow = Buffer.alloc(16);
  overflow.writeUInt32BE(1);
  overflow.write("free", 4);
  overflow.writeBigUInt64BE(2n ** 63n, 8);
  for (const bytes of [
    videoBytes.subarray(0, -1), videoBytes.subarray(0, 140),
    Buffer.concat([videoBytes, Buffer.from([0, 0, 0, 8])]),
    Buffer.concat([videoBytes, overflow]),
    corruptField("moov", -8, 0xffffffff), corruptField("moov", -8, 0),
    corruptField("mvhd", 12, 0), corruptField("mvhd", 16, 0),
    corruptField("mvhd", 16, 0xffffffff), corruptField("mvhd", 0, 0x02000000),
    corruptField("mdhd", 12, 0), corruptField("tkhd", 20, 0),
  ]) assert.throws(() => validateFixture(bytes), /完整的 MP4/);
});

test("real 2-second MP4 passes inclusive expected-duration tolerance boundaries", () => {
  for (const expected of [1.75, 2, 2.25]) assert.equal(validateFixture(videoBytes, expected).duration, 2);
  for (const expected of [1.749, 2.251]) assert.throws(() => validateFixture(videoBytes, expected), /口播及停顿/);
});

test("provider claims cannot approve short/long videos; failed pages are neither cached nor exported", async () => {
  for (const actual of [0.5, 20]) {
    const { project, narration, input } = await setup();
    narration.pages[0].clips = [
      { ...narration.pages[0].clips[0], duration: 0.7, pauseAfter: 0.2 },
      { ...narration.pages[0].clips[0], duration: 0.8, pauseAfter: 0.3 },
    ];
    store.put("narration", narration);
    const provider = { ...mockProvider, async generate(request) {
      assert.equal(request.audio.clips.length, 2);
      assert.equal(expectedPlaybackDuration(request.audio.clips), 2);
      assert.ok(request.audio.clips.every((c) => c.bytes.equals(silenceMp3)));
      return { status: 200, contentType: "video/mp4", duration: 2,
        bytes: movieDuration(actual) };
    } };
    const v = await p.createPresenter(project.id, input, provider);
    await p.runPresenter(v.id, provider);
    const failed = store.get("presenter", v.id);
    assert.equal(failed.status, "partial");
    assert.equal(failed.pages[0].status, "failed");
    assert.equal(failed.pages[0].videoFile, undefined);
    await assert.rejects(p.presenterForExport(v.id, project.id, narration.id));
    const retry = await p.createPresenter(project.id,
      { ...input, requestId: randomUUID() }, provider);
    assert.equal(retry.pages[0].status, "pending");
  }
  const { project, narration, input } = await setup();
  const provider = { ...mockProvider, async generate(request) {
    return { ...(await mockProvider.generate(request)), duration: 999 };
  } };
  const v = await p.createPresenter(project.id, input, provider);
  await p.runPresenter(v.id, provider);
  const saved = store.get("presenter", v.id);
  assert.equal(saved.status, "ready");
  assert.equal(saved.pages[0].duration, 2);
  // Simulate a previously accepted but truncated cached version with matching
  // source fingerprints. Inspection, cache lookup and both exports recheck it.
  const short = movieDuration(0.5);
  writeFileSync(videoPath(saved.pages[0].videoFile), short);
  saved.pages[0].duration = 0.5;
  saved.pages[0].videoFingerprint = createHash("sha256").update(short).digest("hex");
  store.put("presenter", saved);
  assert.equal((await p.inspectPresenter(saved)).current, false);
  await assert.rejects(p.presenterForExport(v.id, project.id, narration.id));
  const fresh = await p.createPresenter(project.id,
    { ...input, requestId: randomUUID() }, provider);
  assert.equal(fresh.pages[0].status, "pending");
  const { renderStaticHtml } = await import("../server/html-export.mjs");
  const { renderMotionHtml } = await import("../server/motion/render.mjs");
  await assert.rejects(renderStaticHtml(project, { narration, presenter: saved }), /MP4|口播及停顿/);
  const motion = { title: project.title, pages: project.slides.map((s) => ({
    ...s, background: s.image, width: 256, height: 256, layers: [],
    source: { image: s.image, notes: s.notes },
  })) };
  await assert.rejects(renderMotionHtml(motion, { narration, presenter: saved }), /MP4|口播及停顿/);
});

test("JPEG/WebP packages strip synthetic EXIF/GPS, remap PNG references and preserve stale history", async () => {
  const { exportProjectPackage, importProjectPackage } = await import("../server/project-package.mjs");
  for (const format of ["jpeg", "webp"]) {
    const { project, narration, avatar, input } = await setup();
    const version = await p.createPresenter(project.id, input, mockProvider);
    await p.runPresenter(version.id, mockProvider);
    const legacy = await sharp(avatarBytes).withExif({
      IFD0: { Artist: "synthetic-private-fixture" },
      IFD3: { GPSLatitudeRef: "N", GPSLatitude: "1/1 2/1 3/1",
        GPSLongitudeRef: "E", GPSLongitude: "4/1 5/1 6/1" },
    })[format]().toBuffer();
    assert.ok((await sharp(legacy).metadata()).exif);
    assert.ok(legacy.includes(Buffer.from("synthetic-private-fixture")));
    avatar.sourceAsset = randomUUID() + (format === "jpeg" ? ".jpg" : ".webp");
    avatar.previewAsset = avatar.sourceAsset;
    writeFileSync(store.assetPath(avatar.sourceAsset), legacy);
    store.put("avatar", avatar);
    const current = store.get("presenter", version.id);
    for (const page of current.pages)
      page.avatarFingerprint = avatarFingerprint(legacy, avatar);
    store.put("presenter", current);
    const historical = structuredClone(current);
    historical.id = randomUUID();
    historical.pages[0].avatarFingerprint = "0".repeat(64);
    historical.pages[1].sourceFingerprint = "0".repeat(64);
    historical.pages[2].audioFingerprint = "0".repeat(64);
    store.put("presenter", historical);
    let source = project;
    for (let round = 0; round < 2; round++) {
      const zip = await exportProjectPackage(source);
      const imported = await importProjectPackage(await zip.generateAsync({ type: "nodebuffer" }));
      source = imported.project;
      const versions = store.all("presenter").filter((v) => v.projectId === source.id);
      assert.equal(versions.length, 2);
      const mapped = store.get("avatar", versions[0].avatarId);
      assert.match(mapped.sourceAsset, /\.png$/);
      assert.equal(mapped.previewAsset, mapped.sourceAsset);
      const bytes = readFileSync(store.assetPath(mapped.sourceAsset));
      assert.deepEqual(bytes.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      const info = await sharp(bytes).metadata();
      assert.equal(info.format, "png");
      for (const key of ["exif", "xmp", "iptc", "icc"]) assert.equal(info[key], undefined);
      assert.ok(!bytes.includes(Buffer.from("synthetic-private-fixture")));
      const inspected = await Promise.all(versions.map(p.inspectPresenter));
      const ready = inspected.find((v) => v.current);
      assert.ok(ready);
      assert.deepEqual(inspected.find((v) => !v.current).pages.map((p) => p.stale), [true, true, true]);
      assert.equal(ready.pages[0].avatarFingerprint, avatarFingerprint(bytes, mapped));
      assert.notEqual(ready.pages[0].avatarFingerprint, current.pages[0].avatarFingerprint);
      await p.presenterForExport(ready.id, source.id, ready.narrationId);
      if (round === 1) {
        let calls = 0;
        const provider = { ...mockProvider, id: "mime-check", async generate(request) {
          calls++;
          assert.equal(request.profile.source.contentType, "image/png");
          assert.ok(request.profile.source.bytes.equals(bytes));
          assert.equal((await sharp(request.profile.source.bytes).metadata()).format, "png");
          return mockProvider.generate(request);
        } };
        const generated = await p.createPresenter(source.id, { ...input,
          avatarId: mapped.id, narrationId: ready.narrationId, requestId: randomUUID(),
        }, provider);
        await p.runPresenter(generated.id, provider);
        assert.equal(calls, 2);
        assert.equal(store.get("presenter", generated.id).status, "ready");
      }
    }
  }
});

test("concurrent replay and ambiguous failure retry use the identical provider page request", async () => {
  const { project, input } = await setup();
  const requests = [];
  let failOnce = true;
  const provider = {
    ...mockProvider,
    async generate(request) {
      requests.push(request.requestId);
      if (failOnce) {
        failOnce = false;
        throw new Error("ambiguous response");
      }
      return mockProvider.generate(request);
    },
  };
  const [a, b] = await Promise.all([
    p.createPresenter(project.id, input, provider),
    p.createPresenter(project.id, input, provider),
  ]);
  assert.equal(a.id, b.id);
  await p.runPresenter(a.id, provider);
  assert.equal(store.get("presenter", a.id).status, "partial");
  await p.retryPresenter(a.id, true, provider);
  await p.runPresenter(a.id, provider);
  assert.equal(requests[0], requests[1]);
  assert.equal(new Set(requests).size, 2);
});

test("missing or modified local videos become stale and provider output URLs are discarded", async () => {
  const { project, input } = await setup();
  const provider = {
    ...mockProvider,
    async generate(request) {
      return {
        ...(await mockProvider.generate(request)),
        url: "https://expiring.invalid/?token=private",
        logs: ["private"],
      };
    },
  };
  const v = await p.createPresenter(project.id, input, provider);
  await p.runPresenter(v.id, provider);
  const saved = store.get("presenter", v.id);
  assert.doesNotMatch(JSON.stringify(saved), /expiring|private|logs/);
  const filename = videoPath(saved.pages[0].videoFile);
  writeFileSync(filename, Buffer.from("invalid video"));
  assert.equal((await p.inspectPresenter(saved)).pages[0].stale, true);
  rmSync(filename);
  assert.equal((await p.inspectPresenter(saved)).current, false);
  await assert.rejects(
    p.presenterForExport(v.id, project.id, input.narrationId),
    /演练中心/,
  );
});

test("editable-scene presenter fingerprints survive independent package ID remapping", async () => {
  const { composeScene, samplePlan, defaultSystem } =
    await import("../shared/slides.mjs");
  const { exportProjectPackage, importProjectPackage } =
    await import("../server/project-package.mjs");
  const { project, narration, input } = await setup();
  const system = defaultSystem({});
  const scene = composeScene(samplePlan(system.layouts[0]), system);
  project.slides[0].scene = scene;
  project.slides[0].image = null;
  narration.pages[0].scene = structuredClone(scene);
  narration.pages[0].image = null;
  store.put("project", project);
  store.put("narration", narration);
  const v = await p.createPresenter(project.id, input, mockProvider);
  await p.runPresenter(v.id, mockProvider);
  const zip = await exportProjectPackage(project);
  const imported = await importProjectPackage(
    await zip.generateAsync({ type: "nodebuffer" }),
  );
  const mapped = store
    .all("presenter")
    .find((v) => v.projectId === imported.project.id);
  assert.equal((await p.inspectPresenter(mapped)).current, true);
});

test("project package includes only referenced avatars/videos, remaps identities and excludes operation/provider data", async () => {
  const { exportProjectPackage, importProjectPackage } =
    await import("../server/project-package.mjs");
  const JSZip = (await import("jszip")).default;
  const { project, input, avatar } = await setup();
  const v = await p.createPresenter(project.id, input, mockProvider);
  await p.runPresenter(v.id, mockProvider);
  const saved = store.get("presenter", v.id);
  saved.providerUrl = "https://provider.invalid/?token=never-export";
  saved.operationToken = "never-export";
  saved.apiKey = "never-export";
  store.put("presenter", saved);
  const zip = await exportProjectPackage(project);
  const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
  assert.doesNotMatch(
    JSON.stringify(manifest),
    /never-export|provider.invalid|requestId|requestFingerprint/,
  );
  assert.equal(manifest.records.filter((r) => r.kind === "avatar").length, 1);
  assert.ok(manifest.files.some((f) => f.path.startsWith("presenter-video/")));
  const packageBytes = await zip.generateAsync({ type: "nodebuffer" });
  const result = await importProjectPackage(packageBytes);
  const imported = store
    .all("presenter")
    .find((v) => v.projectId === result.project.id);
  assert.notEqual(imported.id, v.id);
  assert.notEqual(imported.avatarId, avatar.id);
  assert.notEqual(imported.narrationId, input.narrationId);
  assert.notEqual(imported.pages[0].pageId, v.pages[0].pageId);
  assert.notEqual(imported.pages[0].videoFile, saved.pages[0].videoFile);
  assert.equal((await p.inspectPresenter(imported)).current, true);
  const hostile = await JSZip.loadAsync(packageBytes);
  manifest.records.find((r) => r.kind === "presenter").value.providerUrl =
    "https://provider.invalid/?secret";
  hostile.file("manifest.json", JSON.stringify(manifest));
  await assert.rejects(
    importProjectPackage(await hostile.generateAsync({ type: "nodebuffer" })),
    /数字人/,
  );
  saved.status = "running";
  saved.pages[0].status = "running";
  store.put("presenter", saved);
  const interruptedZip = await exportProjectPackage(project);
  const interrupted = await importProjectPackage(
    await interruptedZip.generateAsync({ type: "nodebuffer" }),
  );
  assert.equal(
    store.all("presenter").find((v) => v.projectId === interrupted.project.id)
      .status,
    "interrupted",
  );
});

test("static and motion HTML stream video assets, retain offline fallback narration and keep legacy exports", async () => {
  const { renderStaticHtml, writeStaticHtml } =
    await import("../server/html-export.mjs");
  const { renderMotionHtml } = await import("../server/motion/render.mjs");
  const { htmlPayload } = await import("./helpers/html-payload.mjs");
  const { project, narration, input } = await setup();
  const v = await p.createPresenter(project.id, input, mockProvider);
  await p.runPresenter(v.id, mockProvider);
  const presenter = await p.presenterForExport(v.id, project.id, narration.id);
  const html = await renderStaticHtml(project, { narration, presenter });
  const data = htmlPayload(html);
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /data:video\/mp4;base64,/);
  assert.match(html, /"presenter":\{"asset":"asset:media-/);
  assert.equal(data.pages[0].clips.length, 1);
  assert.equal(data.pages[2].presenter, null);
  assert.equal(Object.keys(data.audio).length, 2);
  assert.doesNotMatch(html, /provider.invalid|requestId|videoFile/);
  const file = path.join(dir, "streamed.html");
  await writeStaticHtml(project, { narration, presenter }, file);
  assert.equal(readFileSync(file, "utf8"), html);
  const deck = {
    title: project.title,
    pages: project.slides.map((s, i) => ({
      id: s.id,
      number: i + 1,
      title: s.title,
      status: "ready",
      width: 256,
      height: 256,
      background: s.image,
      layers: [],
      source: { image: s.image, notes: s.notes },
    })),
  };
  const motion = htmlPayload(
    await renderMotionHtml(deck, { narration, presenter }),
  );
  assert.deepEqual(motion.presenter, data.presenter);
  assert.equal(motion.pages[0].clips.length, 1);
  const audioOnly = htmlPayload(await renderStaticHtml(project, { narration }));
  assert.equal(audioOnly.pages[0].clips.length, 1);
  assert.equal(audioOnly.presenter, null);
  const silent = htmlPayload(await renderStaticHtml(project));
  assert.equal(silent.narration, null);
  const many = {
    ...project,
    slides: Array.from({ length: 128 }, (_, i) => ({
      ...project.slides[0],
      id: `page-${i}`,
    })),
  };
  const manyNarration = {
    ...narration,
    pages: many.slides.map((s) => ({ ...narration.pages[0], id: s.id })),
  };
  const manyPresenter = {
    ...presenter,
    pages: many.slides.map((s) => ({ ...presenter.pages[0], pageId: s.id })),
  };
  const bigFile = path.join(dir, "128-pages.html");
  await writeStaticHtml(
    many,
    { narration: manyNarration, presenter: manyPresenter },
    bigFile,
  );
  assert.equal(
    (readFileSync(bigFile, "utf8").match(/data:video\/mp4;base64,/g) || [])
      .length,
    128,
  );
});
