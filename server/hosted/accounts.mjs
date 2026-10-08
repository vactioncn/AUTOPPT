import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync } from "node:fs";
import path from "node:path";
import {
  randomBytes,
  randomUUID,
  createHash,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
const scrypt = promisify(scryptCallback);
const digest = (value) => createHash("sha256").update(value).digest("hex");
const fail = (message, status = 400) => {
  throw Object.assign(new Error(message), { status });
};
const token = () => randomBytes(32).toString("base64url");
export async function passwordHash(password) {
  if (
    typeof password !== "string" ||
    password.length < 12 ||
    password.length > 128
  )
    fail("密码需要 12–128 个字符。");
  const salt = randomBytes(16).toString("hex");
  const key = await scrypt(password, salt, 64, {
    N: 32768,
    r: 8,
    p: 3,
    maxmem: 64 * 1024 * 1024,
  });
  return `${salt}:${key.toString("hex")}`;
}
async function passwordMatches(password, hash) {
  if (typeof password !== "string" || password.length > 128) return false;
  const [salt, stored] = hash.split(":");
  const key = await scrypt(password, salt, 64, {
    N: 32768,
    r: 8,
    p: 3,
    maxmem: 64 * 1024 * 1024,
  });
  return timingSafeEqual(key, Buffer.from(stored, "hex"));
}
const username = (value) => {
  const name = String(value || "")
    .trim()
    .toLowerCase();
  if (!/^[a-z0-9][a-z0-9_.@-]{2,79}$/.test(name))
    fail("账号需为 3–80 位字母、数字、点、下划线或邮箱格式。");
  return name;
};
export class Accounts {
  constructor(dir) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    chmodSync(dir, 0o700);
    this.db = new DatabaseSync(path.join(dir, "accounts.sqlite"));
    this.db
      .exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, name TEXT UNIQUE NOT NULL, password TEXT NOT NULL, role TEXT NOT NULL, disabled INTEGER NOT NULL DEFAULT 0, balance INTEGER NOT NULL CHECK(balance>=0), created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS invites(hash TEXT PRIMARY KEY, id TEXT UNIQUE NOT NULL, created INTEGER NOT NULL, expires INTEGER NOT NULL, usedBy TEXT, revoked INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS ledger(id TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES users(id), kind TEXT NOT NULL, amount INTEGER NOT NULL, status TEXT NOT NULL, filename TEXT, note TEXT NOT NULL DEFAULT '', created INTEGER NOT NULL, updated INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS ledger_user ON ledger(userId,created);
      CREATE TABLE IF NOT EXISTS limits(key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS audit(id TEXT PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL, target TEXT, created INTEGER NOT NULL);
    `);
  }
  transaction(fn) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const value = fn();
      this.db.exec("COMMIT");
      return value;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  limit(key, max, windowMs) {
    const now = Date.now();
    const row = this.db.prepare("SELECT * FROM limits WHERE key=?").get(key);
    if (row?.expires > now && row.count >= max)
      fail("操作较频繁，请稍后再试。", 429);
    this.db
      .prepare(
        "INSERT INTO limits VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET count=excluded.count,expires=excluded.expires",
      )
      .run(
        key,
        row?.expires > now ? row.count + 1 : 1,
        row?.expires > now ? row.expires : now + windowMs,
      );
    this.db.prepare("DELETE FROM limits WHERE expires<?").run(now - 86400000);
  }
  audit(actor, action, target) {
    this.db
      .prepare("INSERT INTO audit VALUES(?,?,?,?,?)")
      .run(randomUUID(), actor, action, target || null, Date.now());
  }
  user(id) {
    const u = this.db
      .prepare(
        "SELECT id,name,role,disabled,balance,created FROM users WHERE id=?",
      )
      .get(id);
    if (!u) return null;
    u.held = this.db
      .prepare(
        "SELECT COUNT(*) AS n FROM ledger WHERE userId=? AND kind='image' AND status IN ('reserved','dispatched','uncertain')",
      )
      .get(id).n;
    u.available = u.balance - u.held;
    return u;
  }
  active(id) {
    const u = this.user(id);
    if (!u || u.disabled) fail("账号已停用或登录已失效。", 401);
    return u;
  }
  async bootstrap(name, password) {
    if (this.db.prepare("SELECT id FROM users LIMIT 1").get()) return;
    const hash = await passwordHash(password);
    this.transaction(() => {
      if (this.db.prepare("SELECT id FROM users LIMIT 1").get()) return;
      this.db
        .prepare("INSERT INTO users VALUES(?,?,?,?,?,?,?)")
        .run(randomUUID(), username(name), hash, "admin", 0, 100, Date.now());
    });
  }
  invite(actor) {
    const code = token(),
      id = randomUUID(),
      created = Date.now(),
      expires = created + 7 * 86400000;
    this.db
      .prepare("INSERT INTO invites(hash,id,created,expires) VALUES(?,?,?,?)")
      .run(digest(code), id, created, expires);
    this.audit(actor, "create-invite", id);
    return { id, code, expires };
  }
  async register(name, password, invite) {
    name = username(name);
    const hash = await passwordHash(password);
    return this.transaction(() => {
      const code = digest(String(invite || ""));
      const i = this.db.prepare("SELECT * FROM invites WHERE hash=?").get(code);
      if (!i || i.usedBy || i.revoked || i.expires < Date.now())
        fail("邀请码无效、已使用或已过期。");
      if (this.db.prepare("SELECT id FROM users WHERE name=?").get(name))
        fail("这个账号已注册。");
      const id = randomUUID();
      this.db
        .prepare("INSERT INTO users VALUES(?,?,?,?,?,?,?)")
        .run(id, name, hash, "member", 0, 100, Date.now());
      this.db.prepare("UPDATE invites SET usedBy=? WHERE hash=?").run(id, code);
      this.audit(id, "register", i.id);
      return this.user(id);
    });
  }
  async login(name, password) {
    const row = this.db.prepare("SELECT * FROM users WHERE name=?").get(
      String(name || "")
        .trim()
        .toLowerCase(),
    );
    // Use a real scrypt operation even for unknown accounts.
    const fallback = `00000000000000000000000000000000:${"00".repeat(64)}`;
    const matches = await passwordMatches(password, row?.password || fallback);
    if (!row || !matches || row.disabled)
      fail("账号或密码不正确，或账号已停用。", 401);
    return this.user(row.id);
  }
  session(userId) {
    const code = token();
    this.db.prepare("DELETE FROM sessions WHERE expires<?").run(Date.now());
    this.db
      .prepare("INSERT INTO sessions VALUES(?,?,?)")
      .run(digest(code), userId, Date.now() + 7 * 86400000);
    return code;
  }
  authenticate(code) {
    const row = this.db
      .prepare("SELECT userId FROM sessions WHERE hash=? AND expires>?")
      .get(digest(code || ""), Date.now());
    return row ? this.active(row.userId) : null;
  }
  logout(code) {
    this.db
      .prepare("DELETE FROM sessions WHERE hash=?")
      .run(digest(code || ""));
  }
  async changePassword(id, current, next) {
    const row = this.db.prepare("SELECT * FROM users WHERE id=?").get(id);
    if (!row || !(await passwordMatches(current, row.password)))
      fail("原密码不正确。");
    const hash = await passwordHash(next);
    this.transaction(() => {
      this.db.prepare("UPDATE users SET password=? WHERE id=?").run(hash, id);
      this.db.prepare("DELETE FROM sessions WHERE userId=?").run(id);
      this.audit(id, "change-password", id);
    });
  }
  async resetPassword(actor, id, next) {
    if (!this.user(id)) fail("账号不存在。", 404);
    const hash = await passwordHash(next);
    this.transaction(() => {
      this.db.prepare("UPDATE users SET password=? WHERE id=?").run(hash, id);
      this.db.prepare("DELETE FROM sessions WHERE userId=?").run(id);
      this.audit(actor, "reset-password", id);
    });
  }
  topup(actor, userId, amount, key) {
    if (
      !Number.isSafeInteger(amount) ||
      amount < 1 ||
      amount > 10000 ||
      !/^[a-zA-Z0-9-]{16,80}$/.test(key || "")
    )
      fail("请输入 1–10000 张的补充额度。");
    return this.transaction(() => {
      if (!this.user(userId)) fail("账号不存在。", 404);
      const old = this.db.prepare("SELECT * FROM ledger WHERE id=?").get(key);
      if (old) {
        if (
          old.userId !== userId ||
          old.kind !== "topup" ||
          old.amount !== amount
        )
          fail("请求编号冲突。", 409);
        return this.user(userId);
      }
      this.db
        .prepare("UPDATE users SET balance=balance+? WHERE id=?")
        .run(amount, userId);
      this.db
        .prepare("INSERT INTO ledger VALUES(?,?,?,?,?,?,?,?,?)")
        .run(
          key,
          userId,
          "topup",
          amount,
          "complete",
          null,
          `管理员 ${actor} 补充`,
          Date.now(),
          Date.now(),
        );
      this.audit(actor, "topup", key);
      return this.user(userId);
    });
  }
  reserve(userId, key) {
    if (!/^[a-f0-9-]{36}$/.test(key || "")) fail("请求编号无效。");
    return this.transaction(() => {
      const u = this.active(userId);
      const old = this.db.prepare("SELECT * FROM ledger WHERE id=?").get(key);
      if (old) {
        if (old.userId !== userId || old.kind !== "image")
          fail("请求编号冲突。", 409);
        return old;
      }
      if (u.available < 1) fail("图片额度不足，请联系管理员补充。", 402);
      this.db
        .prepare("INSERT INTO ledger VALUES(?,?,?,?,?,?,?,?,?)")
        .run(
          key,
          userId,
          "image",
          -1,
          "reserved",
          null,
          "",
          Date.now(),
          Date.now(),
        );
      return { id: key, status: "reserved" };
    });
  }
  dispatch(userId, key) {
    this.active(userId);
    const result = this.db
      .prepare(
        "UPDATE ledger SET status='dispatched',updated=? WHERE id=? AND userId=? AND status='reserved'",
      )
      .run(Date.now(), key || "", userId);
    if (!result.changes) fail("本次生成已提交，请勿重复发送。", 409);
  }
  finish(userId, key, status, filename = null, reviewed = false) {
    if (!["complete", "failed", "uncertain"].includes(status))
      fail("状态无效。");
    return this.transaction(() => {
      const old = this.db
        .prepare(
          "SELECT * FROM ledger WHERE id=? AND userId=? AND kind='image'",
        )
        .get(key, userId);
      if (!old) fail("生成记录不存在。", 404);
      if (["complete", "failed"].includes(old.status)) return old;
      if (old.status === "reserved" && status === "uncertain")
        status = "failed";
      if (old.status === "uncertain" && status === "failed" && !reviewed)
        return old;
      if (status === "complete") {
        if (!/^[a-f0-9-]{36}\.(?:png|jpg)$/.test(filename || ""))
          fail("生成文件无效。");
        this.db
          .prepare("UPDATE users SET balance=balance-1 WHERE id=?")
          .run(userId);
      }
      this.db
        .prepare("UPDATE ledger SET status=?,filename=?,updated=? WHERE id=?")
        .run(status, filename, Date.now(), key);
      return { id: key, status, filename };
    });
  }
  disable(actor, id, value) {
    if (!this.user(id)) fail("账号不存在。", 404);
    if (id === actor) fail("不能停用当前管理员账号。");
    this.db
      .prepare("UPDATE users SET disabled=? WHERE id=?")
      .run(value ? 1 : 0, id);
    if (value) this.db.prepare("DELETE FROM sessions WHERE userId=?").run(id);
    this.audit(actor, value ? "disable" : "enable", id);
  }
  history(userId) {
    return this.db
      .prepare(
        "SELECT * FROM ledger WHERE userId=? ORDER BY created DESC LIMIT 200",
      )
      .all(userId);
  }
  overview() {
    return {
      users: this.db
        .prepare("SELECT id FROM users ORDER BY created DESC")
        .all()
        .map((u) => this.user(u.id)),
      invites: this.db
        .prepare(
          "SELECT id,created,expires,usedBy,revoked FROM invites ORDER BY created DESC LIMIT 100",
        )
        .all(),
      pending: this.db
        .prepare(
          "SELECT * FROM ledger WHERE status='uncertain' ORDER BY created",
        )
        .all(),
      audit: this.db
        .prepare("SELECT * FROM audit ORDER BY created DESC LIMIT 100")
        .all(),
    };
  }
}
