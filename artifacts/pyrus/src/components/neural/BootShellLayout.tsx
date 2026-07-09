import { Suspense, lazy } from "react";
import { BrandResolve } from "@/components/marketing/brand-resolve";
import { PyrusMark } from "@/components/marketing/pyrus-mark";
import { usePrefersReducedMotion } from "@/components/marketing/pyrus-mark-3d";
import type { NeuralCoreProps } from "@/components/marketing/neural-core";
import { isWebglAvailable } from "@/lib/webglCapability";
import { PyrusWordmark } from "../brand/pyrus-wordmark";
import { isNeuralOpenerActive } from "./neuralOpenerState";

const NeuralCoreScene = lazy(
  () => import("@/components/marketing/neural-core-scene"),
);

// One tuned neural cloud used for every ambient/loader surface so they read as
// the same brand atmosphere.
export const LOADER_CLOUD_PROPS = {
  particles: 22000,
  orbitCount: 9000,
  particleSize: 0.024,
  coreOpacity: 0.82,
  orbitOpacity: 0.6,
  distortion: 0.62,
  noiseSpeed: 0.07,
  rotationSpeed: 0.018,
  tiltStrength: 0.15,
  glow: 0,
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

// Full-bleed cloud, weighted toward the brand (left) and fading behind the form.
export const CLOUD_MASK =
  "radial-gradient(120% 118% at 24% 46%, #000 0%, #000 34%, rgba(0,0,0,0.35) 66%, transparent 90%)";

// The canonical immersive loading screen — a full-page neural cloud atmosphere
// with the brand and a calm loading affordance on the left. Shared by the boot
// curtain (NeuralBootOverlay) and the workspace/app loaders (NeuralLoader) so
// loading never "jumps" to a different, centered layout.
export function BootShellLayout({
  testId = "neural-stage-fallback",
  label = "PYRUS",
}: {
  testId?: string;
  label?: string;
}) {
  const reducedMotion = usePrefersReducedMotion();
  const openerActive = isNeuralOpenerActive();
  const showCloud = !reducedMotion && isWebglAvailable();

  return (
    <div
      className="pyrus-boot-loader"
      data-testid={testId}
      role="status"
      aria-label={label}
    >
      {showCloud ? (
        <div className="pyrus-boot-cloud" aria-hidden="true">
          <div
            style={{
              height: "100%",
              width: "100%",
              maskImage: CLOUD_MASK,
              WebkitMaskImage: CLOUD_MASK,
            }}
          >
            <Suspense fallback={null}>
              <NeuralCoreScene {...LOADER_CLOUD_PROPS} />
            </Suspense>
          </div>
        </div>
      ) : null}
      <div className="pyrus-boot-brand" aria-hidden="true">
        {openerActive ? (
          <PyrusMark className="h-[140px] w-[140px]" />
        ) : (
          <BrandResolve
            loop
            morph
            logoVariant="svg"
            haloBlur={0.45}
            bloomBlur={1.8}
            webglPolicy="available"
            className="h-[140px] w-[140px]"
          />
        )}
        <PyrusWordmark title="" width={200} />
        <span className="pyrus-boot-tagline">
          Real-time options flow & signal intelligence.
        </span>
        <div className="pyrus-loading pyrus-boot-loading">
          <div className="pyrus-loading-bar" />
          <span className="pyrus-loading-label">Loading</span>
        </div>
      </div>
      <div className="pyrus-boot-content" />
      <span className="pyrus-boot-sr">{label}</span>
    </div>
  );
}
