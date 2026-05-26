import React, { useEffect, useMemo, useState } from "react";
import { getLatestDiagnostics } from "@workspace/api-client-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { AppTooltip } from "@/components/ui/tooltip";
import { FONT_WEIGHTS, RADII, T, dim, sp, textSize } from "../../lib/uiTokens.jsx";
import {
  isPressureLevelAtLeast,
} from "./memoryPressureModel";
import { buildMemoryPressurePopoverModel } from "./memoryPressurePopoverModel.js";
import { useMemoryPressurePreferences } from "./memoryPressurePreferences";

const CSS_COLOR = Object.freeze({
  bg0: "var(--ra-surface-0)",
  bg1: "var(--ra-surface-1)",
  bg2: "var(--ra-surface-2)",
  bg3: "var(--ra-surface-3)",
  bg4: "var(--ra-surface-4)",
  border: "var(--ra-border-default)",
  borderLight: "var(--ra-border-light)",
  borderFocus: "var(--ra-border-focus)",
  text: "var(--ra-text-primary)",
  textSec: "var(--ra-text-secondary)",
  textDim: "var(--ra-text-dim)",
  textMuted: "var(--ra-text-muted)",
  accent: "var(--ra-color-accent)",
  accentDim: "var(--ra-accent-dim)",
  accentHoverBg: "var(--ra-accent-hover-bg)",
  accentActiveBg: "var(--ra-accent-active-bg)",
  blue: "var(--ra-blue-500)",
  purple: "var(--ra-purple-500)",
  cyan: "var(--ra-cyan-500)",
  pink: "var(--ra-pink-500)",
  green: "var(--ra-green-500)",
  greenDim: "var(--ra-green-dim)",
  greenBg: "var(--ra-green-bg)",
  red: "var(--ra-red-500)",
  redDim: "var(--ra-red-dim)",
  redBg: "var(--ra-red-bg)",
  amber: "var(--ra-amber-500)",
  amberDim: "var(--ra-amber-dim)",
  amberBg: "var(--ra-amber-bg)",
  pulseLive: "var(--ra-green-500)",
  pulseAlert: "var(--ra-amber-500)",
  pulseLoss: "var(--ra-red-500)",
  onAccent: "var(--ra-on-accent)",
});

const cssColorMix = (color, percent) =>
  `color-mix(in srgb, ${color} ${percent}%, transparent)`;

const PRESSURE_TOKEN_BY_LEVEL = {
  normal: "--ra-pressure-normal",
  watch: "--ra-pressure-watch",
  high: "--ra-pressure-high",
  critical: "--ra-pressure-critical",
};

const pressureTone = (level) =>
  `var(${PRESSURE_TOKEN_BY_LEVEL[level] || "--ra-text-secondary"})`;

const pressureBorder = (level) =>
  `color-mix(in srgb, ${pressureTone(level)} 40%, transparent)`;

const pressureBackground = (level) =>
  `color-mix(in srgb, ${pressureTone(level)} 14%, transparent)`;

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

const CLUSTER_BAR_HEIGHT = 14;
const CLUSTER_BAR_WIDTH = 3;
const CLUSTER_BAR_GAP = 3;
const CLUSTER_LABEL_GAP = 6;
const CLUSTER_PADDING_X = 4;
const BROWSER_MEMORY_REFERENCE_MB = 600;

const fallbackMiniDriver = { level: "normal", score: 0 };

const barFillPercent = (driver) => {
  const score = Number(driver?.score);
  if (Number.isFinite(score)) {
    return Math.round(clamp(score, 0, 100));
  }
  return FALLBACK_SCORE_BY_LEVEL[driver?.level] ?? 0;
};

const rawMetricFillPercent = (value, maxValue) =>
  Number.isFinite(value) ? Math.round(clamp((value / maxValue) * 100, 0, 100)) : null;

const rawPercentFillPercent = (value) =>
  Number.isFinite(value) ? Math.round(clamp(value, 0, 100)) : null;

const findMiniDriver = (drivers, kind) =>
  drivers.find((driver) => driver?.kind === kind) || fallbackMiniDriver;

const miniTrackStyle = () => ({
  position: "relative",
  display: "inline-block",
  width: dim(CLUSTER_BAR_WIDTH),
  height: dim(CLUSTER_BAR_HEIGHT),
  borderRadius: dim(RADII.xs),
  background: `${cssColorMix(CSS_COLOR.textMuted, 12)}`,
  overflow: "hidden",
  flexShrink: 0,
});

