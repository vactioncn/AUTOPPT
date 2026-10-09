import path from "node:path";
import { lstat, readFile } from "node:fs/promises";
import sharp from "sharp";
import { createHash } from "node:crypto";
import { dataDir } from "../store.mjs";

export const MAX_IMAGE = 8 * 1024 * 1024;
export const MAX_VIDEO = 64 * 1024 * 1024;
// 30 min at 240 fps = 432,000 video samples; AAC at 192 kHz with
// 960-sample packets = 360,000 packets (48 kHz / 1024 needs only 84,375).
// 500k/track leaves rounding/encoder headroom. File budgets allow additional
// audio tracks without multiplying every limit by the 16-track ceiling.
const MP4_LIMITS = {
  boxes: 4096,
  tracks: 16,
  brands: 32,
  samplesPerTrack: 500000,
  samples: 2000000,
  entriesPerTable: 500000,
  entriesPerTrack: 3000000, // up to six sample-sized tables
  entries: 6000000,
  chunksPerTrack: 500000, // permits one chunk per sample
  chunks: 1000000, // > 432k video + 360k AAC, at most 8 MB of intervals
  work: 40000000, // table scans, run intersections, chunk lookup and sort
};
export function avatarFingerprint(bytes, avatar) {
  const hash = (v) => createHash("sha256").update(v).digest("hex");
  return hash(
    JSON.stringify([
      hash(bytes),
      avatar.kind,
      avatar.provider,
      avatar.providerAvatarId || null,
    ]),
  );
}
export const videoName = (name) =>
  typeof name === "string" && /^[a-f0-9-]{36}\.mp4$/.test(name);
export function videoPath(name) {
  if (!videoName(name)) throw new Error("数字人视频路径无效");
  return path.join(dataDir, "presenter-video", name);
}
export async function readLocal(file) {
  const stat = await lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink())
    throw new Error("素材必须是本地普通文件");
  return readFile(file);
}
export async function validateImage(bytes, mime) {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > MAX_IMAGE)
    throw new Error("头像图片应为不超过 8 MB 的 JPEG、PNG 或 WebP");
  const formats = {
    "image/jpeg": "jpeg",
    "image/png": "png",
    "image/webp": "webp",
  };
  if (!formats[mime]) throw new Error("头像仅支持 JPEG、PNG 或 WebP");
  try {
    const image = sharp(bytes, {
      limitInputPixels: 25000000,
      failOn: "warning",
    });
    const info = await image.metadata();
    if (
      info.format !== formats[mime] ||
      info.pages > 1 ||
      !info.width ||
      !info.height
    )
      throw new Error("invalid image");
    // Decode, rotate, bound dimensions and strip uploaded EXIF/metadata.
    return await image
      .rotate()
      .resize(1024, 1024, { fit: "inside", withoutEnlargement: true })
      .png()
      .toBuffer();
  } catch {
    throw new Error(
      "头像图片字节或类型无效，请选择完整的静态 JPEG、PNG 或 WebP",
    );
  }
}

// The same clip sequence is sent to the adapter and checked on reuse/export.
export function expectedPlaybackDuration(clips) {
  let duration = 0;
  for (const clip of clips) {
    const pause = clip.pauseAfter ?? 0;
    if (
      !Number.isFinite(clip.duration) ||
      clip.duration <= 0 ||
      !Number.isFinite(pause) ||
      pause < 0
    )
      throw new Error("口播片段时长或停顿无效");
    duration += clip.duration + pause;
  }
  if (!Number.isFinite(duration) || duration <= 0 || duration > 1800)
    throw new Error("数字人口播总时长应在 0–1800 秒之间");
  return duration;
}

// Allow codec padding/frame rounding: 5%, with a 250 ms floor and 1 s cap.
export function validatePlaybackDuration(actual, expected) {
  const tolerance = Math.max(0.25, Math.min(1, expected * 0.05));
  if (
    !Number.isFinite(expected) ||
    expected <= 0 ||
    expected > 1800 ||
    Math.abs(actual - expected) > tolerance + 1e-9
  )
    throw new Error("数字人视频时长与本页口播及停顿不一致");
}

