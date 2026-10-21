import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";
import {
  STYLE_SAMPLE_PAGES,
  sampleSource,
} from "../shared/style-sample-suite.mjs";
import { STYLE_SHOWCASE } from "../shared/style-showcase.mjs";

test("eight authored pages keep copy and data identical across all four styles", async () => {
  const directory = mkdtempSync(
    path.join(tmpdir(), "autoppt-standard-samples-"),
  );
  process.env.AUTOPPT_DATA_DIR = directory;
  const { standardSamplePlan } =
    await import("../server/style-sample-plan.mjs");
  const { directImagePrompt } = await import("../server/direct-image.mjs");
  const { get, db } = await import("../server/store.mjs");
  try {
    assert.equal(STYLE_SAMPLE_PAGES.length, 8);
    assert.equal(new Set(STYLE_SAMPLE_PAGES.map((page) => page.type)).size, 8);
    assert.deepEqual(
      STYLE_SAMPLE_PAGES.map((page) => page.number),
      ["01", "02", "03", "04", "05", "06", "07", "08"],
    );
    const copies = [];
    for (const group of STYLE_SHOWCASE) {
      const style = get("style", group.styleId),
        original = structuredClone(style);
      const plans = STYLE_SAMPLE_PAGES.map((page, i) => {
        const plan = standardSamplePlan(style, page.id);
        assert.deepEqual(plan.displayText, page.displayText);
        assert.equal(plan.pageNumber, i + 1);
        assert.equal(plan.styleRules, original.rules);
        assert(
          plan.screenCopy.entries.every((entry) =>
            sampleSource(page).includes(entry.sourceQuote),
          ),
        );
        const prompt = directImagePrompt(plan);
        for (const text of page.displayText) assert(prompt.includes(text));
        assert(!plan.layeredLayout);
        return plan;
      });
      copies.push(plans.map((plan) => plan.displayText));
      assert.deepEqual(style, original);
    }
    assert(
      copies.every(
        (copy) => JSON.stringify(copy) === JSON.stringify(copies[0]),
      ),
    );
    const data = STYLE_SAMPLE_PAGES[3];
    assert(data.displayText.some((text) => text.includes("12.5%")));
    assert(data.displayText.some((text) => text.includes("87.5%")));
    assert(data.displayText.some((text) => text.includes("非效率统计")));
    assert(
      STYLE_SAMPLE_PAGES[6].displayText.some((text) =>
        text.includes("非真实客户案例"),
      ),
    );
    assert.throws(() =>
      standardSamplePlan(get("style", STYLE_SHOWCASE[0].styleId), "unknown"),
    );
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("published sample manifest covers every style and page with distinct real images", async () => {
  const root = "public/style-samples-v1";
  const manifest = JSON.parse(readFileSync(`${root}/manifest.json`));
  assert.equal(manifest.pages.length, 32);
  assert.equal(
    new Set(manifest.pages.map((page) => page.sourceImageSha256)).size,
    32,
  );
  for (const group of STYLE_SHOWCASE)
    for (const page of STYLE_SAMPLE_PAGES) {
      const id = `${group.id}-${page.id}`;
      const record = manifest.pages.find((item) => item.id === id);
      assert.equal(record.styleId, group.styleId);
      assert.equal(record.type, page.type);
      assert(existsSync(`${root}/${id}.webp`));
      assert(existsSync(`${root}/${id}-small.webp`));
      assert.equal(record.width / record.height, 16 / 9);
      const bytes = readFileSync(`${root}/${id}.webp`);
      assert.equal(
        createHash("sha256").update(bytes).digest("hex"),
        record.sha256,
      );
      const full = await sharp(bytes).metadata();
      const thumb = await sharp(`${root}/${id}-small.webp`).metadata();
      assert.deepEqual([full.width, full.height], [1600, 900]);
      assert.deepEqual([thumb.width, thumb.height], [640, 360]);
    }
});
