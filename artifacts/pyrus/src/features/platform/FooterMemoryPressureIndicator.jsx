import React, { useEffect, useMemo, useState } from "react";
import { getLatestDiagnostics } from "@workspace/api-client-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { AppTooltip } from "@/components/ui/tooltip";
import { FailurePointContent } from "../../components/platform/FailurePointTooltip.jsx";
import { CSS_COLOR, cssColorMix, dim, FONT_WEIGHTS, MISSING_VALUE, RADII, sp, T, textSize } from "../../lib/uiTokens.jsx";
import { MEMORY_PRESSURE_THRESHOLDS } from "./memoryPressureModel";
import { buildMemoryPressurePopoverModel } from "./memoryPressurePopoverModel.js";
import { useMemoryPressurePreferences } from "./memoryPressurePreferences";
import { buildMemoryPressureFailurePoint } from "./failurePointModel.js";
import { TRADE_OPTIONS_CHAIN_LABEL } from "./runtimeControlModel";

const PRESSURE_TOKEN_BY_LEVEL = {
  normal: "--ra-pressure-normal",
  watch: "--ra-pressure-watch",
  high: "--ra-pressure-high",
};

const PRESSURE_RANK = {
  normal: 0,
  watch: 1,
  high: 2,
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
};

export const memoryPressureFillPercent = (signal) => {
  const score = Number(signal?.score);
  if (Number.isFinite(score)) {
    return Math.round(clamp(score, 0, 100));
  }
  return FALLBACK_SCORE_BY_LEVEL[signal?.level] ?? FALLBACK_SCORE_BY_LEVEL.normal;
};

const CLUSTER_BAR_HEIGHT = 4;
const CLUSTER_BAR_WIDTH = 54;
const CLUSTER_BAR_GAP = 6;
const CLUSTER_LABEL_GAP = 2;
const CLUSTER_PADDING_X = 2;

const fallbackMiniDriver = { level: null, score: 0 };

const finiteNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const normalizePressureLevel = (level) =>
  PRESSURE_RANK[level] == null ? "normal" : level;

const maxPressureLevel = (...levels) =>
  levels.reduce((current, next) =>
    PRESSURE_RANK[normalizePressureLevel(next)] >
    PRESSURE_RANK[normalizePressureLevel(current)]
      ? normalizePressureLevel(next)
      : normalizePressureLevel(current),
  "normal");

const findMiniDriver = (drivers, kind) =>
  drivers.find((driver) => driver?.kind === kind) || null;

const normalizeThresholds = (thresholds, fallback = {}) => ({
  watch: finiteNumber(thresholds?.watch) ?? fallback.watch ?? null,
  high: finiteNumber(thresholds?.high) ?? fallback.high ?? null,
});

const maxThresholdValue = (thresholds, fallbackMax) =>
  finiteNumber(thresholds?.high) ??
  finiteNumber(thresholds?.watch) ??
  fallbackMax;

const thresholdFillPercent = (value, thresholds, fallbackMax) => {
  const numericValue = finiteNumber(value);
  const maxValue = maxThresholdValue(thresholds, fallbackMax);
  if (numericValue === null || !Number.isFinite(maxValue) || maxValue <= 0) {
    return 0;
  }
  return Math.round(clamp((numericValue / maxValue) * 100, 0, 100));
};

const levelFromThresholds = (value, thresholds, fallback = "normal") => {
  const numericValue = finiteNumber(value);
  if (numericValue === null) return fallback;
  if (Number.isFinite(thresholds?.high) && numericValue >= thresholds.high) {
    return "high";
  }
  if (Number.isFinite(thresholds?.watch) && numericValue >= thresholds.watch) {
    return "watch";
  }
  return "normal";
};

const buildApiMemoryDetail = (rssMb, heapPercent) => {
  if (rssMb !== null && heapPercent !== null) {
    return `API RSS ${formatMetric(rssMb, "M")} / heap ${formatMetric(heapPercent, "%")}`;
  }
  if (rssMb !== null) return `API RSS ${formatMetric(rssMb, "M")}`;
  if (heapPercent !== null) return `API heap ${formatMetric(heapPercent, "%")}`;
  return "API --";
};

