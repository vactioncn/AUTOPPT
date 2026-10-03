export const DEFAULT_STYLE_ID: string;
export const BUILTIN_STYLE_COVERS: Readonly<Record<string, string>>;
export function defaultStyleId(
  styles: { id: string; rules?: string; deletedAt?: string }[],
): string;
