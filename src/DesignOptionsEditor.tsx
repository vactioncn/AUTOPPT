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
  {
    name: "深色 · 薄荷绿",
    instructions:
      "深灰 #152525 为背景，浅白 #F2F6F4 为主文字，薄荷绿 #86D6AE 为少量强调色；保持清晰对比。",
    colors: ["#152525", "#F2F6F4", "#86D6AE"],
  },
];
const customPalette = (
  colors: string[],
): NonNullable<DesignOptions["palette"]> => ({
  name: "自定义配色",
  colors,
  instructions: `背景 ${colors[0]}，主文字 ${colors[1]}，强调色 ${colors[2]}。强调色少量使用，保证文字清晰可读。`,
});

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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  const current = useRef({ value, onChange, onBusyChange });
  current.current = { value, onChange, onBusyChange };
  useEffect(() => {
    const controller = new AbortController();
    api<{ features?: { designOptions?: boolean } }>("/bootstrap", {
      signal: controller.signal,
    })
      .then((data) => setSupported(!!data.features?.designOptions))
      .catch(() => {
        if (!controller.signal.aborted) setSupported(false);
      });
    return () => {
      controller.abort();
      request.current?.abort();
    };
  }, []);
  useEffect(() => {
    request.current?.abort();
    request.current = null;
    setBusy(false);
    current.current.onBusyChange?.(false);
  }, [styleId, rules]);
  const expand = async () => {
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    onBusyChange?.(true);
    setError("");
    try {
      const audience = await api<NonNullable<DesignOptions["audience"]>>(
        "/design-options/audience",
        {
          method: "POST",
          signal: controller.signal,
          body: JSON.stringify({ description: value.audience?.description }),
        },
      );
      if (!controller.signal.aborted)
        current.current.onChange({ ...current.current.value, audience });
    } catch (e) {
      if (!controller.signal.aborted) setError((e as Error).message);
    } finally {
      if (request.current === controller) {
        request.current = null;
        setBusy(false);
        current.current.onBusyChange?.(false);
      }
    }
  };
  if (supported !== true)
    return (
      <p className="detail-help" role="status">
        {supported === null
          ? "正在加载设置…"
          : "当前服务尚未加载内容倾向与配色功能，请在任务结束后正常重启 AutoPPT 再使用。"}
      </p>
    );
  const locked = disabled || busy;
  const selected = value.palette
    ? palettes.find((p) => JSON.stringify(p) === JSON.stringify(value.palette))
        ?.name || "custom"
    : "original";
  const colors =
    value.palette?.colors.length === 3
      ? value.palette.colors
      : ["#FFFFFF", "#202020", "#3972B8"];
  return (
    <div className="design-options-editor simple-options">
      <Field label="内容倾向（可选）">
        <input
          value={value.audience?.description || ""}
          disabled={locked}
          maxLength={2000}
          placeholder="默认不调整；例如：面向儿童摄影影楼老板"
          onChange={(e) =>
            onChange({
              ...value,
              audience: e.target.value.trim()
                ? { description: e.target.value, brief: "" }
                : null,
            })
          }
        />
      </Field>
      <small>
        写一句受众或场景即可，留空沿用原内容。不补充原稿没有的观点。
      </small>
      {value.audience && (
        <details className="audience-details">
          <summary>展开说明（可选）</summary>
          <p className="detail-help">
            简述已可直接使用。需要更细的要求时，可手填或让 AI
            完善；修改上方简述会重新以简述为准。
          </p>
          <Field label="受众与行业语境（可编辑）">
            <textarea
              rows={4}
              maxLength={10000}
              disabled={locked}
              value={value.audience.brief}
              onChange={(e) =>
                onChange({
                  ...value,
                  audience: { ...value.audience!, brief: e.target.value },
                })
              }
            />
          </Field>
          <Button
            type="button"
            disabled={locked}
            loading={busy}
            onClick={expand}
          >
            AI 完善说明
          </Button>
          <small>仅此按钮调用内容分析模型；结果可编辑。</small>
        </details>
      )}
      <fieldset className="palette-picker" disabled={locked}>
        <legend>配色方案</legend>
        <div className="palette-grid" role="group" aria-label="配色方案">
          <button
            type="button"
            className="palette-choice"
            aria-pressed={selected === "original"}
            onClick={() => onChange({ ...value, palette: null })}
          >
            <span className="palette-original" aria-hidden="true">
              原
            </span>
            <strong>默认 · 沿用风格</strong>
          </button>
          {palettes.map((p) => (
            <button
              type="button"
              key={p.name}
              className="palette-choice"
              aria-pressed={selected === p.name}
              onClick={() => onChange({ ...value, palette: p })}
            >
              <span className="palette-strip">
                {p.colors.map((c) => (
                  <i key={c} style={{ background: c }} />
                ))}
              </span>
              <strong>{p.name}</strong>
            </button>
          ))}
          <button
            type="button"
            className="palette-choice"
            aria-pressed={selected === "custom"}
            onClick={() => {
              if (selected !== "custom")
                onChange({
                  ...value,
                  palette: customPalette(["#FFFFFF", "#202020", "#3972B8"]),
                });
            }}
          >
            <span className="palette-original" aria-hidden="true">
              ＋
            </span>
            <strong>自定义</strong>
          </button>
        </div>
        {selected === "custom" && (
          <div className="custom-colors">
            {["背景色", "文字色", "强调色"].map((label, i) => (
              <label key={label}>
                {label}
                <input
                  type="color"
                  aria-label={label}
                  value={colors[i]}
                  onChange={(e) =>
                    onChange({
                      ...value,
                      palette: customPalette(
                        colors.map((c, j) => (j === i ? e.target.value : c)),
                      ),
                    })
                  }
                />
                <span>{colors[i]}</span>
              </label>
            ))}
            <details>
              <summary>配色说明（可选）</summary>
              <Field label="配色说明">
                <textarea
                  rows={3}
                  disabled={locked}
                  maxLength={4000}
                  value={value.palette?.instructions || ""}
                  onChange={(e) =>
                    onChange({
                      ...value,
                      palette: {
                        ...value.palette!,
                        instructions: e.target.value,
                      },
                    })
                  }
                />
              </Field>
            </details>
          </div>
        )}
      </fieldset>
      <small>
        默认不替换原配色。选中新色板即可应用，无需先提取；只调整配色，不重新提炼已确认文案。
      </small>
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
