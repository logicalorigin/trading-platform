import { type CSSProperties } from "react";

const MARK_SRC = "/brand/pyrus-mark.svg";

export function PyrusMark({
  animated = false,
  className,
  imageClassName,
  style,
  title = "Pyrus",
}: {
  animated?: boolean;
  className?: string;
  imageClassName?: string;
  style?: CSSProperties;
  title?: string;
}) {
  return (
    <span
      aria-hidden={title ? undefined : true}
      aria-label={title || undefined}
      className={["pyrus-mark", className].filter(Boolean).join(" ")}
      data-animated={animated ? "true" : undefined}
      role={title ? "img" : undefined}
      style={style}
    >
      <img
        alt=""
        aria-hidden="true"
        className={["pyrus-mark-image", imageClassName].filter(Boolean).join(" ")}
        decoding="async"
        draggable={false}
        src={MARK_SRC}
      />
    </span>
  );
}
