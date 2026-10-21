export type StyleSamplePage = {
  id: string;
  number: string;
  type: string;
  objective: string;
  title: string;
  displayText: string[];
  notes: string;
  visualBrief: string;
  relationship: string;
};
export const STYLE_SAMPLE_VERSION: number;
export const STYLE_SAMPLE_TITLE: string;
export const STYLE_SAMPLE_PAGES: StyleSamplePage[];
export function sampleSource(page: StyleSamplePage): string;
