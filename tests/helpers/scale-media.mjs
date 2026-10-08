import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import sharp from "sharp";
import { silenceMp3 } from "./speech-audio.mjs";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
// Synthetic colored stills, silence and the non-human local test animation.
// Indexed ID3 / ISO-BMFF free metadata makes separate clips independently
// verifiable; this does not claim diverse voices, codecs or real lip sync.
export async function createScaleMedia(dir, { imageBytes = 0 } = {}) {
  for (const folder of ["assets", "speech-audio", "presenter-video"])
    await mkdir(path.join(dir, folder), { recursive: true });
  const images = [],
    audio = [],
    videos = [];
  let totalBytes = 0;
  const save = async (folder, name, bytes) => {
    await writeFile(path.join(dir, folder, name), bytes);
    totalBytes += bytes.length;
    return { file: name, hash: hash(bytes), bytes: bytes.length };
  };
  for (let i = 0; i < 133; i++) {
    const rgb = { r: (i * 37) % 256, g: (i * 73) % 256, b: (i * 113) % 256 };
    const jpeg = await sharp({
      create: { width: 640, height: 360, channels: 3, background: rgb },
    })
      .jpeg({ quality: 85 })
      .toBuffer();
    const bytes = imageBytes
      ? Buffer.concat([
          jpeg,
          Buffer.alloc(Math.max(0, imageBytes - jpeg.length), i),
        ])
      : jpeg;
    images.push(await save("assets", randomUUID() + ".jpg", bytes));
  }
  // Replace the existing small ID3 tag with a valid indexed v2.4 text frame.
  const tagSize =
    10 +
    ((silenceMp3[6] << 21) |
      (silenceMp3[7] << 14) |
      (silenceMp3[8] << 7) |
      silenceMp3[9]);
  for (let i = 0; i < 759; i++) {
    const text = Buffer.from("\x03Synthetic silent segment " + i);
    const frame = Buffer.alloc(10);
    frame.write("TIT2");
    frame[7] = text.length;
    const header = Buffer.from([
      73,
      68,
      51,
      4,
      0,
      0,
      0,
      0,
      0,
      frame.length + text.length,
    ]);
    const bytes = Buffer.concat([
      header,
      frame,
      text,
      silenceMp3.subarray(tagSize),
      silenceMp3.subarray(tagSize),
    ]);
    audio.push(await save("speech-audio", randomUUID() + ".mp3", bytes));
  }
  const source = await readFile(
    new URL("../fixtures/presenter/presenter.mp4", import.meta.url),
  );
  for (let i = 0; i < 133; i++) {
    const free = Buffer.alloc(32);
    free.writeUInt32BE(32);
    free.write("free", 4);
    free.write("synthetic-video-" + i, 8);
    videos.push(
      await save(
        "presenter-video",
        randomUUID() + ".mp4",
        Buffer.concat([source, free]),
      ),
    );
  }
  return { images, audio, videos, totalBytes };
}
export function scalePresentation(
  media,
  count = 133,
  { manyClips = true, presenter = false } = {},
) {
  const project = {
    id: "synthetic-scale",
    title: "合成多媒体压力验收",
    revision: 1,
    batches: [],
    slides: media.images
      .slice(0, count)
      .map((image, i) => ({
        id: "scale-" + i,
        title: "页面 " + (i + 1),
        notes: "合成静默讲稿 " + i,
        image: image.file,
        status: "ready",
        manuscriptVersion: 1,
        versions: [],
        batchIds: [],
      })),
  };
  let offset = 0;
  const narration = {
    id: "synthetic-narration",
    projectId: project.id,
    title: project.title,
    status: "ready",
    voiceName: "合成静默",
    pages: project.slides.map((s, i) => ({
      ...s,
      number: i + 1,
      clips: Array.from({ length: manyClips ? (i < 94 ? 6 : 5) : 1 }, () => ({
        file: media.audio[offset++].file,
        text: s.notes,
        duration: 2,
      })),
      silentDuration: 0,
    })),
  };
  const version = presenter
    ? {
        id: "synthetic-presenter",
        projectId: project.id,
        narrationId: narration.id,
        status: "ready",
        placement: "bottom-right",
        size: "small",
        pages: project.slides.map((s, i) => ({
          pageId: s.id,
          status: "ready",
          videoFile: media.videos[i].file,
          videoFingerprint: media.videos[i].hash,
          duration: 2,
        })),
      }
    : null;
  return { project, narration, presenter: version };
}
