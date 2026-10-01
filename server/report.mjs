import { speakerNotes, spokenManuscript } from "./manuscript.mjs";

const compact = (text) => String(text || "").replace(/\s/gu, "");
export const characterCount = (text) => Array.from(compact(text)).length;
export function projectReport(project) {
  const batches = project.batches || [],
    slides = project.slides || [];
  const original = batches.map((b) => b.text).join("");
  const body = batches.map((b) => spokenManuscript(b.text)).join("");
  // Same helper and page order as exportPresentation. The script view is these
  // current notes in sequence, not a separate AI summary.
  const notes = slides.map((s) => speakerNotes(s)).join("");
  const a = Array.from(compact(body)),
    b = Array.from(compact(notes));
  let first = 0;
  while (first < a.length && first < b.length && a[first] === b[first]) first++;
  const matches = first === a.length && first === b.length;
  let page = 0,
    offset = 0;
  for (; page < slides.length; page++) {
    offset += characterCount(speakerNotes(slides[page]));
    if (offset > first) break;
  }
  const unsegmented = batches
    .filter((batch) => !batch.slideIds?.length)
    .map((batch) => ({
      id: batch.id,
      label: batch.label,
      characters: characterCount(spokenManuscript(batch.text)),
    }));
  return {
    revision: project.revision,
    original: characterCount(original),
    body: a.length,
    removedHeadings: characterCount(original) - a.length,
    notes: b.length,
    speech: b.length,
    pages: slides.length,
    readyPages: slides.filter((s) => s.image || s.scene).length,
    stalePages: slides.filter((s) => s.stale).length,
    draft: characterCount(project.draft),
    unsegmented,
    difference: b.length - a.length,
    status: !batches.length
      ? "empty"
      : matches && !unsegmented.length
        ? "matched"
        : "different",
    textMatches: matches,
    firstDifference: matches
      ? null
      : {
          position: first + 1,
          page: page < slides.length ? page + 1 : null,
          original: a.slice(Math.max(0, first - 15), first + 35).join(""),
          notes: b.slice(Math.max(0, first - 15), first + 35).join(""),
        },
    perPage: slides.map((s, i) => ({
      id: s.id,
      page: i + 1,
      title: s.plan?.title || `第 ${i + 1} 页`,
      characters: characterCount(speakerNotes(s)),
      ready: !!(s.image || s.scene),
    })),
  };
}
