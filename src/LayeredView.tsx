import { useLayoutEffect, useRef, useState } from "react";
import { asset } from "./api";
import { FONTS } from "../shared/motion/schema.mjs";
import type { LayeredPage } from "./types";
import "@fontsource-variable/noto-sans-sc/index.css";
import "@fontsource-variable/noto-serif-sc/index.css";

// Use the same fixed canvas and CSS text metrics as the editable player.
export function LayeredView({
  page,
  label = "可编辑演讲页面",
}: {
  page: LayeredPage;
  label?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  useLayoutEffect(() => {
    const node = container.current!;
    const update = () =>
      setScale(
        Math.min(
          node.clientWidth / page.width,
          node.clientHeight / page.height,
        ),
      );
    const observer = new ResizeObserver(update);
    observer.observe(node);
    update();
    return () => observer.disconnect();
  }, [page.width, page.height]);
  return (
    <div
      ref={container}
      role="img"
      aria-label={label}
      data-layered-preview
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        aspectRatio: `${page.width}/${page.height}`,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          width: page.width,
          height: page.height,
          left: "50%",
          top: "50%",
          transform: `translate(-50%, -50%) scale(${scale})`,
          transformOrigin: "center",
          textAlign: "left",
        }}
      >
        <img
          src={asset(page.background)}
          alt=""
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "fill",
          }}
        />
        {page.layers.map((l) => (
          <div
            key={l.id}
            style={{
              position: "absolute",
              left: l.x,
              top: l.y,
              width: l.w,
              height: l.h,
              transform: `rotate(${l.rotation || 0}deg)`,
            }}
          >
            {l.type === "image" ? (
              <img
                src={asset(l.asset!)}
                alt=""
                style={{ width: "100%", height: "100%", objectFit: "fill" }}
              />
            ) : (
              <span
                style={{
                  display: "block",
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: l.w,
                  whiteSpace: "pre-wrap",
                  fontFamily: `"${FONTS[l.font || "sans"]}","${FONTS.sans}",sans-serif`,
                  fontSize: l.fontSize,
                  fontWeight: l.fontWeight,
                  color: l.color,
                  lineHeight: l.lineHeight,
                  letterSpacing: l.letterSpacing,
                  textAlign: l.align,
                  fontKerning: "normal",
                  fontSynthesis: "none",
                }}
              >
                {l.text}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
