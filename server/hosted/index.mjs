import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fork } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  existsSync,
  readFileSync,
  readdirSync,
  mkdirSync,
  unlinkSync,
} from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Accounts } from "./accounts.mjs";
import { acquireLock } from "./process-lock.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const dir = path.resolve(process.env.AUTOPPT_HOSTED_DATA_DIR || ".hosted");
if (dir === path.resolve(process.env.AUTOPPT_DATA_DIR || ".local"))
  throw new Error("线上数据目录不能使用本机工作区。");
const publicUrl = new URL(
  process.env.AUTOPPT_PUBLIC_URL || "http://127.0.0.1:4318",
);
if (
  publicUrl.pathname !== "/" ||
  publicUrl.search ||
  publicUrl.hash ||
  publicUrl.username ||
  publicUrl.password
)
  throw new Error("AUTOPPT_PUBLIC_URL 应为站点根地址。");
const local = ["localhost", "127.0.0.1"].includes(publicUrl.hostname);
if (
  publicUrl.protocol !== "https:" &&
  !(local && publicUrl.protocol === "http:")
)
  throw new Error("线上地址必须使用 HTTPS。");
const positive = (name, fallback) => {
  const n = Number(process.env[name] || fallback);
  if (!Number.isSafeInteger(n) || n < 1)
    throw new Error(`${name} 必须为正整数。`);
  return n;
};
const maxWorkers = positive("AUTOPPT_MAX_WORKSPACES", 10);
const maxCalls = positive("AUTOPPT_MODEL_CONCURRENCY", 2);
const dailyCalls = positive("AUTOPPT_DAILY_MODEL_CALLS", 2000);
const perUserCalls = positive("AUTOPPT_USER_DAILY_MODEL_CALLS", 300);
mkdirSync(dir, { recursive: true, mode: 0o700 });
const lockPath = path.join(dir, "hosted.lock");
acquireLock(lockPath);
const accounts = new Accounts(dir, {
  signupImageCredits: Number(process.env.AUTOPPT_SIGNUP_IMAGE_CREDITS ?? 20),
});
const secret = (name) =>
  process.env[`${name}_FILE`]
    ? readFileSync(process.env[`${name}_FILE`], "utf8").trim()
    : process.env[name] || "";
const providers = Object.fromEntries(
  ["text", "image"].map((kind) => {
    const prefix = `AUTOPPT_${kind.toUpperCase()}`;
    const base = new URL(
      process.env[`${prefix}_BASE_URL`] || "https://api.openai.com/v1",
    );
    if (
      !["http:", "https:"].includes(base.protocol) ||
      base.username ||
      base.password ||
      base.search ||
      base.hash
    )
      throw new Error(`${prefix}_BASE_URL 无效。`);
    if (
      base.protocol !== "https:" &&
      !["localhost", "127.0.0.1"].includes(base.hostname)
    )
      throw new Error("远程模型接口必须使用 HTTPS。");
    return [
      kind,
      {
        baseUrl: base.href.replace(/\/$/, ""),
        apiKey: secret(`${prefix}_API_KEY`),
        model:
          process.env[`${prefix}_MODEL`] ||
          (kind === "text" ? "gpt-5.4-mini" : "gpt-image-2.5-sunburst"),
      },
    ];
  }),
);
if (!accounts.db.prepare("SELECT id FROM users LIMIT 1").get()) {
  const password = secret("AUTOPPT_ADMIN_PASSWORD");
  if (!password)
    throw new Error("首次启动请配置 AUTOPPT_ADMIN_PASSWORD_FILE。");
  await accounts.bootstrap(process.env.AUTOPPT_ADMIN_USER || "admin", password);
}
const userDir = (id) => path.join(dir, "users", id);
const workers = new Map();
const workerTokens = new Map();
let gatewayBase;
let shuttingDown = false;
let calls = 0;
const queue = [];
async function modelSlot(res) {
  if (calls < maxCalls) {
    calls++;
    return;
  }
  if (queue.length >= 80) fail("等待生成的任务较多，请稍后继续。", 429);
  await new Promise((resolve, reject) => {
    const item = {
      run: () => {
        cleanup();
        calls++;
        resolve();
      },
    };
    const cleanup = () => {
      clearTimeout(timer);
      res.off("close", closed);
      const i = queue.indexOf(item);
      if (i >= 0) queue.splice(i, 1);
    };
    const closed = () => {
      cleanup();
      reject(Object.assign(new Error("请求已取消。"), { status: 499 }));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(
        Object.assign(new Error("等待模型服务超时，请稍后继续任务。"), {
          status: 429,
        }),
      );
    }, 540000);
    res.once("close", closed);
    queue.push(item);
  });
}
function releaseSlot() {
  calls--;
  queue[0]?.run();
}

