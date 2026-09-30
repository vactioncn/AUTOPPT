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
export const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("zh-CN", { month: "long", day: "numeric" });
export const active = (status: string) =>
  ["queued", "running"].includes(status);
