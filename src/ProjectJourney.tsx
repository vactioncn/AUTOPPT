import { useEffect, useState } from "react";
import { api } from "./api";
import {
  HtmlExportOptions,
  useHtmlExportOptions,
  downloadMotionHtml,
  type ExportFormat,
} from "./HtmlExportOptions";
import { Button } from "./components";
export { RehearsalCenter } from "./RehearsalCenter";
import type { Project } from "./types";
import type { Capabilities } from "../shared/diagnostics.mjs";
import {
  completePresentation,
  projectPrimaryAction,
  type JourneyAction,
  type PresentationRecord,
  type projectJourney,
} from "./project-journey";
import "./project-journey.css";

type RecordsState = {
  records: PresentationRecord[];
  loaded: boolean;
  error: string;
};
const emptyRecords: RecordsState = { records: [], loaded: false, error: "" };
export function usePresentationRecords(
  id: string,
  speech: boolean,
  motion: boolean,
) {
  const [narration, setNarration] = useState<RecordsState>(emptyRecords);
  const [dynamic, setDynamic] = useState<RecordsState>(emptyRecords);
  const [voice, setVoice] = useState<{ ready: boolean | null; error: string }>({
    ready: null,
    error: "",
  });
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    setNarration(emptyRecords);
    setDynamic(emptyRecords);
    setVoice({ ready: null, error: "" });
    const readRecords = async (path: string, set: typeof setNarration) => {
      try {
        const records = await api<PresentationRecord[]>(path);
        if (alive) set({ records, loaded: true, error: "" });
      } catch {
        // Never turn an unavailable endpoint into a claim that no versions exist.
        if (alive)
          set({
            records: [],
            loaded: false,
            error: "记录暂时无法读取，请稍后重试。",
          });
      }
    };
    const poll = async () => {
      await Promise.all([
        speech
          ? readRecords(`/projects/${id}/narration`, setNarration)
          : Promise.resolve(),
        motion
          ? readRecords(`/projects/${id}/motion`, setDynamic)
          : Promise.resolve(),
        speech
          ? api<{ hasKey: boolean }>("/settings/speech")
              .then((c) => {
                if (alive) setVoice({ ready: c.hasKey, error: "" });
              })
              .catch(() => {
                if (alive)
                  setVoice({
                    ready: null,
                    error: "无法读取语音服务状态，请在模型与服务中检查。",
                  });
              })
          : Promise.resolve(),
      ]);
      if (alive) timer = setTimeout(() => void poll(), 4000);
    };
    void poll();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [id, speech, motion]);
  return { narration, dynamic, voice };
}
type Presentations = ReturnType<typeof usePresentationRecords>;
type Journey = ReturnType<typeof projectJourney>;

