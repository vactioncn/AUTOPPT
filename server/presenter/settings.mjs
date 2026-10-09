import {
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  chmodSync,
} from "node:fs";
import path from "node:path";
import { dataDir } from "../store.mjs";

const filename = path.join(dataDir, "presenter-settings.json");
const accountUrl = "https://api.heygen.com/v3/users/me";
const fail = (message, status = 400) =>
  Object.assign(new Error(message), { status });

export function registerPresenterSettings(app) {
  app.use("/api/settings/presenter", (_req, _res, next) =>
    process.env.AUTOPPT_WORKER_TOKEN
      ? next(fail("数字人设置目前仅在本机版提供", 403))
      : next(),
  );
  app.get("/api/settings/presenter", (_req, res) =>
    res.json(publicPresenterSettings()),
  );
  app.put("/api/settings/presenter", (req, res) =>
    res.json(savePresenterSettings(req.body)),
  );
  app.post("/api/settings/presenter/test", async (_req, res) =>
    res.json(await testPresenterConnection()),
  );
}

export function presenterSettings() {
  const saved = existsSync(filename)
    ? JSON.parse(readFileSync(filename, "utf8"))
    : {};
  return { apiKey: typeof saved.apiKey === "string" ? saved.apiKey : "" };
}

export function publicPresenterSettings() {
  return {
    provider: "heygen",
    hasKey: !!presenterSettings().apiKey,
    generationAvailable: false,
  };
}

export function savePresenterSettings(input) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw fail("请填写 HeyGen API Key");
  if (input.clearKey !== undefined && typeof input.clearKey !== "boolean")
    throw fail("移除密钥参数无效");
  if (input.apiKey !== undefined && typeof input.apiKey !== "string")
    throw fail("HeyGen API Key 格式无效");
  const next = (input.apiKey || "").trim();
  if (next && !/^[\x21-\x7e]{8,1024}$/.test(next))
    throw fail("HeyGen API Key 格式无效，请完整复制且不要包含空格");
  const apiKey = input.clearKey ? "" : next || presenterSettings().apiKey;
  writeFileSync(filename + ".tmp", JSON.stringify({ apiKey }, null, 2), {
    mode: 0o600,
  });
  chmodSync(filename + ".tmp", 0o600);
  renameSync(filename + ".tmp", filename);
  return publicPresenterSettings();
}

// Account lookup only. Never upload media or create a paid video from this route.
export async function testPresenterConnection(fetchAccount = fetch) {
  const rejected = (message) => ({ ok: false, message });
  const { apiKey } = presenterSettings();
  if (!apiKey) return rejected("请先保存 HeyGen API Key");
  let response;
  try {
    response = await fetchAccount(accountUrl, {
      method: "GET",
      headers: { "X-Api-Key": apiKey },
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    return rejected("无法连接 HeyGen，请检查网络后重试。");
  }
  if (response.status === 401)
    return rejected("HeyGen 密钥验证失败，请检查 API Key 是否有效。");
  if (response.status === 403)
    return rejected("HeyGen 拒绝访问，请检查 API Key 的账号查询权限。");
  if (response.status === 429)
    return rejected("HeyGen 请求繁忙，请稍后再测试连接。");
  if (!response.ok) return rejected("HeyGen 暂未返回有效结果，请稍后重试。");
  const data = await response.json().catch(() => null);
  if (
    !data?.data ||
    typeof data.data !== "object" ||
    Array.isArray(data.data) ||
    data.error
  )
    return rejected("HeyGen 返回的账号信息无效，请稍后重试。");
  // Do not expose the account's name, email, balance, or raw provider response.
  return {
    ok: true,
    message: "HeyGen 连接成功，密钥已验证。视频生成仍在接入中。",
  };
}