const buildCacheLabel = (queryCount) =>
  queryCount !== null ? `Cache ${formatMetric(queryCount)}` : "Cache --";

const buildCacheDetail = (queryCount, heavyQueryCount) => {
  if (queryCount === null && heavyQueryCount === null) return "Cache --";
  const queryLabel =
    queryCount !== null ? `${formatMetric(queryCount)} queries` : "-- queries";
  const heavyLabel =
    heavyQueryCount !== null ? `${formatMetric(heavyQueryCount)} heavy` : "-- heavy";
  return `Cache ${queryLabel} / ${heavyLabel}`;
};

const buildBrowserMemoryDetail = (memoryMb, limitMb) => {
  if (memoryMb === null && limitMb === null) return "Browser --";
  if (memoryMb !== null && limitMb !== null) {
    return `Browser ${formatMetric(memoryMb, "M")} / limit ${formatMetric(limitMb, "M")}`;
  }
  if (memoryMb !== null) return `Browser ${formatMetric(memoryMb, "M")}`;
  return `Browser limit ${formatMetric(limitMb, "M")}`;
};

const readBrowserMemoryLimitMb = (signal) =>
  finiteNumber(signal?.browserMemoryLimitMb) ??
  (Number.isFinite(Number(signal?.measurement?.memory?.jsHeapSizeLimit))
    ? Number(signal.measurement.memory.jsHeapSizeLimit) / 1024 / 1024
    : null);

const readApiRssMb = (signal) =>
  finiteNumber(signal?.apiRssMb) ?? finiteNumber(signal?.server?.rssMb);

const miniTrackStyle = () => ({
  position: "relative",
  display: "block",
  width: "100%",
  minWidth: dim(CLUSTER_BAR_WIDTH),
  height: dim(CLUSTER_BAR_HEIGHT),
  borderRadius: dim(RADII.pill),
  background: `${cssColorMix(CSS_COLOR.textMuted, 12)}`,
  overflow: "hidden",
});

const miniFillStyle = (bar) => ({
  position: "absolute",
  inset: 0,
  width: `${bar.fillPercent}%`,
  minWidth: bar.fillPercent > 0 ? dim(2) : 0,
  background: pressureTone(bar.level),
  opacity: 0.92,
  transition: "width var(--ra-motion-standard) ease, opacity var(--ra-motion-standard) ease",
});

const miniLabelStyle = (bar, showLabels) => ({
  color: pressureTone(bar.level),
  fontSize: textSize("caption"),
  fontFamily: T.sans,
  fontWeight: FONT_WEIGHTS.medium,
  fontVariantNumeric: "tabular-nums",
  letterSpacing: 0,
  whiteSpace: "nowrap",
  maxWidth: showLabels ? undefined : 0,
  opacity: showLabels ? 1 : 0,
  overflow: "hidden",
});

