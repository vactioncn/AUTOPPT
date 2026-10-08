import { rehearsalState } from "../shared/rehearsal.mjs";
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
  standardCapability = { enabled: true } as {
    enabled: boolean;
    reason?: string;
  },
) {
  const total = project.slides.length;
  const illustrated = project.slides.filter((s) => s.image || s.scene).length;
  const missing = project.slides.flatMap((s, i) =>
    !s.image && !s.scene ? [i + 1] : [],
  );
  const missingWithoutFailure = project.slides.filter(
    (s) => !s.image && !s.scene && s.status !== "error",
  ).length;
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
    failed,
    "failed",
    `检查 ${failed} 页失败页面`,
    "打开失败页面，查看原因并重试。",
    "error",
  );
  task(
    missingWithoutFailure,
    "missing",
    `补齐 ${missingWithoutFailure} 页画面`,
    "这些页面缺少画面；打开页面继续制作。",
  );
  task(
    stale,
    "stale",
    `核对 ${stale} 页画面`,
    "这些页面生成后修改过讲稿，不代表画面有错。查看每页变化，决定修改画面或确认保留。",
  );
  task(
    working,
    "jobs",
    `查看 ${working} 项后台任务`,
    `${working} 项后台制作任务进行中，完成或停止后再导出 PPTX。`,
    "progress",
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
  const rehearsal = rehearsalState(project, standardCapability);
  task(
    !!total &&
      !missing.length &&
      ["unstarted", "stale"].includes(rehearsal.status),
    "player",
    rehearsal.status === "stale" ? "重新演练" : "开始演练",
    rehearsal.label,
    "info",
    "rehearsal",
  );
  task(
    !!total && !missing.length,
    "checks",
    "检查交付",
    ["complete", "unavailable"].includes(rehearsal.status)
      ? rehearsal.label
      : "检查当前演讲的交付文件。",
    "info",
    "delivery",
  );
  // One fact owns one task. Failed pages are repaired through the failure task,
  // even if they also lack an image. All destinations use current project data.
  const priority: Record<string, number> = {
    failed: 0,
    missing: 1,
    batches: 2,
    stale: 3,
    jobs: 4,
    presentations: 5,
    proposal: 8,
    composer: total ? 9 : 2,
    player: 6,
    checks: 7,
  };
  tasks.sort((a, b) => priority[a.id] - priority[b.id]);
  const next: JourneyAction = tasks[0]?.action || {
    area: "studio",
    target: "composer",
    label: "开始写讲稿",
  };
  // Mirror existing PPTX export blockers; warnings still require review in the dialog.
  const pptxReady = !!total && !working && !missing.length && !unsegmented;
  return {
    rehearsal,
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
  if (area === "rehearsal") {
    if (!journey.illustrated || journey.missing.length)
      return {
        area: "studio",
        target: journey.missing.length ? "missing" : "pages",
        label: "返回制作台",
      };
    if (!speechAvailable || journey.rehearsal.status === "unavailable")
      return {
        area,
        target: "player",
        label: "标准放映不可用",
        disabled: true,
      };
    if (journey.rehearsal.status === "complete")
      return { area: "delivery", target: "checks", label: "进入交付" };
    return {
      area,
      target: "player",
      label: journey.rehearsal.status === "stale" ? "重新演练" : "开始演练",
    };
  }
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
