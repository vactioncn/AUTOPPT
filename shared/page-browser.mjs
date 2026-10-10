// Browsing is a view over the existing pages; it never reorders or copies them.
export function browsePages(slides, allSlides, query, page, pageSize = 24) {
  const numbers = new Map(
    allSlides.map((slide, index) => [slide.id, index + 1]),
  );
  const normalize = (value) =>
    String(value || "")
      .normalize("NFKC")
      .toLocaleLowerCase();
  const search = normalize(query).trim();
  const terms = search.split(/\s+/).filter(Boolean);
  const matches = !search
    ? slides
    : slides.filter((slide) => {
        if (/^\d+$/.test(search))
          return numbers.get(slide.id) === Number(search);
        const text = normalize(
          [
            slide.plan?.title,
            slide.notes,
            ...(slide.plan?.displayText || []),
          ].join("\n"),
        );
        return terms.every((term) => text.includes(term));
      });
  const pages = Math.max(1, Math.ceil(matches.length / pageSize));
  const current = Math.max(0, Math.min(Math.trunc(page) || 0, pages - 1));
  const start = current * pageSize;
  return {
    slides: matches.slice(start, start + pageSize),
    total: matches.length,
    pages,
    current,
    start,
    end: Math.min(start + pageSize, matches.length),
    numbers,
  };
}
