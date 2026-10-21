import {
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  chmodSync,
} from "node:fs";
import path from "node:path";

const kinds = ["text", "image"];
const fail = (message, status = 400) => {
  throw Object.assign(new Error(message), { status });
};
function connection(value) {
  if (
    !value ||
    typeof value.baseUrl !== "string" ||
    typeof value.model !== "string" ||
    typeof value.apiKey !== "string"
  )
    fail("请填写接口地址、模型名称和 API Key。");
  let url;
  try {
    url = new URL(value.baseUrl.trim());
  } catch {
    fail("请填写完整的模型接口地址。");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== "https:" &&
      !["localhost", "127.0.0.1"].includes(url.hostname))
  )
    fail("远程模型接口须使用 HTTPS，地址中不能包含密码或查询参数。");
  const model = value.model.trim(),
    apiKey = value.apiKey.trim();
  if (
    !model ||
    model.length > 200 ||
    /[\x00-\x1f\x7f]/.test(model) ||
    apiKey.length > 4096 ||
    /[\x00-\x20\x7f]/.test(apiKey)
  )
    fail("模型名称或 API Key 格式无效。");
  return { baseUrl: url.href.replace(/\/+$/, ""), model, apiKey };
}

// Environment/secrets remain the initial source. An explicit admin save creates
// a private, atomic snapshot in the same persistent volume, never a user workspace.
export class ModelServices {
  constructor(dir, env = process.env) {
    this.file = path.join(dir, "model-services.json");
    const secret = (name) =>
      env[`${name}_FILE`]
        ? readFileSync(env[`${name}_FILE`], "utf8").trim()
        : env[name] || "";
    if (existsSync(this.file)) {
      const saved = JSON.parse(readFileSync(this.file, "utf8"));
      if (
        saved.version !== 1 ||
        !Number.isSafeInteger(saved.revision) ||
        saved.revision < 1
      )
        fail("模型服务配置文件无效，请恢复备份；不会改用空配置。");
      this.revision = saved.revision;
      this.providers = Object.fromEntries(
        kinds.map((kind) => [kind, connection(saved[kind])]),
      );
    } else {
      this.revision = 0;
      this.providers = Object.fromEntries(
        kinds.map((kind) => {
          const prefix = `AUTOPPT_${kind.toUpperCase()}`;
          return [
            kind,
            connection({
              baseUrl: env[`${prefix}_BASE_URL`] || "https://api.openai.com/v1",
              model:
                env[`${prefix}_MODEL`] ||
                (kind === "text" ? "gpt-5.4-mini" : "gpt-image-2.5-sunburst"),
              apiKey: secret(`${prefix}_API_KEY`),
            }),
          ];
        }),
      );
    }
  }
  public() {
    return {
      revision: this.revision,
      ...Object.fromEntries(
        kinds.map((kind) => {
          const { baseUrl, model, apiKey } = this.providers[kind];
          return [kind, { baseUrl, model, hasKey: !!apiKey }];
        }),
      ),
    };
  }
  candidate(kind, draft) {
    if (!kinds.includes(kind)) fail("请选择文本模型或图片模型。");
    if (!draft || draft.revision !== this.revision)
      fail("配置已更新，请重新读取后再保存。", 409);
    const before = this.providers[kind];
    const next = connection({ ...draft, apiKey: draft.apiKey ?? "" });
    // Do not silently forward an existing secret to a newly entered endpoint.
    if (!next.apiKey && next.baseUrl !== before.baseUrl)
      fail("接口地址已改变，请填写新地址对应的 API Key。");
    next.apiKey ||= before.apiKey;
    if (!next.apiKey) fail("请填写 API Key。");
    return next;
  }
  save(kind, draft) {
    const next = this.candidate(kind, draft);
    const providers = Object.fromEntries(
      kinds.map((key) => [key, key === kind ? next : this.providers[key]]),
    );
    const saved = { version: 1, revision: this.revision + 1, ...providers };
    writeFileSync(this.file + ".tmp", JSON.stringify(saved, null, 2), {
      mode: 0o600,
      flush: true,
    });
    chmodSync(this.file + ".tmp", 0o600);
    renameSync(this.file + ".tmp", this.file);
    this.revision = saved.revision;
    Object.assign(this.providers, providers);
    return this.public();
  }
}
