const PYRUS_MARK_SRC = "/brand/pyrus-mark.png";

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function PyrusMark({
  className,
  title,
}: {
  className?: string;
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
        className="pyrus-mark-image"
        decoding="async"
        draggable={false}
        loading="eager"
        src={PYRUS_MARK_SRC}
      />
    </span>
  );
}
