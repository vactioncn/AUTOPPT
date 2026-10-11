import {
  createContext,
  useContext,
  useEffect,
  useState,
  useRef,
  type ReactNode,
} from "react";
import { api, post, asset } from "./api";
import { Button, Field } from "./components";
import { clearWorkspacePreferences } from "./onboarding";
import "./account.css";
import { WebSite } from "./WebSite";
import {
  publicPage,
  navigateWeb,
  workspaceTarget,
} from "../shared/web-routes.mjs";
import { frontendBuildInfo } from "./diagnostics";
type User = {
  id: string;
  name: string;
  role: string;
  balance: number;
  available: number;
  held: number;
  disabled: number;
};
type Account = {
  hosted: boolean;
  user: User | null;
  modelReady?: boolean;
  signupImageCredits?: number;
  modelStatusUnknown?: boolean;
  supportEmail?: string;
  supportUrl?: string;
};
const Context = createContext<Account>({ hosted: false, user: null });
export const useAccount = () => useContext(Context);
function forgetWorkspace() {
  clearWorkspacePreferences();
  navigateWeb("/login", true);
}
export function AccountGate({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<Account | null>(null);
  const latestAccount = useRef(account);
  latestAccount.current = account;
  const mounted = useRef(false);
  const refreshSequence = useRef(0);
  const [error, setError] = useState("");
  const [url, setUrl] = useState(() => ({
    path: location.pathname,
    hash: location.hash,
  }));
  const workspaceUser = useRef<string | null>(null);
  const lastWorkspaceRoute = useRef("projects");
  useEffect(() => {
    const update = () =>
      setUrl({ path: location.pathname, hash: location.hash });
    window.addEventListener("popstate", update);
    window.addEventListener("hashchange", update);
    return () => {
      window.removeEventListener("popstate", update);
      window.removeEventListener("hashchange", update);
    };
  }, []);
  const hosted =
    account?.hosted || (!account && frontendBuildInfo.runtimeMode === "hosted");
  const page = publicPage(url.path, url.hash);
  if (!page) lastWorkspaceRoute.current = workspaceTarget(url.hash);
  if (account?.user && !page) {
    workspaceUser.current = account.user.id;
    lastWorkspaceRoute.current = workspaceTarget(url.hash);
  }
  if (!account?.user) workspaceUser.current = null;
  const refresh = async () => {
    const sequence = ++refreshSequence.current;
    const isLatest = () =>
      mounted.current && sequence === refreshSequence.current;
    try {
      const res = await fetch("/api/account");
      if (!isLatest()) return;
      if (res.status === 404) {
        if (
          latestAccount.current?.hosted ||
          frontendBuildInfo.runtimeMode === "hosted"
        )
          throw new Error("账号服务暂时不可用。");
        setAccount({ hosted: false, user: null });
        setError("");
        return;
      }
      if (!res.ok) throw new Error("账号服务暂时不可用。");
      const nextAccount = await res.json();
      if (!isLatest()) return;
      setAccount(nextAccount);
      setError("");
    } catch (e) {
      if (!isLatest()) return;
      setAccount((a) =>
        a?.hosted ? { ...a, modelReady: false, modelStatusUnknown: true } : a,
      );
      setError((e as Error).message);
    }
  };
  useEffect(() => {
    mounted.current = true;
    void refresh();
    const expired = () => {
      refreshSequence.current++;
      setAccount((a) =>
        a?.hosted ? { ...a, user: null, modelReady: false } : a,
      );
    };
    window.addEventListener("autoppt-session-expired", expired);
    return () => {
      mounted.current = false;
      refreshSequence.current++;
      window.removeEventListener("autoppt-session-expired", expired);
    };
  }, []);
  useEffect(() => {
    if (!account?.hosted) return;
    const timer = setInterval(refresh, 10000);
    return () => clearInterval(timer);
  }, [account?.hosted]);
  if (hosted) {
    const signedIn = !!account?.user;
    const showPublic = !!page || !signedIn;
    return (
      <Context.Provider value={account || { hosted: true, user: null }}>
        {showPublic && (
          <WebSite
            page={page || "login"}
            account={account}
            error={error}
            onRetry={refresh}
            returnTo={
              page ? lastWorkspaceRoute.current : workspaceTarget(url.hash)
            }
            onAuthenticated={async () => {
              clearWorkspacePreferences();
              await refresh();
            }}
          />
        )}
        {signedIn && workspaceUser.current === account!.user!.id && (
          <div key={account!.user!.id} hidden={showPublic}>
            {children}
          </div>
        )}
      </Context.Provider>
    );
  }
  if (!account)
    return (
      <div className="boot">
        <h1>AutoPPT</h1>
        <p>{error || "正在连接工作空间…"}</p>
        {error && <Button onClick={refresh}>重新连接</Button>}
      </div>
    );
  return (
    <Context.Provider value={account}>
      <div key="local">{children}</div>
    </Context.Provider>
  );
}
export function AccountFooter({ onOpen }: { onOpen: () => void }) {
  const { user, modelReady, modelStatusUnknown } = useAccount();
  return (
    <button onClick={onOpen} className="account-footer">
      <strong>{user?.name}</strong>
      <span>
        可用 {user?.available} 张{user?.held ? ` · 预留 ${user.held} 张` : ""}
      </span>
      {!modelReady && (
        <span className="account-error">
          {modelStatusUnknown ? "暂时无法确认模型状态" : "等待管理员配置模型"}
        </span>
      )}
      <small>账号与额度 →</small>
    </button>
  );
}
type Entry = {
  id: string;
  kind: string;
  status: string;
  amount: number;
  created: number;
  filename?: string;
  userId: string;
};
const statusName: Record<string, string> = {
  reserved: "已预留",
  dispatched: "生成中",
  uncertain: "结果待核对",
  complete: "已完成",
  failed: "未扣额度",
};
export function AccountPage({ adminOnly = false }: { adminOnly?: boolean }) {
  const { user } = useAccount();
  const [usage, setUsage] = useState<Entry[]>([]),
    [error, setError] = useState(""),
    [current, setCurrent] = useState(""),
    [next, setNext] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    api<Entry[]>("/account/usage")
      .then(setUsage)
      .catch((e) => setError(e.message));
  }, []);
  if (adminOnly)
    return (
      <div className="account-page">
        <h1>网站管理</h1>
        <p>
          邀请、账号、图片额度与待核对用量在这里管理。模型连接由部署配置统一维护。
        </p>
        {user?.role === "admin" ? (
          <AdminPanel />
        ) : (
          <p role="alert">此页面仅供管理员使用。</p>
        )}
      </div>
    );
  return (
    <div className="account-page">
      <h1>账号与额度</h1>
      <p>当前账号：{user?.name}</p>
      <div className="account-balance">
        <strong>{user?.available}</strong>
        <span>张可用 · {user?.held} 张预留</span>
      </div>
      <p>
        每次成功生成图片（含重新生成和风格试做）使用 1
        张；编辑文字、导出和恢复版本不扣图片额度。需要更多额度请联系管理员。
      </p>
      <p>
        网络中断且结果不明时会暂时预留，管理员核对后释放；不会自动重复扣除。
      </p>
      {error && (
        <p role="alert" className="account-error">
          {error}
        </p>
      )}
      <Button
        onClick={async () => {
          await post("/account/logout");
          forgetWorkspace();
          location.reload();
        }}
      >
        退出登录
      </Button>
      <details>
        <summary>修改密码</summary>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await post("/account/password", { current, next });
              forgetWorkspace();
              location.reload();
            } catch (e) {
              setError((e as Error).message);
              setBusy(false);
            }
          }}
        >
          <Field label="原密码">
            <input
              type="password"
              autoComplete="current-password"
              required
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </Field>
          <Field label="新密码">
            <input
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              maxLength={128}
              value={next}
              onChange={(e) => setNext(e.target.value)}
            />
          </Field>
          <Button type="submit" loading={busy}>
            保存并重新登录
          </Button>
        </form>
      </details>

      <h2>最近使用记录</h2>
      <div className="account-table">
        <table>
          <thead>
            <tr>
              <th>时间</th>
              <th>操作</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            {usage.map((row) => (
              <tr key={row.id}>
                <td>{new Date(row.created).toLocaleString()}</td>
                <td>
                  {row.kind === "topup" ? `补充 ${row.amount} 张` : "生成 1 张"}
                </td>
                <td>
                  {statusName[row.status] || row.status}
                  {row.filename && (
                    <>
                      {" "}
                      ·{" "}
                      <a
                        href={asset(row.filename)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        查看成品
                      </a>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
type AdminData = {
  users: User[];
  invites: {
    id: string;
    expires: number;
    usedBy: string | null;
    revoked: number;
  }[];
  pending: Entry[];
  limits: {
    concurrency: number;
    dailyCalls: number;
    perUserCalls: number;
    maxWorkers: number;
  };
  modelReady: boolean;
};
function AdminPanel() {
  const { user: currentUser } = useAccount();
  const pendingTopup = useRef<{
    user: string;
    amount: number;
    key: string;
  } | null>(null);
  const [data, setData] = useState<AdminData | null>(null),
    [code, setCode] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [selected, setSelected] = useState(""),
    [amount, setAmount] = useState(100),
    [resetPassword, setResetPassword] = useState("");
  const refresh = () =>
    api<AdminData>("/admin").then((d) => {
      setData(d);
      setSelected((s) => s || d.users[0]?.id || "");
    });
  useEffect(() => {
    refresh().catch((e) => setMessage(e.message));
  }, []);
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setMessage("");
    try {
      await fn();
      await refresh();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (!data) return <p>{message || "读取管理信息…"}</p>;
  return (
    <section className="account-admin">
      <h2>内部使用管理</h2>
      <Button disabled={busy} onClick={() => act(async () => {})}>
        刷新管理信息
      </Button>
      <p>
        模型：{data.modelReady ? "已配置" : "尚未配置"} · 全站模型并发{" "}
        {data.limits.concurrency} · 每日最多 {data.limits.dailyCalls} 次模型调用
        · 每人每日 {data.limits.perUserCalls} 次
      </p>
      <Button
        loading={busy}
        onClick={() =>
          act(async () => {
            const i = await post("/admin/invites");
            setCode(i.code);
          })
        }
      >
        创建一次性邀请码
      </Button>
      {code && (
        <div className="invite-code">
          <p>邀请码有效期 7 天，仅展示一次，请复制保存。</p>
          <input aria-label="新邀请码" readOnly value={code} />
          <Button
            onClick={() =>
              act(async () => {
                await navigator.clipboard.writeText(code);
                setMessage("邀请码已复制。");
              })
            }
          >
            复制邀请码
          </Button>
          <Button
            variant="secondary"
            onClick={() =>
              act(async () => {
                await navigator.clipboard.writeText(
                  `${location.origin}/register?invite=${encodeURIComponent(code)}`,
                );
                setMessage("邀请链接已复制，接收者打开即可填写账号。");
              })
            }
          >
            复制邀请链接
          </Button>
        </div>
      )}
      {message && (
        <p className="account-error" role="alert">
          {message}
        </p>
      )}
      <h3>用户与额度</h3>
      <div className="account-table">
        <table>
          <thead>
            <tr>
              <th>账号</th>
              <th>可用 / 预留</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {data.users.map((u) => (
              <tr key={u.id}>
                <td>
                  {u.name}
                  {u.role === "admin" ? "（管理员）" : ""}
                </td>
                <td>
                  {u.available} / {u.held}
                </td>
                <td>{u.disabled ? "已停用" : "正常"}</td>
                <td>
                  <Button
                    disabled={busy || u.id === currentUser?.id}
                    onClick={() =>
                      act(() =>
                        post(`/admin/users/${u.id}/status`, {
                          disabled: !u.disabled,
                        }),
                      )
                    }
                  >
                    {u.disabled ? "启用" : "停用"}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const pending = pendingTopup.current;
          const key =
            pending?.user === selected && pending?.amount === amount
              ? pending.key
              : crypto.randomUUID();
          pendingTopup.current = { user: selected, amount, key };
          void act(async () => {
            await post(`/admin/users/${selected}/credits`, { amount, key });
            pendingTopup.current = null;
            setMessage("额度已补充。");
          });
        }}
      >
        <Field label="选择账号">
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
          >
            {data.users.map((u) => (
              <option value={u.id} key={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="增加图片额度">
          <input
            type="number"
            min={1}
            max={10000}
            required
            value={amount}
            onChange={(e) => setAmount(Number(e.target.value))}
          />
        </Field>
        <Button type="submit" loading={busy}>
          补充额度
        </Button>
      </form>
      <details>
        <summary>重置所选账号的密码</summary>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void act(async () => {
              await post(`/admin/users/${selected}/password`, {
                password: resetPassword,
              });
              setResetPassword("");
              setMessage("密码已重置，原登录已失效。");
            });
          }}
        >
          <Field label="新密码（请安全交给该用户）">
            <input
              type="password"
              autoComplete="new-password"
              minLength={12}
              maxLength={128}
              required
              value={resetPassword}
              onChange={(e) => setResetPassword(e.target.value)}
            />
          </Field>
          <Button loading={busy} type="submit">
            重置密码
          </Button>
        </form>
      </details>
      <h3>邀请码</h3>
      {data.invites.map((i) => (
        <div className="account-row" key={i.id}>
          <span>
            {i.id.slice(0, 8)} ·{" "}
            {i.usedBy
              ? "已使用"
              : i.revoked
                ? "已撤销"
                : i.expires < Date.now()
                  ? "已过期"
                  : "待使用"}
          </span>
          {!i.usedBy && !i.revoked && (
            <Button
              disabled={busy}
              onClick={() => act(() => post(`/admin/invites/${i.id}/revoke`))}
            >
              撤销
            </Button>
          )}
        </div>
      ))}
      <h3>待核对生成</h3>
      <p>请先核对模型服务记录；确认没有交付成品后，可释放预留额度。</p>
      {!data.pending.length && <p>暂无待核对记录。</p>}
      {data.pending.map((r) => (
        <div className="account-row" key={r.id}>
          <span>
            {data.users.find((u) => u.id === r.userId)?.name} ·{" "}
            {new Date(r.created).toLocaleString()} · {r.id.slice(0, 8)}
          </span>
          <Button
            disabled={busy}
            onClick={() => act(() => post(`/admin/usage/${r.id}/release`))}
          >
            确认未交付，释放额度
          </Button>
        </div>
      ))}
    </section>
  );
}
