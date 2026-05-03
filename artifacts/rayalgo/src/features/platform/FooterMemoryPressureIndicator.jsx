import { T, dim, fs, sp } from "../../lib/uiTokens";
import {
  isPressureLevelAtLeast,
} from "./memoryPressureModel";
import { useMemoryPressurePreferences } from "./memoryPressurePreferences";

const TONE_BY_LEVEL = {
  normal: T.green,
  watch: T.amber,
  high: "#fb923c",
  critical: T.red,
};

const BACKGROUND_BY_LEVEL = {
  normal: T.greenBg,
  watch: T.amberBg || `${T.amber}14`,
  high: "rgba(251,146,60,0.14)",
  critical: `${T.red}14`,
};

const formatMetric = (value, suffix = "") =>
  Number.isFinite(value) ? `${Math.round(value)}${suffix}` : "--";

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const FALLBACK_SCORE_BY_LEVEL = {
  normal: 12,
  watch: 38,
  high: 68,
  critical: 92,
};

export const memoryPressureFillPercent = (signal) => {
  const score = Number(signal?.score);
  if (Number.isFinite(score)) {
    return Math.round(clamp(score, 0, 100));
  }
  return FALLBACK_SCORE_BY_LEVEL[signal?.level] ?? FALLBACK_SCORE_BY_LEVEL.normal;
};

const topDriverLabel = (signal) => {
  const driver = Array.isArray(signal?.dominantDrivers)
    ? signal.dominantDrivers[0]
    : null;
  if (!driver?.label) {
    return null;
  }
  return driver.detail ? `${driver.label} ${driver.detail}` : driver.label;
};

const buildTitle = (signal) => {
  const drivers = Array.isArray(signal?.dominantDrivers)
    ? signal.dominantDrivers
        .map((driver) =>
          driver?.detail ? `${driver.label} ${driver.detail}` : driver.label,
        )
        .join(" | ")
    : "";
  return [
    `Memory pressure ${String(signal?.level || "normal").toUpperCase()}`,
    `Trend ${String(signal?.trend || "steady").toUpperCase()}`,
    `Browser ${formatMetric(signal?.browserMemoryMb, " MB")}`,
    `API ${formatMetric(signal?.apiHeapUsedPercent, "%")}`,
    drivers,
  ]
    .filter(Boolean)
    .join(" • ");
};

export const FooterMemoryPressureIndicator = ({ signal }) => {
  const { preferences } = useMemoryPressurePreferences();
  const level = signal?.level || "normal";
  const tone = TONE_BY_LEVEL[level] || T.textSec;
  const fillPercent = memoryPressureFillPercent(signal);
  const driverLabel = topDriverLabel(signal);
  const shouldAnimate =
    preferences.animationEnabled &&
    !signal?.reducedMotionEnabled &&
    isPressureLevelAtLeast(level, preferences.alertThreshold);

  return (
    <div
      data-testid="footer-memory-pressure-indicator"
      aria-label={buildTitle(signal)}
      title={buildTitle(signal)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: sp(5),
        minWidth: 0,
        padding: sp("2px 6px"),
        border: `1px solid ${tone}66`,
        background: BACKGROUND_BY_LEVEL[level] || `${tone}14`,
        color: tone,
        fontFamily: T.mono,
        fontSize: fs(8),
        fontWeight: 900,
        flexShrink: 0,
        maxWidth: "min(58vw, 430px)",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          position: "relative",
          display: "inline-block",
          width: dim(54),
          height: dim(8),
          borderRadius: dim(3),
          border: `1px solid ${tone}66`,
          background: T.bg0,
          overflow: "hidden",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            position: "absolute",
            inset: 0,
            width: `${fillPercent}%`,
            minWidth: fillPercent > 0 ? dim(3) : 0,
            background: tone,
            opacity: shouldAnimate ? 0.72 : 0.86,
            boxShadow: shouldAnimate ? `0 0 10px ${tone}` : "none",
            transition: "width 180ms ease, opacity 180ms ease",
          }}
        />
      </span>
      <span style={{ whiteSpace: "nowrap" }}>
        MEM {String(level).toUpperCase()} {fillPercent}%
      </span>
      {preferences.showCompactLabel ? (
        <span
          style={{
            color: T.textSec,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          Browser {formatMetric(signal?.browserMemoryMb, "M")} · API{" "}
          {formatMetric(signal?.apiHeapUsedPercent, "%")}
          {driverLabel ? ` · Driver ${driverLabel}` : ""}
        </span>
      ) : null}
    </div>
  );
};
