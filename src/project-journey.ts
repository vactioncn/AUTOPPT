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
  const tasks: JourneyTask[] = [];
  const task = (
    count: number | boolean,
    target: JourneyTarget,
    label: string,
    reason: string,
    tone: JourneyTask["tone"] = "warning",
    area: ProjectArea = "studio",
  ) => {
    if (count)
      tasks.push({ id: target, reason, tone, action: { area, target, label } });
  };
  task(
    working,
    "jobs",
    `查看 ${working} 项后台任务`,
    `${working} 项后台制作任务进行中，完成或停止后再导出 PPTX。`,
    "progress",
  );
  task(
    failed,
    "failed",
    `检查 ${failed} 页失败页面`,
    "打开失败页面，查看原因并重试。",
    "error",
  );
  task(
    missing.length,
    "missing",
    `补齐 ${missing.length} 页画面`,
    `第 ${missing.join("、")} 页缺少画面；打开页面继续制作。`,
  );
  task(
    stale,
    "stale",
    `核对 ${stale} 页画面`,
    "这些页面生成后修改过讲稿，不代表画面有错。查看每页变化，决定修改画面或确认保留。",
  );
  task(
    unsegmented,
    "batches",
    `继续 ${unsegmented} 段未拆页讲稿`,
    "原文已保存，前往制作台查看未完成任务并继续。",
  );
  task(
    !!project.proposal,
    "proposal",
    "查看待确认方案",
    "拆分或合并方案待确认，当前母版仍保留原页面。",
    "info",
  );
  task(
    hasDraft,
    "composer",
    "继续未提交草稿",
    "草稿尚未进入页面和逐字稿交付物；请继续编辑并提交。",
    "info",
  );
  task(
    !total && !unsegmented && !hasDraft,
    "composer",
    "开始写讲稿",
    "添加第一段讲稿，开始制作页面。",
    "info",
  );
  task(
    presentationJobs,
    "presentations",
    `查看 ${presentationJobs} 项演练任务`,
    "口播或动态演示正在制作，可在演练中心查看进度。",
    "progress",
    "rehearsal",
  );
  const nextMaking = tasks.find((t) => t.action.area === "studio");
  // A subset conversion is not evidence that the entire talk is ready.
  const currentPresentation = presentations.some(
    (p) =>
      p.sourceRevision === project.revision &&
      completePresentation(p) &&
      p.pages.length === total &&
      project.slides.every((s, i) => p.pages[i]?.id === s.id),
  );
  const next: JourneyAction = nextMaking
    ? nextMaking.action
    : currentPresentation && !presentationJobs
      ? { area: "delivery", target: "checks", label: "检查交付" }
      : {
          area: "rehearsal",
          target: "presentations",
          label: presentationJobs ? "查看演练进度" : "开始演练",
        };
  // Mirror existing PPTX export blockers; warnings still require review in the dialog.
  const pptxReady = !!total && !working && !missing.length && !unsegmented;
  return {
    total,
    illustrated,
    missing,
    stale,
    unsegmented,
    failed,
    working,
    pptxReady,
    needsReview: !!(stale || failed || hasDraft || project.proposal),
    tasks,
    next,
  };
}

export type JourneyTarget =
  | "composer"
  | "missing"
  | "stale"
  | "failed"
  | "jobs"
  | "batches"
  | "proposal"
  | "pages"
  | "presentations"
  | "player"
  | "checks";
export type JourneyAction = {
  area: ProjectArea;
  target: JourneyTarget;
  label: string;
  disabled?: boolean;
};
export type JourneyTask = {
  id: string;
  reason: string;
  tone: "info" | "progress" | "warning" | "error";
  action: JourneyAction;
};

export function projectPrimaryAction(
  area: ProjectArea,
  journey: ReturnType<typeof projectJourney>,
  {
    speechAvailable = true,
    bundleAvailable = true,
  }: { speechAvailable?: boolean; bundleAvailable?: boolean } = {},
): JourneyAction {
  if (area === "overview") return journey.next;
  if (area === "rehearsal")
    return journey.illustrated
      ? {
          area,
          target: "player",
          label: speechAvailable ? "打开演讲播放器" : "标准放映不可用",
          disabled: !speechAvailable,
        }
      : { area: "studio", target: "pages", label: "返回制作台" };
  if (area === "delivery")
    return {
      area,
      target: "checks",
      label:
        journey.pptxReady && !journey.needsReview
          ? bundleAvailable
            ? "下载 ZIP 交付包"
            : "下载 PPTX"
          : "查看导出检查",
    };
  return (
    journey.tasks.find((task) => task.action.area === "studio")?.action || {
      area,
      target: "pages",
      label: `检查 ${journey.total} 页讲稿与画面`,
    }
  );
}
