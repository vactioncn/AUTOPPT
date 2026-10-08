import { get, put, now, settings } from "../store.mjs";
import {
  performanceFingerprint,
  readPerformanceCheckpoint,
} from "./performance-checkpoint.mjs";
import { speakerNotes } from "../manuscript.mjs";
import {
  prepareSpeechText,
  SPEECH_TEXT_VERSION,
} from "../../shared/speech-text.mjs";

export function speechScript(project) {
  const draft = get("speech-script", project.id);
  const pages = project.slides.map((s) => {
    const notes = speakerNotes(s);
    const prepared = prepareSpeechText(notes);
    const saved = draft?.pages.find((p) => p.id === s.id && p.notes === notes);
    return {
      id: s.id,
      notes,
      ...prepared,
      text: saved ? saved.text : prepared.text,
      edited: !!saved,
    };
  });
  const checkpoint = draft?.performanceCheckpoint;
  const inputs = pages.map((p, i) => ({
    ...p,
    title: project.slides[i].plan?.title || `第 ${i + 1} 页`,
  }));
  const resume =
    checkpoint &&
    readPerformanceCheckpoint(
      checkpoint,
      performanceFingerprint(inputs, checkpoint.settings, settings().text),
      inputs,
      checkpoint.settings,
    );
  return {
    revision: project.revision,
    version: SPEECH_TEXT_VERSION,
    performance: draft?.performance || null,
    performanceTask: draft?.performanceTask
      ? {
          ...draft.performanceTask,
          canResume:
            !!resume &&
            ["failed", "cancelled", "interrupted"].includes(
              draft.performanceTask.status,
            ),
          resumeSettings: resume ? checkpoint.settings : undefined,
        }
      : null,
    pages,
  };
}
export function prepareSpeechScript(project, input) {
  if (input.revision !== project.revision)
    throw Object.assign(
      new Error("讲稿已更新，请载入当前项目后再检查口播文本"),
      { status: 409 },
    );
  const texts = input.pageTexts;
  if (
    !texts ||
    typeof texts !== "object" ||
    Array.isArray(texts) ||
    Object.keys(texts).length !== project.slides.length ||
    project.slides.some(
      (s) => typeof texts[s.id] !== "string" || texts[s.id].length > 100000,
    )
  )
    throw new Error(
      "请检查每页口播文本（每页最多 10 万字符，可留空作为无口播页）",
    );
  return {
    id: project.id,
    projectId: project.id,
    updatedAt: now(),
    pages: project.slides.map((s) => ({
      id: s.id,
      notes: speakerNotes(s),
      text: texts[s.id].trim(),
    })),
  };
}
export function saveSpeechScript(project, input) {
  put("speech-script", {
    ...get("speech-script", project.id),
    ...prepareSpeechScript(project, input),
  });
  return speechScript(project);
}
