import { projectOrThrow } from "./store.mjs";
import { exportFilename } from "./export.mjs";
import { speakerNotes } from "./manuscript.mjs";
import { renderMotionHtml } from "./motion/render.mjs";
import { narrationForExport } from "./speech/export.mjs";

export async function renderStaticHtml(
  project,
  { narration = null, includeNotes = false } = {},
) {
  if (
    !project.slides.length ||
    project.slides.some((s) => !s.image && !s.scene)
  )
    throw new Error("请先完成所有页面的画面，再导出静态 HTML");
  if (project.batches?.some((b) => !b.slideIds?.length))
    throw new Error("还有讲稿未完成拆页，请先完成内容拆分");
  return renderMotionHtml(
    {
      title: project.title,
      pages: project.slides.map((s, i) => ({
        ...s,
        title: s.title || s.plan?.title || `第 ${i + 1} 页`,
        notes: speakerNotes(s),
        manuscriptVersion: 1,
        number: i + 1,
        status: "ready",
      })),
    },
    { staticMode: true, narration, includeNotes },
  );
}
function sendHtml(res, html, title, download) {
  if (download)
    res.attachment(exportFilename(title).replace(/\.pptx$/, "-口播演示.html"));
  res.type("html").send(html);
}
export function registerHtmlExport(app) {
  app.get("/api/projects/:id/html", async (req, res) => {
    const p = projectOrThrow(req.params.id);
    if (req.query.revision !== String(p.revision))
      throw Object.assign(new Error("项目已更新，请重新打开导出窗口"), {
        status: 409,
      });
    const narration = narrationForExport(req.query.narration, p.id);
    const html = await renderStaticHtml(p, {
      narration,
      includeNotes: req.query.notes === "1",
    });
    sendHtml(res, html, p.title, req.query.download === "1");
  });
  app.get("/api/narration/:id/html", async (req, res) => {
    // Lookup is scoped to a live project, including after importing a package.
    const { get } = await import("./store.mjs");
    const saved = get("narration", req.params.id);
    if (!saved) throw new Error("口播版本不存在");
    projectOrThrow(saved.projectId);
    const n = narrationForExport(saved.id, saved.projectId);
    const html = await renderStaticHtml(
      {
        title: n.title,
        slides: n.pages.map((p) => ({ ...p, manuscriptVersion: 1 })),
        batches: [],
      },
      { narration: n, includeNotes: req.query.notes === "1" },
    );
    sendHtml(res, html, n.title, req.query.download === "1");
  });
}
