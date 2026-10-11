import type { RehearsalPlan, RehearsalRun } from "../src/rehearsal-types";
export function matchesRehearsalRun(
  run: RehearsalRun,
  plan: RehearsalPlan | null,
  context: {
    texts: Record<string, string>;
    model?: string;
    pageIds: string[];
    trialLength: "short" | "page";
  },
): boolean;
export function rehearsalPlaybackPieces(run: RehearsalRun): {
  page: RehearsalRun["pages"][number];
  clip: RehearsalRun["pages"][number]["clips"][number];
}[];
