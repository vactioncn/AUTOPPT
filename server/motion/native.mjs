import { createHash } from "node:crypto";
import { projectOrThrow, saveProject } from "../store.mjs";
import { snapshot } from "../core.mjs";
import { assertIdle } from "../jobs.mjs";
import { speakerNotes } from "../manuscript.mjs";

// A read-only projection of the current project, not a second saved deck.
// The editor, rehearsal and exports therefore read exactly the same layers.
export function nativeDeck(project) {
  if (!project.slides.some((s) => s.layered)) return null;
  const pages = project.slides.map((s, index) => ({
    id: s.id,
    number: index + 1,
    title: s.plan?.title || `第 ${index + 1} 页`,
    status: s.image || s.scene ? "ready" : "pending",
    width: 1600,
    height: 900,
    background: s.image,
    layers: [],
    scene: s.scene,
    image: s.image,
    source: {
      image: s.layered ? null : s.image,
      notes: speakerNotes(s),
      stale: !!s.stale,
      fingerprint: createHash("sha256")
        .update(
          JSON.stringify({
            image: s.image,
            scene: s.scene,
            notes: s.notes,
            ...(s.layered ? { layered: s.layered } : {}),
          }),
        )
        .digest("hex"),
    },
    ...s.layered,
  }));
  return {
    id: `native-${project.id}`,
    projectId: project.id,
    native: true,
    sourceMode: "layered",
    sourceRevision: project.revision,
    revision: project.revision,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    title: project.title,
    pages,
    customFont: null,
    status: pages.every((p) => p.status === "ready") ? "ready" : "partial",
    progress: "首次制作即为底图与独立文字；修改直接保存到当前页面",
  };
}

export function getNativeDeck(key) {
  return key.startsWith("native-")
    ? nativeDeck(projectOrThrow(key.slice(7)))
    : null;
}

export function saveNativePage(deck, pageId) {
  const project = projectOrThrow(deck.projectId);
  if (project.revision !== deck.revision)
    throw Object.assign(
      new Error("项目已更新，请重新载入后保存；当前输入仍保留"),
      { status: 409 },
    );
  assertIdle(project.id, [pageId]);
  const slide = project.slides.find((s) => s.id === pageId);
  const page = deck.pages.find((p) => p.id === pageId);
  if (!slide?.layered || !page)
    throw new Error(
      "这页是已有整页图片，请先在制作台选择重新制作；其他页面不会改变",
    );
  slide.versions.push(structuredClone(snapshot(slide)));
  slide.layered = {
    ...slide.layered,
    layers: page.layers,
    playbackMode: page.playbackMode,
    choreography: page.choreography,
    reviewed: page.reviewed,
    history: page.history,
  };
  slide.plan = {
    ...slide.plan,
    displayText: page.layers
      .filter(
        (l) => l.type === "text" && l.id !== slide.layered.pageNumberLayerId,
      )
      .map((l) => l.text),
  };
  // The manually edited copy must not be replaced by a cached model draft.
  delete slide.plan.screenCopy;
  if (slide.plan.layeredLayout)
    slide.plan.layeredLayout = {
      ...slide.plan.layeredLayout,
      layers: page.layers,
    };
  project.undo = null;
  if (project.proposal?.sourceIds.includes(pageId)) project.proposal = null;
  saveProject(project);
  return nativeDeck(project);
}
