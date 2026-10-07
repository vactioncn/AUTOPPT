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
  modelStatusUnknown?: boolean;
};
const Context = createContext<Account>({ hosted: false, user: null });
export const useAccount = () => useContext(Context);
function forgetWorkspace() {
  clearWorkspacePreferences();
  location.hash = "projects";
}
export function AccountGate({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<Account | null>(null);
  const latestAccount = useRef(account);
  latestAccount.current = account;
  const [error, setError] = useState("");
  const refresh = async () => {
    try {
      const res = await fetch("/api/account");
      if (res.status === 404) {
        if (latestAccount.current?.hosted)
          throw new Error("账号服务暂时不可用。");
        setAccount({ hosted: false, user: null });
        setError("");
        return;
      }
      if (!res.ok) throw new Error("账号服务暂时不可用。");
      setAccount(await res.json());
      setError("");
    } catch (e) {
      setAccount((a) =>
        a?.hosted ? { ...a, modelReady: false, modelStatusUnknown: true } : a,
      );
      setError((e as Error).message);
    }
  };
  useEffect(() => {
    void refresh();
    const expired = () => {
      setAccount((a) =>
        a?.hosted ? { ...a, user: null, modelReady: false } : a,
      );
    };
    window.addEventListener("autoppt-session-expired", expired);
    return () => {
      window.removeEventListener("autoppt-session-expired", expired);
    };
  }, []);
  useEffect(() => {
    if (!account?.hosted) return;
    const timer = setInterval(refresh, 10000);
    return () => clearInterval(timer);
  }, [account?.hosted]);
  if (!account)
    return (
      <div className="boot">
        <h1>AutoPPT</h1>
        <p>{error || "正在连接工作空间…"}</p>
        {error && <Button onClick={refresh}>重新连接</Button>}
      </div>
    );
  if (account.hosted && !account.user) return <Login onDone={refresh} />;
  return (
    <Context.Provider value={account}>
      <div key={account.user?.id || "local"}>{children}</div>
    </Context.Provider>
  );
}
function Login({ onDone }: { onDone: () => Promise<void> }) {
  const [register, setRegister] = useState(false),
    [name, setName] = useState(""),
    [password, setPassword] = useState(""),
    [invite, setInvite] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <main className="account-login">
      <section className="account-story">
        <a className="brand" href="/intro/">
          AutoPPT ↗
        </a>
        <p className="eyebrow">你的演讲制作室</p>
        <h1>
          把想说的话，
          <br />
          做成值得看的演讲。
        </h1>
        <p>
          选好风格，放入逐字稿。
          <br />
          从提炼文案到逐页打磨，在自己的工作区完成。
        </p>
        <span>邀请制内测 · 新账号赠送 100 张图片额度</span>
      </section>
      <form
        className="account-card"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            await post(`/account/${register ? "register" : "login"}`, {
              name,
              password,
              invite,
            });
            forgetWorkspace();
            await onDone();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <h2>{register ? "创建你的工作区" : "欢迎回来"}</h2>
        <p>
          {register
            ? "使用邀请码注册，模型已由管理员统一配置。"
            : "登录后继续制作你的演讲。"}
        </p>
        <Field label="账号">
          <input
            required
            autoComplete="username"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="字母、数字或邮箱"
            maxLength={80}
          />
        </Field>
        <Field label="密码">
          <input
            required
            type="password"
            autoComplete={register ? "new-password" : "current-password"}
            minLength={register ? 12 : 1}
            maxLength={128}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={register ? "至少 12 个字符" : "输入密码"}
          />
        </Field>
        {register && (
          <Field label="邀请码">
            <input
              required
              value={invite}
              onChange={(e) => setInvite(e.target.value)}
              autoComplete="off"
            />
          </Field>
        )}
        {error && (
          <p role="alert" className="account-error">
            {error}
          </p>
        )}
        <Button variant="primary" loading={busy} type="submit">
          {register ? "注册并开始制作" : "登录"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            setRegister(!register);
            setError("");
          }}
        >
          {register ? "已有账号？去登录" : "有邀请码？创建账号"}
        </Button>
        <small>忘记密码请联系管理员重置。</small>
      </form>
    </main>
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
export function AccountPage() {
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
  return (
    <div className="account-page">
      <h1>账号与额度</h1>
      <p>当前账号：{user?.name}</p>
      <div className="account-balance">
        <strong>{user?.available}</strong>
        <span>张可用 · {user?.held} 张预留</span>
      </div>
      <p>
        新账号一次性赠送 100 张。每次成功生成图片（含重新生成和风格试做）使用 1
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
      {user?.role === "admin" && <AdminPanel />}
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
          <Button onClick={() => navigator.clipboard.writeText(code)}>
            复制邀请码
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
