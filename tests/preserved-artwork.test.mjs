import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";

test("text-only extraction keeps patterned artwork pixel-identical even when the repair service redraws it", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "jianghao-preserve-"));
  process.env.AUTOPPT_DATA_DIR = dir;
  const { assetPath, db } = await import("../server/store.mjs");
  const { extractLayers } = await import("../server/motion/extract.mjs");
  t.after(async () => {
    db.close();
    await rm(dir, { recursive: true, force: true });
  });
  const original = await sharp(
    Buffer.from(
      '<svg width="400" height="240"><rect width="400" height="240" fill="#eeeecc"/><path d="M200 0L400 240M400 0L200 240" stroke="#842233" stroke-width="45"/><rect x="25" y="40" width="55" height="32" fill="#111111"/></svg>',
    ),
  )
    .png()
    .toBuffer();
  await writeFile(assetPath("original.png"), original);
  const replacement = await sharp({
    create: { width: 400, height: 240, channels: 4, background: "#00ff00" },
  })
    .png()
    .toBuffer();
  const analysis = {
    width: 400,
    height: 240,
    layers: [
      {
        id: "text-0",
        type: "text",
        text: "正文",
        x: 24,
        y: 39,
        w: 57,
        h: 34,
        fontSize: 36,
        color: "#111111",
      },
    ],
    regions: [{ id: "text-0", fill: null }],
  };
  let repairs = 0;
  const result = await extractLayers(
    { image: "original.png" },
    analysis,
    AbortSignal.timeout(30000),
    () => {},
    async () => {
      repairs++;
      await writeFile(assetPath("repair.png"), replacement);
      return "repair.png";
    },
    { lossless: true, textOnly: true, forceRepair: true },
  );
  assert.equal(repairs, 1);
  assert.equal(result.preservation.outsideMaskDifferences, 0);
  assert.match(result.background, /\.png$/);
  assert.deepEqual(await readFile(assetPath("original.png")), original);
  const originalPhoto = await sharp(original)
    .extract({ left: 200, top: 0, width: 200, height: 240 })
    .raw()
    .toBuffer();
  const retainedPhoto = await sharp(assetPath(result.background))
    .extract({ left: 200, top: 0, width: 200, height: 240 })
    .raw()
    .toBuffer();
  assert.deepEqual(retainedPhoto, originalPhoto);
  const { generatePreservedPage } =
    await import("../server/motion/preserved.mjs");
  const counts = { image: 0, analysis: 0, extract: 0, check: 0 };
  const work = {
    layeredPlan: {
      displayText: ["正文"],
      layeredLayout: { background: "wrong simplified layout" },
    },
    source: { style: { rules: "保留照片与荧光色块" }, attachments: [] },
  };
  const models = {
    generateImage: async (plan, style) => {
      counts.image++;
      assert.equal(plan.layeredLayout, undefined);
      assert.equal(style.rules, work.source.style.rules);
      return "original.png";
    },
    jsonModel: async (system) => {
      if (system.includes("原画面文字还原师")) {
        counts.analysis++;
        return {
          texts: [
            {
              text: "正文",
              x: 24,
              y: 39,
              w: 57,
              h: 30,
              fontSize: 34,
              font: "sans",
              fontWeight: 400,
              color: "#111111",
            },
          ],
          objects: [],
        };
      }
      counts.check++;
      return counts.check === 1
        ? { mainTextRemoved: false, nonTextPreserved: true, detail: "residue" }
        : counts.check === 2
          ? {}
          : { mainTextRemoved: true, nonTextPreserved: true, detail: "clean" };
    },
    extractLayers: async (
      _source,
      _analysis,
      _signal,
      _progress,
      _repair,
      options,
    ) => {
      counts.extract++;
      assert.equal(options.textOnly, true);
      return {
        background: result.background,
        usedRepair: options.forceRepair,
        preservation: result.preservation,
      };
    },
  };
  const completed = await generatePreservedPage(
    work,
    null,
    () => {},
    () => {},
    models,
  );
  assert.deepEqual(counts, { image: 1, analysis: 1, extract: 1, check: 1 });
  assert.equal(completed.originalImage, "original.png");
  assert.equal(completed.layers[0].fit, false);
  assert.equal(completed.qualityReview.status, "advisory");
  assert(completed.warnings.includes("residue"));
  assert.equal(work.extracted.background, result.background);
  await generatePreservedPage(
    work,
    null,
    () => {},
    () => {},
    models,
  );
  assert.deepEqual(counts, { image: 1, analysis: 1, extract: 1, check: 1 });

  const legacy = structuredClone(work);
  delete legacy.extracted;
  delete legacy.preservationCheck;
  legacy.rejectedBackground = result.background;
  legacy.forceRepair = true;
  const resumed = await generatePreservedPage(
    legacy,
    null,
    () => {},
    () => {},
    models,
  );
  assert.equal(resumed.background, result.background);
  assert.equal(resumed.recoveredBackground, result.background);
  assert.equal(resumed.qualityReview.status, "advisory");
  assert.deepEqual(
    counts,
    { image: 1, analysis: 1, extract: 1, check: 1 },
    "legacy withheld assets resume with zero model calls",
  );

  for (const check of [
    async () => ({}),
    async () => {
      throw new Error("review unavailable");
    },
  ]) {
    const next = structuredClone(work);
    delete next.preservationCheck;
    const page = await generatePreservedPage(
      next,
      null,
      () => {},
      () => {},
      { ...models, jsonModel: check },
    );
    assert.equal(page.background, result.background);
    assert.equal(page.qualityReview.status, "advisory");
    assert(page.warnings.length);
  }
  const aborted = new AbortController();
  const next = structuredClone(work);
  delete next.preservationCheck;
  await assert.rejects(
    generatePreservedPage(
      next,
      aborted.signal,
      () => {},
      () => {},
      {
        ...models,
        jsonModel: async () => {
          aborted.abort();
          throw aborted.signal.reason;
        },
      },
    ),
    { name: "AbortError" },
  );
  const missing = structuredClone(work);
  missing.extracted.background = "missing.png";
  await assert.rejects(
    generatePreservedPage(
      missing,
      null,
      () => {},
      () => {},
      models,
    ),
    /ENOENT/,
  );
  await assert.rejects(
    extractLayers(
      { image: "original.png" },
      { ...analysis, layers: [{ ...analysis.layers[0], type: "image" }] },
      null,
      () => {},
      null,
      { textOnly: true },
    ),
    /不能移除照片/,
  );
});

