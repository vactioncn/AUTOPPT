import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import {
  defaultSystem,
  composeScene,
  samplePlan,
  renderSceneSvg,
} from "../shared/slides.mjs";
import { inspectPresentation } from "./helpers/presentation.mjs";

const dir = mkdtempSync(path.join(tmpdir(), "autoppt-export-test-"));
process.env.AUTOPPT_DATA_DIR = dir;
const { exportPresentation, exportFilename } =
  await import("../server/export.mjs");
const { db, assetsDir } = await import("../server/store.mjs");
after(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});
const project = (slides) => ({ title: "完整图片与备注", batches: [], slides });
const picture = (width, height, background) =>
  sharp({ create: { width, height, channels: 3, background } });

test("image PPT preserves PNG/JPEG bytes, order, aspect ratio, complete notes and input records", async () => {
  const sources = [
    await picture(1600, 900, "#d43528").png().toBuffer(),
    await picture(600, 900, "#126631").jpeg().toBuffer(),
    await picture(1800, 400, "#315ec0").png().toBuffer(),
  ];
  const slides = sources.map((buffer, i) => {
    const image = `page-${i}.${i === 1 ? "jpg" : "png"}`;
    writeFileSync(path.join(assetsDir, image), buffer);
    return {
      image,
      notes: [
        `  中文 & <原文> "引号" '单引号' 😀\r\n\n\t第二行  \n`,
        "不同页面不能错位。",
        "长讲稿。\n".repeat(10000),
      ][i],
    };
  });
  const p = project(slides),
    before = structuredClone(p);
  const images = await inspectPresentation(await exportPresentation(p), slides);
  images.forEach((data, i) => assert.deepEqual(data, sources[i]));
  assert.deepEqual(p, before);
});

test("WebP and EXIF orientation are converted to compatible images; historical scenes flatten to one PNG", async () => {
  const webp = await picture(400, 200, "#334488").webp().toBuffer();
  const rotated = await picture(300, 200, "#445588")
    .withMetadata({ orientation: 6 })
    .jpeg()
    .toBuffer();
  writeFileSync(path.join(assetsDir, "source.webp"), webp);
  writeFileSync(path.join(assetsDir, "rotated.jpg"), rotated);
  const sys = defaultSystem({
    rules: "留白",
    colors: ["#ffffff", "#222222", "#284fa3"],
  });
  const scene = composeScene(samplePlan(sys.layouts[0]), sys);
  const slides = [
    { image: "source.webp", notes: "完整 WebP" },
    { image: "rotated.jpg", notes: "按图片方向显示" },
    {
      scene,
      image: "missing.png",
      notes: "历史网页也只放一张图片；使用与预览一致的场景。",
    },
  ];
  const images = await inspectPresentation(
    await exportPresentation(project(slides)),
    slides,
  );
  assert.equal((await sharp(images[0]).metadata()).format, "png");
  assert.deepEqual(
    await sharp(images[0]).raw().toBuffer(),
    await sharp(webp).raw().toBuffer(),
  );
  assert.equal((await sharp(images[1]).metadata()).width, 200);
  assert.equal((await sharp(images[1]).metadata()).height, 300);
  const expected = await sharp(
    Buffer.from(
      renderSceneSvg(scene).replace(
        'width="100%" height="100%"',
        'width="1600" height="900"',
      ),
    ),
  )
    .png()
    .toBuffer();
  assert.deepEqual(images[2], expected);
});

test("export reports empty, missing, unreadable, unsegmented and stale pages without omitting content", async () => {
  await assert.rejects(exportPresentation(project([])), /先添加/);
  await assert.rejects(
    exportPresentation(project([{ notes: "还没生成图片" }])),
    /第 1 页/,
  );
  await assert.rejects(
    exportPresentation({
      ...project([{ image: "page-0.png", notes: "已完成" }]),
      batches: [{ slideIds: [] }],
    }),
    /尚未完成内容拆分/,
  );
  await assert.rejects(
    exportPresentation(project([{ image: "missing.png", notes: "文件缺失" }])),
    /第 1 页的图片无法读取/,
  );
  writeFileSync(path.join(assetsDir, "corrupt.png"), "not an image");
  await assert.rejects(
    exportPresentation(project([{ image: "corrupt.png", notes: "文件损坏" }])),
    /第 1 页的图片无法读取/,
  );
  const slides = [{ image: "page-0.png", notes: "新备注", stale: true }];
  await assert.rejects(exportPresentation(project(slides)), { status: 409 });
  await inspectPresentation(
    await exportPresentation(project(slides), { allowStale: true }),
    slides,
  );
  assert.equal(
    exportFilename('演讲/内容:\r\n"测试"'),
    "演讲_内容____测试_.pptx",
  );
  assert.equal(exportFilename("..."), "演讲.pptx");
});
