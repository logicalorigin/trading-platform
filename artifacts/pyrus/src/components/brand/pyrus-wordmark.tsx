import { type CSSProperties } from "react";

const WORDMARK_WIDTH = 852;
const WORDMARK_HEIGHT = 104;
const WORDMARK_ASPECT_RATIO = WORDMARK_HEIGHT / WORDMARK_WIDTH;

type WordmarkProps = {
  className?: string;
  title?: string;
  width?: number;
  style?: CSSProperties;
};

export function PyrusWordmark({
  className,
  title = "PYRUS",
  width = 118,
  style,
}: WordmarkProps) {
  const height = Math.max(1, Math.round(width * WORDMARK_ASPECT_RATIO));
  const text = title || "PYRUS";

  return (
    <span
      aria-hidden={title ? undefined : true}
      aria-label={title || undefined}
      className={["pyrus-wordmark", className].filter(Boolean).join(" ")}
      role={title ? "img" : undefined}
      style={{
        alignItems: "center",
        display: "inline-flex",
        fontSize: Math.max(12, Math.min(26, Math.round(width * 0.16))),
        fontWeight: 700,
        height,
        justifyContent: "center",
        letterSpacing: 0,
        lineHeight: 1,
        width,
        ...style,
      }}
    >
      {text}
    </span>
  );
}
