export function manuscriptTitle(text: string): string;
export function presentationProgress(
  project: {
    slides: {
      image?: unknown;
      scene?: unknown;
      status?: string;
      stale?: boolean;
    }[];
    batches: { slideIds: string[]; generationMode?: string }[];
    draft?: string;
  },
  working?: boolean,
): { label: string; kind: string };
