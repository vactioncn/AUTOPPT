import type { Slide } from "../src/types";
export function browsePages(
  slides: Slide[],
  allSlides: Slide[],
  query: string,
  page: number,
  pageSize?: number,
): {
  slides: Slide[];
  total: number;
  pages: number;
  current: number;
  start: number;
  end: number;
  numbers: Map<string, number>;
};
