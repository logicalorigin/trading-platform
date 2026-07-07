import { Suspense, lazy, type CSSProperties } from "react";
import BrandLoader, { type BrandLoaderProps } from "../BrandLoader";
import { PyrusWordmark } from "../brand/pyrus-wordmark";
import { BrandResolve } from "@/components/marketing/brand-resolve";
import { usePrefersReducedMotion } from "@/components/marketing/pyrus-mark-3d";
import type { NeuralCoreProps } from "@/components/marketing/neural-core";
import { FONT_CSS_VAR } from "@/lib/typography";
import { isWebglAvailable } from "@/lib/webglCapability";
import { isNeuralOpenerActive } from "./neuralOpenerState";

const NeuralCoreScene = lazy(
  () => import("@/components/marketing/neural-core-scene"),
);

export type NeuralLoaderProps = BrandLoaderProps & {
  caption?: string;
};

const SHELL_BG = "var(--ra-surface-0, #F7FAFF)";
const PANEL_BG = "var(--ra-surface-1, #FFFFFF)";

const normalizeMinHeight = (value: string | number): string =>
  typeof value === "number" ? `${value}px` : value;

const normalizeProgressPercent = (value: number): number =>
  Math.min(100, Math.max(0, Math.round(Number.isFinite(value) ? value : 0)));

const LOADER_CLOUD_PROPS = {
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

// Source-backed neural loader for container / page loading states. The animated
// center is the website's BrandResolve moment: neural cloud -> Pyrus rings. A
// loader-local source cloud sits behind it so the loading screen reads as neural
// first, not just a resolved logo mark.
// If the first-load opener already owns a WebGL context, fall back to the static
// BrandLoader underneath it to avoid competing canvases.
export function NeuralLoader({
  caption,
  label = "PYRUS",
  minHeight = "100vh",
  progress = null,
  testId = "neural-loader",
  tone = "app",
  ...brandProps
}: NeuralLoaderProps) {
  const reducedMotion = usePrefersReducedMotion();

  if (isNeuralOpenerActive()) {
    return (
      <BrandLoader
        {...brandProps}
        label={label}
        minHeight={minHeight}
        progress={progress}
        testId={testId}
        tone={tone}
      />
    );
  }

  const showCloud = !reducedMotion && isWebglAvailable();
  const isPanel = tone === "panel";
  const progressPercent =
    progress == null ? null : normalizeProgressPercent(progress.percent);
  const progressLabel = progress?.label?.trim() || caption || label;
  const progressDetail = progress?.detail?.trim() || null;

  return (
    <div
      className="neural-loader"
      data-testid={testId}
      data-tone={tone}
      data-progress={progressPercent === null ? undefined : progressPercent}
      role="status"
      aria-label={label}
      style={
        {
          alignItems: "center",
          background: isPanel ? PANEL_BG : SHELL_BG,
          color: "var(--ra-text-primary, #101827)",
          display: "flex",
          flexDirection: "column",
          fontFamily: FONT_CSS_VAR.sans,
          height: isPanel ? "100%" : undefined,
          justifyContent: "center",
          minHeight: normalizeMinHeight(minHeight),
          overflow: "hidden",
          position: "relative",
        } as CSSProperties
      }
    >
      {showCloud ? (
        <div
          aria-hidden="true"
          style={{
            inset: 0,
            opacity: isPanel ? 0.58 : 0.72,
            pointerEvents: "none",
            position: "absolute",
          }}
        >
          <div
            style={{
              height: "100%",
              maskImage:
                "radial-gradient(125% 125% at 50% 45%, #000 55%, transparent 100%)",
              width: "100%",
              WebkitMaskImage:
                "radial-gradient(125% 125% at 50% 45%, #000 55%, transparent 100%)",
            }}
          >
            <Suspense fallback={null}>
              <NeuralCoreScene {...LOADER_CLOUD_PROPS} />
            </Suspense>
          </div>
        </div>
      ) : null}
      <div
        aria-hidden="true"
        className="brand-loader-lockup"
        style={{ position: "relative", zIndex: 1 }}
      >
        <BrandResolve
          loop
          morph
          logoVariant="svg"
          className={isPanel ? "h-[72px] w-[72px]" : "h-[136px] w-[136px]"}
          haloBlur={0.45}
          bloomBlur={1.8}
          webglPolicy="available"
        />
        <PyrusWordmark
          title=""
          className="brand-loader-word brand-loader-word--resolve"
          width={isPanel ? 148 : 213}
        />
      </div>
      {progressPercent === null ? (
        caption ? <div className="neural-loader-caption">{caption}</div> : null
      ) : (
        <div
          className="brand-loader-progress"
          aria-live="polite"
          style={{ position: "relative", zIndex: 1 }}
        >
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
      )}
      <span
        style={{
          clip: "rect(0 0 0 0)",
          height: 1,
          overflow: "hidden",
          position: "absolute",
          width: 1,
        }}
      >
        {progressPercent === null
          ? progressLabel
          : `${progressLabel} ${progressPercent}%`}
      </span>
    </div>
  );
}

export default NeuralLoader;
