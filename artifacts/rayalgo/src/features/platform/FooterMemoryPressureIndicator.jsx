import { useEffect, useMemo, useState } from "react";
import { getLatestDiagnostics } from "@workspace/api-client-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { FONT_WEIGHTS, RADII, T, dim, sp, textSize } from "../../lib/uiTokens.jsx";
import {
  isPressureLevelAtLeast,
} from "./memoryPressureModel";
import { buildMemoryPressurePopoverModel } from "./memoryPressurePopoverModel.js";
import { useMemoryPressurePreferences } from "./memoryPressurePreferences";

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

const topDriverLabel = (signal) => {
  const driver = Array.isArray(signal?.dominantDrivers)
    ? signal.dominantDrivers[0]
    : null;
  if (!driver?.label) {
    return null;
  }
  return driver.detail ? `${driver.label} ${driver.detail}` : driver.label;
};

const topDriverLevel = (signal) => {
  const driver = Array.isArray(signal?.dominantDrivers)
    ? signal.dominantDrivers[0]
    : null;
  return driver?.level || signal?.level || "normal";
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
  borderBottom: `1px solid ${T.border}`,
};

const sectionHeaderStyle = {
  color: T.textMuted,
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
  color: T.textMuted,
  fontSize: textSize("caption"),
  minWidth: 0,
};

const rowValueStyle = {
  color: T.text,
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
            background: T.bg2,
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
            <div style={{ minWidth: 0, color: T.text, fontSize: textSize("caption") }}>
              {driver.label}
            </div>
            <LevelPill level={driver.level} />
          </div>
          <div style={{ ...rowValueStyle, color: T.textMuted }}>
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
    <div style={{ ...rowValueStyle, color: T.textMuted }}>
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
        <div style={{ ...rowLabelStyle, color: T.textSec }}>{row.label}</div>
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
  const driverLabel = topDriverLabel(signal);
  const driverTone = pressureTone(topDriverLevel(signal));
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
              color: T.textMuted,
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
              background: `${T.textMuted}1f`,
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
          {preferences.showCompactLabel ? (
            <span
              style={{
                color: driverLabel ? driverTone : T.textMuted,
                fontSize: textSize("caption"),
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              Browser {formatMetric(signal?.browserMemoryMb, "M")} · API{" "}
              {formatMetric(signal?.apiHeapUsedPercent, "%")}
              {driverLabel ? ` · ${driverLabel}` : ""}
            </span>
          ) : null}
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
          border: `1px solid ${T.border}`,
        }}
      >
        <div
          style={{
            display: "grid",
            gap: 0,
            color: T.text,
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
                  color: T.text,
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
