export function visualReviewReason(slide: {
  image?: string | null;
  scene?: unknown;
  notes: string;
  versions?: {
    stale?: boolean;
    image?: string | null;
    scene?: unknown;
    notes: string;
  }[];
}): { kind: string; before: string | null; reason: string };