const miniFillStyle = (bar) => ({
  position: "absolute",
  left: 0,
  right: 0,
  bottom: 0,
  height: `${bar.fillPercent}%`,
  minHeight: bar.fillPercent > 0 ? 1 : 0,
  background: pressureTone(bar.level),
  opacity: 0.92,
  transition: "height 180ms ease, opacity 180ms ease",
});

const miniLabelStyle = (bar) => ({
  color: pressureTone(bar.level),
  fontSize: textSize("caption"),
  fontFamily: T.sans,
  fontWeight: FONT_WEIGHTS.medium,
  fontVariantNumeric: "tabular-nums",
  letterSpacing: 0,
  whiteSpace: "nowrap",
});

const MiniPressureBars = ({ signal }) => {
  if (!signal) {
    return null;
  }

  const drivers = Array.isArray(signal.pressureDrivers)
    ? signal.pressureDrivers
    : [];
  const browserDriver = findMiniDriver(drivers, "browser-memory");
  const apiDriver = findMiniDriver(drivers, "api-heap");
  const workloadDriver = findMiniDriver(drivers, "workload");
  const browserFill =
    rawMetricFillPercent(signal.browserMemoryMb, BROWSER_MEMORY_REFERENCE_MB) ??
    barFillPercent(browserDriver);
  const apiFill =
    rawPercentFillPercent(signal.apiHeapUsedPercent) ?? barFillPercent(apiDriver);
  const workloadFill = barFillPercent(workloadDriver);
  const bars = [
    {
      key: "browser",
      level: browserDriver.level || "normal",
      fillPercent: browserFill,
      detail: `Browser ${formatMetric(signal.browserMemoryMb, "M")}`,
    },
    {
      key: "api",
      level: apiDriver.level || "normal",
      fillPercent: apiFill,
      detail: `API ${formatMetric(signal.apiHeapUsedPercent, "%")}`,
    },
    {
      key: "workload",
      level: workloadDriver.level || "normal",
      fillPercent: workloadFill,
      detail: `Workload ${signal.activeWorkloadCount ?? 0}`,
    },
  ];

  return (
    <span
      className="ra-pressure-mini-cluster"
      data-testid="footer-memory-pressure-mini-cluster"
      data-cluster-expanded="true"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: dim(CLUSTER_BAR_GAP),
        paddingLeft: dim(CLUSTER_PADDING_X),
        paddingRight: dim(CLUSTER_PADDING_X),
        marginLeft: sp(2),
        borderRadius: dim(RADII.sm),
        minWidth: dim(
          CLUSTER_BAR_WIDTH * 3 + CLUSTER_BAR_GAP * 2 + CLUSTER_PADDING_X * 2,
        ),
        height: dim(CLUSTER_BAR_HEIGHT + 4),
        alignSelf: "center",
        overflow: "hidden",
        whiteSpace: "nowrap",
      }}
    >
      {bars.map((bar) => (
        <AppTooltip key={bar.key} content={bar.detail}>
          <span
            className="ra-pressure-mini-slot"
            data-testid={`footer-memory-pressure-mini-slot-${bar.key}`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: dim(CLUSTER_LABEL_GAP),
              height: "100%",
            }}
          >
            <span aria-hidden="true" style={miniTrackStyle(bar)}>
              <span
                data-testid={`footer-memory-pressure-mini-fill-${bar.key}`}
                style={miniFillStyle(bar)}
              />
            </span>
            <span className="ra-pressure-mini-label" style={miniLabelStyle(bar)}>
              {bar.detail}
            </span>
          </span>
        </AppTooltip>
      ))}
    </span>
  );
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

const readLatestDiagnosticsSnapshot = (signal) =>
  getLatestDiagnostics(signal ? { signal } : undefined);

const sectionStyle = {
  display: "grid",
  gap: sp(8),
  padding: sp("12px 14px"),
  borderBottom: `1px solid ${CSS_COLOR.border}`,
};

const sectionHeaderStyle = {
  color: CSS_COLOR.textMuted,
  fontSize: textSize("caption"),
  fontWeight: FONT_WEIGHTS.medium,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
};

const rowGridStyle = {
  display: "grid",
  gridTemplateColumns: "minmax(96px, 0.9fr) minmax(0, 1.1fr)",
  gap: sp("5px 10px"),
  alignItems: "baseline",
};

