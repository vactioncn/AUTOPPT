// Display membership must survive completion; lock ownership intentionally does not.
export function productionTargetIds(job, project) {
  if (job.type === "render") return job.payload.slideIds || [];
  if (job.type === "append")
    return (
      project?.batches.find((b) => b.id === job.payload.batchId)?.slideIds || []
    );
  return [];
}

export function currentProduction(project, jobs) {
  const productionJobs = jobs
    .filter(
      (j) =>
        j.projectId === project.id && ["render", "append"].includes(j.type),
    )
    .sort((a, b) =>
      (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt),
    );
  const running = productionJobs.filter((j) =>
    ["queued", "running"].includes(j.status),
  );
  const selected = running.length ? running : productionJobs.slice(0, 1);
  // An older server has no complete task membership. Name that fallback honestly.
  const useTasks =
    selected.length > 0 &&
    selected.every((j) => Array.isArray(j.targetSlideIds));
  const latestBatch = project.batches.at(-1);
  const ids = new Set(
    useTasks
      ? selected.flatMap((j) => j.targetSlideIds)
      : latestBatch?.slideIds || [],
  );
  return {
    slides: project.slides.filter((s) => ids.has(s.id)),
    label: useTasks ? "本次制作" : "最近添加",
    description: useTasks
      ? running.length
        ? "显示正在制作和排队任务涉及的页面，已完成的页面仍保留在同一任务中。页码按整份演讲编号。"
        : "显示最近一次制作任务涉及的页面。页码按整份演讲编号。"
      : "显示最近一次新增讲稿或插页，页码按整份演讲编号。",
    batchIds: useTasks
      ? [...new Set(selected.map((j) => j.batchId).filter(Boolean))]
      : latestBatch
        ? [latestBatch.id]
        : [],
  };
}
