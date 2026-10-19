type Palette = { name: string; instructions: string; colors: string[] };
export const PALETTE_GROUPS: string[];
export const DESIGN_PALETTES: { group: string; palette: Palette }[];
export function samePalette(
  a: Palette | null | undefined,
  b: Palette | null | undefined,
): boolean;
export function normalizeHexColor(value: string): string | null;
