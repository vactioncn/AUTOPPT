import { useEffect, useState } from "react";
import { DownloadSimple, ArrowClockwise } from "@phosphor-icons/react";
import { api } from "./api";
import { Button, Modal } from "./components";

type Report = {
  revision: number;
  original: number;
  body: number;
  removedHeadings: number;
  notes: number;
  speech: number;
  pages: number;
  readyPages: number;
  stalePages: number;
  draft: number;
  difference: number;
  status: string;
  textMatches: boolean;
  unsegmented: { id: string; label: string; characters: number }[];
  firstDifference: null | {
    position: number;
    page: number | null;
    original: string;
    notes: string;
  };
  perPage: {
    id: string;
    page: number;
    title: string;
    characters: number;
    ready: boolean;
  }[];
};
const n = (value: number) => value.toLocaleString();
export function ProjectReport({
  projectId,
  revision,
  title,
  onClose,
  onOpenPage,
}: {
  projectId: string;
  revision: number;
  title: string;
  onClose: () => void;
  onOpenPage: (id: string) => void;
}) {
  const [report, setReport] = useState<Report | null>(null),
    [error, setError] = useState(""),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    api<Report>(`/projects/${projectId}/report`, { signal: controller.signal })
      .then(setReport)
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [projectId, revision, attempt]);
  const download = () => {
    if (!report) return;
    const lines = [
      title + " · 制作报告",
      "统计口径：不计空白，标点、汉字、数字及英文字母均按字符计数。",
      `已提交原稿：${report.original} 字`,
      `去标题正文：${report.body} 字（标题及标记 ${report.removedHeadings} 字）`,
      `页面：${report.pages} 页，其中 ${report.readyPages} 页有画面`,
      `PPT备注：${report.notes} 字`,
      `演说稿：${report.speech} 字`,
      `备注与原稿正文差额：${report.difference} 字`,
      `逐字核对：${report.status === "matched" ? "一致（忽略空白）" : report.status === "empty" ? "尚无已提交原稿" : "存在差异，需核对"}`,
      `未拆页段落：${report.unsegmented.length}`,
      `未提交草稿：${report.draft} 字（未计入）`,
      "演说稿由页面备注按顺序组成，与备注同字数不是独立的完整性证明。",
      "",
      ...report.perPage.map(
        (p) =>
          `第 ${p.page} 页 | ${p.title} | ${p.characters} 字 | ${p.ready ? "有画面" : "待生成"}`,
      ),
    ];
    if (report.firstDifference)
      lines.push(
        "",
        `首处差异：第 ${report.firstDifference.position} 个非空白字符`,
        "原稿正文：" + report.firstDifference.original,
        "页面备注：" + report.firstDifference.notes,
      );
    const url = URL.createObjectURL(
      new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title.replace(/[<>:"/\\|?*]/g, "_")}-制作报告.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <Modal
      wide
      title="制作报告"
      subtitle="核对原稿、页面备注与演说稿，确认内容有没有漏下。"
      onClose={onClose}
    >
      {error ? (
        <div role="alert">
          <p className="error-text">{error}</p>
          <Button onClick={() => setAttempt(attempt + 1)}>
            <ArrowClockwise size={16} />
            重新读取
          </Button>
        </div>
      ) : !report ? (
        <p role="status">正在核对讲稿…</p>
      ) : (
        <>
          <div className="report-metrics">
            {[
              ["原文", report.original, "已提交的逐字稿，含标题"],
              [
                "页面",
                report.pages,
                `${report.readyPages} 页已有画面 · ${report.pages - report.readyPages} 页待生成`,
              ],
              ["页面备注", report.notes, "与导出 PPT 的备注使用同一正文"],
              ["演说稿", report.speech, "按页序拼合的完整演说稿"],
            ].map(([label, value, hint]) => (
              <div key={String(label)}>
                <span>{label}</span>
                <strong>
                  {n(Number(value))}
                  <small>{label === "页面" ? "页" : "字"}</small>
                </strong>
                <p>{hint}</p>
              </div>
            ))}
          </div>
          <div
            className={`report-summary ${report.status === "matched" ? "matched" : "attention"}`}
          >
            <strong>
              {report.status === "matched"
                ? "原稿正文与页面备注逐字一致"
                : report.status === "empty"
                  ? "还没有提交原稿"
                  : "原稿正文与页面备注存在差异"}
            </strong>
            <p>
              去掉 Markdown 标题后的原稿正文为 {n(report.body)} 字；备注
              {report.difference === 0
                ? "与正文同字数"
                : `${report.difference > 0 ? "多" : "少"} ${n(Math.abs(report.difference))} 字`}
              。
              {report.status === "different" && report.difference === 0
                ? "字数相同，但文字或顺序不一致。"
                : ""}
            </p>
            <p>
              原稿中的标题及标记共 {n(report.removedHeadings)}{" "}
              字，不用于口播。核对时忽略空格与换行，不忽略正文中的标点。
            </p>
          </div>
          {report.unsegmented.length > 0 && (
            <p className="error-text">
              还有 {report.unsegmented.length}{" "}
              段尚未拆页，正文暂未全部进入备注：
              {report.unsegmented
                .map((b) => `${b.label}（${n(b.characters)} 字）`)
                .join("、")}
              。
            </p>
          )}
          {report.firstDifference && (
            <section className="report-difference">
              <h3>
                从第 {n(report.firstDifference.position)} 个非空白字符开始不同
              </h3>
              <p>可能是尚未完成拆页或你修改过备注，请结合上下文核对。</p>
              <div>
                <span>原稿正文</span>
                <p>{report.firstDifference.original || "（正文已结束）"}</p>
              </div>
              <div>
                <span>页面备注</span>
                <p>{report.firstDifference.notes || "（备注已结束）"}</p>
              </div>
              {report.firstDifference.page && (
                <Button
                  onClick={() =>
                    onOpenPage(
                      report.perPage[report.firstDifference!.page! - 1].id,
                    )
                  }
                >
                  查看第 {report.firstDifference.page} 页
                </Button>
              )}
            </section>
          )}
          <p className="report-explanation">
            演说稿直接由页面备注按顺序组成，因此两者字数相同；是否完整，以备注与原稿正文的逐字核对为准。所有数字不计空白，标点、汉字、数字和英文字母均按字符计数。
          </p>
          {!!report.draft && (
            <p className="report-explanation">
              输入框还有 {n(report.draft)} 字未提交草稿，未计入原文或备注。
            </p>
          )}
          {!!report.stalePages && (
            <p className="report-explanation">
              {report.stalePages} 页讲稿已修改、画面待核对；报告统计最新备注。
            </p>
          )}
          {report.perPage.length > 0 && (
            <details className="report-pages">
              <summary>逐页备注字数 · {report.pages} 页</summary>
              <div>
                {report.perPage.map((p) => (
                  <button key={p.id} onClick={() => onOpenPage(p.id)}>
                    <span>{String(p.page).padStart(2, "0")}</span>
                    <span>{p.title}</span>
                    <strong>{n(p.characters)} 字</strong>
                    <small>{p.ready ? "有画面" : "待生成"}</small>
                  </button>
                ))}
              </div>
            </details>
          )}
          <div className="modal-actions">
            <Button onClick={onClose}>关闭</Button>
            <Button onClick={download}>
              <DownloadSimple size={17} />
              下载报告
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}
