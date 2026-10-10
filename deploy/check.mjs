import { readFileSync, accessSync, constants } from "node:fs";
import path from "node:path";
const dir = path.resolve(import.meta.dirname);
const values = Object.fromEntries(
  readFileSync(path.join(dir, ".env"), "utf8")
    .split(/\r?\n/)
    .filter((s) => s.trim() && !s.trim().startsWith("#"))
    .map((s) => {
      const i = s.indexOf("=");
      if (i < 1) throw new Error("配置文件必须使用 NAME=value 格式。");
      return [s.slice(0, i).trim(), s.slice(i + 1).trim()];
    }),
);
const problems = [];
if (
  !/^(?!.*example)(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(
    values.AUTOPPT_DOMAIN || "",
  )
)
  problems.push("填写可用的域名，不带协议、端口或路径。");
if (!/^[a-z0-9][a-z0-9_.@-]{2,79}$/.test(values.AUTOPPT_ADMIN_USER || "admin"))
  problems.push("管理员账号需为 3–80 位小写字母、数字或邮箱格式。");
if (!/^[a-f0-9]{40}$/.test(values.AUTOPPT_BUILD_GIT_SHA || ""))
  problems.push("缺少准确的 40 位发布提交号。");
for (const kind of ["TEXT", "IMAGE"]) {
  try {
    const url = new URL(values[`AUTOPPT_${kind}_BASE_URL`]);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error();
  } catch {
    problems.push(`${kind} 模型地址需使用 HTTPS，不在地址中填写 Key。`);
  }
  if (!values[`AUTOPPT_${kind}_MODEL`]?.trim())
    problems.push(`填写 ${kind} 模型名称。`);
}
for (const [key, min, max] of [
  ["AUTOPPT_SIGNUP_IMAGE_CREDITS", 0, 10000],
  ["AUTOPPT_MODEL_CONCURRENCY", 1, 100],
  ["AUTOPPT_MAX_WORKSPACES", 1, 100],
  ["AUTOPPT_DAILY_MODEL_CALLS", 1, 1000000],
  ["AUTOPPT_USER_DAILY_MODEL_CALLS", 1, 1000000],
]) {
  const n = Number(values[key]);
  if (!Number.isSafeInteger(n) || n < min || n > max)
    problems.push(`${key} 应为 ${min}–${max} 的整数。`);
}
for (const name of ["admin_password", "text_key", "image_key"]) {
  try {
    const file = path.join(dir, "secrets", name);
    accessSync(file, constants.R_OK);
    const content = readFileSync(file, "utf8").trim();
    if (
      !content ||
      (name === "admin_password" &&
        (content.length < 12 || content.length > 128))
    )
      throw new Error();
  } catch {
    problems.push(`检查 secrets/${name} 文件是否存在、可读且内容有效。`);
  }
}
if (problems.length) {
  console.error(problems.map((s) => `- ${s}`).join("\n"));
  process.exitCode = 1;
} else
  console.log(
    "部署配置检查通过（未调用模型，尚未验证 DNS、网络或供应商权限）。",
  );
