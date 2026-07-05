// Capability + motion gates for the neural loading screen. Kept tiny and
// eager (no `three`) so it can run synchronously, before the lazy WebGL chunk
// is imported, to decide whether to play the neural opener at all.

export function isWebglAvailable(): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return false;
  }
  try {
    const canvas = document.createElement("canvas");
    const gl =
      canvas.getContext("webgl2") ||
      canvas.getContext("webgl") ||
      canvas.getContext("experimental-webgl");
    return Boolean(gl);
  } catch {
    return false;
  }
}

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;

  // OS-level preference is the only reliable signal at opener time — the app's
  // own `html[data-pyrus-reduced-motion]` attribute is set later, by the app
  // shell, so it may not exist yet during first load.
  if (typeof window.matchMedia === "function") {
    try {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        return true;
      }
    } catch {
      // matchMedia can throw on malformed queries in old engines — ignore.
    }
  }

  // Honor the app preference if it has already been applied.
  if (typeof document !== "undefined") {
    const attr = document.documentElement.getAttribute(
      "data-pyrus-reduced-motion",
    );
    if (attr === "on") return true;
  }

  return false;
}

export function shouldPlayNeuralOpener(): boolean {
  return isWebglAvailable() && !prefersReducedMotion();
}
