import { get, put, now } from "../store.mjs";
import { speakerNotes } from "../manuscript.mjs";
import {
  prepareSpeechText,
  SPEECH_TEXT_VERSION,
} from "../../shared/speech-text.mjs";

export function speechScript(project) {
  const draft = get("speech-script", project.id);
  return {
    revision: project.revision,
    version: SPEECH_TEXT_VERSION,
    pages: project.slides.map((s) => {
      const notes = speakerNotes(s);
      const prepared = prepareSpeechText(notes);
      const saved = draft?.pages.find(
        (p) => p.id === s.id && p.notes === notes,
      );
      return {
        id: s.id,
        notes,
        ...prepared,
        text: saved ? saved.text : prepared.text,
        edited: !!saved,
      };
    }),
  };
}
export function saveSpeechScript(project, input) {
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
  put("speech-script", {
    id: project.id,
    projectId: project.id,
    updatedAt: now(),
    pages: project.slides.map((s) => ({
      id: s.id,
      notes: speakerNotes(s),
      text: texts[s.id].trim(),
    })),
  });
  return speechScript(project);
}
