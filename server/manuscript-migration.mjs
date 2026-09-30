import { all, get, put, now, saveProject, transaction } from "./store.mjs";
import { snapshot } from "./core.mjs";
import {
  spokenManuscript,
  speakerNotes,
  MANUSCRIPT_VERSION,
} from "./manuscript.mjs";

// Keep the submitted batches and all historical versions as source evidence.
// Cleaning notes never regenerates or marks the existing pictures stale.
export function cleanProjectManuscripts(project) {
  let changed = false;
  for (const slides of [project.slides, project.undo?.slides || []]) {
    for (const slide of slides) {
      const notes = speakerNotes(slide);
      if (notes === slide.notes) continue;
      (slide.versions ||= []).push(snapshot(slide));
      slide.notes = notes;
      slide.manuscriptVersion = MANUSCRIPT_VERSION;
      changed = true;
    }
  }
  if (
    project.proposal &&
    project.proposal.manuscriptVersion !== MANUSCRIPT_VERSION
  ) {
    project.proposal.notes = project.proposal.notes.map((raw) => {
      const notes = spokenManuscript(raw);
      changed ||= notes !== raw;
      return notes;
    });
    if (changed) project.proposal.manuscriptVersion = MANUSCRIPT_VERSION;
  }
  return changed;
}

export function migrateManuscripts() {
  const changes = [];
  transaction(() => {
    for (const original of all("project")) {
      const project = structuredClone(original);
      if (!cleanProjectManuscripts(project)) continue;
      const key = `markdown-headings-v1:${project.id}`;
      if (!get("manuscriptBackup", key))
        put("manuscriptBackup", {
          id: key,
          createdAt: now(),
          project: original,
        });
      saveProject(project);
      changes.push(project.id);
    }
  });
  return changes;
}
