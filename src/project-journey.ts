import type { Job, Project } from "./types";

export const projectAreas = {
  overview: "概览",
  studio: "制作台",
  rehearsal: "演练中心",
  delivery: "交付中心",
} as const;
export type ProjectArea = keyof typeof projectAreas;
export function projectArea(value?: string): ProjectArea {
  return value && Object.hasOwn(projectAreas, value)
    ? (value as ProjectArea)
    : "overview";
}

// Read-only projections of existing endpoints; these are not new saved states.
export type PresentationRecord = {
  id: string;
  sourceRevision: number;
  status: string;
  pages: { id: string; status: string; reviewed?: boolean }[];
};
export const isWorking = (status: string) =>
  ["queued", "running"].includes(status);
export const completePresentation = (record: PresentationRecord) =>
  !isWorking(record.status) &&
  record.pages.length > 0 &&
  record.pages.every((page) => page.status === "ready");

export function projectJourney(
  project: Project,
  jobs: Job[],
  hasDraft: boolean,
  presentations: PresentationRecord[] = [],
) {
  const total = project.slides.length;
  const illustrated = project.slides.filter((s) => s.image || s.scene).length;
  const missing = project.slides.flatMap((s, i) =>
    !s.image && !s.scene ? [i + 1] : [],
  );
  const stale = project.slides.filter((s) => s.stale).length;
  const failed = project.slides.filter((s) => s.status === "error").length;
  const unsegmented = project.batches.filter((b) => !b.slideIds.length).length;
  const working = jobs.filter((j) => isWorking(j.status)).length;
  const presentationJobs = presentations.filter((p) =>
    isWorking(p.status),
  ).length;
  const tasks = [
    !total && !unsegmented ? "添加第一段讲稿，开始制作页面。" : "",
    hasDraft
      ? "有尚未提交的草稿，放映与逐字稿交付物不包含这部分内容；项目源文件包含已保存草稿。"
      : "",
    unsegmented ? `${unsegmented} 段讲稿尚未完成拆页。` : "",
    missing.length
      ? `${missing.length} 页待生成（第 ${missing.join("、")} 页缺少画面）。`
      : "",
    stale
      ? `${stale} 页内容已改待更新；导出当前画面时，备注仍使用最新讲稿。`
      : "",
    failed ? `${failed} 页制作失败，请在制作台检查并重试。` : "",
    working ? `${working} 项后台制作任务进行中，完成或停止后再导出 PPT。` : "",
    project.proposal ? "有拆分或合并方案待确认，当前母版仍保留原页面。" : "",
    presentationJobs
      ? `${presentationJobs} 项口播或动态演示任务进行中，请到演练中心查看。`
      : "",
  ].filter(Boolean);
  const needsMaking =
    !total ||
    hasDraft ||
    unsegmented ||
    missing.length ||
    stale ||
    failed ||
    working ||
    project.proposal;
  // A subset conversion is not evidence that the entire talk is ready.
  const currentPresentation = presentations.some(
    (p) =>
      p.sourceRevision === project.revision &&
      completePresentation(p) &&
      p.pages.length === total &&
      project.slides.every((s, i) => p.pages[i]?.id === s.id),
  );
  const next: {
    area: ProjectArea;
    label: string;
    stage: string;
    reason: string;
  } = needsMaking
    ? {
        area: "studio",
        label: total || project.batches.length ? "继续制作" : "开始写讲稿",
        stage: total ? "做 · 完善母版" : "写 · 准备讲稿",
        reason: "先处理待制作内容，再进入演练与交付。",
      }
    : currentPresentation && !presentationJobs
      ? {
          area: "delivery",
          label: "检查交付",
          stage: "交 · 检查交付",
          reason:
            "已有基于当前母版的完整演示记录，可检查文件与交付条件；仍需自行核对演练效果。",
        }
      : {
          area: "rehearsal",
          label: presentationJobs ? "查看演练进度" : "开始演练",
          stage: "练 · 演练演讲",
          reason: "页面画面已齐备，可打开标准放映，或制作口播与动态演示。",
        };
  return {
    total,
    illustrated,
    missing,
    stale,
    unsegmented,
    working,
    tasks,
    next,
  };
}
