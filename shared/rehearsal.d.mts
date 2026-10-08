export type RehearsalRecord = { signature: string; completedAt: string };
export type RehearsalState = {
  status: "unavailable" | "unstarted" | "complete" | "stale";
  label: string;
  completedAt?: string;
};
export function contentSignature(project: {
  slides: unknown[];
  [key: string]: unknown;
}): string;
export function cleanRehearsal(record: unknown): RehearsalRecord | undefined;
export function rehearsalState(
  project: { slides: unknown[]; [key: string]: unknown },
  capability?: { enabled: boolean; reason?: string },
): RehearsalState;
