export const PAGE_NUMBER_TOKEN: string;
export function pageNumberTemplate(rules?: string): string;
export function pageNumberStyle(
  rules: string | undefined,
  pageNumber?: number,
): { supported: boolean; label: string | null; rules: string };
export function withProjectPageNumber<T>(
  plan: T,
  slides: { id: string }[],
  slideId: string,
): T & { pageNumber: number };