const fail = (message, status = 400) => {
  throw Object.assign(new Error(message), { status });
};

// Recover only our hosted records. No access to the existing local workspace.
function reconcile(userId, stopped = false) {
  const folder = userDir(userId);
  if (existsSync(folder))
    for (const file of readdirSync(folder)) {
      if (!/^receipt-[a-f0-9-]{36}\.json$/.test(file)) continue;
      try {
        const receipt = JSON.parse(
          readFileSync(path.join(folder, file), "utf8"),
        );
        if (
          /^[a-f0-9-]{36}\.(?:png|jpg)$/.test(receipt.filename) &&
          existsSync(path.join(folder, "assets", receipt.filename))
        ) {
          accounts.finish(userId, receipt.id, "complete", receipt.filename);
          unlinkSync(path.join(folder, file));
        }
      } catch {
        /* Keep the receipt for administrator review. */
      }
    }
  if (stopped) {
    accounts.db
      .prepare(
        "UPDATE ledger SET status='failed',updated=? WHERE userId=? AND status='reserved'",
      )
      .run(Date.now(), userId);
    accounts.db
      .prepare(
        "UPDATE ledger SET status='uncertain',updated=? WHERE userId=? AND status='dispatched'",
      )
      .run(Date.now(), userId);
  }
}
async function worker(userId) {
  if (workers.has(userId)) return workers.get(userId).ready;
  if (shuttingDown) fail("服务正在维护，请稍后重试。", 503);
  if (workers.size >= maxWorkers)
    fail("当前在线工作区已满，请联系管理员扩容。", 503);
  const token = randomBytes(32).toString("hex");
  mkdirSync(userDir(userId), { recursive: true, mode: 0o700 });
  // Explicit allowlist: child processes receive an internal token, never provider secrets.
  const child = fork(path.join(root, "server/index.mjs"), [], {
    cwd: root,
    env: {
      PATH: process.env.PATH,
      HOME: userDir(userId),
      NODE_ENV: "production",
      PORT: "0",
      AUTOPPT_DATA_DIR: userDir(userId),
      AUTOPPT_WORKER_TOKEN: token,
      AUTOPPT_GATEWAY: gatewayBase,
      AUTOPPT_TEXT_MODEL: providers.text.model,
      AUTOPPT_IMAGE_MODEL: providers.image.model,
    },
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  child.stderr.on("data", () => {}); // Errors reach the user through API; never expose credentials in logs.
  const entry = {
    child,
    token,
    ready: null,
    lastUsed: Date.now(),
    requests: 0,
  };
  workerTokens.set(token, userId);
  entry.ready = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("工作区启动超时，请稍后再试。"));
    }, 20000);
    child.once("error", (e) => {
      clearTimeout(timeout);
      reject(e);
    });
    child.once("message", (message) => {
      if (message.type === "ready") {
        clearTimeout(timeout);
        entry.port = message.port;
        resolve(entry);
      }
    });
    child.once("exit", () => {
      clearTimeout(timeout);
      workers.delete(userId);
      workerTokens.delete(token);
      reconcile(userId, true);
      reject(new Error("工作区已退出，请重新打开。"));
    });
  });
  workers.set(userId, entry);
  return entry.ready;
}
const app = express();
app.disable("x-powered-by");
// The optional proxy must be the sole network ingress (see compose.yaml).
if (process.env.AUTOPPT_TRUST_PROXY === "1") app.set("trust proxy", 1);
app.use((req, res, next) => {
  res.set({
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "same-origin",
    "X-Frame-Options": "DENY",
    "Cache-Control": "no-store",
  });
  if (!local) res.set("Strict-Transport-Security", "max-age=31536000");
  if (
    !req.path.startsWith("/internal/") &&
    !["GET", "HEAD", "OPTIONS"].includes(req.method)
  ) {
    if (req.headers.origin !== publicUrl.origin)
      return res
        .status(403)
        .json({ error: "请求来源不符，请从正式访问地址重新登录。" });
  }
  next();
});
const parse = express.json({ limit: "16kb" });
const cookieName = local ? "autoppt_session" : "__Host-autoppt_session";
function cookie(req) {
  return (
    req.headers.cookie
      ?.split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith(`${cookieName}=`))
      ?.slice(cookieName.length + 1) || ""
  );
}
function setCookie(res, value, maxAge = 7 * 86400) {
  res.setHeader(
    "Set-Cookie",
    `${cookieName}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${local ? "" : "; Secure"}`,
  );
}
const authenticated = (req, res, next) => {
  try {
    req.user = accounts.authenticate(cookie(req));
    if (!req.user) fail("请先登录。", 401);
    next();
  } catch (e) {
    next(e);
  }
};
const modelsReady = () => !!providers.text.apiKey && !!providers.image.apiKey;
const admin = (req, res, next) =>
  req.user?.role === "admin"
    ? next()
    : res.status(403).json({ error: "仅管理员可操作。" });
