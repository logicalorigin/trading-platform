import { type CSSProperties } from "react";

const WORDMARK_DARK_SRC = "/brand/pyrus-wordmark-tight.png";
const WORDMARK_LIGHT_SRC = "/brand/pyrus-wordmark-tight-light.png";
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

  return (
    <span
      aria-hidden={title ? undefined : true}
      aria-label={title || undefined}
      className={["pyrus-wordmark", className].filter(Boolean).join(" ")}
      role={title ? "img" : undefined}
      style={{
        alignItems: "center",
        display: "inline-flex",
        height,
        justifyContent: "center",
        lineHeight: 1,
        width,
        ...style,
      }}
    >
      <img
        alt=""
        aria-hidden="true"
        className="pyrus-wordmark-image pyrus-wordmark-image--dark"
        decoding="async"
        draggable={false}
        src={WORDMARK_DARK_SRC}
      />
      <img
        alt=""
        aria-hidden="true"
        className="pyrus-wordmark-image pyrus-wordmark-image--light"
        decoding="async"
        draggable={false}
        src={WORDMARK_LIGHT_SRC}
      />
    </span>
  );
}