const sourceNumber = (value) => {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const firstSourceNumber = (...values) => {
  for (const value of values) {
    const number = sourceNumber(value);
    if (number !== null) return number;
  }
  return null;
};

const formatSourceCount = (value) =>
  Number.isFinite(value) ? Math.round(value).toLocaleString() : "--";

const timestampMs = (value) => {
  const timestamp = value ? Date.parse(String(value)) : Number.NaN;
  return Number.isFinite(timestamp) ? timestamp : null;
};

const formatCompactDuration = (durationMs) => {
  if (durationMs == null || durationMs === "") return null;
  const ms = Number(durationMs);
  if (ms === null) return null;
  if (!Number.isFinite(ms)) return null;
  if (ms < 1_000) return "now";
  if (ms < 60_000) return `${Math.round(ms / 1_000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${Math.round(ms / 3_600_000)}h`;
};

const formatCompactAge = (durationMs) => {
  const duration = formatCompactDuration(durationMs);
  return duration ? `${duration} ago` : null;
};

const resolveLiveAgeMs = ({ lastMessageAt, lastMessageAgeMs, observedAt, nowMs }) => {
  const now = sourceNumber(nowMs);
  const messageTimestamp = timestampMs(lastMessageAt);
  if (now !== null && messageTimestamp !== null) {
    return Math.max(0, now - messageTimestamp);
  }
  const baseAge = sourceNumber(lastMessageAgeMs);
  if (baseAge === null) {
    return null;
  }
  const observedTimestamp = timestampMs(observedAt);
  if (now !== null && observedTimestamp !== null) {
    return Math.max(0, baseAge + now - observedTimestamp);
  }
  return baseAge;
};

const streamAgeLevel = (ageMs, fallback = "normal") => {
  if (!Number.isFinite(ageMs)) return fallback;
  if (ageMs >= 60_000) return "high";
  if (ageMs >= 15_000) return "watch";
  return fallback;
};

const streamAgeFillPercent = (ageMs, fallbackPercent) => {
  const ms = sourceNumber(ageMs);
  if (ms === null) return fallbackPercent;
  return Math.round(clamp((ms / 60_000) * 100, 4, 100));
};

const sourceLevelFromLineUsage = ({ used, cap, limited }) => {
  if (!Number.isFinite(used) || !Number.isFinite(cap) || cap <= 0) {
    return "normal";
  }
  if (limited) {
    return "high";
  }
  return "normal";
};

const buildIbkrSourcePressureBar = (runtimeControl) => {
  const lineUsage = runtimeControl?.lineUsage || {};
  const bridge = lineUsage.bridge || {};
  const allocation = lineUsage.allocation || {};
  const used = sourceNumber(bridge.used);
  const cap = firstSourceNumber(bridge.effectiveCap, bridge.cap);
  const computedFree =
    Number.isFinite(used) && Number.isFinite(cap) ? Math.max(0, cap - used) : null;
  const free = firstSourceNumber(bridge.free, computedFree);
  const state = String(
    bridge.streamState || lineUsage.pressure?.state || "",
  ).toLowerCase();
  const limited =
    Number(lineUsage.warnings) > 0 ||
    state.includes("limited") ||
    state.includes("backoff") ||
    state.includes("stalled");
  const fillPercent =
    Number.isFinite(used) && Number.isFinite(cap) && cap > 0
      ? Math.round(clamp((used / cap) * 100, 0, 100))
      : 0;
  const tradeOptionsChainReserveLineCount = firstSourceNumber(
    allocation.tradeOptionsChainReserveLineCount,
    lineUsage.pressure?.tradeOptionsChainReserveLineCount,
  );
  const tradeOptionsChainReserveDetail =
    Number.isFinite(tradeOptionsChainReserveLineCount) &&
    tradeOptionsChainReserveLineCount > 0
      ? ` · ${formatSourceCount(tradeOptionsChainReserveLineCount)} ${TRADE_OPTIONS_CHAIN_LABEL} active`
      : "";
  const level = sourceLevelFromLineUsage({ used, cap, limited });
  const hasRatio = Number.isFinite(used) && Number.isFinite(cap);
  const label = hasRatio
    ? `IBKR ${formatSourceCount(used)}/${formatSourceCount(cap)}`
    : "IBKR --";
  const detail = hasRatio
    ? `IBKR ${formatSourceCount(used)} of ${formatSourceCount(cap)}${
        Number.isFinite(free) ? ` · ${formatSourceCount(free)} free` : ""
      }${tradeOptionsChainReserveDetail}`
    : "IBKR line usage unavailable";

  return {
    key: "ibkr",
    level,
    fillPercent,
    label,
    detail,
  };
};

const normalizeProviderStatus = (status) =>
  String(status || "").trim().toLowerCase().replaceAll("_", "-");

const providerStatusLevel = (status, configured) => {
  const normalized = normalizeProviderStatus(status);
  if (["degraded", "error", "failed"].includes(normalized)) return "high";
  if (["stale", "delayed", "reconnecting", "checking"].includes(normalized)) {
    return "watch";
  }
  if (!configured || ["idle", "unknown", "unconfigured", "missing"].includes(normalized)) {
    return "normal";
  }
  return "normal";
};

const providerStatusLabel = (status, fallback = "--") => {
  const normalized = normalizeProviderStatus(status);
  if (!normalized) return fallback;
  if (normalized === "ok" || normalized === "healthy" || normalized === "ready") {
    return "OK";
  }
  if (normalized === "degraded") return "Degraded";
  if (normalized === "unconfigured" || normalized === "missing") return "--";
  return normalized
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
};

const firstUsefulText = (...values) => {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text && text !== MISSING_VALUE && text !== "--") {
      return text;
    }
  }
  return null;
};

