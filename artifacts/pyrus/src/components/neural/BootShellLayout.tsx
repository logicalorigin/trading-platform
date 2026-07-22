import { Suspense, lazy, type ReactNode } from "react";
import { usePrefersReducedMotion } from "@/components/marketing/use-prefers-reduced-motion";
import type { NeuralCoreProps } from "@/components/marketing/neural-core";
import { isNeuralWebglRendererSupported } from "@/lib/webglCapability";
import type { BrandLoaderProgress } from "../BrandLoader";
import { PYRUS_NEURAL_CLOUD_SRC } from "../brand/brokerLogoAssets";
import { PyrusWordmark } from "../brand/pyrus-wordmark";

const NeuralCoreScene = lazy(
  () => import("@/components/marketing/neural-core-scene"),
);

// Marketing-derived full-bleed atmosphere for launch and signed-out surfaces.
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

// Screen-level waits keep the original compact cloud geometry. The expanded
// marketing atmosphere belongs only to launch/auth surfaces.
export const WORKSPACE_CLOUD_PROPS = {
  ...LOADER_CLOUD_PROPS,
  particles: 14000,
  orbitCount: 5400,
  particleSize: 0.045,
  radius: 1.35,
  stray: 0.15,
} satisfies Partial<NeuralCoreProps>;

export const CLOUD_MASK =
  "radial-gradient(120% 118% at 50% 50%, #000 0%, #000 34%, rgba(0,0,0,0.35) 66%, transparent 90%)";

type BootShellVariant = "immersive" | "workspace";

const normalizeMinHeight = (value: string | number) =>
  typeof value === "number" ? `${value}px` : value;

export function BootShellLayout({
  children,
  cloud,
  cloudSuppressed = false,
  label = "PYRUS",
  loading = true,
  minHeight = "100vh",
  progress = null,
  surface = "loading",
  testId = "neural-stage-fallback",
  variant = "immersive",
}: {
  children?: ReactNode;
  cloud?: ReactNode;
  cloudSuppressed?: boolean;
  label?: string;
  loading?: boolean;
  minHeight?: string | number;
  progress?: BrandLoaderProgress | null;
  surface?: "auth" | "loading";
  testId?: string;
  variant?: BootShellVariant;
}) {
  const reducedMotion = usePrefersReducedMotion();
  const isWorkspace = variant === "workspace";
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
  if (isWorkspace) {
    return (
      <div
        className="pyrus-workspace-loader"
        data-testid={testId}
        data-progress={progressPercent ?? undefined}
        role={loading ? "status" : undefined}
        aria-label={loading ? label : undefined}
        aria-live={loading ? "polite" : undefined}
        style={{ minHeight: normalizeMinHeight(minHeight) }}
      >
        <div className="pyrus-workspace-loader-band">
          {showCloud ? (
            <div className="pyrus-workspace-cloud" aria-hidden="true">
              <Suspense fallback={null}>
                <div className="pyrus-workspace-cloud-live">
                  <NeuralCoreScene {...WORKSPACE_CLOUD_PROPS} />
                </div>
              </Suspense>
            </div>
          ) : null}
          <div className="pyrus-workspace-loader-copy">
            <div className="pyrus-workspace-loader-row">
              <span className="pyrus-workspace-loader-label">
                {progressLabel}
              </span>
              {progressPercent != null ? (
                <span className="pyrus-workspace-loader-percent">
                  {progressPercent}%
                </span>
              ) : null}
            </div>
            <div
              className={
                progressPercent == null
                  ? "pyrus-workspace-loader-track pyrus-workspace-loader-track--indeterminate"
                  : "pyrus-workspace-loader-track"
              }
              role={progressPercent == null ? undefined : "progressbar"}
              aria-label={progressPercent == null ? undefined : progressLabel}
              aria-valuemin={progressPercent == null ? undefined : 0}
              aria-valuemax={progressPercent == null ? undefined : 100}
              aria-valuenow={progressPercent ?? undefined}
            >
              <span
                className="pyrus-workspace-loader-fill"
                style={
                  progressPercent == null
                    ? undefined
                    : { width: `${progressPercent}%` }
                }
              />
            </div>
            {progressDetail ? (
              <span className="pyrus-workspace-loader-detail">
                {progressDetail}
              </span>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

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
      aria-live={loading ? "polite" : undefined}
      style={{ minHeight: normalizeMinHeight(minHeight) }}
    >
      <div className="pyrus-boot-cloud" aria-hidden="true">
        <img
          alt=""
          className="pyrus-boot-cloud-static"
          decoding="async"
          draggable={false}
          src={PYRUS_NEURAL_CLOUD_SRC}
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
