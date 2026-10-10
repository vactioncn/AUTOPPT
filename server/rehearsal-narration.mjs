import { createHash } from "node:crypto";
import { get, put, now } from "./store.mjs";
import { SPEECH_TEXT_VERSION } from "../shared/speech-text.mjs";
// Publish only a full project snapshot, never a short trial masquerading as a whole deck.
export function publishRehearsalNarration(run, pages = run.pages) {
  if (
    run.scope === "trial" ||
    run.plan.actor === "self" ||
    run.plan.narrationId ||
    get("narration", run.id)
  )
    return;
  const project = get("project", run.projectId);
  if (
    !project ||
    pages.length !== project.slides.length ||
    !project.slides.every((s) => pages.some((p) => p.id === s.id)) ||
    pages.some((p) => !p.clips.length || p.clips.some((c) => !c.audioFile))
  )
    return;
  put("narration", {
    id: run.id,
    projectId: run.projectId,
    title: run.projectTitle || project.title,
    sourceRevision: run.sourceRevision,
    options: run.options,
    voiceName: run.voiceName,
    provider: run.speechProvider,
    model: run.speechModel,
    status: "ready",
    progress: "演练口播已就绪，音频可独立播放和导出。",
    createdAt: now(),
    pages: pages.map((p) => ({
      ...p,
      spokenText: p.text || p.clips.map((c) => c.text).join(""),
      speechTextVersion: SPEECH_TEXT_VERSION,
      emotion: run.options.emotion,
      status: "ready",
      sourceFingerprint: createHash("sha256")
        .update(
          JSON.stringify({ image: p.image, scene: p.scene, notes: p.notes }),
        )
        .digest("hex"),
      clips: p.clips.map((c) => ({
        text: c.text,
        file: c.audioFile,
        duration: c.duration,
      })),
    })),
  });
}
