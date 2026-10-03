import type { Project, Job, Slide } from "../src/types";
export function currentProduction(
  project: Project,
  jobs: Job[],
): {
  slides: Slide[];
  label: string;
  description: string;
  batchIds: string[];
};
export function productionTargetIds(
  job: { type: string; payload: { slideIds?: string[]; batchId?: string } },
  project?: Project | null,
): string[];
