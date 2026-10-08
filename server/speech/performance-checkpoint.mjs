import { createHash } from "node:crypto";
import {
  PERFORMANCE_VERSION,
  speechUnits,
  validateDelivery,
} from "../../shared/speech-performance.mjs";

import { readDirectorState } from "./performance-director.mjs";

// Input identity is independent of request grouping: old validated cues remain
// reusable. The new global director state has its own schema version.
const CHECKPOINT_VERSION = 1;
export function performanceFingerprint(pages, config, model) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        CHECKPOINT_VERSION,
        PERFORMANCE_VERSION,
        config,
        model.baseUrl.trim().replace(/\/+$/, ""),
        model.model,
        pages.map(({ id, title, notes, text }) => [id, title, notes, text]),
      ]),
    )
    .digest("hex");
}

// Only a validated contiguous prefix may be reused; partial work stays private
// until the complete plan passes validation and replaces the previous plan.
export function readPerformanceCheckpoint(
  checkpoint,
  fingerprint,
  pages,
  config,
) {
  if (
    !checkpoint ||
    checkpoint.fingerprint !== fingerprint ||
    !Array.isArray(checkpoint.entries) ||
    checkpoint.entries.length > pages.length
  )
    return null;
  let completed = 0,
    savedUnits = 0;
  const entries = [];
  let director;
  try {
    director = readDirectorState(checkpoint.director, pages);
    if (!checkpoint.entries.length && !director?.parts.length) return null;
    for (let i = 0; i < checkpoint.entries.length; i++) {
      const entry = checkpoint.entries[i],
        page = pages[i],
        units = speechUnits(page.text);
      if (
        entry.id !== page.id ||
        !Array.isArray(entry.units) ||
        entry.units.length > units.length ||
        (units.length && !entry.units.length) ||
        (i < checkpoint.entries.length - 1 &&
          entry.units.length !== units.length)
      )
        return null;
      const validated = validateDelivery(
        units.slice(0, entry.units.length),
        entry.units,
        config,
        page.notes,
      );
      entries.push({ id: page.id, units: validated });
      savedUnits += validated.length;
      if (validated.length === units.length) completed++;
    }
  } catch {
    return null;
  }
  return { entries, completed, savedUnits, director };
}
