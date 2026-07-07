import { lazy, Suspense, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";

import type { NeuralCoreProps } from "@/components/marketing/neural-core";

declare global {
  interface Window {
    __PYRUS_BOOT_NEURAL_SCENE_URL__?: string;
    __PYRUS_DISPOSE_BOOT_NEURAL__?: () => void;
  }
}

const BOOT_CLOUD_PROPS = {
  particles: 36000,
  orbitCount: 14000,
  particleSize: 0.023,
  coreOpacity: 0.86,
  orbitOpacity: 0.62,
  distortion: 0.62,
  noiseSpeed: 0.07,
  rotationSpeed: 0.018,
  tiltStrength: 0.15,
  glow: 0.02,
  warp: 0.16,
  warpScale: 0.9,
  warpSpeed: 0.2,
  breath: 0.022,
  breathSpeed: 0.33,
  shimmer: 0.1,
  shimmerSpeed: 1.3,
  orbitTimeScale: 0.78,
  driftX: 0.05,
  driftY: 0.04,
  maxFps: 30,
  antialias: false,
  superSample: 1,
  maxPixelRatio: 1.75,
  radius: 3.1,
} satisfies Partial<NeuralCoreProps>;

type BootNeuralSceneComponent = ComponentType<Partial<NeuralCoreProps>>;
type ResolvedBootNeuralSceneModule = {
  default: BootNeuralSceneComponent;
};

const EmptyBootNeuralScene: BootNeuralSceneComponent = () => null;
const EMPTY_BOOT_NEURAL_SCENE = {
  default: EmptyBootNeuralScene,
} satisfies ResolvedBootNeuralSceneModule;

type BootNeuralSceneModule = {
  default?: ComponentType<Partial<NeuralCoreProps>>;
  n?:
    | ComponentType<Partial<NeuralCoreProps>>
    | { default?: ComponentType<Partial<NeuralCoreProps>> };
};

const loadBootNeuralScene = async (): Promise<ResolvedBootNeuralSceneModule> => {
  const sceneUrl = window.__PYRUS_BOOT_NEURAL_SCENE_URL__;
  if (!sceneUrl) {
    return EMPTY_BOOT_NEURAL_SCENE;
  }

  let sceneModule: BootNeuralSceneModule;
  try {
    sceneModule = (await import(
      /* @vite-ignore */ sceneUrl
    )) as BootNeuralSceneModule;
  } catch {
    return EMPTY_BOOT_NEURAL_SCENE;
  }

  const sceneExport = sceneModule.default ?? sceneModule.n;
  const Scene =
    typeof sceneExport === "function" ? sceneExport : sceneExport?.default;
  if (!Scene) {
    return EMPTY_BOOT_NEURAL_SCENE;
  }

  return { default: Scene };
};

const NeuralCoreScene = lazy(loadBootNeuralScene);

let cachedWebglAvailable: boolean | undefined;

function isWebglAvailable() {
  if (cachedWebglAvailable !== undefined) return cachedWebglAvailable;
  if (typeof window === "undefined" || typeof document === "undefined") {
    cachedWebglAvailable = false;
    return cachedWebglAvailable;
  }

  try {
    const canvas = document.createElement("canvas");
    const gl =
      canvas.getContext("webgl2") ||
      canvas.getContext("webgl") ||
      canvas.getContext("experimental-webgl");
    cachedWebglAvailable = gl !== null;
    (gl as WebGLRenderingContext | WebGL2RenderingContext | null)
      ?.getExtension("WEBGL_lose_context")
      ?.loseContext?.();
  } catch {
    cachedWebglAvailable = false;
  }

  return cachedWebglAvailable;
}

function prefersReducedMotion() {
  if (typeof window === "undefined") return false;
  if (typeof window.matchMedia === "function") {
    try {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        return true;
      }
    } catch {
      // Keep boot resilient in older engines.
    }
  }

  return (
    typeof document !== "undefined" &&
    document.documentElement.getAttribute("data-pyrus-reduced-motion") === "on"
  );
}

function BootNeuralCloud() {
  return (
    <Suspense fallback={null}>
      <NeuralCoreScene {...BOOT_CLOUD_PROPS} />
    </Suspense>
  );
}

function mountBootNeural() {
  const mount = document.getElementById("pyrus-boot-neural-root");
  const loader = mount?.closest(".pyrus-boot-loader");
  if (!mount || prefersReducedMotion() || !isWebglAvailable()) {
    return;
  }

  loader?.classList.add("pyrus-boot-loader--webgl");
  const root: Root = createRoot(mount);
  root.render(<BootNeuralCloud />);

  window.__PYRUS_DISPOSE_BOOT_NEURAL__ = () => {
    root.unmount();
    mount.textContent = "";
    loader?.classList.remove("pyrus-boot-loader--webgl");
    if (window.__PYRUS_DISPOSE_BOOT_NEURAL__) {
      delete window.__PYRUS_DISPOSE_BOOT_NEURAL__;
    }
  };
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mountBootNeural, { once: true });
} else {
  mountBootNeural();
}
