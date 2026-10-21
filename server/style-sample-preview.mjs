import { styleStamp } from "./core.mjs";
import { sampleSelection } from "../shared/style-sample-sequence.mjs";
import { STYLE_SAMPLE_PAGES } from "../shared/style-sample-suite.mjs";

// Read-only administrator previews. Never write trial images onto a style or
// publish them just to make completed (including partial) suites browsable.
export function styleSamplePreviews(styles, trials, jobs) {
  const statuses = new Map(jobs.map((job) => [job.id, job.status]));
  const grouped = new Map();
  for (const trial of [...trials].sort((a, b) =>
    (b.createdAt || "").localeCompare(a.createdAt || ""),
  )) {
    if (!grouped.has(trial.styleId)) grouped.set(trial.styleId, []);
    grouped.get(trial.styleId).push({
      ...trial,
      status: statuses.get(trial.jobId) || trial.status,
    });
  }
  return new Map(
    styles
      .filter((style) => !style.deletedAt && !style.catalogSourceId)
      .map((style) => [
        style.id,
        sampleSelection(
          grouped.get(style.id) || [],
          styleStamp(style).fingerprint,
        ).flatMap((trial, index) => {
          if (!trial) return [];
          const page = STYLE_SAMPLE_PAGES[index];
          return [
            {
              id: trial.id,
              image: trial.image,
              pageId: page.id,
              number: page.number,
              title: page.title,
              expression: page.type,
            },
          ];
        }),
      ]),
  );
}