const internal = (req, res, next) => {
  const id = workerTokens.get(
    String(req.headers.authorization || "").replace(/^Bearer /, ""),
  );
  if (!id) return res.status(403).json({ error: "请求未授权。" });
  req.workerUser = id;
  next();
};
app.get("/api/health", (req, res) =>
  res.json({ app: "AutoPPT", ok: true, hosted: true }),
);
app.get("/api/account", (req, res) => {
  let user = null;
  try {
    user = accounts.authenticate(cookie(req));
  } catch {}
  res.json({
    hosted: true,
    user,
    modelReady: modelsReady(),
    signupImageCredits: accounts.signupImageCredits,
  });
});
const authLimit = (req, res, next) => {
  try {
    accounts.limit(`login:${req.ip}`, 20, 10 * 60000);
    accounts.limit("login:global", 120, 10 * 60000);
    next();
  } catch (e) {
    next(e);
  }
};
app.post("/api/account/login", parse, authLimit, async (req, res) => {
  const u = await accounts.login(req.body.name, req.body.password);
  setCookie(res, accounts.session(u.id));
  res.json({ user: u });
});
app.post("/api/account/register", parse, authLimit, async (req, res) => {
  const u = await accounts.register(
    req.body.name,
    req.body.password,
    req.body.invite,
  );
  setCookie(res, accounts.session(u.id));
  res.json({ user: u });
});
app.post("/api/account/logout", (req, res) => {
  accounts.logout(cookie(req));
  setCookie(res, "", 0);
  res.json({ ok: true });
});
app.post(
  "/api/account/password",
  authenticated,
  parse,
  authLimit,
  async (req, res) => {
    await accounts.changePassword(req.user.id, req.body.current, req.body.next);
    setCookie(res, "", 0);
    res.json({ ok: true });
  },
);
app.get("/api/account/usage", authenticated, (req, res) =>
  res.json(accounts.history(req.user.id)),
);
app.use("/api/admin", authenticated, admin, parse);
app.get("/api/admin", (req, res) =>
  res.json({
    ...accounts.overview(),
    modelReady: modelsReady(),
    limits: {
      concurrency: maxCalls,
      dailyCalls,
      perUserCalls,
      maxWorkers,
      signupImageCredits: accounts.signupImageCredits,
    },
    activity: {
      modelCalls: calls,
      waiting: queue.length,
      workspaces: workers.size,
    },
  }),
);
app.post("/api/admin/invites", (req, res) =>
  res.json(accounts.invite(req.user.id)),
);
app.post("/api/admin/invites/:id/revoke", (req, res) => {
  accounts.db
    .prepare("UPDATE invites SET revoked=1 WHERE id=?")
    .run(req.params.id);
  accounts.audit(req.user.id, "revoke-invite", req.params.id);
  res.json({ ok: true });
});
app.post("/api/admin/users/:id/credits", (req, res) =>
  res.json(
    accounts.topup(req.user.id, req.params.id, req.body.amount, req.body.key),
  ),
);
app.post("/api/admin/users/:id/status", (req, res) => {
  accounts.disable(req.user.id, req.params.id, req.body.disabled === true);
  res.json({ ok: true });
});
app.post("/api/admin/users/:id/password", async (req, res) => {
  await accounts.resetPassword(req.user.id, req.params.id, req.body.password);
  res.json({ ok: true });
});
app.post("/api/admin/usage/:id/release", (req, res) => {
  const record = accounts.db
    .prepare("SELECT * FROM ledger WHERE id=? AND status='uncertain'")
    .get(req.params.id);
  if (!record) fail("仅可处理待核对的记录。", 409);
  accounts.finish(record.userId, record.id, "failed", null, true);
  accounts.audit(req.user.id, "release-uncertain", record.id);
  res.json({ ok: true });
});
app.use("/internal", internal);
app.post("/internal/reserve", parse, (req, res) =>
  res.json(accounts.reserve(req.workerUser, req.body.id)),
);
app.post("/internal/finish", parse, (req, res) => {
  if (
    req.body.status === "complete" &&
    (!/^[a-f0-9-]{36}\.(?:png|jpg)$/.test(req.body.filename || "") ||
      !existsSync(
        path.join(userDir(req.workerUser), "assets", req.body.filename),
      ))
  )
    fail("成品尚未保存。", 409);
  res.json(
    accounts.finish(
      req.workerUser,
      req.body.id,
      req.body.status,
      req.body.filename,
    ),
  );
});
const modelBody = express.raw({ type: () => true, limit: "80mb" });
app.post("/internal/model/:kind/{*route}", async (req, res) => {
  const kind = req.params.kind,
    route = "/" + req.params.route.join("/");
  if (!(
    (kind === "text" && route === "/chat/completions") ||
    (kind === "image" &&
      ["/images/generations", "/images/edits"].includes(route))
  ))
    fail("模型接口无效。", 404);
  const u = accounts.active(req.workerUser);
  const lease = String(req.headers["x-autoppt-lease"] || "");
  const config = providers[kind];
  if (!config.apiKey) fail("管理员尚未配置模型服务。", 503);
  if (kind === "text" && u.available < 1)
    fail("图片额度不足，请联系管理员补充后继续制作。", 402);

  const day = new Date().toISOString().slice(0, 10);
  accounts.limit(`model:global:${day}`, dailyCalls, 86400000);
  accounts.limit(`model:${u.id}:${day}`, perUserCalls, 86400000);
  await modelSlot(res);
  try {
    // Apply backpressure while queued; do not retain dozens of large image
    // attachment bodies in memory before a provider slot is available.
    await new Promise((resolve, reject) =>
      modelBody(req, res, (error) => (error ? reject(error) : resolve())),
    );
    accounts.active(u.id);
    if (kind === "image") accounts.dispatch(u.id, lease);
    const response = await fetch(config.baseUrl + route, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": req.headers["content-type"],
      },
      body: req.body,
      signal: AbortSignal.timeout(600000),
      redirect: "error",
    });
    if (!response.ok) {
      if (kind === "image")
        accounts.finish(
          u.id,
          lease,
          response.status >= 500 ? "uncertain" : "failed",
        );
      // Do not relay arbitrary upstream HTML, stack traces, URLs, or credentials.
      return res.status(response.status).json({
        error: {
          message: `模型服务返回 ${response.status}，请稍后重试或联系管理员。`,
        },
        uncertain: response.status >= 500,
      });
    }
    res.set("Content-Type", "application/json");
    await pipeline(Readable.fromWeb(response.body), res);
  } catch (e) {
    if (e.status) throw e;
    if (kind === "image") accounts.finish(u.id, lease, "uncertain");
    if (!res.headersSent)
      res.status(502).json({
        error: { message: "模型连接中断，本次生成结果待核对。" },
        uncertain: true,
      });
  } finally {
    releaseSlot();
  }
});
app.use("/internal", (req, res) =>
  res.status(404).json({ error: "接口不存在。" }),
);
// Only checked-in/build assets are public. Uploaded/generated assets are below auth.
app.use(express.static(path.join(root, "dist"), { dotfiles: "deny" }));
app.use(["/api", "/assets"], authenticated, async (req, res) => {
  // Express routes are case-insensitive by default. Normalize policy checks too,
  // otherwise a mixed-case URL could reach the worker with hosted restrictions bypassed.
  if (
    req.originalUrl
      .split("?", 1)[0]
      .toLowerCase()
      .startsWith("/api/settings") &&
    req.method !== "GET"
  )
    fail("模型由管理员统一配置。", 403);
  if (!["GET", "HEAD"].includes(req.method))
    accounts.limit(`mutation:${req.user.id}`, 120, 60000);
  const w = await worker(req.user.id);
  w.lastUsed = Date.now();
  w.requests++;
  res.once("close", () => {
    w.requests--;
    w.lastUsed = Date.now();
  });
  // Only the gateway supplies readiness. Keep the body streaming and let the
  // authenticated worker resolve accepted request IDs before gating new work.
  const headers = {
    "x-autoppt-worker": w.token,
    "x-autoppt-model-ready": modelsReady() ? "1" : "0",
  };
  for (const key of ["content-type", "content-length", "accept"])
    if (req.headers[key]) headers[key] = req.headers[key];
  let response;
  try {
    response = await fetch(`http://127.0.0.1:${w.port}${req.originalUrl}`, {
      method: req.method,
      headers,
      ...(!["GET", "HEAD"].includes(req.method)
        ? { body: req, duplex: "half" }
        : {}),
      signal: AbortSignal.timeout(1260000),
      redirect: "manual",
    });
  } catch {
    fail("工作区连接暂时中断，已保存内容不会丢失，请稍后刷新。", 502);
  }
  res.status(response.status);
  for (const key of ["content-type", "content-disposition"])
    if (response.headers.has(key)) res.set(key, response.headers.get(key));
  // Never allow one account's cached assets to survive an account switch.
  res.set("Cache-Control", "private, no-store");
  if (response.body) await pipeline(Readable.fromWeb(response.body), res);
  else res.end();
});
app.get("/{*path}", (req, res) =>
  res.sendFile(path.join(root, "dist/index.html")),
);
app.use((err, req, res, next) => {
  if (res.headersSent) return res.end();
  res.status(err.status || 400).json({
    error: err.status ? err.message : "操作未完成，请检查输入或稍后重试。",
  });
});
const server = app.listen(
  Number(process.env.PORT || 4318),
  process.env.HOST || "127.0.0.1",
  (error) => {
    if (error) {
      console.error(`线上服务启动失败：${error.code || "unknown"}`);
      process.exit(1);
    }
    gatewayBase = `http://127.0.0.1:${server.address().port}`;
    for (const u of accounts.overview().users) reconcile(u.id, true);
    console.log(`AutoPPT hosted → ${publicUrl.origin}`);
    process.send?.({ type: "ready", port: server.address().port });
  },
);
const reconciler = setInterval(async () => {
  for (const u of accounts.overview().users) reconcile(u.id);
  for (const [id, w] of workers) {
    const checked = w.lastUsed;
    if (w.requests || Date.now() - checked < 5 * 60000 || !w.port) continue;
    try {
      const r = await fetch(`http://127.0.0.1:${w.port}/api/activity`, {
        headers: { "x-autoppt-worker": w.token },
        signal: AbortSignal.timeout(5000),
      });
      const activity = await r.json();
      if (
        r.ok &&
        activity.activeJobs === 0 &&
        !w.requests &&
        w.lastUsed === checked
      )
        w.child.kill("SIGTERM");
    } catch {
      /* Never stop a workspace whose activity cannot be verified. */
    }
  }
}, 30000);
reconciler.unref();
function stop() {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(reconciler);
  server.close();
  for (const { child } of workers.values()) child.kill("SIGTERM");
  setTimeout(() => process.exit(0), 1500).unref();
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