const rowLabelStyle = {
  color: CSS_COLOR.textMuted,
  fontSize: textSize("caption"),
  minWidth: 0,
};

const rowValueStyle = {
  color: CSS_COLOR.text,
  fontSize: textSize("caption"),
  fontVariantNumeric: "tabular-nums",
  minWidth: 0,
  overflowWrap: "anywhere",
};

const LevelPill = ({ level }) => (
  <span
    style={{
      justifySelf: "start",
      color: pressureTone(level),
      border: `1px solid ${pressureBorder(level)}`,
      background: pressureBackground(level),
      borderRadius: dim(RADII.pill),
      padding: sp("2px 7px"),
      fontSize: textSize("caption"),
      fontWeight: FONT_WEIGHTS.medium,
      textTransform: "uppercase",
    }}
  >
    {level}
  </span>
);

const DetailRows = ({ rows }) => (
  <div style={rowGridStyle}>
    {rows.map((row) => (
      <div key={`${row.label}:${row.value}`} style={{ display: "contents" }}>
        <div style={rowLabelStyle}>{row.label}</div>
        <div style={rowValueStyle}>{row.value}</div>
      </div>
    ))}
  </div>
);

const DriverRows = ({ rows }) =>
  rows.length ? (
    <div style={{ display: "grid", gap: sp(7) }}>
      {rows.map((driver) => (
        <div
          key={driver.kind}
          style={{
            display: "grid",
            gap: sp(5),
            padding: sp("7px 8px"),
            borderRadius: dim(RADII.sm),
            background: CSS_COLOR.bg2,
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr) auto",
              gap: sp(8),
              alignItems: "center",
            }}
          >
            <div style={{ minWidth: 0, color: CSS_COLOR.text, fontSize: textSize("caption") }}>
              {driver.label}
            </div>
            <LevelPill level={driver.level} />
          </div>
          <div style={{ ...rowValueStyle, color: CSS_COLOR.textMuted }}>
            {driver.detail} / {driver.contribution}
          </div>
          {driver.metrics.length ? (
            <div style={{ display: "grid", gap: sp(4) }}>
              {driver.metrics.map((metric) => (
                <div
                  key={`${driver.kind}:${metric.key}`}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(80px, 0.7fr) minmax(0, 1.3fr)",
                    gap: sp(8),
                  }}
                >
                  <span style={rowLabelStyle}>{metric.label}</span>
                  <span style={rowValueStyle}>
                    {metric.value} / {metric.thresholds}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  ) : (
    <div style={{ ...rowValueStyle, color: CSS_COLOR.textMuted }}>
      No driver sample available yet.
    </div>
  );

const ThresholdRows = ({ rows }) => (
  <div style={{ display: "grid", gap: sp(5) }}>
    {rows.map((row) => (
      <div
        key={`${row.group}:${row.label}`}
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(92px, 0.7fr) minmax(0, 1.3fr)",
          gap: sp(8),
          alignItems: "baseline",
        }}
      >
        <div style={{ ...rowLabelStyle, color: CSS_COLOR.textSec }}>{row.label}</div>
        <div style={rowValueStyle}>{row.summary}</div>
      </div>
    ))}
  </div>
);

const diagnosticsStatusLabel = (status) => {
  if (status === "loading") return "Loading latest API RAM";
  if (status === "ready") return "Latest diagnostics loaded";
  if (status === "error") return "Latest diagnostics unavailable";
  return "Opens with latest diagnostics";
};

export const FooterMemoryPressureIndicator = ({ signal }) => {
  const { preferences } = useMemoryPressurePreferences();
  const [open, setOpen] = useState(false);
  const [diagnosticsPayload, setDiagnosticsPayload] = useState(null);
  const [diagnosticsStatus, setDiagnosticsStatus] = useState("idle");
  const level = signal?.level || "normal";
  const tone = pressureTone(level);
  const fillPercent = memoryPressureFillPercent(signal);
  const title = buildTitle(signal);
  const model = useMemo(
    () => buildMemoryPressurePopoverModel(signal, diagnosticsPayload),
    [diagnosticsPayload, signal],
  );
  const shouldAnimate =
    preferences.animationEnabled &&
    !signal?.reducedMotionEnabled &&
    isPressureLevelAtLeast(level, preferences.alertThreshold);

  useEffect(() => {
    if (!open || typeof window === "undefined") {
      if (!open) {
        setDiagnosticsPayload(null);
        setDiagnosticsStatus("idle");
      }
      return undefined;
    }

    let cancelled = false;
    const controller =
      typeof AbortController !== "undefined" ? new AbortController() : null;
    setDiagnosticsStatus("loading");
    setDiagnosticsPayload(null);
    readLatestDiagnosticsSnapshot(controller?.signal)
      .then((payload) => {
        if (!cancelled) {
          setDiagnosticsPayload(payload);
          setDiagnosticsStatus("ready");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDiagnosticsStatus("error");
        }
      });

    return () => {
      cancelled = true;
      controller?.abort();
    };
  }, [open]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="footer-memory-pressure-indicator"
          aria-label={`${title}. Open memory details.`}
          title={title}
          style={{
            appearance: "none",
            display: "inline-flex",
            alignItems: "center",
            gap: sp(8),
            minWidth: 0,
            padding: sp("4px 10px"),
            borderRadius: dim(RADII.pill),
            border: `1px solid ${pressureBorder(level)}`,
            background: pressureBackground(level),
            fontFamily: T.sans,
            cursor: "pointer",
            flexShrink: 1,
            maxWidth: "min(58vw, 430px)",
          }}
        >
          <span
            style={{
              color: CSS_COLOR.textMuted,
              fontSize: textSize("caption"),
              fontWeight: FONT_WEIGHTS.medium,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              whiteSpace: "nowrap",
            }}
          >
            Memory
          </span>
          <span
            aria-hidden="true"
            style={{
              position: "relative",
              display: "inline-block",
              width: dim(64),
              height: dim(6),
              borderRadius: dim(RADII.pill),
              background: `${cssColorMix(CSS_COLOR.textMuted, 12)}`,
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
                opacity: shouldAnimate ? 0.72 : 0.92,
                boxShadow: shouldAnimate ? `0 0 8px ${tone}` : "none",
                transition: "width 180ms ease, opacity 180ms ease",
              }}
            />
          </span>
          <span
            style={{
              color: tone,
              fontSize: textSize("body"),
              fontWeight: FONT_WEIGHTS.medium,
              fontVariantNumeric: "tabular-nums",
              whiteSpace: "nowrap",
            }}
          >
            {fillPercent}%
          </span>
          {preferences.showCompactLabel ? <MiniPressureBars signal={signal} /> : null}
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        sideOffset={8}
        data-testid="footer-memory-pressure-popover"
        style={{
          width: "min(520px, calc(100vw - 24px))",
          maxHeight: "min(72vh, 640px)",
          overflowY: "auto",
          padding: 0,
          border: `1px solid ${CSS_COLOR.border}`,
        }}
      >
        <div
          style={{
            display: "grid",
            gap: 0,
            color: CSS_COLOR.text,
            fontFamily: T.sans,
          }}
        >
          <div
            style={{
              ...sectionStyle,
              gridTemplateColumns: "minmax(0, 1fr) auto",
              alignItems: "center",
            }}
          >
            <div style={{ display: "grid", gap: sp(3), minWidth: 0 }}>
              <div style={sectionHeaderStyle}>Memory Pressure</div>
              <div
                style={{
                  color: CSS_COLOR.text,
                  fontSize: textSize("body"),
                  fontWeight: FONT_WEIGHTS.medium,
                }}
              >
                {diagnosticsStatusLabel(diagnosticsStatus)}
              </div>
            </div>
            <LevelPill level={model.level} />
          </div>
          <section style={sectionStyle}>
            <div style={sectionHeaderStyle}>Status</div>
            <DetailRows rows={model.statusRows} />
          </section>
          <section style={sectionStyle}>
            <div style={sectionHeaderStyle}>Browser RAM</div>
            <DetailRows rows={model.browserRows} />
          </section>
          <section style={sectionStyle}>
            <div style={sectionHeaderStyle}>API RAM</div>
            <DetailRows rows={model.apiRows} />
          </section>
          <section style={sectionStyle}>
            <div style={sectionHeaderStyle}>Drivers</div>
            <DriverRows rows={model.driverRows} />
          </section>
          <section style={{ ...sectionStyle, borderBottom: "none" }}>
            <div style={sectionHeaderStyle}>Thresholds</div>
            <ThresholdRows rows={model.thresholdRows} />
          </section>
        </div>
      </PopoverContent>
    </Popover>
  );
};
