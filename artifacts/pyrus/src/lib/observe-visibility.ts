export type VisibilityObserverCleanup = () => void;

export function observeVisibility(
  element: Element,
  onChange: (visible: boolean) => void,
): VisibilityObserverCleanup {
  let inViewport = true;
  let disposed = false;

  const emit = () => {
    if (disposed) return;
    onChange(inViewport && !document.hidden);
  };

  const observer =
    typeof IntersectionObserver === "function"
      ? new IntersectionObserver((entries) => {
          inViewport = entries.some((entry) => entry.isIntersecting);
          emit();
        })
      : null;

  observer?.observe(element);
  document.addEventListener("visibilitychange", emit);
  emit();

  return () => {
    disposed = true;
    observer?.disconnect();
    document.removeEventListener("visibilitychange", emit);
  };
}
