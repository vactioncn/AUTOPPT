export function planImageBatch(
  slideIds: string[],
  available: number | null | undefined,
  creditsPerPage?: number,
): {
  ids: string[];
  total: number;
  known: boolean;
  affordable: number;
  remaining: number;
  limited: boolean;
};
