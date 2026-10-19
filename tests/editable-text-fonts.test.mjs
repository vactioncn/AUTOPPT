import test from "node:test";
import assert from "node:assert/strict";
import {
  FONT_CATALOG,
  embeddedFontLibrary,
  normalizeFont,
} from "../site/editable-text-lab/fonts.mjs";

test("font selection rejects arbitrary sources and uses available weights", () => {
  assert.throws(() => normalizeFont("https://example.test/font.woff2"));
  assert.throws(() => normalizeFont("sans", NaN));
  assert.deepEqual(normalizeFont("wenkai", 900), {
    font: "wenkai",
    fontWeight: 500,
  });
  assert.deepEqual(normalizeFont("xiaowei", 900), {
    font: "xiaowei",
    fontWeight: 400,
  });
  assert.deepEqual(normalizeFont(undefined, 600), {
    font: "serif",
    fontWeight: 600,
  });
  assert.deepEqual(normalizeFont("sans", 650), {
    font: "sans",
    fontWeight: 650,
  });
});

test("offline font library embeds complete selected faces, licenses and fingerprints", async () => {
  const { css, fonts, licenses } = await embeddedFontLibrary();
  assert.equal(fonts.length, 5);
  assert.equal(licenses.length, fonts.length);
  const urls = [...css.matchAll(/url\(([^)]+)\)/g)].map((m) => m[1]);
  assert(urls.length > 0);
  assert(urls.every((url) => url.startsWith("data:font/woff2;base64,")));
  assert(!css.includes("local("));
  assert(!css.includes("font-display: swap"));
  for (const font of fonts) {
    assert.equal(font.license, "OFL-1.1");
    assert(font.files.length > 0);
    assert(
      font.files.every(
        (file) => /^[0-9a-f]{64}$/.test(file.sha256) && file.bytes > 0,
      ),
    );
    assert(
      licenses
        .find((l) => l.font === font.family)
        .text.includes("SIL OPEN FONT LICENSE"),
    );
    assert(css.includes(`font-family: '${font.family}'`));
  }
  assert.deepEqual(
    fonts.map((f) => f.id),
    FONT_CATALOG.map((f) => f.id),
  );
});
