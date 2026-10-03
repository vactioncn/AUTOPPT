export const MANUSCRIPT_VERSION: number;
export function spokenManuscript(text: string): string;
export function speakerNotes(slide: {
  notes: string;
  manuscriptVersion?: number;
}): string;
export function exportManuscript(project: {
  title: string;
  revision?: number;
  batches?: { slideIds?: string[] }[];
  slides: { notes: string; manuscriptVersion?: number }[];
}): string;
