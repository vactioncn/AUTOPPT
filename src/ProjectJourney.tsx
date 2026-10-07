import { useEffect, useState } from "react";
import { api } from "./api";
import {
  HtmlExportOptions,
  useHtmlExportOptions,
  downloadMotionHtml,
  type ExportFormat,
} from "./HtmlExportOptions";
import { Button } from "./components";
import type { Project } from "./types";
import {
  completePresentation,
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

export function ProjectOverview({ journey }: { journey: Journey }) {
  return (
    <section aria-label="概览" className="journey-panel">
      <div className="journey-stage">
        <span className="journey-eyebrow">写 → 做 → 练 → 交</span>
        <h2>{journey.next.stage}</h2>
        <p>{journey.next.reason}</p>
        <p>下一步：{journey.next.label}。一场演讲，持续更新同一份母版。</p>
      </div>
      <dl className="journey-stats">
        {[
          ["总页数", journey.total],
          ["已有画面", journey.illustrated],
          ["待生成", journey.missing.length],
          ["内容已改待更新", journey.stale],
        ].map(([label, count]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{count}</dd>
          </div>
        ))}
      </dl>
      <TaskList journey={journey} />
      <p className="journey-note">
        阶段由当前内容和已有演示记录判断；系统尚未记录你是否已完成演练或交付。
      </p>
    </section>
  );
}

function TaskList({ journey }: { journey: Journey }) {
  return (
    <section className="journey-tasks" aria-label="待处理事项">
      <h3>待处理事项</h3>
      {journey.tasks.length ? (
        <ul>
          {journey.tasks.map((task) => (
            <li key={task}>{task}</li>
          ))}
        </ul>
      ) : (
        <p>当前没有待制作事项。请在演练时核对画面与讲稿，再检查交付文件。</p>
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

export function RehearsalCenter({
  project,
  journey,
  records,
  speechAvailable,
  motionAvailable,
  hosted,
  selectedCount,
  onSpeech,
  onMotion,
  onSettings,
}: {
  project: Project;
  journey: Journey;
  records: Presentations;
  speechAvailable: boolean;
  motionAvailable: boolean;
  hosted: boolean;
  selectedCount: number;
  onSpeech: () => void;
  onMotion: () => void;
  onSettings: () => void;
}) {
  return (
    <section aria-label="演练中心" className="journey-panel">
      <div className="journey-section-heading">
        <h2>演练中心</h2>
        <p>当前母版 r{project.revision} · 演练中的演示保留各自的来源版本。</p>
      </div>
      <div className="journey-cards">
        <article className="journey-card">
          <h3>标准放映 / AI 口播</h3>
          <p>在同一个播放器中翻页演讲、查看讲稿，或生成 AI 口播。</p>
          {!speechAvailable ? (
            <p className="journey-warning">
              {hosted
                ? "当前托管服务未开放演讲播放器与语音功能；此版本的语音功能仅在本机提供。"
                : "当前服务未开放演讲播放器，请检查服务版本。"}
            </p>
          ) : (
            <>
              <p>标准放映使用当前母版；打开后可选择已有口播版本。</p>
              {records.voice.error ? (
                <p>{records.voice.error}</p>
              ) : records.voice.ready === false ? (
                <p className="journey-warning">
                  尚未配置语音服务，AI 口播生成不可用；仍可打开播放器手动翻页。
                </p>
              ) : records.voice.ready === null ? (
                <p>正在读取语音服务状态…</p>
              ) : (
                <p>语音服务已配置，可在播放器内选择音色并生成口播。</p>
              )}
              <RecordStatus
                state={records.narration}
                revision={project.revision}
                kind="口播"
              />
            </>
          )}
          {!journey.illustrated && <p>请先在制作台生成至少一页画面。</p>}
          <div className="journey-card-actions">
            <Button
              disabled={!speechAvailable || !journey.illustrated}
              onClick={onSpeech}
            >
              打开演讲播放器
            </Button>
            {speechAvailable &&
              (records.voice.ready === false || records.voice.error) && (
                <Button variant="ghost" onClick={onSettings}>
                  配置语音服务
                </Button>
              )}
          </div>
        </article>
        <article className="journey-card">
          <h3>动态演示</h3>
          <p>把已有画面转换为动态 HTML，在编辑器中对照原图校准和预览。</p>
          {motionAvailable ? (
            <RecordStatus
              state={records.dynamic}
              revision={project.revision}
              kind="动态演示"
            />
          ) : (
            <p className="journey-warning">
              当前服务未开放动态演示，请检查服务版本。
            </p>
          )}
          {!journey.illustrated && <p>需要先生成画面，再创建动态演示。</p>}
          {!!journey.missing.length && !!journey.illustrated && (
            <p>
              还有 {journey.missing.length}{" "}
              页缺少画面。可先在制作台选中有画面的页面进行转换。
            </p>
          )}
          <p>
            {selectedCount
              ? `制作台已选 ${selectedCount} 页，打开后可选择转换范围。`
              : "支持整个项目或制作台选中的页面；转换前会确认范围与费用。"}
          </p>
          <div className="journey-card-actions">
            <Button
              disabled={
                !motionAvailable ||
                (!journey.illustrated && !records.dynamic.records.length)
              }
              onClick={onMotion}
            >
              打开动态演示
            </Button>
          </div>
        </article>
      </div>
    </section>
  );
}

export function DeliveryCenter({
  project,
  journey,
  records,
  motionAvailable,
  bundleAvailable,
  scriptExporting,
  onReport,
  onExport,
  onManuscript,
  onRehearsal,
  notify,
}: {
  project: Project;
  journey: Journey;
  records: Presentations;
  motionAvailable: boolean;
  bundleAvailable: boolean;
  scriptExporting: boolean;
  onReport: () => void;
  onExport: (format: ExportFormat) => void;
  onManuscript: () => void;
  onRehearsal: () => void;
  notify: (message: string) => void;
}) {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");
  const [chosen, setChosen] = useState("");
  const html = useHtmlExportOptions(project.id);
  const deck =
    records.dynamic.records.find((d) => d.id === chosen) ||
    records.dynamic.records[0];
  const ready = deck && completePresentation(deck);
  return (
    <section aria-label="交付中心" className="journey-panel">
      <div className="journey-section-heading">
        <h2>交付中心</h2>
        <p>当前母版 r{project.revision} · 下载前核对内容、画面和版本。</p>
      </div>
      <TaskList journey={journey} />
      <div className="journey-cards">
        <article className="journey-card">
          <h3>制作报告</h3>
          <p>核对原文、逐页备注与逐字稿，查看缺页和内容完整性。</p>
          <Button onClick={onReport}>查看制作报告</Button>
        </article>
        <article className="journey-card">
          <h3>PPTX + 逐字稿</h3>
          <p>
            {bundleAvailable
              ? "ZIP 包含 PPTX 和完整逐字稿 Markdown。"
              : "当前服务只支持 PPTX 下载；逐字稿可从旁边入口单独下载。"}
            画面与备注采用当前保存的版本。
          </p>
          <p>
            {journey.working ||
            journey.missing.length ||
            journey.unsegmented ||
            !journey.total
              ? "尚不满足 PPT 下载条件，可打开导出检查查看详情。"
              : "画面已齐备，可打开导出检查。"}
          </p>
          <Button
            disabled={!journey.total && !project.batches.length}
            onClick={() => onExport("ppt")}
          >
            导出 PPT
          </Button>
        </article>
        <article className="journey-card">
          <h3>单独逐字稿</h3>
          <p>
            按当前页序下载最新正文，无需等待图片生成。未提交草稿不包含在内。
          </p>
          {!!journey.unsegmented && (
            <p className="journey-warning">
              请先完成 {journey.unsegmented} 段讲稿拆页。
            </p>
          )}
          <Button
            disabled={!journey.total || !!journey.unsegmented}
            loading={scriptExporting}
            onClick={onManuscript}
          >
            导出演说稿（Markdown）
          </Button>
        </article>
        <article className="journey-card">
          <h3>静态 HTML</h3>
          <p>
            直接打包当前画面，可选择已完成的口播与演讲备注，离线放映，无需转换动画。
          </p>
          <Button
            disabled={!journey.total && !project.batches.length}
            onClick={() => onExport("html")}
          >
            导出静态 HTML
          </Button>
        </article>
        <article className="journey-card">
          <h3>项目源文件</h3>
          <p>
            .autoppt.zip
            包含已保存草稿、讲稿、风格、附件、历史版本、动态演示与口播，用于备份或换电脑继续编辑；不包含模型密钥。
          </p>
          <p>导入请回到项目首页选择“导入项目包”，每次创建新项目。</p>
          <Button onClick={() => onExport("project")}>导出项目源文件</Button>
        </article>
        <article className="journey-card">
          <h3>动态 HTML</h3>
          <p>下载演练中心已转换的动态演示，保留该演示的版本与页面范围。</p>
          {!motionAvailable ? (
            <p className="journey-warning">当前服务未开放动态演示下载。</p>
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
                  await downloadMotionHtml(deck.id, html.notes, html.narration);
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
      </div>
      <p className="journey-note">
        PPTX、Markdown 与 HTML 用于放映或交付；项目源文件用于在 AutoPPT
        中恢复编辑，不能用交付文件替代。
      </p>
    </section>
  );
}
