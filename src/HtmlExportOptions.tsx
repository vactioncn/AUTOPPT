import { useEffect, useState } from "react";
import { api, downloadFile } from "./api";
import { Field } from "./components";
import type { Narration } from "./speech-types";

export type ExportFormat = "ppt" | "html" | "project";

// Shared by the motion editor and delivery center, including narrated exports.
export function motionHtmlUrl(id: string, notes: boolean, narration: string) {
  return `/api/motion/${encodeURIComponent(id)}/html?${new URLSearchParams({
    notes: notes ? "1" : "0",
    narration,
  })}`;
}

export function downloadMotionHtml(
  id: string,
  notes: boolean,
  narration: string,
) {
  return downloadFile(
    motionHtmlUrl(id, notes, narration) + "&download=1",
    "动态演示.html",
  );
}

export function useHtmlExportOptions(projectId: string, enabled = true) {
  const [narrations, setNarrations] = useState<Narration[]>([]);
  const [narration, setNarration] = useState("");
  const [notes, setNotes] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    setNarrations([]);
    setNarration("");
    setError("");
    if (!enabled) return;
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
  }, [projectId, enabled]);
  return { narrations, narration, setNarration, notes, setNotes, error };
}

export function HtmlExportOptions({
  options,
  disabled = false,
}: {
  options: ReturnType<typeof useHtmlExportOptions>;
  disabled?: boolean;
}) {
  return (
    <>
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
      {options.error && (
        <p role="status" className="detail-help">
          {options.error}
        </p>
      )}
    </>
  );
}
