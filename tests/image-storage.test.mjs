import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { screenImage } from "../server/image-storage.mjs";

const picture = (width, height, background = "#f3f0e5", channels = 3) =>
  sharp({ create: { width, height, channels, background } });

test("screen images fit QHD without enlargement, cropping or repeated JPEG loss", async () => {
  for (const [width, height, expected] of [
    [3840, 2160, [2560, 1440]],
    [1000, 563, [1000, 563]],
    [1200, 2400, [720, 1440]],
  ]) {
    const stored = await screenImage(
      await picture(width, height).png().toBuffer(),
    );
    assert.deepEqual([stored.width, stored.height], expected);
    const metadata = await sharp(stored.data).metadata();
    assert.equal(metadata.format, "jpeg");
    assert.equal(metadata.chromaSubsampling, "4:4:4");
    assert.equal(stored.extension, "jpg");
    assert.strictEqual((await screenImage(stored.data)).data, stored.data);
  }
});
test("colored small type and thin rules retain quality; transparency and coordinate canvases survive", async () => {
  const svg = `<svg width="800" height="450"><rect width="800" height="450" fill="#f7f4ed"/>${Array.from({ length: 14 }, (_, i) => `<text x="25" y="${24 + i * 30}" font-size="16" fill="${["#bf2040", "#144a89", "#175f32"][i % 3]}">Screen 1234567890 colored text and thin rules</text><path d="M25 ${28 + i * 30}H760" stroke="#346abb" stroke-width="1"/>`).join("")}</svg>`;
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  const jpg = await screenImage(png);
  const raw = await sharp(png).removeAlpha().raw().toBuffer();
  const compressed = await sharp(jpg.data).raw().toBuffer();
  const mse =
    raw.reduce((sum, v, i) => sum + (v - compressed[i]) ** 2, 0) / raw.length;
  assert(
    10 * Math.log10(255 ** 2 / mse) > 38,
    "fine colored text remains close to original pixels",
  );
  const alpha = await picture(20, 20, { r: 255, g: 0, b: 0, alpha: 0.3 }, 4)
    .png()
    .toBuffer();
  const cutout = await screenImage(alpha);
  assert.equal(cutout.format, "png");
  assert.deepEqual(cutout.data, alpha);
  const large = await screenImage(await picture(3000, 1600).png().toBuffer(), {
    resize: false,
  });
  assert.deepEqual([large.width, large.height], [3000, 1600]);
  const oriented = await picture(300, 200)
    .withMetadata({ orientation: 6 })
    .jpeg()
    .toBuffer();
  const upright = await screenImage(oriented);
  assert.deepEqual([upright.width, upright.height], [200, 300]);
  assert.equal((await sharp(upright.data).metadata()).orientation, undefined);
});
