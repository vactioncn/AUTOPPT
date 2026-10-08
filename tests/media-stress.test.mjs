import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, stat, mkdir, writeFile, open } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createScaleMedia, scalePresentation } from "./helpers/scale-media.mjs";
test(
  "133 independent JPEGs, 759 MP3s and 133 MP4s: realistic byte volume, bounded streaming and cleanup",
  { skip: process.env.MEDIA_STRESS_TEST !== "1", timeout: 120000 },
  async (t) => {
    const dir = await mkdtemp(path.join(tmpdir(), "autoppt-media-stress-"));
    process.env.AUTOPPT_DATA_DIR = dir;
    const store = await import("../server/store.mjs");
    t.after(async () => {
      store.db.close();
      await rm(dir, { recursive: true, force: true });
    });
    const { motionHtmlChunks } = await import("../server/motion/render.mjs");
    const start = Date.now(),
      baseline = process.memoryUsage().rss;
    let peak = baseline,
      maxChunk = 0,
      chunks = 0;
    const media = await createScaleMedia(dir, { imageBytes: 1024 * 1024 });
    for (const [name, count] of [
      ["images", 133],
      ["audio", 759],
      ["videos", 133],
    ]) {
      assert.equal(media[name].length, count);
      assert.equal(new Set(media[name].map((x) => x.file)).size, count);
      assert.equal(new Set(media[name].map((x) => x.hash)).size, count);
    }
    const { project, narration } = scalePresentation(media);
    const deck = {
      ...project,
      pages: project.slides.map((s, i) => ({ ...s, number: i + 1 })),
    };
    const output = path.join(dir, "stress.html");
    const counts = { images: 0, audio: 0, videos: 0, pages: 0 };
    async function* measured() {
      for await (const chunk of motionHtmlChunks(deck, {
        staticMode: true,
        narration,
      })) {
        chunks++;
        maxChunk = Math.max(maxChunk, Buffer.byteLength(chunk));
        peak = Math.max(peak, process.memoryUsage().rss);
        if (chunk.includes("data:image/jpeg;")) counts.images++;
        if (chunk.includes("data:audio/mpeg;")) counts.audio++;
        if (chunk.includes('class="deck-page"')) counts.pages++;
        yield chunk;
      }
    }
    await pipeline(Readable.from(measured()), createWriteStream(output));
    assert.deepEqual(counts, {
      images: 133,
      audio: 759,
      videos: 0,
      pages: 133,
    });
    const size = (await stat(output)).size;
    assert(size > 133 * 1024 * 1024);
    assert(size < 220 * 1024 * 1024);
    assert(maxChunk < 2 * 1024 * 1024);
    assert(chunks > 2500);
    assert(peak - baseline < 256 * 1024 * 1024);
    assert(peak < 640 * 1024 * 1024);
    const file = await open(output);
    const tail = Buffer.alloc(64);
    await file.read(tail, 0, 64, size - 64);
    await file.close();
    assert(tail.toString().endsWith("</body></html>"));
    // Also stream independent videos through the actual validation/export path.
    const small = scalePresentation(media, 128, {
      manyClips: false,
      presenter: true,
    });
    let videoCount = 0;
    for await (const chunk of motionHtmlChunks(
      {
        title: project.title,
        pages: small.project.slides.map((s, i) => ({ ...s, number: i + 1 })),
      },
      {
        staticMode: true,
        narration: small.narration,
        presenter: small.presenter,
      },
    )) {
      if (chunk.includes("data:video/mp4;")) videoCount++;
      peak = Math.max(peak, process.memoryUsage().rss);
    }
    peak = Math.max(peak, process.resourceUsage().maxRSS * 1024);
    assert.equal(videoCount, 128);
    assert(peak < 640 * 1024 * 1024);
    assert(peak - baseline < 256 * 1024 * 1024);
    const report = {
      synthetic: true,
      uniqueJPEGs: 133,
      uniqueMP3s: 759,
      uniqueMP4s: 133,
      sourceBytes: media.totalBytes,
      htmlBytes: size,
      peakRssBytes: peak,
      baselineRssBytes: baseline,
      maxChunkBytes: maxChunk,
      chunks,
      durationMs: Date.now() - start,
      limits: {
        timeoutMs: 120000,
        absoluteRssBytes: 640 * 1024 * 1024,
        deltaRssBytes: 256 * 1024 * 1024,
      },
      note: "Synthetic colors/silence/local animation plus JPEG padding; not equivalent to a user's 197 MB project. Temporary media and HTML are removed.",
    };
    await mkdir("test-results/media-stress", { recursive: true });
    await writeFile(
      "test-results/media-stress/metrics.json",
      JSON.stringify(report, null, 2),
    );
    t.diagnostic(JSON.stringify(report));
  },
);
