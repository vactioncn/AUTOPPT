import { useEffect, useRef, useState } from "react";
import {
  createAudienceDraft,
  type AudienceDraftState,
} from "../shared/audience-draft.mjs";
import {
  DESIGN_PALETTES,
  PALETTE_GROUPS,
  samePalette,
  normalizeHexColor,
} from "../shared/design-palettes.mjs";
import { BRAND } from "../shared/brand.mjs";
import type { DesignOptions } from "./types";
import { api } from "./api";
import { Button, Field } from "./components";

export const emptyDesignOptions: DesignOptions = {
  audience: null,
  palette: null,
};
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
  hideAudience = false,
}: {
  value: DesignOptions;
  onChange: (value: DesignOptions) => void;
  styleId: string;
  rules?: string;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
  hideAudience?: boolean;
}) {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [draftState, setDraftState] = useState<AudienceDraftState>({
    status: "idle",
    error: "",
  });
  const [composing, setComposing] = useState(false);
  const [paletteGroup, setPaletteGroup] = useState("全部");
  const draft = useRef<ReturnType<typeof createAudienceDraft> | null>(null);
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
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const coordinator = createAudienceDraft({
      generate: (description, signal) =>
        api<NonNullable<DesignOptions["audience"]>>(
          "/design-options/audience",
          {
            method: "POST",
            signal,
            body: JSON.stringify({ description }),
          },
        ),
      onResult: (audience) =>
        current.current.onChange({ ...current.current.value, audience }),
      onState: (state) => {
        setDraftState(state);
        current.current.onBusyChange?.(
          state.status === "waiting" || state.status === "generating",
        );
      },
    });
    draft.current = coordinator;
    return () => {
      coordinator.dispose();
      draft.current = null;
    };
  }, []);
  useEffect(() => {
    draft.current?.update({
      description: value.audience?.description || "",
      brief: value.audience?.brief || "",
      enabled: supported === true && !disabled && !hideAudience,
      composing,
      context: JSON.stringify([styleId, rules]),
    });
  }, [
    value.audience?.description,
    value.audience?.brief,
    supported,
    disabled,
    hideAudience,
    composing,
    styleId,
    rules,
  ]);
  if (supported !== true)
    return (
      <p className="detail-help" role="status">
        {supported === null
          ? "正在加载设置…"
          : `当前服务尚未加载内容倾向与配色功能，请在任务结束后正常重启${BRAND.name}再使用。`}
      </p>
    );
  const busy =
    draftState.status === "waiting" || draftState.status === "generating";
  const locked = disabled;
  const selected = value.palette
    ? DESIGN_PALETTES.find(({ palette }) => samePalette(palette, value.palette))
        ?.palette.name || "custom"
    : "original";
  const colors =
    value.palette?.colors.length === 3
      ? value.palette.colors
      : ["#FFFFFF", "#202020", "#3972B8"];
  return (
    <div className="design-options-editor simple-options">
      {!hideAudience && (
        <>
          <Field label="内容倾向（可选）">
            <input
              value={value.audience?.description || ""}
              disabled={locked}
              onCompositionStart={() => setComposing(true)}
              onCompositionEnd={() => setComposing(false)}
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
            写一句受众、行业或使用场景，停止输入后 AI
            自动生成说明。留空沿用原内容，不补充原稿没有的观点。
          </small>
          {value.audience && (
            <div className="audience-status" role="status" aria-live="polite">
              <span>
                {draftState.status === "generating"
                  ? "正在生成内容倾向方案…"
                  : draftState.status === "waiting"
                    ? "输入完成后将自动生成方案…"
                    : draftState.status === "error"
                      ? "暂未生成说明，当前简述仍可使用。"
                      : value.audience.brief.trim()
                        ? "内容倾向方案已就绪，可展开查看或修改。"
                        : "将按当前简述生成方案。"}
              </span>
              <Button
                type="button"
                variant="ghost"
                disabled={locked || busy}
                onClick={() => draft.current?.retry()}
              >
                {draftState.status === "error" ? "重试" : "重新生成说明"}
              </Button>
            </div>
          )}
          {draftState.error && (
            <p role="alert" className="error-text">
              {draftState.error}
            </p>
          )}
          {value.audience && (
            <details className="audience-details">
              <summary>展开说明（可选）</summary>
              <p className="detail-help">
                这里仅用于查看或编辑说明，不影响自动生成。修改上方简述会自动更新方案；手动编辑的说明会保留。
              </p>
              <Field label="受众与行业语境（可编辑）">
                <textarea
                  rows={12}
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
            </details>
          )}
        </>
      )}
      <fieldset className="palette-picker" disabled={locked}>
        <legend>配色方案</legend>
        <div className="palette-filters" role="group" aria-label="配色分类">
          {["全部", ...PALETTE_GROUPS].map((group) => (
            <button
              type="button"
              key={group}
              aria-pressed={paletteGroup === group}
              onClick={() => setPaletteGroup(group)}
            >
              {group}
            </button>
          ))}
        </div>
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
          {DESIGN_PALETTES.filter(
            ({ group }) => paletteGroup === "全部" || paletteGroup === group,
          ).map(({ palette: p }) => (
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
                  palette: customPalette([...colors]),
                });
            }}
          >
            <span className="palette-original" aria-hidden="true">
              ＋
            </span>
            <strong>自定义</strong>
          </button>
        </div>
        {value.palette?.colors.length === 3 && (
          <div
            className="palette-preview"
            style={{
              background: colors[0],
              color: colors[1],
              borderColor: colors[1] + "22",
            }}
            aria-label="当前配色预览"
          >
            <i style={{ background: colors[2] }} aria-hidden="true" />
            <div>
              <strong>让想法被看见</strong>
              <small>{value.palette.name} · 当前配色</small>
            </div>
          </div>
        )}
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
                <HexColorInput
                  value={colors[i]}
                  label={`${label}（HEX）`}
                  disabled={locked}
                  onChange={(color) =>
                    onChange({
                      ...value,
                      palette: customPalette(
                        colors.map((c, j) => (j === i ? color : c)),
                      ),
                    })
                  }
                />
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
    </div>
  );
}
function HexColorInput({
  value,
  label,
  disabled,
  onChange,
}: {
  value: string;
  label: string;
  disabled: boolean;
  onChange: (color: string) => void;
}) {
  const [text, setText] = useState(value);
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    setText(value);
    setInvalid(false);
  }, [value]);
  const commit = () => {
    const color = normalizeHexColor(text);
    setInvalid(!color);
    if (color) {
      setText(color);
      if (color !== value) onChange(color);
    }
  };
  return (
    <>
      <input
        type="text"
        className="color-hex"
        aria-label={label}
        aria-invalid={invalid}
        value={text}
        maxLength={7}
        disabled={disabled}
        spellCheck={false}
        onChange={(e) => {
          setText(e.target.value);
          setInvalid(false);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
        }}
      />
      {invalid && (
        <small className="error-text">请输入有效色值，如 #17324D</small>
      )}
    </>
  );
}

export const validDesignOptions = (v: DesignOptions) =>
  (!v.audience || !!v.audience.description.trim()) &&
  (!v.palette || (!!v.palette.name.trim() && !!v.palette.instructions.trim()));
