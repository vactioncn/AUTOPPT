import { useEffect, useRef, useState } from "react";
import { ArrowDown, Coins, Plus } from "@phosphor-icons/react";
import { api, post, downloadFile } from "./api";
import { Button, Field, Modal } from "./components";
import "./usage.css";

type Model = {
  providerId: string;
  provider: string;
  model: string;
  kind: string;
  size: string;
  quality: string;
};
type Rate = Model & {
  unit: string;
  input: number | string | null;
  output: number | string | null;
  cached: number | string | null;
  price: number | string | null;
  note: string;
};
type Totals = {
  requests: number;
  cached: number;
  costMicro: number;
  unknown: number;
  tokens: number;
  images: number;
  characters: number;
  audioSeconds: number;
};
type Row = Model & {
  id: string;
  createdAt: string;
  projectTitle: string;
  projectId: string;
  pageId: string;
  taskId: string;
  feature: string;
  status: string;
  costMicro: number | null;
  requestId: string;
  rate: Rate | null;
  usage: {
    inputTokens?: number;
    outputTokens?: number;
    cachedTokens?: number;
    totalTokens?: number;
    images?: number;
    characters?: number;
    characterSource?: string;
    audioSeconds?: number;
    calls?: number;
  };
};
type Report = {
  startedAt: string;
  models: Model[];
  rates: Rate[];
  summary: Totals;
  lifetime: Totals;
  budgetMicro: number;
  remainingMicro: number;
  total: number;
  rows: Row[];
  budgets: {
    id: string;
    amountMicro: number;
    createdAt: string;
    note: string;
  }[];
  byKind: (Totals & { id: string })[];
  byProject: (Totals & { id: string; title: string })[];
  projects: { id: string; title: string }[];
};
const names: Record<string, string> = {
  text: "内容与分析",
  image: "图片生成",
  speech: "语音合成",
  clone: "声音复刻",
};
const statuses: Record<string, string> = {
  success: "已返回",
  rejected: "服务拒绝",
  uncertain: "结果待核对",
  pending: "请求中",
  cached: "复用已有音频",
};
const key = (r: Model) =>
  [r.providerId, r.model, r.kind, r.size, r.quality].join("|");
const yuan = (micro: number) =>
  (micro / 1e6).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });
const time = (iso: string) =>
  new Date(iso).toLocaleString("zh-CN", { hour12: false });
const qty = (value?: number | null) =>
  value === null || value === undefined
    ? "未返回"
    : value.toLocaleString("zh-CN", { maximumFractionDigits: 1 });
