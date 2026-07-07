// Capability + motion gates for the neural loading screen. Kept tiny and
// eager (no `three`) so it can run synchronously, before the lazy WebGL chunk
// is imported, to decide whether to play the neural opener at all.

export type WebglRendererInfo = {
  vendor: string;
  renderer: string;
  unmaskedVendor: string;
  unmaskedRenderer: string;
};

type WebglContext = WebGLRenderingContext | WebGL2RenderingContext;

const SOFTWARE_RENDERER_PATTERN =
  /\b(swiftshader|llvmpipe|softpipe|software rasterizer|mesa offscreen|subzero|basic render driver)\b/i;

let cachedRendererInfo: WebglRendererInfo | null | undefined;

function readParameter(gl: WebglContext, parameter: number): string {
  const value = gl.getParameter(parameter);
  return typeof value === "string" ? value : "";
}

export function isSoftwareWebglRenderer(info: WebglRendererInfo | null): boolean {
  if (!info) return false;
  return [
    info.vendor,
    info.renderer,
    info.unmaskedVendor,
    info.unmaskedRenderer,
  ].some((value) => SOFTWARE_RENDERER_PATTERN.test(value));
}

export function readWebglRendererInfo(): WebglRendererInfo | null {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return null;
  }

  try {
    const canvas = document.createElement("canvas");
    const gl =
      canvas.getContext("webgl2") ||
      canvas.getContext("webgl") ||
      canvas.getContext("experimental-webgl");
    if (!gl) return null;

    const webgl = gl as WebglContext;
    const debugInfo = webgl.getExtension("WEBGL_debug_renderer_info");
    const info = {
      vendor: readParameter(webgl, webgl.VENDOR),
      renderer: readParameter(webgl, webgl.RENDERER),
      unmaskedVendor: debugInfo
        ? readParameter(webgl, debugInfo.UNMASKED_VENDOR_WEBGL)
        : "",
      unmaskedRenderer: debugInfo
        ? readParameter(webgl, debugInfo.UNMASKED_RENDERER_WEBGL)
        : "",
    };
    const loseContext = webgl.getExtension("WEBGL_lose_context") as
      | { loseContext?: () => void }
      | null;
    loseContext?.loseContext?.();

    return info;
  } catch {
    return null;
  }
}

function getCachedWebglRendererInfo(): WebglRendererInfo | null {
  if (cachedRendererInfo === undefined) {
    cachedRendererInfo = readWebglRendererInfo();
  }
  return cachedRendererInfo;
}

export function isWebglAvailable(): boolean {
  return getCachedWebglRendererInfo() !== null;
}

export function isNeuralWebglRendererSupported(): boolean {
  const info = getCachedWebglRendererInfo();
  return Boolean(info && !isSoftwareWebglRenderer(info));
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
  return isNeuralWebglRendererSupported() && !prefersReducedMotion();
}

export function __resetWebglCapabilityCacheForTests(): void {
  cachedRendererInfo = undefined;
}