const buildMassiveFeedSummary = (feed, fallbackObservedAt, nowMs) => {
  const ageMs = resolveLiveAgeMs({
    lastMessageAt: feed?.lastMessageAt,
    lastMessageAgeMs: feed?.lastMessageAgeMs,
    observedAt: feed?.observedAt || fallbackObservedAt,
    nowMs,
  });
  const age = formatCompactAge(ageMs);
  const symbols = Number.isFinite(feed?.subscribedSymbolCount)
    ? `${formatSourceCount(feed.subscribedSymbolCount)} sym`
    : null;
  const events = Number.isFinite(feed?.eventCount)
    ? `${formatSourceCount(feed.eventCount)} ev`
    : null;
  const channels = Array.isArray(feed?.subscribedChannels) && feed.subscribedChannels.length
    ? feed.subscribedChannels.join(",")
    : Array.isArray(feed?.availableChannels) && feed.availableChannels.length
      ? `${feed.availableChannels.join(",")} idle`
      : null;
  return [
    feed?.label || "Massive feed",
    channels,
    symbols,
    events,
    age,
  ]
    .filter(Boolean)
    .join(" · ");
};

const buildMassiveSourcePressureBar = (runtimeControl, nowMs) => {
  const massive = runtimeControl?.massive || {};
  const rest = massive.rest || {};
  const websocket = massive.websocket || {};
  const feeds = Array.isArray(websocket.feeds) ? websocket.feeds : [];
  const configured = Boolean(
    massive.configured ||
      massive.providerIdentity === "massive" ||
      rest.status ||
      websocket.status,
  );
  const lastMessageAgeMs = resolveLiveAgeMs({
    lastMessageAt: websocket.lastMessageAt,
    lastMessageAgeMs: websocket.lastMessageAgeMs,
    observedAt: websocket.observedAt || massive.observedAt,
    nowMs,
  });
  const rawStatus =
    normalizeProviderStatus(rest.status) === "degraded" ||
    normalizeProviderStatus(websocket.status) === "degraded"
      ? "degraded"
      : massive.status || rest.status || websocket.status || null;
  const level = maxPressureLevel(
    providerStatusLevel(rawStatus, configured),
    streamAgeLevel(lastMessageAgeMs),
  );
  const statusLabel =
    configured || rawStatus ? providerStatusLabel(massive.label || rawStatus) : "--";
  const issue = firstUsefulText(massive.lastError, rest.lastError, websocket.lastError);
  const age = formatCompactAge(lastMessageAgeMs);
  const mode = websocket.mode || (massive.stocksRealtimeConfigured ? "real-time" : null);
  const feedSummaries = feeds
    .filter(
      (feed) =>
        feed?.configured &&
        (feed.connected ||
          Number(feed.subscribedSymbolCount) > 0 ||
          Number(feed.activeConsumerCount) > 0 ||
          Number(feed.eventCount) > 0),
    )
    .map((feed) => buildMassiveFeedSummary(feed, websocket.observedAt || massive.observedAt, nowMs));
  const activity = firstUsefulText(
    feedSummaries.join(" / "),
    [
      mode ? `WS ${mode}` : null,
      websocket.channelSummary && websocket.channelSummary !== MISSING_VALUE
        ? websocket.channelSummary
        : null,
      Number.isFinite(websocket.subscribedSymbolCount)
        ? `${formatSourceCount(websocket.subscribedSymbolCount)} symbols`
        : null,
      Number.isFinite(websocket.eventCount)
        ? `${formatSourceCount(websocket.eventCount)} events`
        : null,
      age ? `last ${age}` : null,
    ]
      .filter(Boolean)
      .join(" · "),
    Number.isFinite(websocket.subscribedSymbolCount)
      ? `${formatSourceCount(websocket.subscribedSymbolCount)} symbols`
      : null,
    rest.lastRequestSummary,
  );
  const detail = [`Massive ${statusLabel}`, issue || activity]
    .filter(Boolean)
    .join(" · ");
  const fillPercent =
    level === "high"
      ? 88
      : level === "watch"
        ? Math.max(42, streamAgeFillPercent(lastMessageAgeMs, 42))
        : streamAgeFillPercent(lastMessageAgeMs, statusLabel === "OK" ? 18 : 0);
  const compactAge = formatCompactDuration(lastMessageAgeMs);
  const compactStatus = issue
    ? statusLabel
    : Number.isFinite(websocket.subscribedSymbolCount)
      ? `${formatSourceCount(websocket.subscribedSymbolCount)}${
          compactAge ? ` · ${compactAge}` : ""
        }`
      : compactAge || statusLabel;

  return {
    key: "massive",
    level,
    fillPercent,
    label: `Massive ${compactStatus}`,
    detail: detail || "Massive --",
  };
};

