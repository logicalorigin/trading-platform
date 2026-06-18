const PYRUS_MARK_SRC = "/brand/pyrus-mark-dark.svg";
const PYRUS_ANIMATED_MARK_SRC = PYRUS_MARK_SRC;

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function PyrusMark({
  animated = false,
  className,
  imageClassName,
  title,
}: {
  animated?: boolean;
  className?: string;
  imageClassName?: string;
  title?: string;
}) {
  return (
    <span
      aria-hidden={title ? undefined : true}
      aria-label={title || undefined}
      className={cn("pyrus-mark h-10 w-10", className)}
      role={title ? "img" : undefined}
    >
      <img
        alt=""
        aria-hidden="true"
        className={cn("pyrus-mark-image", imageClassName)}
        decoding="async"
        draggable={false}
        loading="eager"
        src={animated ? PYRUS_ANIMATED_MARK_SRC : PYRUS_MARK_SRC}
      />
    </span>
  );
}