export function ProjectOverview({
  journey,
  onAction,
}: {
  journey: Journey;
  onAction: (action: JourneyAction) => void;
}) {
  const action = projectPrimaryAction("overview", journey);
  return (
    <section aria-label="概览" className="journey-panel">
      <div className="journey-section-heading">
        <h2>{journey.tasks.length ? "当前待办" : "页面已齐备"}</h2>
        <p>
          {journey.tasks.length
            ? "查看下面的具体原因，选择现在处理或稍后继续。"
            : "打开播放器核对画面与讲稿，再检查交付文件。"}
        </p>
        <Button variant="primary" onClick={() => onAction(action)}>
          {action.label}
        </Button>
      </div>
      <TaskList journey={journey} onAction={onAction} />
      <dl className="journey-stats" aria-label="页面摘要">
        {[
          ["总页数", journey.total],
          ["已有画面", journey.illustrated],
          ["待生成", journey.missing.length],
          ["讲稿已改待核对", journey.stale],
        ].map(([label, count]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{count}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function TaskList({
  journey,
  onAction,
}: {
  journey: Journey;
  onAction: (action: JourneyAction) => void;
}) {
  return (
    <section className="journey-tasks" aria-label="待处理事项">
      <h3>待处理事项</h3>
      {journey.tasks.length ? (
        <ul>
          {journey.tasks.map((task) => (
            <li key={task.id} data-tone={task.tone}>
              <p>{task.reason}</p>
              <Button variant="ghost" onClick={() => onAction(task.action)}>
                {task.action.label}
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="journey-success">
          当前没有待制作事项。演练与交付效果仍需自行核对。
        </p>
      )}
    </section>
  );
}
const statusLabels: Record<string, string> = {
  ready: "已完成",
  partial: "部分完成",
  queued: "排队中",
  running: "进行中",
  failed: "失败",
  cancelled: "已停止",
  interrupted: "已中断",
};
function RecordStatus({
  state,
  revision,
  kind,
}: {
  state: RecordsState;
  revision: number;
  kind: string;
}) {
  if (state.error)
    return (
      <p role="status">
        {kind}
        {state.error}
      </p>
    );
  if (!state.loaded) return <p role="status">正在读取{kind}记录…</p>;
  const latest = state.records[0];
  if (!latest) return <p>尚无{kind}记录。</p>;
  return (
    <div className="journey-record">
      <p>
        最近{kind}：基于母版 r{latest.sourceRevision} ·{" "}
        {statusLabels[latest.status] || "状态待核对"} ·{" "}
        {latest.pages.filter((p) => p.status === "ready").length}/
        {latest.pages.length} 页完成
      </p>
      {latest.sourceRevision !== revision && (
        <p className="journey-warning">
          母版已变化；这份{kind}基于历史版本，不会自动同步。
        </p>
      )}
    </div>
  );
}

export function DeliveryCenter({
  hosted,
  project,
  journey,
  records,
  capabilities,
  scriptExporting,
  onReport,
  onExport,
  onManuscript,
  onRehearsal,
  onAction,
  notify,
}: {
  hosted: boolean;
  project: Project;
  journey: Journey;
  records: Presentations;
  capabilities: Capabilities;
  scriptExporting: boolean;
  onReport: () => void;
  onExport: (format: ExportFormat) => void;
  onManuscript: () => void;
  onRehearsal: () => void;
  onAction: (action: JourneyAction) => void;
  notify: (message: string) => void;
}) {
  const motionAvailable = capabilities.motionPresentation.enabled;
  const bundleAvailable = capabilities.bundleExport.enabled;
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");
  const [chosen, setChosen] = useState("");
  const html = useHtmlExportOptions(project.id, !hosted);
  const deck =
    records.dynamic.records.find((d) => d.id === chosen) ||
    records.dynamic.records[0];
  const ready = deck && completePresentation(deck);
  const action = projectPrimaryAction("delivery", journey, { bundleAvailable });
  if (!journey.total)
    return (
      <section aria-label="交付中心" className="journey-panel journey-empty">
        <h2>还没有可交付内容</h2>
        <p>回到制作台写下讲稿，生成页面后再选择交付格式。</p>
        <Button
          variant="primary"
          onClick={() =>
            onAction({
              area: "studio",
              target: "composer",
              label: "返回制作台",
            })
          }
        >
          返回制作台
        </Button>
        <details>
          <summary>项目源文件</summary>
          <p>
            即使还没有页面，也可以保存项目源文件，用于备份或迁移草稿与项目设置。
          </p>
          {capabilities.projectPackages.enabled ? (
            <Button onClick={() => onExport("project")}>导出项目源文件</Button>
          ) : (
            <p>{capabilities.projectPackages.reason}</p>
          )}
        </details>
      </section>
    );
  return (
    <section aria-label="交付中心" className="journey-panel">
      <section
        className="journey-focus"
        data-delivery-section="checks"
        aria-label="交付检查"
      >
        <div className="journey-section-heading">
          <h2>交付检查</h2>
          <p
            className={
              journey.pptxReady && !journey.needsReview
                ? "journey-success"
                : "journey-warning"
            }
          >
            {!journey.pptxReady
              ? "暂不能下载 PPTX，请先处理以下事项。"
              : journey.needsReview
                ? "画面已齐备，交付前还有内容需要核对。"
                : `${journey.total} 页画面已齐备，可以交付。`}
          </p>
        </div>
        {(!journey.pptxReady || journey.needsReview) && (
          <Button variant="primary" onClick={() => onExport("ppt")}>
            {action.label}
          </Button>
        )}
        {!!journey.tasks.length && (
          <TaskList journey={journey} onAction={onAction} />
        )}
        <Button variant="ghost" onClick={onReport}>
          查看制作报告
        </Button>
      </section>
      <section
        className="journey-primary-delivery"
        data-delivery-section="primary"
        aria-label="主交付"
      >
        <h2>PPTX＋完整逐字稿</h2>
        <p>
          {bundleAvailable
            ? "ZIP 交付包包含 PPTX＋完整逐字稿（Markdown）；备注使用最新保存的讲稿。"
            : capabilities.bundleExport.reason}
        </p>
        {journey.pptxReady && !journey.needsReview ? (
          <Button
            variant="primary"
            aria-label={
              bundleAvailable
                ? "下载 ZIP 交付包（含 PPTX＋逐字稿）"
                : "下载 PPTX"
            }
            onClick={() => onExport("ppt")}
          >
            {action.label}
          </Button>
        ) : (
          <p>完成上方检查后下载；需要提前交付正文，可在下方单独下载逐字稿。</p>
        )}
      </section>
      <section data-delivery-section="formats" aria-label="更多格式">
        <h2 className="journey-subheading">更多格式</h2>
        <div className="journey-cards">
          <article className="journey-card">
            <h3>单独逐字稿</h3>
            <p>
              按当前页序下载最新正文，无需等待图片生成。未提交草稿不包含在内。
            </p>
            {!journey.total && (
              <p className="journey-warning">
                还没有页面正文，请先在制作台添加讲稿并完成拆页。
              </p>
            )}
            {!!journey.unsegmented && (
              <p className="journey-warning">
                请先完成 {journey.unsegmented} 段讲稿拆页。
              </p>
            )}
            {(!journey.total || !!journey.unsegmented) && (
              <Button
                variant="ghost"
                onClick={() =>
                  onAction({
                    area: "studio",
                    target: journey.unsegmented ? "batches" : "composer",
                    label: "前往制作台",
                  })
                }
              >
                前往制作台
              </Button>
            )}
            <Button
              disabled={!journey.total || !!journey.unsegmented}
              loading={scriptExporting}
              onClick={onManuscript}
            >
              导出演说稿（Markdown）
            </Button>
          </article>
          {!hosted && (
            <article className="journey-card">
              <h3>静态 HTML</h3>
              <p>
                直接打包当前画面，可选择已完成的口播与演讲备注，离线放映，无需转换动画。
              </p>
              {!journey.total && !project.batches.length && (
                <p className="journey-warning">
                  还没有可打包页面，请先添加讲稿并制作画面。
                </p>
              )}
              <Button
                onClick={() =>
                  !journey.total && !project.batches.length
                    ? onAction({
                        area: "studio",
                        target: "composer",
                        label: "开始写讲稿",
                      })
                    : onExport("html")
                }
              >
                {!journey.total && !project.batches.length
                  ? "添加讲稿后制作 HTML"
                  : "导出静态 HTML"}
              </Button>
            </article>
          )}
          {!hosted && (
            <article className="journey-card">
              <h3>动态 HTML</h3>
              <p>下载演练中心已转换的动态演示，保留该演示的版本与页面范围。</p>
              {!motionAvailable ? (
                <p className="journey-warning">
                  {capabilities.motionPresentation.reason}
                </p>
              ) : (
                <>
                  <RecordStatus
                    state={records.dynamic}
                    revision={project.revision}
                    kind="动态演示"
                  />
                  {!!records.dynamic.records.length && (
                    <label className="journey-field">
                      交付版本
                      <select
                        aria-label="动态 HTML 交付版本"
                        value={deck?.id || ""}
                        disabled={downloading}
                        onChange={(e) => {
                          setChosen(e.target.value);
                          setError("");
                        }}
                      >
                        {records.dynamic.records.map((d, i) => (
                          <option key={d.id} value={d.id}>
                            {i === 0 ? "最近演示" : `历史演示 ${i}`} · 母版 r
                            {d.sourceRevision} · {d.pages.length} 页 ·{" "}
                            {statusLabels[d.status] || "状态待核对"}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {deck && (
                    <p>
                      所选演示：基于母版 r{deck.sourceRevision} ·{" "}
                      {deck.pages.length} 页。
                      {deck.sourceRevision !== project.revision
                        ? "与当前母版不同，请确认是否交付历史版本。"
                        : "来源版本与当前母版一致。"}
                      {deck.pages.length !== project.slides.length ||
                      project.slides.some((s, i) => deck.pages[i]?.id !== s.id)
                        ? "页面范围或顺序与当前项目不同，请核对。"
                        : ""}
                    </p>
                  )}
                  {deck && !ready && (
                    <p className="journey-warning">
                      所选动态演示尚未全部完成，请到演练中心完成或重试后下载。
                    </p>
                  )}
                  {ready && deck.pages.some((p) => !p.reviewed) && (
                    <p>仍有页面未标记校对，请在演练中心对照原图检查。</p>
                  )}
                  {deck && (
                    <HtmlExportOptions options={html} disabled={downloading} />
                  )}
                  <p>
                    可选与所选演示画面、讲稿一致的口播，内嵌音频后离线自动讲述；不一致时会提示并停止下载。
                  </p>
                </>
              )}
              {motionAvailable && !deck && (
                <p>先到演练中心创建动态演示，完成后即可下载。</p>
              )}
              {error && (
                <p role="alert" className="error-text">
                  {error}
                </p>
              )}
              <div className="journey-card-actions">
                <Button
                  disabled={!motionAvailable || !ready}
                  loading={downloading}
                  onClick={async () => {
                    if (!deck) return;
                    setDownloading(true);
                    setError("");
                    try {
                      await downloadMotionHtml(
                        deck.id,
                        html.notes,
                        html.narration,
                      );
                      notify("动态 HTML 已开始下载。");
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setDownloading(false);
                    }
                  }}
                >
                  下载动态 HTML
                </Button>
                <Button variant="ghost" onClick={onRehearsal}>
                  前往演练中心
                </Button>
              </div>
            </article>
          )}
        </div>
      </section>
      <section data-delivery-section="backup" aria-label="备份与继续编辑">
        <h2 className="journey-subheading">备份与继续编辑</h2>
        <article className="journey-card">
          <h3>项目源文件</h3>
          <p>
            .autoppt.zip
            包含已保存草稿、讲稿、风格、附件、历史版本、动态演示与口播，用于备份或换电脑继续编辑；不包含模型密钥。
          </p>
          <p>导入请回到项目首页选择“导入项目包”，每次创建新项目。</p>
          {!capabilities.projectPackages.enabled && (
            <p className="journey-warning">
              {capabilities.projectPackages.reason}
            </p>
          )}
          <Button
            disabled={!capabilities.projectPackages.enabled}
            onClick={() => onExport("project")}
          >
            导出项目源文件
          </Button>
        </article>
      </section>
      <p className="journey-note">
        {hosted
          ? "PPTX、Markdown 用于放映或交付；项目源文件用于在 AutoPPT"
          : "PPTX、Markdown 与 HTML 用于放映或交付；项目源文件用于在 AutoPPT"}
        中恢复编辑，不能用交付文件替代。
      </p>
    </section>
  );
}