export const buildApiSourcePressureBars = (runtimeControl, nowMs) => [
  buildIbkrSourcePressureBar(runtimeControl),
  buildMassiveSourcePressureBar(runtimeControl, nowMs),
];

const buildCachePressureBar = (signal) => {
  const drivers = Array.isArray(signal?.pressureDrivers)
    ? signal.pressureDrivers
    : [];
  const queryCacheDriver =
    findMiniDriver(drivers, "query-cache") || fallbackMiniDriver;
  const queryCountThresholds = normalizeThresholds(
    MEMORY_PRESSURE_THRESHOLDS.queryCache.queryCount,
  );
  const heavyQueryCountThresholds = normalizeThresholds(
    MEMORY_PRESSURE_THRESHOLDS.queryCache.heavyQueryCount,
  );
  const queryCount = finiteNumber(signal?.queryCount);
  const heavyQueryCount = finiteNumber(signal?.heavyQueryCount);
  const queryCountLevel = levelFromThresholds(queryCount, queryCountThresholds);
  const heavyQueryCountLevel = levelFromThresholds(
    heavyQueryCount,
    heavyQueryCountThresholds,
  );
  const level = maxPressureLevel(
    queryCacheDriver.level,
    queryCountLevel,
    heavyQueryCountLevel,
  );

  return {
    key: "cache",
    driverKind: "query-cache",
    level,
    fillPercent: Math.max(
      thresholdFillPercent(queryCount, queryCountThresholds, 240),
      thresholdFillPercent(heavyQueryCount, heavyQueryCountThresholds, 50),
    ),
    label: buildCacheLabel(queryCount),
    detail: buildCacheDetail(queryCount, heavyQueryCount),
  };
};

export const buildFooterPressureBars = ({ signal, runtimeControl, nowMs } = {}) => [
  ...buildApiSourcePressureBars(runtimeControl, nowMs),
  buildCachePressureBar(signal),
];

const ApiSourcePressureTooltip = ({ bar }) => (
  <div
    style={{
      display: "grid",
      gap: sp(3),
      maxWidth: dim(260),
      color: CSS_COLOR.text,
      fontFamily: T.sans,
      fontSize: textSize("caption"),
      lineHeight: 1.35,
    }}
  >
    <div
      style={{
        color: pressureTone(bar.level),
        fontWeight: FONT_WEIGHTS.medium,
      }}
    >
      {bar.label}
    </div>
    <div style={{ color: CSS_COLOR.textSec }}>{bar.detail}</div>
  </div>
);

