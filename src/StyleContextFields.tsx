import type { StyleContext } from "./types";
import { Field } from "./components";

const fields: [keyof StyleContext, string, string][] = [
  ["useCase", "使用场景", "例如：大型行业峰会 / 文学教学"],
  ["industry", "行业", "例如：儿童摄影；留空保持通用"],
  ["audience", "受众", "例如：影楼经营者 / 初中学生"],
  ["topic", "内容主题", "例如：经营战略 / 朝花夕拾"],
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
      <summary>使用场景与补充要求（可选）</summary>
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
        输出为单张 16:9
        横版演示页面。行业用于理解真实场景，不会要求每页添加行业符号。
      </p>
    </details>
  );
}
