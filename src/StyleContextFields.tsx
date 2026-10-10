import type { StyleContext } from "./types";
import { Field } from "./components";

const fields: [keyof StyleContext, string, string][] = [
  ["strengthen", "希望强化", "例如：纸张质感、安静的叙事节奏"],
  ["avoid", "希望避免", "例如：科技 HUD、固定三栏版式"],
];
export function StyleContextFields({
  value,
  onChange,
  disabled = false,
}: {
  value: StyleContext;
  onChange: (value: StyleContext) => void;
  disabled?: boolean;
}) {
  return (
    <details className="style-context-fields">
      <summary>视觉补充要求（可选）</summary>
      <div className="style-context-grid">
        {fields.map(([key, label, placeholder]) => (
          <Field label={label} key={key}>
            <input
              aria-label={label}
              value={value[key] || ""}
              placeholder={placeholder}
              maxLength={1000}
              disabled={disabled}
              onChange={(event) =>
                onChange({ ...value, [key]: event.target.value })
              }
            />
          </Field>
        ))}
      </div>
      <p className="detail-help">
        这里只调整视觉表达。主题、行业和受众在项目中填写。
      </p>
    </details>
  );
}