const MiniPressureBars = ({ bars = [], signal, showLabels = true }) => {
  if (!bars.length) {
    return null;
  }

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
          CLUSTER_BAR_WIDTH * bars.length +
            CLUSTER_BAR_GAP * Math.max(0, bars.length - 1) +
            CLUSTER_PADDING_X * 2,
        ),
        height: dim(18),
        alignSelf: "center",
        overflow: "hidden",
        whiteSpace: "nowrap",
      }}
    >
      {bars.map((bar) => {
        const isApiSource = bar.key === "ibkr" || bar.key === "massive";
        const failurePoint = buildMemoryPressureFailurePoint({
          signal,
          driver: {
            kind: bar.driverKind || bar.key,
            label: bar.label,
            level: bar.level,
            detail: bar.detail,
          },
        });
        const tooltipContent = isApiSource ? (
          <ApiSourcePressureTooltip bar={bar} />
        ) : (
          <FailurePointContent point={failurePoint} compact />
        );
        return (
          <AppTooltip key={bar.key} content={tooltipContent}>
            <span
              className="ra-pressure-mini-slot"
              data-testid={
                isApiSource
                  ? `footer-api-source-pressure-slot-${bar.key}`
                  : `footer-memory-pressure-mini-slot-${bar.key}`
              }
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 1fr)",
                gap: dim(CLUSTER_LABEL_GAP),
                height: "100%",
                minWidth: dim(CLUSTER_BAR_WIDTH),
                maxWidth: dim(78),
              }}
            >
              <span aria-hidden="true" style={miniTrackStyle(bar)}>
                <span
                  data-testid={
                    isApiSource
                      ? `footer-api-source-pressure-fill-${bar.key}`
                      : `footer-memory-pressure-mini-fill-${bar.key}`
                  }
                  style={miniFillStyle(bar)}
                />
              </span>
              <span className="ra-pressure-mini-label" style={miniLabelStyle(bar, showLabels)}>
                {bar.label || bar.detail}
              </span>
            </span>
          </AppTooltip>
        );
      })}
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
    buildBrowserMemoryDetail(
      finiteNumber(signal?.browserMemoryMb),
      readBrowserMemoryLimitMb(signal),
    ),
    buildApiMemoryDetail(readApiRssMb(signal), finiteNumber(signal?.apiHeapUsedPercent)),
    buildCacheDetail(finiteNumber(signal?.queryCount), finiteNumber(signal?.heavyQueryCount)),
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

const useFooterPressureClock = () => {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }
    const interval = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1_000);
    return () => window.clearInterval(interval);
  }, []);

  return nowMs;
};

export const FooterMemoryPressureIndicator = ({ signal, runtimeControl = null }) => {
  const { preferences } = useMemoryPressurePreferences();
  const [open, setOpen] = useState(false);
  const [diagnosticsPayload, setDiagnosticsPayload] = useState(null);
  const [diagnosticsStatus, setDiagnosticsStatus] = useState("idle");
  const nowMs = useFooterPressureClock();
  const bars = useMemo(
    () => buildFooterPressureBars({ signal, runtimeControl, nowMs }),
    [nowMs, runtimeControl, signal],
  );
  const level = maxPressureLevel(...bars.map((bar) => bar.level));
  const compactTitle = bars.map((bar) => bar.detail).filter(Boolean).join(" | ");
  const title = [compactTitle, buildTitle(signal)].filter(Boolean).join(" | ");
  const model = useMemo(
    () => buildMemoryPressurePopoverModel(signal, diagnosticsPayload),
    [diagnosticsPayload, signal],
  );
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
            maxWidth: "min(72vw, 360px)",
          }}
        >
          <MiniPressureBars
            bars={bars}
            signal={signal}
            showLabels={preferences.showCompactLabel}
          />
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
