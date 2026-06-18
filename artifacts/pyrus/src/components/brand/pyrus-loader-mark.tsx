const PYRUS_LOADER_MARK_SRC = "/brand/pyrus-mark-dark.svg";

export function PyrusLoaderMark({ className }: { className?: string }) {
  return (
    <img
      alt=""
      aria-hidden="true"
      className={["pyrus-loader-instrument", className].filter(Boolean).join(" ")}
      decoding="async"
      draggable={false}
      loading="eager"
      src={PYRUS_LOADER_MARK_SRC}
    />
  );
}
