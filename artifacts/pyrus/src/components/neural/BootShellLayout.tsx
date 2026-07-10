import { Suspense, lazy, type ReactNode } from "react";
import { usePrefersReducedMotion } from "@/components/marketing/use-prefers-reduced-motion";
import type { NeuralCoreProps } from "@/components/marketing/neural-core";
import { isNeuralWebglRendererSupported } from "@/lib/webglCapability";
import type { BrandLoaderProgress } from "../BrandLoader";
import { PyrusWordmark } from "../brand/pyrus-wordmark";

const NeuralCoreScene = lazy(
  () => import("@/components/marketing/neural-core-scene"),
);

// Marketing-derived full-bleed atmosphere for every loading and signed-out surface.
export const LOADER_CLOUD_PROPS = {
  look: "balanced",
  particles: 22000,
  orbitCount: 9000,
  particleSize: 0.024,
  coreOpacity: 0.82,
  orbitOpacity: 0.6,
  distortion: 0.62,
  noiseSpeed: 0.07,
  rotationSpeed: 0.018,
  tiltStrength: 0,
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

export const CLOUD_MASK =
  "radial-gradient(120% 118% at 50% 50%, #000 0%, #000 34%, rgba(0,0,0,0.35) 66%, transparent 90%)";

export function BootShellLayout({
  children,
  cloud,
  cloudSuppressed = false,
  label = "PYRUS",
  loading = true,
  progress = null,
  surface = "loading",
  testId = "neural-stage-fallback",
}: {
  children?: ReactNode;
  cloud?: ReactNode;
  cloudSuppressed?: boolean;
  label?: string;
  loading?: boolean;
  progress?: BrandLoaderProgress | null;
  surface?: "auth" | "loading";
  testId?: string;
}) {
  const reducedMotion = usePrefersReducedMotion();
  const showCloud =
    !cloudSuppressed &&
    !reducedMotion &&
    isNeuralWebglRendererSupported();
  const rawProgress = progress?.percent;
  const progressValue =
    typeof rawProgress === "number" && Number.isFinite(rawProgress)
      ? rawProgress
      : 0;
  const progressPercent =
    progress == null
      ? null
      : Math.min(100, Math.max(0, Math.round(progressValue)));
  const progressLabel = progress?.label?.trim() || label;
  const progressDetail = progress?.detail?.trim() || null;
  const liveCloud =
    cloud ??
    (showCloud ? (
      <div
        style={{
          height: "100%",
          width: "100%",
          maskImage: CLOUD_MASK,
          WebkitMaskImage: CLOUD_MASK,
        }}
      >
        <NeuralCoreScene {...LOADER_CLOUD_PROPS} />
      </div>
    ) : null);

  return (
    <div
      className="pyrus-boot-loader"
      data-surface={surface}
      data-testid={testId}
      data-progress={progressPercent ?? undefined}
      role={loading ? "status" : undefined}
      aria-label={loading ? label : undefined}
    >
      <div className="pyrus-boot-cloud" aria-hidden="true">
        <img
          alt=""
          className="pyrus-boot-cloud-static"
          decoding="async"
          draggable={false}
          src="/brand/pyrus-neural-cloud.webp"
        />
        {liveCloud ? (
          <Suspense fallback={null}>
            <div className="pyrus-boot-cloud-live">{liveCloud}</div>
          </Suspense>
        ) : null}
      </div>
      <div className="pyrus-boot-brand">
        <div className="pyrus-boot-identity" aria-hidden="true">
          <PyrusWordmark title="" width={200} />
          {!loading ? (
            <span className="pyrus-boot-tagline">
              Real-time options flow & signal intelligence.
            </span>
          ) : null}
        </div>
        {loading && progressPercent != null ? (
          <div className="brand-loader-progress" aria-live="polite">
            <div className="brand-loader-progress-row">
              <span className="brand-loader-progress-label">{progressLabel}</span>
              <span className="brand-loader-progress-percent">{progressPercent}%</span>
            </div>
            <div
              className="brand-loader-progress-track"
              role="progressbar"
              aria-label={progressLabel}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progressPercent}
            >
              <div
                className="brand-loader-progress-fill"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            {progressDetail ? (
              <div className="brand-loader-progress-detail">{progressDetail}</div>
            ) : null}
          </div>
        ) : loading ? (
          <div className="pyrus-loading pyrus-boot-loading">
            <div className="pyrus-loading-bar" />
            <span className="pyrus-loading-label">Loading</span>
          </div>
        ) : null}
        {children ? <div className="pyrus-auth-content">{children}</div> : null}
      </div>
      {loading ? (
        <span className="pyrus-boot-sr">
          {progressPercent == null
            ? label
            : `${progressLabel} ${progressPercent}%`}
        </span>
      ) : null}
    </div>
  );
}
