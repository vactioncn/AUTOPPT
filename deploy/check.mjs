import { readFileSync, accessSync, constants, statSync } from "node:fs";
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
const speech = process.argv.includes("--speech");
const music = process.argv.includes("--music");
const preview = process.argv.includes("--preview");
if (
  !preview &&
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
for (const name of [
  "admin_password",
  "text_key",
  "image_key",
  ...(speech ? ["speech_key"] : []),
]) {
  try {
    const file = path.join(dir, "secrets", name);
    accessSync(file, constants.R_OK);
    const content = readFileSync(file, "utf8").trim();
    if (
      !content ||
      (name === "admin_password" &&
        (content.length < 6 || content.length > 128))
    )
      throw new Error();
  } catch {
    problems.push(`检查 secrets/${name} 文件是否存在、可读且内容有效。`);
  }
}
if (speech) {
  try {
    const url = new URL(values.AUTOPPT_SPEECH_BASE_URL);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !/^speech-/.test(values.AUTOPPT_SPEECH_MODEL || "")
    )
      throw new Error();
  } catch {
    problems.push("检查 MiniMax 原生 HTTPS 地址和 speech 模型名称。");
  }
  for (const name of [
    "AUTOPPT_DAILY_SPEECH_CHARS",
    "AUTOPPT_USER_DAILY_SPEECH_CHARS",
  ]) {
    const n = Number(values[name]);
    if (!Number.isSafeInteger(n) || n < 1)
      problems.push(`${name} 应为正整数。`);
  }
}
if (music) {
  try {
    const root = path.resolve(dir, "../music");
    const list = JSON.parse(
      readFileSync(path.join(root, "index.json"), "utf8"),
    );
    if (!Array.isArray(list) || !list.length || list.length > 30)
      throw new Error();
    for (const track of list) {
      if (
        !/^[a-f0-9]{24}$/.test(track.id || "") ||
        typeof track.name !== "string"
      )
        throw new Error();
      const file = path.join(root, track.id + ".mp3");
      accessSync(file, constants.R_OK);
      if (!statSync(file).isFile() || !statSync(file).size) throw new Error();
    }
  } catch {
    problems.push("检查 music/index.json 和曲目 MP3 是否完整且可读。");
  }
}
if (problems.length) {
  console.error(problems.map((s) => `- ${s}`).join("\n"));
  process.exitCode = 1;
} else
  console.log(
    preview
      ? "部署配置检查通过（仅适用于 preview.sh 回环地址验收；未调用模型，未验证公网或供应商权限）。"
      : "部署配置检查通过（未调用模型，尚未验证 DNS、网络或供应商权限）。",
  );
