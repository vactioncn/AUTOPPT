import { useMemo, useState, useEffect } from "react";
import {
  renderSceneSvg,
  validateScene,
  systemForStyle,
  samplePlan,
  composeScene,
} from "../shared/slides.mjs";
import type { Scene, SceneElement, Style } from "./types";
import { Button, Field } from "./components";
import "./scene.css";
export function SceneView({
  scene,
  onSelect,
  selected,
  label = "演讲页面",
}: {
  scene: Scene;
  onSelect?: (id: string) => void;
  selected?: string;
  label?: string;
}) {
  const markup = useMemo(() => renderSceneSvg(scene), [scene]);
  return (
    <div
      className={`scene-view ${onSelect ? "scene-selectable" : ""}`}
      role="img"
      aria-label={label}
      onClick={(e) => {
        const id = (e.target as Element)
          .closest("[data-element]")
          ?.getAttribute("data-element");
        if (id) onSelect?.(id);
      }}
    >
      <div className="scene-art" dangerouslySetInnerHTML={{ __html: markup }} />
      {selected &&
        scene.elements
          .filter((e) => e.id === selected)
          .map((e) => (
            <div
              key={e.id}
              className="scene-selection"
              style={{
                left: `${e.x / 16}%`,
                top: `${e.y / 9}%`,
                width: `${e.w / 16}%`,
                height: `${e.h / 9}%`,
              }}
            />
          ))}
    </div>
  );
}
export function LayoutGallery({
  style,
  value = "",
  onChoose,
  disabled = false,
}: {
  style: Style;
  value?: string;
  onChoose?: (id: string) => void;
  disabled?: boolean;
}) {
  const system = useMemo(() => systemForStyle(style), [style]);
  return (
    <section className="layout-library" aria-label="风格版式库">
      <div className="section-heading">
        <h3>版式库</h3>
        <span className="muted">
          {system.layouts.length} 种内容用途 · 预览文字为示例
        </span>
      </div>
      <div className="layout-gallery">
        {system.layouts.map((l) => {
          let scene;
          try {
            scene = composeScene(samplePlan(l), system);
          } catch {
            return (
              <div key={l.id} className="error-text">
                {l.name}的区域需要调整
              </div>
            );
          }
          const content = (
            <>
              <SceneView scene={scene} label={`${l.name}版式示例`} />
              <strong>{l.name}</strong>
              <span>
                {l.origin === "reference" ? "参考中已有" : "同风格延伸"} · 最多{" "}
                {l.maxItems} 项
              </span>
            </>
          );
          return onChoose ? (
            <button
              key={l.id}
              disabled={disabled}
              aria-pressed={value === l.id}
              className={`layout-tile ${value === l.id ? "chosen" : ""}`}
              onClick={() => onChoose(l.id)}
              title={l.description}
            >
              {content}
            </button>
          ) : (
            <article className="layout-tile" key={l.id} title={l.description}>
              {content}
            </article>
          );
        })}
      </div>
    </section>
  );
}
export function SceneEditor({
  scene,
  draftKey,
  onSave,
  disabled = false,
}: {
  scene: Scene;
  draftKey: string;
  onSave: (scene: Scene) => Promise<void>;
  disabled?: boolean;
}) {
  const storageKey = "autoppt-scene-draft:" + draftKey;
  const signature = JSON.stringify(scene);
  const readDraft = () => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || "null");
      return saved?.base === signature ? (saved.draft as Scene) : scene;
    } catch {
      return scene;
    }
  };
  const [draft, setDraft] = useState<Scene>(readDraft),
    [selected, setSelected] = useState(scene.elements[0]?.id || ""),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false);
  useEffect(() => {
    setDraft(readDraft());
    setSelected(scene.elements[0]?.id || "");
  }, [signature, storageKey]);
  const change = (next: Scene) => {
    setDraft(next);
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({ base: signature, draft: next }),
      );
    } catch {}
  };
  const e = draft.elements.find((e) => e.id === selected);
  const changed = JSON.stringify(draft) !== JSON.stringify(scene);
  const update = (patch: Partial<SceneElement>) =>
    change({
      ...draft,
      elements: draft.elements.map((e) =>
        e.id === selected ? { ...e, ...patch } : e,
      ),
    });
  // Invalid temporary field values stay in the form; keep the last valid canvas visible.
  let preview = scene;
  try {
    preview = validateScene(draft);
  } catch {}
  const save = async () => {
    setError("");
    setSaving(true);
    try {
      await onSave(validateScene(draft));
      localStorage.removeItem(storageKey);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="scene-editor">
      <p className="detail-help">
        点击画面中的文字或图形，再修改内容、位置和样式。保存不会调用模型。
        {changed && " 修改草稿已留在本机，点击保存后用于导出。"}
      </p>
      <SceneView scene={preview} onSelect={setSelected} selected={selected} />
      <Field label="选择页面元素">
        <select value={selected} onChange={(e) => setSelected(e.target.value)}>
          {draft.elements.map((e, i) => (
            <option value={e.id} key={e.id}>
              {i + 1} ·{" "}
              {e.type === "text"
                ? e.text?.slice(0, 28)
                : e.type === "chart"
                  ? "数据图表"
                  : e.type === "line"
                    ? "线条"
                    : e.type === "ellipse"
                      ? "椭圆"
                      : "矩形"}
            </option>
          ))}
        </select>
      </Field>
      {e && (
        <fieldset disabled={disabled || saving} className="element-fields">
          {e.type === "text" && (
            <>
              <Field label="画面文字">
                <textarea
                  value={e.text}
                  onChange={(v) => update({ text: v.target.value })}
                />
              </Field>
              <div className="scene-fields-row">
                <Field label="字号">
                  <input
                    type="number"
                    min="16"
                    max="180"
                    value={e.fontSize}
                    onChange={(v) =>
                      update({ fontSize: Number(v.target.value) })
                    }
                  />
                </Field>
                <Field label="文字颜色">
                  <input
                    type="color"
                    value={e.color}
                    onChange={(v) => update({ color: v.target.value })}
                  />
                </Field>
                <Field label="对齐">
                  <select
                    value={e.align}
                    onChange={(v) =>
                      update({ align: v.target.value as SceneElement["align"] })
                    }
                  >
                    <option value="left">左对齐</option>
                    <option value="center">居中</option>
                    <option value="right">右对齐</option>
                  </select>
                </Field>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={!!e.bold}
                    onChange={(v) => update({ bold: v.target.checked })}
                  />
                  加粗
                </label>
              </div>
            </>
          )}
          {["rect", "ellipse", "line"].includes(e.type) && (
            <div className="scene-fields-row">
              <Field label="线条颜色">
                <input
                  type="color"
                  value={e.stroke}
                  onChange={(v) => update({ stroke: v.target.value })}
                />
              </Field>
              <Field label="线条宽度">
                <input
                  type="number"
                  min="0"
                  max="12"
                  value={e.strokeWidth}
                  onChange={(v) =>
                    update({ strokeWidth: Number(v.target.value) })
                  }
                />
              </Field>
              {e.type !== "line" && (
                <>
                  <Field label="填充颜色">
                    <input
                      type="color"
                      value={e.fill || draft.background}
                      onChange={(v) => update({ fill: v.target.value })}
                    />
                  </Field>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={!e.fill}
                      onChange={(v) =>
                        update({
                          fill: v.target.checked ? null : draft.background,
                        })
                      }
                    />
                    无填充
                  </label>
                </>
              )}
            </div>
          )}
          {e.type === "chart" && (
            <>
              <div className="scene-fields-row">
                <Field label="图表类型">
                  <select
                    value={e.chartType}
                    onChange={(v) =>
                      update({ chartType: v.target.value as "bar" | "line" })
                    }
                  >
                    <option value="bar">柱状图</option>
                    <option value="line">折线图</option>
                  </select>
                </Field>
                <Field label="数值单位">
                  <input
                    value={e.unit}
                    onChange={(v) => update({ unit: v.target.value })}
                  />
                </Field>
                <Field label="图表颜色">
                  <input
                    type="color"
                    value={e.color}
                    onChange={(v) => update({ color: v.target.value })}
                  />
                </Field>
              </div>
              {e.labels?.map((label, i) => (
                <div className="scene-fields-row" key={i}>
                  <Field label={`分类 ${i + 1}`}>
                    <input
                      value={label}
                      onChange={(v) =>
                        update({
                          labels: e.labels!.map((x, n) =>
                            n === i ? v.target.value : x,
                          ),
                        })
                      }
                    />
                  </Field>
                  <Field label={`数值 ${i + 1}`}>
                    <input
                      type="number"
                      value={e.values?.[i]}
                      onChange={(v) =>
                        update({
                          values: e.values!.map((x, n) =>
                            n === i ? Number(v.target.value) : x,
                          ),
                        })
                      }
                    />
                  </Field>
                </div>
              ))}
            </>
          )}
          <div className="scene-fields-row">
            {(["x", "y", "w", "h"] as const).map((k, i) => (
              <Field
                key={k}
                label={["横向位置", "纵向位置", "宽度", "高度"][i]}
              >
                <input
                  type="number"
                  value={e[k]}
                  min={k === "w" || k === "h" ? 1 : 0}
                  onChange={(v) => update({ [k]: Number(v.target.value) })}
                />
              </Field>
            ))}
          </div>
        </fieldset>
      )}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      <div className="scene-editor-actions">
        <Button
          onClick={() => {
            change(scene);
            setError("");
          }}
          disabled={!changed || saving}
        >
          撤销未保存修改
        </Button>
        <Button
          variant="primary"
          onClick={save}
          loading={saving}
          disabled={!changed || disabled}
        >
          保存画面修改
        </Button>
      </div>
    </div>
  );
}
