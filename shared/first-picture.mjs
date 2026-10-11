export function manuscriptTitle(text) {
  return (
    String(text || "")
      .split(/\r?\n/)
      .map((line) => line.replace(/^\s*#+\s*/, "").trim())
      .find(Boolean)
      ?.slice(0, 36) || "我的演讲"
  );
}

// A read-only continuation hint; never a persisted workflow or a content migration.
export function presentationProgress(project, working = false) {
  if (working) return { label: "正在生成 · 查看进度", kind: "working" };
  if (project.slides.some((s) => s.status === "error"))
    return { label: "有页面未完成 · 继续处理", kind: "failed" };
  if (project.batches.some((b) => !b.slideIds.length))
    return { label: "讲稿已保存 · 继续制作", kind: "draft" };
  const ready = project.slides.filter((s) => s.image || s.scene).length;
  if (project.slides.some((s) => s.stale))
    return { label: "讲稿有更新 · 核对画面", kind: "review" };
  if (project.draft?.trim())
    return { label: "有已保存草稿 · 继续编辑", kind: "draft" };
  if (!project.slides.length) return { label: "从一段讲稿开始", kind: "empty" };
  if (ready === project.slides.length)
    return { label: "画面已齐 · 可下载 PPT", kind: "ready" };
  if (
    ready === 1 &&
    project.batches.some((b) => b.generationMode === "preview")
  )
    return { label: "一页效果已出 · 查看并继续", kind: "preview" };
  return {
    label: `${ready} / ${project.slides.length} 页已完成 · 继续制作`,
    kind: "partial",
  };
}
