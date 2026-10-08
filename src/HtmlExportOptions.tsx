import { useEffect, useState } from "react";
import { api, downloadFile } from "./api";
import { Field } from "./components";
import { Feedback } from "./Feedback";
import type { Narration } from "./speech-types";
import {
  repairPresenter,
  presenterPositions,
  presenterSizes,
  type PresenterState,
  type PresenterVersion,
} from "./presenter-types";

export type ExportFormat = "ppt" | "html" | "project";

// Shared by the motion editor and delivery center, including narrated exports.
export function motionHtmlUrl(
  id: string,
  notes: boolean,
  narration: string,
  presenter = "",
) {
  return `/api/motion/${encodeURIComponent(id)}/html?${new URLSearchParams({
    notes: notes ? "1" : "0",
    narration,
    presenter,
  })}`;
}

export function downloadMotionHtml(
  id: string,
  notes: boolean,
  narration: string,
  presenter = "",
) {
  return downloadFile(
    motionHtmlUrl(id, notes, narration, presenter) + "&download=1",
    "动态演示.html",
  );
}

export function useHtmlExportOptions(projectId: string, revision?: number) {
  const [narrations, setNarrations] = useState<Narration[]>([]);
  const [narration, setNarration] = useState("");
  const [notes, setNotes] = useState(false);
  const [error, setError] = useState("");
  const [presenters, setPresenters] = useState<PresenterVersion[]>([]);
  const [includePresenter, setIncludePresenter] = useState(false);
  const [selectedPresenter, setSelectedPresenter] = useState("");
  useEffect(() => {
    setNarration("");
    setIncludePresenter(false);
    setSelectedPresenter("");
  }, [projectId]);
  useEffect(() => {
    let alive = true;
    setNarrations([]);
    setError("");
    setPresenters([]);
    api<PresenterState>("/projects/" + projectId + "/presenter")
      .then((state) => {
        if (alive) setPresenters(state.versions);
      })
      .catch(() => {
        /* Plain audio/HTML stays available on older servers. */
      });
    api<Narration[]>(`/projects/${projectId}/narration`)
      .then((list) => {
        if (alive) setNarrations(list.filter((n) => n.status === "ready"));
      })
      .catch(() => {
        if (alive)
          setError("口播版本暂时无法读取；可关闭后重试，或仅导出画面。");
      });
    return () => {
      alive = false;
    };
  }, [projectId, revision]);
  const matching = presenters.filter(
    (p) => p.current && p.narrationId === narration && p.status === "ready",
  );
  const presenter =
    matching.find((p) => p.id === selectedPresenter) || matching.at(-1);
  return {
    narrations,
    narration,
    setNarration,
    notes,
    setNotes,
    error,
    matching,
    includePresenter,
    setIncludePresenter,
    selectedPresenter: presenter?.id || "",
    setSelectedPresenter,
    presenter: includePresenter ? presenter?.id || "" : "",
    presenterBlocked: includePresenter && !presenter,
  };
}

export function HtmlExportOptions({
  options,
  disabled = false,
}: {
  options: ReturnType<typeof useHtmlExportOptions>;
  disabled?: boolean;
}) {
  return (
    <div className="html-export-options">
      <label className="motion-check">
        <input
          type="checkbox"
          checked={options.notes}
          disabled={disabled}
          onChange={(e) => options.setNotes(e.target.checked)}
        />
        HTML 包含演讲备注
      </label>
      <Field label="HTML 口播版本">
        <select
          value={options.narration}
          disabled={disabled}
          onChange={(e) => options.setNarration(e.target.value)}
        >
          <option value="">仅画面，不包含口播</option>
          {options.narrations.map((n) => (
            <option key={n.id} value={n.id}>
              {n.voiceName} · 项目版本 {n.sourceRevision} ·{" "}
              {new Date(n.createdAt).toLocaleString("zh-CN")}
            </option>
          ))}
        </select>
      </Field>
      <label className="motion-check">
        <input
          type="checkbox"
          checked={options.includePresenter}
          disabled={
            disabled || (!options.narration && !options.includePresenter)
          }
          onChange={(e) => options.setIncludePresenter(e.target.checked)}
        />
        包含数字人讲解员
      </label>
      {options.includePresenter &&
        (options.matching.length ? (
          <Field label="HTML 数字人版本">
            <select
              value={options.selectedPresenter}
              disabled={disabled}
              onChange={(e) => options.setSelectedPresenter(e.target.value)}
            >
              {options.matching.map((p) => (
                <option key={p.id} value={p.id}>
                  {new Date(p.createdAt).toLocaleString("zh-CN")} ·{" "}
                  {presenterPositions[p.placement]} · {presenterSizes[p.size]}
                  {p.provider === "mock" ? " · 测试样本" : ""}
                </option>
              ))}
            </select>
          </Field>
        ) : (
          <Feedback
            kind="blocking"
            action={{
              label: "前往演练中心更新数字人",
              onClick: repairPresenter,
            }}
          >
            <p>
              没有与当前页面及所选口播一致的完整数字人版本。可更新数字人，或取消勾选后导出普通
              HTML。
            </p>
          </Feedback>
        ))}
      {options.error && (
        <p role="status" className="detail-help">
          {options.error}
        </p>
      )}
    </div>
  );
}
