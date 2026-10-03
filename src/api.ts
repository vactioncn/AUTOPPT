import { exportManuscript } from "../shared/manuscript.mjs";
import type { Project } from "./types";
export async function api<T = any>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const form = options.body instanceof FormData;
  const response = await fetch("/api" + path, {
    ...options,
    headers: {
      ...(!form ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "操作没有完成，请重试。");
  return data;
}
export const post = <T = any>(path: string, body: unknown = {}) =>
  api<T>(path, { method: "POST", body: JSON.stringify(body) });
export const patch = <T = any>(path: string, body: unknown) =>
  api<T>(path, { method: "PATCH", body: JSON.stringify(body) });
export const asset = (name: string) => "/assets/" + encodeURIComponent(name);
export async function downloadPresentation(
  id: string,
  revision: number,
  allowStale: boolean,
  bundle = true,
) {
  const query = new URLSearchParams({
    revision: String(revision),
    allowStale: allowStale ? "1" : "0",
    bundle: bundle ? "1" : "0",
  });
  return downloadFile(
    `/api/projects/${encodeURIComponent(id)}/export?${query}`,
    bundle ? "演讲.zip" : "演讲.pptx",
  );
}
export async function downloadManuscript(id: string, revision: number) {
  // Read the latest saved snapshot; text-only export also works with older servers.
  const project = await api<Project>(`/projects/${encodeURIComponent(id)}`);
  if (project.revision !== revision)
    throw new Error("项目内容已更新，请再点击一次导出。");
  const stem =
    project.title
      .replace(/[\x00-\x1f\x7f<>:"/\\|?*]/g, "_")
      .replace(/[. ]+$/g, "")
      .trim()
      .slice(0, 100) || "演讲";
  saveDownload(
    new Blob([exportManuscript(project)], {
      type: "text/markdown;charset=utf-8",
    }),
    `${stem}-逐字稿-v${revision}.md`,
  );
}
async function downloadFile(path: string, fallback: string) {
  const response = await fetch(path);
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "导出没有完成，请重试。");
  }
  const disposition = response.headers.get("Content-Disposition") || "";
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const filename = encoded
    ? decodeURIComponent(encoded)
    : disposition.match(/filename="([^"]+)"/i)?.[1] || fallback;
  saveDownload(await response.blob(), filename);
}
function saveDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
export const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("zh-CN", { month: "long", day: "numeric" });
export const active = (status: string) =>
  ["queued", "running"].includes(status);
