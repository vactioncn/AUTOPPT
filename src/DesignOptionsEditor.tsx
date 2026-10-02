import { useEffect, useRef, useState } from "react";
import type { DesignOptions } from "./types";
import { api } from "./api";
import { Button, Field } from "./components";

export const emptyDesignOptions: DesignOptions = {
  audience: null,
  palette: null,
};
const palettes = [
  {
    name: "黑白 · 荧光黄",
    instructions:
      "黑或白为大面积底色，文字使用高对比黑白色；荧光黄 #DFFF00 只用于重点。黑底、白底均可，按内容选择。",
    colors: ["#FFFFFF", "#111111", "#DFFF00"],
  },
  {
    name: "暖白 · 深蓝",
    instructions:
      "暖白 #F6F3ED 为背景，深蓝 #17324D 为主文字，蓝色 #3972B8 为少量强调色；保持清晰对比。",
    colors: ["#F6F3ED", "#17324D", "#3972B8"],
  },
  {
    name: "米白 · 赭红",
    instructions:
      "米白 #F5EEE5 为背景，深褐 #302823 为主文字，赭红 #B84E37 为少量强调色；保持清晰对比。",
    colors: ["#F5EEE5", "#302823", "#B84E37"],
  },
];

export function DesignOptionsEditor({
  value,
  onChange,
  styleId,
  rules,
  disabled = false,
  onBusyChange,
}: {
  value: DesignOptions;
  onChange: (value: DesignOptions) => void;
  styleId: string;
  rules?: string;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [supported, setSupported] = useState<boolean | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    api<{ features?: { designOptions?: boolean } }>("/bootstrap", {
      signal: controller.signal,
    })
      .then((data) => setSupported(!!data.features?.designOptions))
      .catch(() => {
        if (!controller.signal.aborted) setSupported(false);
      });
    return () => controller.abort();
  }, []);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [evidence, setEvidence] = useState<string[]>([]);
  const request = useRef<AbortController | null>(null);
  const current = useRef({ value, onChange, onBusyChange });
  current.current = { value, onChange, onBusyChange };
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    request.current?.abort();
    request.current = null;
    setBusy("");
    setEvidence([]);
    setMessage("");
    current.current.onBusyChange?.(false);
  }, [styleId, rules]);
  const run = async (kind: "audience" | "palette") => {
    const controller = new AbortController();
    request.current?.abort();
    request.current = controller;
    setBusy(kind);
    current.current.onBusyChange?.(true);
    setError("");
    setMessage("");
    setEvidence([]);
    try {
      const result = await api<any>(`/design-options/${kind}`, {
        method: "POST",
        signal: controller.signal,
        body: JSON.stringify(
          kind === "audience"
            ? { description: value.audience?.description }
            : { styleId, ...(rules === undefined ? {} : { rules }) },
        ),
      });
      if (controller.signal.aborted) return;
      if (kind === "audience") {
        current.current.onChange({
          ...current.current.value,
          audience: result,
        });
        setMessage("已生成内容倾向草稿，请检查后按需要编辑。");
      } else if (result.palette) {
        current.current.onChange({
          ...current.current.value,
          palette: result.palette,
        });
        setEvidence(result.evidence);
        setMessage("已从风格原文提取配色，请检查颜色角色与可选关系。");
      } else setMessage("风格中没有明确配色。已保留当前选择，也可以手动填写。");
    } catch (e) {
      if (!controller.signal.aborted) setError((e as Error).message);
    } finally {
      if (request.current === controller) {
        request.current = null;
        setBusy("");
        current.current.onBusyChange?.(false);
      }
    }
  };
  const locked = disabled || !!busy;
  if (supported !== true)
    return (
      <p className="detail-help" role="status">
        {supported === null
          ? "正在检查内容倾向与配色功能…"
          : "当前服务尚未加载内容倾向与配色功能，请在任务结束后正常重启 AutoPPT 再使用。"}
      </p>
    );
  return (
    <div className="design-options-editor">
      <details open={!!value.audience}>
        <summary>
          内容倾向{" "}
          <span>{value.audience ? "已启用" : "可选 · 不限定受众"}</span>
        </summary>
        <p className="detail-help">
          帮助选择贴近听众的语境和场景，不添加原文没有的判断或结论。
        </p>
        <label className="option-toggle">
          <input
            type="checkbox"
            checked={!!value.audience}
            disabled={locked}
            onChange={(e) =>
              onChange({
                ...value,
                audience: e.target.checked
                  ? { description: "", brief: "" }
                  : null,
              })
            }
          />
          启用受众与行业语境
        </label>
        {value.audience && (
          <>
            <Field label="简单描述受众与场景">
              <textarea
                rows={2}
                maxLength={2000}
                disabled={locked}
                value={value.audience.description}
                placeholder="例如：面向儿童摄影影楼老板谈 AI；或面向自行车赛参赛者做赛前说明"
                onChange={(e) =>
                  onChange({
                    ...value,
                    audience: {
                      ...value.audience!,
                      description: e.target.value,
                    },
                  })
                }
              />
            </Field>
            <Button
              type="button"
              disabled={locked || !value.audience.description.trim()}
              loading={busy === "audience"}
              onClick={() => run("audience")}
            >
              生成内容倾向说明
            </Button>
            <Field label="受众与行业语境（可编辑）">
              <textarea
                rows={6}
                maxLength={10000}
                disabled={locked}
                value={value.audience.brief}
                placeholder="可直接填写完整说明，也可先生成再编辑。留空时使用上方简述。"
                onChange={(e) =>
                  onChange({
                    ...value,
                    audience: { ...value.audience!, brief: e.target.value },
                  })
                }
              />
            </Field>
            <small>
              修改简述后，可重新生成或编辑下方说明，让两者保持一致。
            </small>
          </>
        )}
      </details>
      <details open={!!value.palette}>
        <summary>
          配色方案 <span>{value.palette?.name || "沿用风格原配色"}</span>
        </summary>
        <p className="detail-help">
          独立配色只替换颜色要求，不改共享风格或已确认文案。重新出图可能产生构图差异。
        </p>
        <div className="option-actions">
          <select
            aria-label="配色预设"
            disabled={locked}
            value={
              value.palette
                ? palettes.find(
                    (p) => JSON.stringify(p) === JSON.stringify(value.palette),
                  )?.name || "custom"
                : "original"
            }
            onChange={(e) => {
              setEvidence([]);
              onChange({
                ...value,
                palette:
                  e.target.value === "original"
                    ? null
                    : palettes.find((p) => p.name === e.target.value) || {
                        name: "自定义配色",
                        instructions: "",
                        colors: [],
                      },
              });
            }}
          >
            <option value="original">沿用风格原配色</option>
            {palettes.map((p) => (
              <option key={p.name}>{p.name}</option>
            ))}
            <option value="custom">自定义配色</option>
          </select>
          <Button
            type="button"
            disabled={locked || !styleId}
            loading={busy === "palette"}
            onClick={() => run("palette")}
          >
            从风格提取配色
          </Button>
        </div>
        {value.palette && (
          <>
            <Field label="配色名称">
              <input
                maxLength={100}
                disabled={locked}
                value={value.palette.name}
                onChange={(e) =>
                  onChange({
                    ...value,
                    palette: { ...value.palette!, name: e.target.value },
                  })
                }
              />
            </Field>
            <Field label="配色说明">
              <textarea
                rows={3}
                maxLength={4000}
                disabled={locked}
                value={value.palette.instructions}
                placeholder="例如：白底、深灰文字、橙色强调；也可填写具体色值与用途。"
                onChange={(e) => {
                  setEvidence([]);
                  onChange({
                    ...value,
                    palette: {
                      ...value.palette!,
                      instructions: e.target.value,
                      colors: [],
                    },
                  });
                }}
              />
            </Field>
            {!!value.palette.colors.length && (
              <div className="option-swatches">
                {value.palette.colors.map((color, i) => (
                  <span key={i}>
                    <i style={{ background: color }} />
                    {color}
                  </span>
                ))}
              </div>
            )}
          </>
        )}
        {!!evidence.length && (
          <details className="palette-evidence">
            <summary>提取依据：风格原文</summary>
            {evidence.map((line, i) => (
              <p key={i}>{line}</p>
            ))}
          </details>
        )}
      </details>
      <small>
        “生成内容倾向说明”和“从风格提取配色”使用内容分析模型；手动填写与选择预设无需调用模型。
      </small>
      {message && (
        <p role="status" className="detail-help">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
    </div>
  );
}

export const validDesignOptions = (v: DesignOptions) =>
  (!v.audience || !!v.audience.description.trim()) &&
  (!v.palette || (!!v.palette.name.trim() && !!v.palette.instructions.trim()));