function amount(micro: number | null, points: boolean) {
  if (micro === null) return "待核对";
  return points
    ? `${(micro / 1000).toLocaleString("zh-CN", { maximumFractionDigits: 2 })} 积分`
    : `¥${yuan(micro)}`;
}
export function UsagePage() {
  const [data, setData] = useState<Report | null>(null),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [period, setPeriod] = useState("month"),
    [project, setProject] = useState(""),
    [kind, setKind] = useState(""),
    [offset, setOffset] = useState(0),
    [points, setPoints] = useState(false);
  const [panel, setPanel] = useState<"rates" | "budget" | null>(null),
    [detail, setDetail] = useState<Row | null>(null),
    [busy, setBusy] = useState(false);
  const query = new URLSearchParams({
    projectId: project,
    kind,
    offset: String(offset),
  });
  if (period !== "all") {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    if (period === "month") start.setDate(1);
    query.set("from", start.toISOString());
  }
  const search = query.toString(),
    request = useRef(0);
  async function refresh() {
    const ticket = ++request.current;
    try {
      const result = await api<Report>(`/usage?${search}`);
      if (ticket === request.current) {
        setData(result);
        setError("");
      }
    } catch (e) {
      if (ticket === request.current) setError((e as Error).message);
    }
  }
  useEffect(() => {
    void refresh();
    const timer = setInterval(refresh, 8000);
    return () => {
      clearInterval(timer);
      request.current++;
    };
  }, [search]);
  async function exportCsv() {
    setBusy(true);
    try {
      await downloadFile(`/api/usage/export?${search}`, "AutoPPT-usage.csv");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="page usage-page" aria-label="用量与账单">
      <div className="page-heading">
        <div>
          <p className="eyebrow">本机个人账本</p>
          <h1>用量与账单</h1>
          <p>看清每次 AI 调用，把演讲制作的消耗记下来。</p>
        </div>
        <div className="usage-actions">
          <Button onClick={() => setPanel("rates")}>模型单价</Button>
          <Button variant="primary" onClick={() => setPanel("budget")}>
            <Plus size={16} />
            补充预算
          </Button>
        </div>
      </div>
      {error && (
        <div className="usage-notice error" role="alert">
          {error} <Button onClick={refresh}>重新读取</Button>
        </div>
      )}
      {message && (
        <p className="usage-notice" role="status">
          {message}
        </p>
      )}
      {!data ? (
        <p>正在读取用量记录…</p>
      ) : (
        <>
          <div className="usage-toolbar">
            <div className="usage-period" aria-label="统计时间">
              {[
                ["today", "今天"],
                ["month", "本月"],
                ["all", "全部"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  aria-pressed={period === value}
                  onClick={() => {
                    setPeriod(value);
                    setOffset(0);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <label className="usage-points">
              <input
                type="checkbox"
                checked={points}
                onChange={(e) => setPoints(e.target.checked)}
              />
              以积分显示（¥1 = 1,000 积分）
            </label>
          </div>
          <div className="usage-cards">
            <article>
              <span>筛选范围内预估费用</span>
              <strong>{amount(data.summary.costMicro, points)}</strong>
              <small>
                {data.summary.unknown
                  ? `${data.summary.unknown} 笔费用待核对，未计入合计`
                  : "按调用时单价估算"}
              </small>
            </article>
            <article>
              <span>AI 请求 / 缓存复用</span>
              <strong>
                {qty(data.summary.requests)}{" "}
                <em>/ {qty(data.summary.cached)}</em>
              </strong>
              <small>复用已保存音频不重复调用</small>
            </article>
            <article>
              <span>服务返回的 Token</span>
              <strong>{qty(data.summary.tokens)}</strong>
              <small>
                另有 {qty(data.summary.images)} 张图片 ·{" "}
                {qty(data.summary.characters)} 语音字符
              </small>
            </article>
            <article>
              <span>全局剩余预算（预估）</span>
              <strong>
                {data.budgetMicro
                  ? amount(data.remainingMicro, points)
                  : "未设置"}
              </strong>
              <small>
                累计补充 {amount(data.budgetMicro, points)} · 全部时间与项目
              </small>
            </article>
          </div>
          {data.budgetMicro > 0 &&
            data.remainingMicro <= data.budgetMicro * 0.2 && (
              <div role="status" className="usage-notice">
                {data.remainingMicro <= 0
                  ? "已计入的费用达到预算"
                  : "剩余预算不足 20%"}
                。这只是提醒，生成任务会继续；补充预算不会给供应商充值。
              </div>
            )}
          <p className="usage-explainer">
            从 {data.startedAt ? time(data.startedAt) : "本次启用"}{" "}
            开始记录。费用为人民币预估，不是供应商结算账单；缺少单价或用量、失败及中断请求可能待核对，实际余额以供应商为准。积分只用于显示费用，不代表
            Token。
          </p>
          <div className="usage-toolbar usage-filters">
            <Field label="项目">
              <select
                value={project}
                onChange={(e) => {
                  setProject(e.target.value);
                  setOffset(0);
                }}
              >
                <option value="">全部项目</option>
                {data.projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="调用类型">
              <select
                value={kind}
                onChange={(e) => {
                  setKind(e.target.value);
                  setOffset(0);
                }}
              >
                <option value="">全部类型</option>
                {Object.entries(names).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Button loading={busy} onClick={exportCsv}>
              <ArrowDown size={16} />
              导出筛选账单 CSV
            </Button>
          </div>
          <div className="usage-breakdown">
            <section>
              <h2>按功能类型</h2>
              {data.byKind.length ? (
                data.byKind.map((r) => (
                  <div key={r.id}>
                    <span>
                      {names[r.id]} <small>{r.requests} 次请求</small>
                    </span>
                    <span>
                      {amount(r.costMicro, points)}
                      {r.unknown > 0 && <small>{r.unknown} 笔待核对</small>}
                    </span>
                  </div>
                ))
              ) : (
                <p>还没有 AI 调用。</p>
              )}
            </section>
            <section>
              <h2>按项目</h2>
              {data.byProject.length ? (
                data.byProject.map((r) => (
                  <div key={r.id}>
                    <span>{r.title || "公共功能 / 未归属项目"}</span>
                    <span>
                      {amount(r.costMicro, points)}
                      {r.unknown > 0 && <small>{r.unknown} 笔待核对</small>}
                    </span>
                  </div>
                ))
              ) : (
                <p>之后的消耗会自动归到项目。</p>
              )}
            </section>
          </div>
          <div className="usage-table-wrap">
            <table className="usage-table">
              <caption>调用明细 · {data.total} 条</caption>
              <thead>
                <tr>
                  <th>时间 / 项目</th>
                  <th>功能 / 模型</th>
                  <th>用量</th>
                  <th>结果</th>
                  <th>预估费用</th>
                  <th>详情</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      {time(r.createdAt)}
                      <small>{r.projectTitle || "公共功能"}</small>
                    </td>
                    <td>
                      {r.feature}
                      <small>{r.model}</small>
                    </td>
                    <td>
                      {r.status === "cached"
                        ? "复用已保存音频"
                        : r.kind === "text"
                          ? `${qty(r.usage.totalTokens)} Token`
                          : r.kind === "image"
                            ? `${qty(r.usage.images)} 张`
                            : r.kind === "speech"
                              ? `${qty(r.usage.characters)} 字符${r.usage.characterSource === "estimated" ? "（估算）" : ""}`
                              : `${qty(r.usage.calls)} 次`}
                      <small>
                        {r.usage.audioSeconds
                          ? `${qty(r.usage.audioSeconds)} 秒`
                          : r.size}
                      </small>
                    </td>
                    <td>
                      <span className={`usage-status ${r.status}`}>
                        {statuses[r.status]}
                      </span>
                    </td>
                    <td>{amount(r.costMicro, points)}</td>
                    <td>
                      <button
                        className="text-button"
                        onClick={() => setDetail(r)}
                        aria-label={`查看 ${r.feature} 调用详情`}
                      >
                        查看
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data.rows.length && (
              <div className="usage-empty">
                <Coins size={30} />
                <h3>从下一次制作开始，消耗都有记录</h3>
                <p>
                  先配置模型单价，然后正常制作页面或口播。旧项目的历史用量不会被推算成真实账单。
                </p>
                <Button onClick={() => setPanel("rates")}>配置模型单价</Button>
              </div>
            )}
          </div>
          {data.total > 100 && (
            <div className="usage-pagination">
              <Button
                disabled={offset === 0}
                onClick={() => setOffset((n) => Math.max(0, n - 100))}
              >
                上一页
              </Button>
              <span>
                {offset + 1}–{Math.min(offset + 100, data.total)} / {data.total}
              </span>
              <Button
                disabled={offset + 100 >= data.total}
                onClick={() => setOffset((n) => n + 100)}
              >
                下一页
              </Button>
            </div>
          )}
          <details className="usage-budget-history">
            <summary>预算流水 · {data.budgets.length} 笔</summary>
            <p>本机记账额度，与供应商账户余额相互独立；不会限制生成。</p>
            {data.budgets.map((b) => (
              <div key={b.id}>
                <span>
                  {time(b.createdAt)} · {b.note || "手动补充"}
                </span>
                <strong>+{amount(b.amountMicro, points)}</strong>
              </div>
            ))}
          </details>
          {panel === "rates" && (
            <Rates
              data={data}
              onClose={() => setPanel(null)}
              onSaved={() => {
                setMessage("单价已保存，仅对之后发出的请求生效。");
                void refresh();
              }}
            />
          )}
          {panel === "budget" && (
            <Budget
              onClose={() => setPanel(null)}
              onSaved={() => {
                setPanel(null);
                setMessage("预算已补充。这是本机记账，没有发起支付。");
                void refresh();
              }}
            />
          )}
          {detail && (
            <Modal title="调用详情" onClose={() => setDetail(null)}>
              <div className="usage-detail">
                <p>
                  {detail.feature} · {statuses[detail.status]} ·{" "}
                  {amount(detail.costMicro, false)}
                </p>
                <dl>
                  {Object.entries({
                    供应商: detail.provider,
                    模型: detail.model,
                    项目: detail.projectTitle || "公共功能",
                    页面编号: detail.pageId || "整场 / 无",
                    任务编号: detail.taskId || "无",
                    请求编号: detail.id,
                    供应商请求编号: detail.requestId || "未返回",
                    "输入 Token": qty(detail.usage.inputTokens),
                    "缓存 Token（已含于输入）": qty(detail.usage.cachedTokens),
                    "输出 Token": qty(detail.usage.outputTokens),
                    语音字符: qty(detail.usage.characters),
                    音频秒数: qty(detail.usage.audioSeconds),
                  }).map(([k, v]) => (
                    <div key={k}>
                      <dt>{k}</dt>
                      <dd>{v}</dd>
                    </div>
                  ))}
                </dl>
                <h3>调用时的计价依据</h3>
                <p>
                  {detail.rate
                    ? rateDescription(detail.rate)
                    : detail.status === "cached"
                      ? "缓存复用，不调用 AI，费用为零。"
                      : "当时尚未配置单价，费用待核对。"}
                </p>
                <p>{detail.rate?.note}</p>
                <p className="detail-help">
                  缺少用量、请求失败或中断，请结合供应商请求编号核对供应商账单。价格变更不会重算这笔记录。图片按张计价是平均估算；复刻的实际扣费时点依供应商规则。
                </p>
              </div>
            </Modal>
          )}
        </>
      )}
    </section>
  );
}
function rateDescription(r: Rate) {
  return r.unit === "tokens"
    ? `输入 ¥${r.input} / 百万 Token，输出 ¥${r.output} / 百万 Token，缓存输入 ${r.cached === null ? "同普通输入" : `¥${r.cached} / 百万 Token`}`
    : `¥${r.price} / ${r.unit === "image" ? "张" : r.unit === "characters" ? "万字符" : "次"}`;
}
function Rates({
  data,
  onClose,
  onSaved,
}: {
  data: Report;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [selected, setSelected] = useState(key(data.models[0])),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [saved, setSaved] = useState("");
  const initial = (m: Model): Rate =>
    data.rates.find((r) => key(r) === key(m)) || {
      ...m,
      unit:
        m.kind === "text"
          ? "tokens"
          : m.kind === "image"
            ? "image"
            : m.kind === "speech"
              ? "characters"
              : "call",
      input: "",
      output: "",
      cached: "",
      price: "",
      note: "",
    };
  const [rate, setRate] = useState<Rate>(() => initial(data.models[0]));
  const update = (field: string, value: string) =>
    setRate((r) => ({ ...r, [field]: value }));
  return (
    <Modal
      title="模型单价"
      subtitle="按供应商实际合同或控制台单价填写人民币价格。未知价格请留空，免费才填 0。"
      onClose={onClose}
    >
      <form
        className="usage-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            await post("/usage/rates", rate);
            setSaved("已保存，对下一次请求生效。历史费用保留原单价。");
            onSaved();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="服务与模型">
          <select
            value={selected}
            onChange={(e) => {
              setSelected(e.target.value);
              setRate(
                initial(data.models.find((m) => key(m) === e.target.value)!),
              );
              setSaved("");
            }}
          >
            {data.models.map((m) => (
              <option key={key(m)} value={key(m)}>
                {names[m.kind]} · {m.model} · {m.provider} {m.size} {m.quality}
              </option>
            ))}
          </select>
        </Field>
        <Field label="计价单位">
          <select
            value={rate.unit}
            onChange={(e) => update("unit", e.target.value)}
          >
            {(rate.kind === "text"
              ? [["tokens", "按输入 / 输出 Token"]]
              : rate.kind === "image"
                ? [
                    ["image", "按图片张数（平均估算）"],
                    ["tokens", "按接口返回 Token（统一单价估算）"],
                  ]
                : rate.kind === "speech"
                  ? [["characters", "按语音字符数"]]
                  : [["call", "按复刻成功次数（预算估算）"]]
            ).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </Field>
        {rate.unit === "tokens" ? (
          <>
            <Field label="输入价格（元 / 百万 Token）">
              <input
                required
                type="number"
                min="0"
                max="1000000"
                step="any"
                value={rate.input ?? ""}
                onChange={(e) => update("input", e.target.value)}
              />
            </Field>
            <Field label="输出价格（元 / 百万 Token）">
              <input
                required
                type="number"
                min="0"
                max="1000000"
                step="any"
                value={rate.output ?? ""}
                onChange={(e) => update("output", e.target.value)}
              />
            </Field>
            <Field label="缓存输入价格（元 / 百万 Token，留空按普通输入）">
              <input
                type="number"
                min="0"
                max="1000000"
                step="any"
                value={rate.cached ?? ""}
                onChange={(e) => update("cached", e.target.value)}
              />
            </Field>
          </>
        ) : (
          <Field
            label={`价格（元 / ${rate.unit === "image" ? "张" : rate.unit === "characters" ? "万字符" : "次"}）`}
          >
            <input
              required
              type="number"
              min="0"
              max="1000000"
              step="any"
              value={rate.price ?? ""}
              onChange={(e) => update("price", e.target.value)}
            />
          </Field>
        )}
        <Field label="价格依据 / 备注">
          <input
            maxLength={300}
            placeholder="例如：供应商控制台单价，核对日期"
            value={rate.note}
            onChange={(e) => update("note", e.target.value)}
          />
        </Field>
        <p className="detail-help">
          修改只影响后续请求。图片的尺寸、质量分开配置；复杂多模态或阶梯计价可按平均成本估算。声音复刻可能在首次使用时扣费，以供应商账单为准。本版本不自动同步折扣、汇率或结算金额。
        </p>
        {error && <p role="alert">{error}</p>}
        {saved && <p role="status">{saved}</p>}
        <Button loading={busy} variant="primary" type="submit">
          保存单价
        </Button>
      </form>
    </Modal>
  );
}
function Budget({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const [amount, setAmount] = useState(""),
    [note, setNote] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const token = useRef(crypto.randomUUID());
  return (
    <Modal
      title="补充预算"
      subtitle="为本机个人账本增加记账额度，不会付款或给供应商充值。"
      onClose={onClose}
    >
      <form
        className="usage-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            await post("/usage/budget", { id: token.current, amount, note });
            onSaved();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="金额（人民币元）">
          <input
            autoFocus
            required
            type="number"
            min="0.01"
            max="9999999.99"
            step="0.01"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              token.current = crypto.randomUUID();
            }}
          />
        </Field>
        <Field label="备注">
          <input
            maxLength={300}
            placeholder="例如：本月制作预算"
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
              token.current = crypto.randomUUID();
            }}
          />
        </Field>
        <p>
          ¥{amount || "0"} = {(Number(amount || 0) * 1000).toLocaleString()}{" "}
          积分。预算用完只提醒，生成任务会继续。
        </p>
        {error && <p role="alert">{error}</p>}
        <Button type="submit" variant="primary" loading={busy}>
          确认记账
        </Button>
      </form>
    </Modal>
  );
}
