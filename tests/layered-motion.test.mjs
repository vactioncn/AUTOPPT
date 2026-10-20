import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import JSZip from "jszip";
import {
  validateLayout,
  backgroundPrompt,
  playbackMode,
} from "../shared/motion/layered.mjs";
process.env.AUTOPPT_DATA_DIR = await mkdtemp(
  path.join(tmpdir(), "jianghao-layered-test-"),
);
const { generateLayeredPage } = await import("../server/motion/layered.mjs");
const { exportLayeredPptx, nativeFace } =
  await import("../server/motion/pptx.mjs");
const text = {
  copyIndex: 0,
  text: "先讲故事",
  type: "text",
  id: "text-0",
  label: "标题",
  x: 100,
  y: 100,
  w: 900,
  h: 130,
  font: "serif",
  fontWeight: 600,
  fontSize: 60,
  color: "#111111",
  fit: false,
  lineHeight: 1.3,
  step: 0,
};
const layout = () => ({
  texts: [{ ...text }],
  background: "米色纸张与右侧水墨山水，左上留白",
});
const plan = () => ({ displayText: [text.text], styleRules: "水墨书卷" });

test("layered layout preserves reviewed copy, accepts only line breaks and validates geometry", () => {
  assert.equal(validateLayout(layout(), [text.text]).layers[0].fit, false);
  assert.doesNotThrow(() =>
    validateLayout({ ...layout(), texts: [{ ...text, text: "先讲\n故事" }] }, [
      text.text,
    ]),
  );
  for (const change of [
    { text: "先讲一个故事" },
    { copyIndex: 2 },
    { x: 1599 },
    { font: "other" },
  ])
    assert.throws(() =>
      validateLayout({ ...layout(), texts: [{ ...text, ...change }] }, [
        text.text,
      ]),
    );
  assert.throws(() =>
    validateLayout({ ...layout(), texts: [text, text] }, [
      text.text,
      text.text,
    ]),
  );
  assert.throws(() => playbackMode("unknown"));
  const prompt = backgroundPrompt({
    ...plan(),
    layeredLayout: validateLayout(layout(), [text.text]),
  });
  assert(prompt.includes("不要在图片中绘制任何文字"));
  assert(!prompt.includes(text.text));
});

test("generation checkpoints text/layout/background, retries inspection without new image calls and rejects residual text", async () => {
  let copies = 0,
    layouts = 0,
    images = 0,
    checks = 0,
    persist = 0,
    reject = false,
    errorOnce = true;
  const models = {
    design: async () => {
      copies++;
      return plan();
    },
    generateImage: async () => {
      images++;
      return "background.jpg";
    },
    jsonModel: async (prompt) => {
      if (prompt.includes("版式设计师")) {
        layouts++;
        return layout();
      }
      checks++;
      if (errorOnce) {
        errorOnce = false;
        throw new Error("temporary network failure");
      }
      return { hasText: reject, detail: "检查完成" };
    },
  };
  const page = {
    source: { notes: "故事讲述", style: {}, attachments: [], plan: null },
  };
  const run = () =>
    generateLayeredPage(
      page,
      new AbortController().signal,
      () => {},
      () => persist++,
      models,
    );
  await assert.rejects(run(), /temporary/);
  assert.equal(page.candidateBackground, "background.jpg");
  const result = await run();
  assert.equal(result.layers[0].text, text.text);
  assert.deepEqual([copies, layouts, images, checks], [1, 1, 1, 2]);
  reject = true;
  await assert.rejects(run(), /底图仍含文字/);
  assert.equal(page.candidateBackground, undefined);
  reject = false;
  await run();
  assert.deepEqual([copies, layouts, images], [1, 1, 2]);
  assert(persist >= 5);
});

test("PPTX export writes native text and exact full font parts, rejects missing glyphs and unsupported faces", async () => {
  assert.deepEqual(nativeFace({ font: "sans", fontWeight: 300 }), {
    family: "Jianghao Sans Light",
    slot: "regular",
  });
  assert.throws(() => nativeFace({ font: "custom", fontWeight: 400 }));
  const dir = process.env.AUTOPPT_DATA_DIR;
  // Minimal packaging fixture only: native rendering uses the reviewed full TTF pack.
  const eot = Buffer.alloc(200);
  eot.writeUInt32LE(eot.length);
  eot.writeUInt16LE(0x504c, 34);
  await writeFile(path.join(dir, "font-1.fntdata"), eot);
  await writeFile(
    path.join(dir, "manifest.json"),
    JSON.stringify({
      version: 1,
      fonts: [
        {
          family: "Jianghao Serif",
          slot: "bold",
          file: "font-1.fntdata",
          license: "SIL OPEN FONT LICENSE",
          sha256: createHash("sha256").update(eot).digest("hex"),
          characters: [...text.text].map((c) => c.codePointAt(0)),
        },
      ],
    }),
  );
  const sharp = (await import("sharp")).default;
  await sharp({
    create: { width: 1600, height: 900, channels: 3, background: "white" },
  })
    .jpeg()
    .toFile(path.join(dir, "assets/background.jpg"));
  const deck = {
    sourceMode: "layered",
    title: "讲好",
    pages: [
      {
        id: "p",
        status: "ready",
        source: { notes: "备注" },
        ...validateLayout(layout(), [text.text]),
        background: "background.jpg",
      },
    ],
  };
  const zip = await JSZip.loadAsync(await exportLayeredPptx(deck, dir));
  const slide = await zip.file("ppt/slides/slide1.xml").async("string");
  assert(slide.includes(text.text));
  assert(slide.includes('typeface="Jianghao Serif"'));
  assert.equal((slide.match(/<p:pic>/g) || []).length, 1);
  assert.equal((slide.match(/<p:sp>/g) || []).length, 1);
  assert.deepEqual(
    await zip.file("ppt/fonts/jianghao-1.fntdata").async("nodebuffer"),
    eot,
  );
  const presentation = await zip.file("ppt/presentation.xml").async("string");
  assert(presentation.includes('saveSubsetFonts="0"'));
  assert.equal((presentation.match(/saveSubsetFonts=/g) || []).length, 1);
  assert.equal((presentation.match(/embedTrueTypeFonts=/g) || []).length, 1);
  assert(presentation.includes('<p:bold r:id="rIdLayeredFont1"/>'));
  deck.pages[0].layers[0].text = "缺字";
  await assert.rejects(exportLayeredPptx(deck, dir), /缺少这些字符/);
});
