import assert from "node:assert/strict";
import path from "node:path";
import JSZip from "jszip";
import sharp from "sharp";

const decode = (text) =>
  text.replace(
    /&(lt|gt|quot|apos|amp);/g,
    (_, name) => ({ lt: "<", gt: ">", quot: '"', apos: "'", amp: "&" })[name],
  );
const normalizeLines = (text) => text.replace(/\r\n?/g, "\n");

export async function inspectPresentation(buffer, slides) {
  const zip = await JSZip.loadAsync(buffer);
  assert.equal(zip.file(/^ppt\/slides\/slide\d+\.xml$/).length, slides.length);
  assert.equal(
    zip.file(/^ppt\/notesSlides\/notesSlide\d+\.xml$/).length,
    slides.length,
  );
  assert.equal(zip.file(/^ppt\/charts\//).length, 0);
  const presentation = await zip.file("ppt/presentation.xml").async("string");
  assert.match(presentation, /<p:sldSz cx="12192000" cy="6858000"/);
  const images = [];
  for (const [i, page] of slides.entries()) {
    const xml = await zip.file(`ppt/slides/slide${i + 1}.xml`).async("string");
    assert.equal(
      (xml.match(/<p:pic>/g) || []).length,
      1,
      `slide ${i + 1} must have exactly one image`,
    );
    assert.doesNotMatch(xml, /<p:sp>|<p:graphicFrame>|<a:t>/);
    const relId = xml.match(/<a:blip r:embed="([^"]+)"/)[1];
    const rels = await zip
      .file(`ppt/slides/_rels/slide${i + 1}.xml.rels`)
      .async("string");
    const rel = rels
      .match(/<Relationship\s[^>]+/g)
      .find((r) => r.includes(`Id="${relId}"`));
    assert(
      !rel.includes('TargetMode="External"'),
      "images must be embedded for offline playback",
    );
    const target = rel.match(/Target="([^"]+)"/)[1];
    const image = await zip
      .file(path.posix.join("ppt/slides", target))
      .async("nodebuffer");
    const meta = await sharp(image).metadata();
    assert(["png", "jpeg"].includes(meta.format));
    const pic = xml.match(/<p:pic>.*?<\/p:pic>/s)[0];
    const [, x, y, w, h] = pic
      .match(
        /<a:xfrm[^>]*>\s*<a:off x="(\d+)" y="(\d+)"\/>\s*<a:ext cx="(\d+)" cy="(\d+)"/,
      )
      .map(Number);
    assert(x + w <= 12192001 && y + h <= 6858001, "image stays inside slide");
    assert(
      Math.abs(w / h - meta.width / meta.height) < 0.00001,
      "original aspect ratio",
    );
    assert(
      Math.abs(x * 2 + w - 12192000) <= 1 && Math.abs(y * 2 + h - 6858000) <= 1,
      "image centered",
    );
    const notes = await zip
      .file(`ppt/notesSlides/notesSlide${i + 1}.xml`)
      .async("string");
    const body = notes
      .match(/<p:sp>.*?<\/p:sp>/gs)
      .find((s) => s.includes('<p:ph type="body"'));
    const text = [...body.matchAll(/<a:t>(.*?)<\/a:t>/gs)]
      .map((m) => decode(m[1]))
      .join("");
    assert.equal(
      normalizeLines(text),
      normalizeLines(page.notes),
      `complete notes for page ${i + 1}`,
    );
    images.push(image);
  }
  return images;
}
