import { canonical, paidOperation } from "../shared/paid-operations.mjs";
const digest = async (value: string | ArrayBuffer) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        typeof value === "string" ? new TextEncoder().encode(value) : value,
      ),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
type Identity = {
  complete?: boolean;
  requestId: string;
  retryOf?: string;
  retryConfirmed?: boolean;
};
export async function preparePaidRequest(path: string, options: RequestInit) {
  if (options.method !== "POST" || !paidOperation("/api" + path)) return null;
  const form = options.body instanceof FormData;
  const body: Record<string, any> = form
    ? Object.fromEntries((options.body as FormData).entries())
    : JSON.parse(String(options.body || "{}"));
  const { requestId: suppliedId, retryOf, retryConfirmed, ...payload } = body;
  const contentValue = async (value: unknown) =>
    value instanceof Blob
      ? {
          name: (value as File).name,
          mime: value.type,
          digest: await digest(await value.arrayBuffer()),
        }
      : value;
  // Multipart may contain several files under the same field name. Preserve every
  // occurrence and its order, rather than dropping all but the final image.
  const fingerprint = form
    ? await Promise.all(
        Array.from((options.body as FormData).entries())
          .filter(
            ([key]) =>
              !["requestId", "retryOf", "retryConfirmed"].includes(key),
          )
          .map(async ([key, value]) => [key, await contentValue(value)]),
      )
    : payload;
  // Read the server's persistent, account-isolated runtime identity. No settings,
  // credential, provider URL or manuscript is stored in browser request records.
  const response = await fetch("/api/request-scope");
  if (!response.ok) throw new Error("无法确认工作区身份，请刷新后重试。");
  const { scope } = await response.json();
  if (typeof scope !== "string" || !scope)
    throw new Error("无法确认工作区身份，请刷新后重试。");
  const key =
    "autoppt-paid:v1:" +
    (await digest(JSON.stringify(canonical([scope, path, fingerprint]))));
  const choose = () => {
    try {
      const saved = JSON.parse(localStorage.getItem(key) || "null");
      if (/^[\w-]{16,80}$/.test(saved?.requestId)) return saved as Identity;
      const identity = {
        requestId: navigator.locks
          ? suppliedId || crypto.randomUUID()
          : key.slice(-64),
      };
      localStorage.setItem(key, JSON.stringify(identity));
      return identity;
    } catch {
      throw new Error("浏览器无法保存请求身份，请允许本地存储后重试。");
    }
  };
  let identity: Identity = navigator.locks
    ? await navigator.locks.request(key, choose)
    : choose();
  const apply = () => {
    const headers = new Headers(options.headers);
    headers.set("X-AutoPPT-Request-Id", identity.requestId);
    if (identity.retryOf) {
      headers.set("X-AutoPPT-Retry-Of", identity.retryOf);
      headers.set("X-AutoPPT-Retry-Confirmed", "1");
    }
    options.headers = headers;
    if (form) (options.body as FormData).set("requestId", identity.requestId);
    else
      options.body = JSON.stringify({
        ...payload,
        requestId: identity.requestId,
      });
  };
  apply();
  return {
    wasComplete: identity.complete === true,
    accepted() {
      if (
        JSON.parse(localStorage.getItem(key) || "null")?.requestId ===
        identity.requestId
      )
        localStorage.setItem(
          key,
          JSON.stringify({ ...identity, complete: true }),
        );
    },
    retry(completed = false) {
      if (
        !window.confirm(
          completed
            ? "这份内容已有受理记录，取消可查看原结果。若确认再次生成，将创建新的尝试，可能再次计费。是否确认新的尝试？"
            : "上次操作可能已经产生费用。请先检查已有任务和结果。确认后会创建一次新的尝试，可能再次计费；取消会保留输入。是否确认新的尝试？",
        )
      )
        return false;
      identity = {
        requestId: crypto.randomUUID(),
        retryOf: identity.requestId,
        retryConfirmed: true,
      };
      localStorage.setItem(key, JSON.stringify(identity));
      apply();
      return true;
    },
  };
}
