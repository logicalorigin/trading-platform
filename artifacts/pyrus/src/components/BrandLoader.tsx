import type { CSSProperties } from "react";
import { PyrusWordmark } from "./brand/pyrus-wordmark";
import { FONT_CSS_VAR } from "../lib/typography";

export type BrandLoaderTone = "app" | "panel";

export type BrandLoaderProgress = {
  percent: number;
  label: string;
  detail?: string | null;
  failedCount?: number;
  complete?: boolean;
};

export type BrandLoaderProps = {
  label?: string;
  minHeight?: string | number;
  tone?: BrandLoaderTone;
  testId?: string;
  bootHandoffElapsedMs?: number | null;
  progress?: BrandLoaderProgress | null;
};

const BRAND_LOADER_SHELL_BG = "var(--ra-surface-0, #F7FAFF)";
const BRAND_LOADER_PANEL_BG = "var(--ra-surface-1, #FFFFFF)";

const normalizeMinHeight = (value: string | number): string =>
  typeof value === "number" ? `${value}px` : value;

const normalizeBootHandoffElapsedMs = (value: number | null | undefined): number | null => {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(0, value);
};

const normalizeProgressPercent = (value: number): number =>
  Math.min(100, Math.max(0, Math.round(Number.isFinite(value) ? value : 0)));

export function BrandLoader({
  bootHandoffElapsedMs = null,
  label = "PYRUS",
  minHeight = "100vh",
  progress = null,
  tone = "app",
  testId = "brand-loader",
}: BrandLoaderProps) {
  const normalizedMinHeight = normalizeMinHeight(minHeight);
  const normalizedBootHandoffElapsedMs = normalizeBootHandoffElapsedMs(bootHandoffElapsedMs);
  const progressPercent =
    progress == null ? null : normalizeProgressPercent(progress.percent);
  const progressLabel = progress?.label?.trim() || label;
  const progressDetail = progress?.detail?.trim() || null;
  const isPanel = tone === "panel";
  const bootHandoffStyle =
    normalizedBootHandoffElapsedMs === null
      ? {}
      : ({
          "--brand-loader-handoff-offset": `${normalizedBootHandoffElapsedMs}ms`,
        } as CSSProperties);

  return (
    <div
      role="status"
      aria-label={label}
      data-testid={testId}
      data-tone={tone}
      data-boot-handoff={normalizedBootHandoffElapsedMs === null ? undefined : "phase"}
      data-progress={progressPercent === null ? undefined : progressPercent}
      style={{
        minHeight: normalizedMinHeight,
        height: isPanel ? "100%" : undefined,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
        background: isPanel ? BRAND_LOADER_PANEL_BG : BRAND_LOADER_SHELL_BG,
        color: "var(--ra-text-primary, #101827)",
        fontFamily: FONT_CSS_VAR.sans,
        ...bootHandoffStyle,
      }}
    >
      <div aria-hidden="true" className="pyrus-boot-identity">
        <PyrusWordmark
          title=""
          className="brand-loader-word"
          width={isPanel ? 148 : 200}
        />
        <span className="pyrus-boot-tagline">
          Real-time options flow &amp; signal intelligence.
        </span>
      </div>
      {progressPercent === null ? null : (
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
      )}
      <span
        style={{
          position: "absolute",
          width: 1,
          height: 1,
          overflow: "hidden",
          clip: "rect(0 0 0 0)",
        }}
      >
        {progressPercent === null
          ? label
          : `${progressLabel} ${progressPercent}%`}
      </span>
    </div>
  );
}

export default BrandLoader;
