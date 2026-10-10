import { SceneView } from "./SceneView";
import {
  useEffect,
  useRef,
  useId,
  cloneElement,
  isValidElement,
  type ReactNode,
  type HTMLAttributes,
} from "react";
import {
  X,
  SpinnerGap,
  Check,
  Image as ImageIcon,
} from "@phosphor-icons/react";
import type { Style, Slide } from "./types";
import { asset } from "./api";
import { BUILTIN_STYLE_COVERS } from "../shared/styles.mjs";
export function Button({
  children,
  variant = "secondary",
  loading = false,
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  loading?: boolean;
}) {
  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      className={`btn ${variant} ${className}`}
    >
      {loading ? <SpinnerGap className="spin" size={18} /> : null}
      {children}
    </button>
  );
}
export function Modal({
  title,
  subtitle,
  onClose,
  children,
  wide = false,
  className = "",
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    const cancel = (e: Event) => {
      e.preventDefault();
      close.current();
    };
    dialog?.addEventListener("cancel", cancel);
    return () => {
      dialog?.removeEventListener("cancel", cancel);
      dialog?.close();
    };
  }, []);
  return (
    <dialog ref={ref} className={`modal ${wide ? "wide" : ""} ${className}`}>
      <div className="modal-heading">
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="关闭">
          <X size={22} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function StylePreview({
  style,
  compact = false,
}: {
  style: Style;
  compact?: boolean;
}) {
  const cover = style.cover
    ? asset(style.cover)
    : BUILTIN_STYLE_COVERS[style.id];
  return (
    <div
      className={`style-preview ${compact ? "compact" : ""}`}
      style={{
        background: style.colors[0] || "#ebece6",
        color: style.colors[1] || "#2f3630",
      }}
    >
      {cover || style.refs[0] ? (
        <img
          src={cover || asset(style.refs[0])}
          alt={`${style.name}${cover ? "封面" : "参考图"}`}
        />
      ) : (
        <>
          <span className="style-sample-top">把值得讲述的，留下来。</span>
          <div className="style-sample-title">
            让一个观点
            <br />
            <span
              style={{
                color:
                  style.id === "bold"
                    ? "#5f7d2f"
                    : style.colors[2] || "inherit",
              }}
            >
              被看见。
            </span>
          </div>
          <div className="style-sample-bottom">
            <span>一页，一个重点</span>
            <span
              className="sample-line"
              style={{ background: style.colors[2] }}
            />
          </div>
        </>
      )}
    </div>
  );
}
export function SlideImage({
  slide,
  onClick,
}: {
  slide: Slide;
  onClick?: () => void;
}) {
  return (
    <div
      className={`slide-image ${slide.image || slide.scene ? "has-image" : "placeholder"}`}
      onClick={onClick}
    >
      {slide.scene ? (
        <SceneView
          scene={slide.scene}
          label={slide.plan?.title || "演讲页面"}
        />
      ) : slide.image ? (
        <img
          src={asset(slide.image)}
          alt={slide.plan?.title || "演讲页面"}
          loading="lazy"
        />
      ) : (
        <div className="slide-placeholder">
          {slide.status === "generating" ? (
            <SpinnerGap size={32} className="spin" />
          ) : (
            <ImageIcon size={32} weight="light" />
          )}
          <strong>{slide.plan?.title || (slide.status === "generating" ? "正在理解这一页的内容" : "这一页尚未生成画面")}</strong>
          <span>
            {slide.status === "error"
              ? "生成未完成，可继续制作"
              : slide.status === "generating"
                ? "正在设计画面…"
                : "等待生成画面"}
          </span>
        </div>
      )}
    </div>
  );
}
export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  const labelId = useId();
  return (
    <label className="field">
      <span id={labelId}>{label}</span>
      {isValidElement<HTMLAttributes<HTMLElement>>(children)
        ? cloneElement(children, {
            "aria-labelledby": labelId,
            "aria-describedby": hint ? labelId + "-hint" : undefined,
          })
        : children}
      {hint && <small id={labelId + "-hint"}>{hint}</small>}
    </label>
  );
}
export function Status({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "good" | "warm";
}) {
  return (
    <span className={`status ${tone}`}>
      {tone === "good" && <Check size={12} weight="bold" />}
      {children}
    </span>
  );
}
