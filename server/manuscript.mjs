/** Remove Markdown heading blocks, keeping the spoken body verbatim. */
export const MANUSCRIPT_VERSION = 1;
export const speakerNotes = (slide) =>
  slide.manuscriptVersion === MANUSCRIPT_VERSION
    ? slide.notes
    : spokenManuscript(slide.notes);

export function spokenManuscript(text) {
  const lines = text.match(/[^\r\n]*(?:\r\n|\n|\r|$)/g)?.filter(Boolean) || [];
  const body = lines.map((line) => line.replace(/[\r\n]+$/, ""));
  const removed = new Set();
  let fence = null,
    paragraph = null;
  for (let i = 0; i < lines.length; i++) {
    const line = body[i];
    if (fence) {
      if (
        new RegExp(`^ {0,3}${fence.char}{${fence.length},}[ \\t]*$`).test(line)
      )
        fence = null;
      paragraph = null;
      continue;
    }
    const start = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (start && (start[1][0] !== "`" || !start[2].includes("`"))) {
      fence = { char: start[1][0], length: start[1].length };
      paragraph = null;
      continue;
    }
    if (/^ {0,3}#{1,6}(?:[ \t]+|$)/.test(line)) {
      removed.add(i);
      paragraph = null;
    } else if (paragraph !== null && /^ {0,3}(?:=+|-+)[ \t]*$/.test(line)) {
      for (let n = paragraph; n <= i; n++) removed.add(n);
      paragraph = null;
    } else if (
      !line.trim() ||
      /^(?: {4}|\t)|^ {0,3}(?:>|[-+*](?:[ \t]|$)|\d+[.)][ \t])/.test(line)
    ) {
      paragraph = null;
    } else {
      paragraph ??= i;
    }
  }
  if (!removed.size) return text;
  // Remove the empty lines belonging to a removed heading, keeping the
  // surrounding body's paragraph breaks and original line endings.
  for (const i of [...removed])
    for (let n = i + 1; n < lines.length && !body[n].trim(); n++)
      removed.add(n);
  const kept = lines.filter((_, i) => !removed.has(i));
  while (kept.length && !kept[0].trim()) kept.shift();
  while (kept.length && !kept.at(-1).trim()) kept.pop();
  return kept.join("");
}
