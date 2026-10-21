import type { StyleSamplePage } from "./style-sample-suite.mjs";
type SampleTrial = {
  id: string;
  purpose?: string;
  samplePageId?: string;
  sampleVersion?: number;
  baseFingerprint?: string;
  status: string;
  image?: string | null;
  error?: string;
};
export function completedSample<T extends SampleTrial>(
  trials: T[],
  pageId: string,
  fingerprint: string,
): T | undefined;
export function sampleSelection<T extends SampleTrial>(
  trials: T[],
  fingerprint: string,
  preferredIds?: string[],
): (T | undefined)[];
export function runSampleSequence<T extends SampleTrial>(options: {
  read: () => Promise<{ trials: T[]; fingerprint: string }>;
  create: (pageId: string, fingerprint: string) => Promise<T>;
  fingerprint: string;
  stopped: () => boolean;
  onPage: (page: StyleSamplePage) => void;
  onTrial: (trial: T) => void;
  wait?: () => Promise<void>;
}): Promise<void>;