test("calibration uses bundled variable font outlines and freezes editable natural typography", async () => {
  const { calibrateText, textMetrics } =
    await import("../server/motion/text-metrics.mjs");
  const light = await textMetrics("连锁加盟", "sans", 300),
    bold = await textMetrics("连锁加盟", "sans", 700);
  assert.notDeepEqual(light, bold);
  const input = {
    text: "连锁加盟",
    font: "sans",
    fontWeight: 700,
    x: 455,
    y: 277,
    w: 508,
    h: 124,
  };
  const output = await calibrateText(input, 1672, 941);
  assert.equal(output.fit, false);
  assert(output.lineHeight >= bold.ascent + bold.descent);
  assert.equal(output.text, input.text);
  assert(Math.abs((bold.maxY - bold.minY) * output.fontSize - input.h) < 0.01);
  assert(
    Math.abs(
      (bold.maxX - bold.minX) * output.fontSize +
        3 * output.letterSpacing -
        input.w,
    ) < 0.01,
  );
  assert.deepEqual(input, {
    text: "连锁加盟",
    font: "sans",
    fontWeight: 700,
    x: 455,
    y: 277,
    w: 508,
    h: 124,
  });
});

test("condensed generated titles fit natural glyphs without overlapping Chinese strokes", async () => {
  const { calibrateText } = await import("../server/motion/text-metrics.mjs");
  const { validateLayers } = await import("../shared/motion/schema.mjs");
  const layer = {
    id: "title",
    type: "text",
    text: "用对待家庭成员的方式",
    x: 840,
    y: 462,
    w: 785,
    h: 98,
    fontSize: 100,
    font: "sans",
    fontWeight: 700,
    color: "#000000",
  };
  const calibrated = await calibrateText(layer, 1672, 941);
  assert(calibrated.fontSize < layer.fontSize);
  assert(calibrated.letterSpacing >= -calibrated.fontSize * 0.04001);
  assert.doesNotThrow(() => validateLayers([calibrated], 1672, 941));
  assert(Math.abs(calibrated.letterSpacing) <= calibrated.fontSize * 0.3);
  assert.throws(
    () => validateLayers([{ ...calibrated, letterSpacing: -1000 }], 1672, 941),
    /字距/,
  );
});