// Bounded structural ISO BMFF validation, not a codec/bitstream decoder.
// No system ffmpeg is used by the application.
// duration, when supplied, is saved local metadata, never an adapter claim.
export function validateVideo({
  bytes,
  contentType,
  status,
  duration,
  expectedDuration,
}) {
  const invalid = () => {
    throw new Error(
      "数字人输出应为完整的 MP4 视频，含有效时长和音轨，且不超过 64 MB",
    );
  };
  if (
    status !== 200 ||
    contentType?.split(";")[0] !== "video/mp4" ||
    !Buffer.isBuffer(bytes) ||
    bytes.length < 32 ||
    bytes.length > MAX_VIDEO
  )
    invalid();
  // Only a self-contained, non-fragmented movie is accepted. Metadata boxes
  // never supply duration/handlers; every structural box has a fixed parent.
  const parents = {
    ftyp: ["root"],
    moov: ["root"],
    mdat: ["root"],
    mvhd: ["moov"],
    trak: ["moov"],
    tkhd: ["trak"],
    edts: ["trak"],
    elst: ["edts"],
    mdia: ["trak"],
    mdhd: ["mdia"],
    hdlr: ["mdia", "meta"],
    minf: ["mdia"],
    vmhd: ["minf"],
    smhd: ["minf"],
    dinf: ["minf"],
    dref: ["dinf"],
    stbl: ["minf"],
    stsd: ["stbl"],
    stts: ["stbl"],
    ctts: ["stbl"],
    stsc: ["stbl"],
    stsz: ["stbl"],
    stco: ["stbl"],
    co64: ["stbl"],
    stss: ["stbl"],
  };
  const containers = new Set([
    "moov",
    "trak",
    "edts",
    "mdia",
    "minf",
    "dinf",
    "stbl",
    "udta",
    "meta",
  ]);
  let boxCount = 0,
    trackCount = 0;
  function boxes(start, end, parent = "root", depth = 0) {
    if (depth > 8) invalid();
    const result = [],
      seen = new Set();
    for (let at = start; at < end;) {
      if (++boxCount > MP4_LIMITS.boxes || end - at < 8) invalid();
      let size = bytes.readUInt32BE(at),
        header = 8;
      const type = bytes.toString("ascii", at + 4, at + 8);
      if (type === "trak" && ++trackCount > MP4_LIMITS.tracks) invalid();
      const toEOF = size === 0;
      if (toEOF) {
        if (parent !== "root" || type !== "mdat") invalid();
        size = end - at;
      }
      if (size === 1) {
        if (end - at < 16) invalid();
        const wide = bytes.readBigUInt64BE(at + 8);
        if (wide > BigInt(Number.MAX_SAFE_INTEGER)) invalid();
        size = Number(wide);
        header = 16;
      }
      // An EOF mdat is checked against exact sample coverage after all tracks;
      // otherwise an appended moov or arbitrary tail would become its payload.
      if (size < header || size > end - at) invalid();
      if (
        parents[type] &&
        (!parents[type].includes(parent) ||
          (seen.has(type) && !["trak", "mdat"].includes(type)))
      )
        invalid();
      if (["moof", "mvex", "stz2"].includes(type)) invalid();
      if (
        parent === "root" &&
        !["ftyp", "moov", "mdat", "free", "skip"].includes(type)
      )
        invalid();
      seen.add(type);
      const box = { type, begin: at + header, end: at + size, toEOF };
      if (containers.has(type)) {
        if (
          type === "meta" &&
          (box.end - box.begin < 4 || bytes.readUInt32BE(box.begin) !== 0)
        )
          invalid();
        box.children = boxes(
          box.begin + (type === "meta" ? 4 : 0),
          box.end,
          type,
          depth + 1,
        );
      }
      result.push(box);
      at += size;
    }
    return result;
  }
  function one(list, type) {
    const found = list.filter((b) => b.type === type);
    if (found.length !== 1) invalid();
    return found[0];
  }
  const has = (list, type) => list.some((b) => b.type === type);
  function full(box, versions = [0]) {
    if (box.end - box.begin < 4 || !versions.includes(bytes[box.begin]))
      invalid();
    return bytes[box.begin];
  }
  function integer(at, wide = false, signed = false) {
    if (!wide) return signed ? bytes.readInt32BE(at) : bytes.readUInt32BE(at);
    const value = signed ? bytes.readBigInt64BE(at) : bytes.readBigUInt64BE(at);
    if (
      value > BigInt(Number.MAX_SAFE_INTEGER) ||
      value < BigInt(Number.MIN_SAFE_INTEGER)
    )
      invalid();
    return Number(value);
  }
  function time(box, kind) {
    const wide = full(box, [0, 1]) === 1;
    const minimum = { mvhd: 100, tkhd: 84, mdhd: 24 }[kind] + (wide ? 12 : 0);
    if (box.end - box.begin !== minimum) invalid();
    const field = box.begin + (wide ? 20 : 12);
    const scale = kind === "tkhd" ? movie.scale : integer(field);
    const ticks = integer(field + (kind === "tkhd" ? 8 : 4), wide);
    if (
      !scale ||
      ticks <= 0 ||
      (!wide && ticks === 0xffffffff) ||
      ticks / scale > 1800
    )
      invalid();
    return { scale, ticks, seconds: ticks / scale };
  }
  let tableEntries = 0;
  const tables = new Map();
  function table(box, stride, versions = [0]) {
    if (tables.has(box)) return tables.get(box);
    const version = full(box, versions);
    if (box.end - box.begin < 8) invalid();
    const count = integer(box.begin + 4);
    if (
      !count ||
      count > MP4_LIMITS.entriesPerTable ||
      count > (box.end - box.begin - 8) / stride ||
      box.end - box.begin !== 8 + count * stride
    )
      invalid();
    tableEntries += count;
    if (tableEntries > MP4_LIMITS.entries) invalid();
    const result = { count, start: box.begin + 8, version };
    tables.set(box, result);
    return result;
  }
  const root = boxes(0, bytes.length);
  const ftyp = one(root, "ftyp");
  if (
    root[0] !== ftyp ||
    ftyp.end - ftyp.begin < 8 ||
    (ftyp.end - ftyp.begin) % 4 ||
    (ftyp.end - ftyp.begin) / 4 - 1 > MP4_LIMITS.brands
  )
    invalid();
  const supportedBrands = new Set([
    "isom",
    "iso2",
    "iso3",
    "iso4",
    "iso5",
    "iso6",
    "iso7",
    "iso8",
    "iso9",
    "mp41",
    "mp42",
    "avc1",
  ]);
  let supported = false;
  for (let at = ftyp.begin; at < ftyp.end; at += 4) {
    if (at === ftyp.begin + 4) continue; // minor_version is not a brand
    supported ||= supportedBrands.has(bytes.toString("ascii", at, at + 4));
  }
  if (!supported) invalid();
  const moov = one(root, "moov").children;
  const movie = time(one(moov, "mvhd"), "mvhd");
  const mdats = root.filter((b) => b.type === "mdat");
  if (!mdats.length || mdats.some((b) => b.begin === b.end)) invalid();
  const tracks = moov.filter((b) => b.type === "trak");
  if (!tracks.length) invalid();
  // Preflight ALL track declarations before any sample/chunk-sized allocation
  // or table-entry loop. Reads below are constant per table, not per sample.
  let totalSamples = 0,
    totalChunks = 0,
    work = 0;
  const sampleTables = new Map();
  for (const track of tracks) {
    const mdia = one(track.children, "mdia").children;
    const minf = one(mdia, "minf").children;
    const stbl = one(minf, "stbl").children;
    const stsz = one(stbl, "stsz");
    full(stsz);
    if (stsz.end - stsz.begin < 12) invalid();
    const fixedSize = integer(stsz.begin + 4),
      sampleCount = integer(stsz.begin + 8);
    totalSamples += sampleCount;
    if (
      !sampleCount ||
      sampleCount > MP4_LIMITS.samplesPerTrack ||
      totalSamples > MP4_LIMITS.samples ||
      sampleCount > bytes.length ||
      fixedSize * sampleCount > bytes.length ||
      stsz.end - stsz.begin !== 12 + (fixedSize ? 0 : sampleCount * 4)
    )
      invalid();
    const before = tableEntries;
    if (!fixedSize) tableEntries += sampleCount;
    table(one(stbl, "stts"), 8);
    if (has(stbl, "ctts")) table(one(stbl, "ctts"), 8, [0, 1]);
    if (has(stbl, "stss")) table(one(stbl, "stss"), 4);
    table(one(stbl, "stsc"), 12);
    if (has(stbl, "co64") && has(stbl, "stco")) invalid();
    const wide = has(stbl, "co64");
    const offsets = table(one(stbl, wide ? "co64" : "stco"), wide ? 8 : 4);
    totalChunks += offsets.count;
    if (
      offsets.count > MP4_LIMITS.chunksPerTrack ||
      totalChunks > MP4_LIMITS.chunks
    )
      invalid();
    if (has(track.children, "edts")) {
      const elst = one(one(track.children, "edts").children, "elst");
      table(elst, full(elst, [0, 1]) === 1 ? 20 : 12, [0, 1]);
    }
    if (
      tableEntries - before > MP4_LIMITS.entriesPerTrack ||
      tableEntries > MP4_LIMITS.entries
    )
      invalid();
    // Three passes also cover the <= stts.count + ctts.count intersections.
    // Binary mdat lookup avoids a chunks * mdats cross product.
    work +=
      3 * (tableEntries - before) +
      offsets.count * (2 + Math.ceil(Math.log2(mdats.length + 1)));
    sampleTables.set(track, { stsz, fixedSize, sampleCount });
  }
  // Reserve O(C log C) sorting and a final coverage pass up front.
  work += totalChunks * (1 + Math.ceil(Math.log2(totalChunks)));
  if (work > MP4_LIMITS.work) invalid();
  // Exact integer packing: both endpoints <= 2^26, so start * (2^26+1)
  // + end stays below 2^53. Sorting numeric intervals needs only 8 bytes/chunk.
  const chunkBase = MAX_VIDEO + 1;
  const chunks = new Float64Array(totalChunks);
  let chunkIndex = 0;
  const ids = new Set(),
    handlers = new Set(),
    trackTimes = [];
  for (const track of tracks) {
    const tkhd = one(track.children, "tkhd"),
      trackTime = time(tkhd, "tkhd");
    const id = integer(tkhd.begin + (bytes[tkhd.begin] === 1 ? 20 : 12));
    if (!id || ids.has(id) || (bytes.readUInt32BE(tkhd.begin) & 3) !== 3)
      invalid();
    ids.add(id);
    const mdia = one(track.children, "mdia").children;
    const media = time(one(mdia, "mdhd"), "mdhd");
    const hdlr = one(mdia, "hdlr");
    full(hdlr);
    if (hdlr.end - hdlr.begin < 24) invalid();
    const handler = bytes.toString("ascii", hdlr.begin + 8, hdlr.begin + 12);
    if (!["vide", "soun"].includes(handler)) invalid();
    handlers.add(handler);
    const minf = one(mdia, "minf").children;
    const header = one(minf, handler === "vide" ? "vmhd" : "smhd");
    full(header);
    if (
      header.end - header.begin !== (handler === "vide" ? 12 : 8) ||
      has(minf, handler === "vide" ? "smhd" : "vmhd")
    )
      invalid();
    const dref = one(one(minf, "dinf").children, "dref");
    full(dref);
    if (dref.end - dref.begin < 8 || integer(dref.begin + 4) !== 1) invalid();
    const refs = boxes(dref.begin + 8, dref.end, "dref");
    if (
      refs.length !== 1 ||
      refs[0].type !== "url " ||
      refs[0].end - refs[0].begin !== 4 ||
      bytes.readUInt32BE(refs[0].begin) !== 1
    )
      invalid();
    const stbl = one(minf, "stbl").children;
    const stsd = one(stbl, "stsd");
    full(stsd);
    if (stsd.end - stsd.begin < 8 || integer(stsd.begin + 4) !== 1) invalid();
    const descriptions = boxes(stsd.begin + 8, stsd.end, "stsd");
    const codecs =
      handler === "vide"
        ? ["avc1", "avc3", "hvc1", "hev1", "vp09", "av01"]
        : ["mp4a", "ac-3", "ec-3", "Opus"];
    if (
      descriptions.length !== 1 ||
      !codecs.includes(descriptions[0].type) ||
      descriptions[0].end - descriptions[0].begin <
        (handler === "vide" ? 78 : 28) ||
      bytes.readUInt16BE(descriptions[0].begin + 6) !== 1
    )
      invalid();
    const { stsz, fixedSize, sampleCount } = sampleTables.get(track);
    const timing = table(one(stbl, "stts"), 8);
    let sample = 0,
      decodeTicks = 0;
    for (let i = 0; i < timing.count; i++) {
      const at = timing.start + i * 8,
        count = integer(at),
        delta = integer(at + 4);
      if (!count || !delta || count > sampleCount - sample) invalid();
      decodeTicks += count * delta;
      if (!Number.isSafeInteger(decodeTicks)) invalid();
      sample += count;
    }
    if (sample !== sampleCount || decodeTicks !== media.ticks) invalid();
    let ptsMin = Infinity,
      ptsEnd = 0,
      decodeTime = 0,
      timingIndex = 0,
      timingLeft = 0,
      delta = 0;
    const composition = has(stbl, "ctts")
      ? table(one(stbl, "ctts"), 8, [0, 1])
      : null;
    sample = 0;
    for (let i = 0; i < (composition?.count || 1); i++) {
      const at = composition && composition.start + i * 8;
      const count = composition ? integer(at) : sampleCount;
      const offset = composition
        ? integer(at + 4, false, composition.version === 1)
        : 0;
      if (!count || count > sampleCount - sample) invalid();
      let remaining = count;
      while (remaining) {
        if (!timingLeft) {
          if (timingIndex === timing.count) invalid();
          const timeAt = timing.start + timingIndex++ * 8;
          timingLeft = integer(timeAt);
          delta = integer(timeAt + 4);
        }
        const take = Math.min(remaining, timingLeft);
        const end = decodeTime + take * delta;
        if (!Number.isSafeInteger(end + offset)) invalid();
        // Positive deltas: extrema of a constant-offset/delta segment occur
        // at its endpoints; no per-sample durations or timestamp array.
        ptsMin = Math.min(ptsMin, decodeTime + offset);
        ptsEnd = Math.max(ptsEnd, end + offset);
        decodeTime = end;
        sample += take;
        timingLeft -= take;
        remaining -= take;
      }
    }
    if (
      sample !== sampleCount ||
      Math.abs((ptsEnd - ptsMin) / media.scale - media.seconds) > 0.05
    )
      invalid();
    if (has(stbl, "stss")) {
      const sync = table(one(stbl, "stss"), 4);
      let previous = 0;
      for (let i = 0; i < sync.count; i++) {
        const number = integer(sync.start + i * 4);
        if (number <= previous || number > sampleCount) invalid();
        previous = number;
      }
    }
    const offsetsBox = one(stbl, has(stbl, "co64") ? "co64" : "stco");
    if (has(stbl, "co64") && has(stbl, "stco")) invalid();
    const wide = offsetsBox.type === "co64",
      offsets = table(offsetsBox, wide ? 8 : 4);
    const mapping = table(one(stbl, "stsc"), 12);
    let mappingIndex = 0;
    sample = 0;
    for (let i = 0; i < mapping.count; i++) {
      const at = mapping.start + i * 12,
        first = integer(at);
      if (
        (i === 0 ? first !== 1 : first <= integer(at - 12)) ||
        first > offsets.count ||
        !integer(at + 4) ||
        integer(at + 8) !== 1
      )
        invalid();
    }
    for (let i = 0; i < offsets.count; i++) {
      if (
        mappingIndex + 1 < mapping.count &&
        i + 1 === integer(mapping.start + (mappingIndex + 1) * 12)
      )
        mappingIndex++;
      const count = integer(mapping.start + mappingIndex * 12 + 4);
      if (count > sampleCount - sample) invalid();
      const start = integer(offsets.start + i * (wide ? 8 : 4), wide);
      let end = start + (fixedSize ? count * fixedSize : 0);
      if (fixedSize) sample += count;
      else {
        for (let j = 0; j < count; j++, sample++) {
          const size = integer(stsz.begin + 12 + sample * 4);
          if (!size || size > bytes.length - end) invalid();
          end += size;
        }
      }
      let lo = 0,
        hi = mdats.length;
      while (lo < hi) {
        const mid = Math.floor((lo + hi) / 2);
        if (mdats[mid].begin <= start) lo = mid + 1;
        else hi = mid;
      }
      if (!lo || end > mdats[lo - 1].end) invalid();
      chunks[chunkIndex++] = start * chunkBase + end;
    }
    if (sample !== sampleCount) invalid();
    let presentation = media.seconds;
    if (has(track.children, "edts")) {
      const edits = one(track.children, "edts").children;
      const elst = one(edits, "elst"),
        wide = full(elst, [0, 1]) === 1;
      const list = table(elst, wide ? 20 : 12, [0, 1]);
      let ticks = 0,
        mediaEdits = 0;
      for (let i = 0; i < list.count; i++) {
        const at = list.start + i * (wide ? 20 : 12);
        const length = integer(at, wide),
          start = integer(at + (wide ? 8 : 4), wide, true);
        const rate = bytes.readInt32BE(at + (wide ? 16 : 8));
        if (!length || rate !== 65536 || start < -1) invalid();
        ticks += length;
        if (!Number.isSafeInteger(ticks)) invalid();
        if (start !== -1) {
          mediaEdits++;
          // Edits trim encoder delay using presentation (not decode) time.
          if (
            start < ptsMin - 1 ||
            start + (length / movie.scale) * media.scale >
              ptsEnd + media.scale / movie.scale + 1
          )
            invalid();
        }
      }
      if (!mediaEdits) invalid();
      presentation = ticks / movie.scale;
    } else if (Math.abs(ptsMin) > 1 || Math.abs(ptsEnd - media.ticks) > 1) {
      // Without edits there is no mapping to trim a shifted presentation.
      // A constant ctts offset must not hide a long leading/trailing gap.
      invalid();
    }
    if (
      Math.abs(presentation - trackTime.seconds) > 1 / movie.scale + 1e-9 ||
      Math.abs(trackTime.seconds - movie.seconds) > 0.25 + 1e-9
    )
      invalid();
    trackTimes.push(trackTime.seconds);
  }
  chunks.sort();
  const eofMdat = mdats.find((b) => b.toEOF);
  let previousEnd = 0,
    coveredEnd = eofMdat?.begin;
  for (const chunk of chunks) {
    const start = Math.floor(chunk / chunkBase),
      end = chunk % chunkBase;
    if (start < previousEnd) invalid();
    previousEnd = end;
    if (eofMdat && start >= eofMdat.begin) {
      // Only exact, contiguous referenced media may extend to EOF. This
      // deliberately excludes padding/unreferenced tails for size=0 mdat;
      // explicit-size mdat retains its existing padding compatibility.
      if (start !== coveredEnd) invalid();
      coveredEnd = end;
    }
  }
  if (eofMdat && coveredEnd !== eofMdat.end) invalid();
  const actual = movie.seconds;
  if (
    !handlers.has("vide") ||
    !handlers.has("soun") ||
    Math.abs(Math.max(...trackTimes) - actual) > 1 / movie.scale + 1e-9 ||
    (duration !== undefined &&
      (!Number.isFinite(duration) || Math.abs(actual - duration) > 0.001))
  )
    invalid();
  if (expectedDuration !== undefined)
    validatePlaybackDuration(actual, expectedDuration);
  return { duration: actual, mime: "video/mp4", size: bytes.length };
}
