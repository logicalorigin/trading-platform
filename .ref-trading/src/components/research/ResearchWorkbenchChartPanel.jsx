import React from "react";
import DraftNumberInput from "../shared/DraftNumberInput.jsx";
import ResearchSpotChart from "./ResearchSpotChart.jsx";
import { B, BORDER, CARD, F, G, M, R, SH1 } from "./insights/shared.jsx";
import {
  ChevronDownIcon,
  ControlButton,
  ControlGroup,
  LinkToggleChip,
  PANEL_HEADER_BACKGROUND,
  PANEL_RADIUS,
  PANEL_VIEWPORT_BACKGROUND,
  SelectionDropdown,
} from "./chartUi.jsx";
import {
  RAYALGO_BAND_PROFILE_OPTIONS,
  RAYALGO_BOS_CONFIRMATION_OPTIONS,
  RAYALGO_INFO_PANEL_POSITION_OPTIONS,
  RAYALGO_INFO_PANEL_SIZE_OPTIONS,
  RAYALGO_MTF_OPTIONS,
  RAYALGO_SESSION_OPTIONS,
  RAYALGO_TIME_HORIZON_OPTIONS,
  resolveBandProfile,
} from "../../research/config/rayalgoSettings.js";
import {
  RAYALGO_BUNDLE_DIRECTION_LABELS,
  RAYALGO_BUNDLE_TIER_LABELS,
} from "../../research/config/rayalgoBundles.js";
import { normalizeSymbolInput } from "./sidebar/shared.jsx";
import {
  INDICATOR_REGISTRY_BY_ID,
  categorizeIndicators,
} from "../../research/chart/indicatorRegistry.js";
import {
  buildRayAlgoAlertJsonExample,
  buildRayAlgoDashboardModel,
  buildRayAlgoPineScriptTemplate,
} from "../../research/rayalgo/presentationModel.js";
import {
  CHART_RANGE_PRESET_OPTIONS,
  CHART_WINDOW_MODE_FULL,
} from "../../research/chart/timeframeModel.js";
import {
  DEFAULT_CHART_TYPE,
  VOLUME_CHART_TYPE,
} from "../../research/chart/volumeChartType.js";

const SPOT_TIMEFRAME_OPTIONS = ["1m", "2m", "5m", "15m", "30m", "1h", "4h", "D", "W"];
const RANGE_OPTIONS = CHART_RANGE_PRESET_OPTIONS;
const INTERVAL_FAVORITES = [
  { value: "auto", label: "Auto" },
  { value: "5m", label: "5m" },
  { value: "15m", label: "15m" },
  { value: "1h", label: "1h" },
  { value: "D", label: "D" },
];
const TIMEFRAME_MENU_SECTIONS = [
  {
    label: "Adaptive",
    options: [{ value: "auto", label: "Auto", detail: "Follow the current range with the best-fit interval." }],
  },
  {
    label: "Intraday",
    options: SPOT_TIMEFRAME_OPTIONS.filter((value) => value.endsWith("m") || value.endsWith("h"))
      .map((value) => ({ value, label: value })),
  },
  {
    label: "Higher",
    options: SPOT_TIMEFRAME_OPTIONS.filter((value) => value === "D" || value === "W")
      .map((value) => ({ value, label: value })),
  },
];
const RANGE_MENU_SECTIONS = [
  {
    label: "Window",
    options: [
      ...RANGE_OPTIONS.map((value) => ({ value, label: value })),
      { value: CHART_WINDOW_MODE_FULL, label: "Full", detail: "Show the full loaded history." },
    ],
  },
];
function getRegimeColor(regime) {
  return regime === "bull" ? G : regime === "bear" ? R : M;
}

function formatWatcherTimestamp(value) {
  if (!Number.isFinite(Number(value))) {
    return "Waiting";
  }
  return new Date(Number(value)).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

function InlineControlSection({ label, children }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        minWidth: 0,
      }}
    >
      <span
        style={{
          fontSize: 10,
          fontFamily: F,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "#94a3b8",
          whiteSpace: "nowrap",
          flexShrink: 0,
        }}
      >
        {label}
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap", minWidth: 0 }}>
        {children}
      </div>
    </div>
  );
}

function ToolbarDivider() {
  return (
    <span
      aria-hidden="true"
      style={{
        width: 1,
        alignSelf: "stretch",
        background: "#e2e8f0",
        opacity: 0.9,
      }}
    />
  );
}

function RuntimeHealthChip({ runtimeHealth }) {
  if (!runtimeHealth?.label) {
    return null;
  }

  const isServer = runtimeHealth.source === "server";
  const background = isServer ? "#fef2f2" : "#fff7ed";
  const border = isServer ? "#fecaca" : "#fed7aa";
  const color = isServer ? "#b91c1c" : "#c2410c";

  return (
    <div
      title={runtimeHealth.title || runtimeHealth.message || runtimeHealth.label}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        minHeight: 24,
        padding: "3px 7px",
        borderRadius: 999,
        border: `1px solid ${border}`,
        background,
        color,
        fontSize: 10,
        fontFamily: F,
        fontWeight: 700,
        letterSpacing: "0.02em",
        whiteSpace: "nowrap",
      }}
    >
      <span>{runtimeHealth.label}</span>
    </div>
  );
}

function SpotSymbolControls({
  marketSymbol,
  setMarketSymbol,
  reloadSpotBars,
  dataSource,
  dataError,
  liveBarCount = 0,
  spotDataMeta = null,
  hasOlderHistory = false,
  isLoadingOlderHistory = false,
  historyLoadMode = "default",
  onRequestOlderHistory = null,
}) {
  const sourceLabel = dataError
    ? "Spot error"
    : dataSource === "loading"
      ? (liveBarCount > 0 ? "Refreshing" : "Loading")
      : dataSource === "massive"
        ? "Massive"
        : dataSource === "market"
          ? "Broker"
          : "Unavailable";
  const historyLabel = isLoadingOlderHistory
    ? "Loading..."
    : historyLoadMode === "user-expanded"
      ? (hasOlderHistory ? "More History" : "Expanded")
      : "Older History";

  return (
    <>
      <input
        value={marketSymbol}
        onChange={(event) => {
          if (typeof setMarketSymbol === "function") {
            setMarketSymbol(normalizeSymbolInput(event.target.value) || "SPY");
          }
        }}
        placeholder="SPY"
        style={{
          width: 68,
          height: 28,
          borderRadius: 8,
          border: `1px solid ${BORDER}`,
          background: "#ffffff",
          padding: "0 8px",
          fontSize: 12,
          fontFamily: F,
          color: "#0f172a",
          textTransform: "uppercase",
        }}
      />
      <ControlButton onClick={() => { if (dataSource !== "loading") { reloadSpotBars?.(); } }}>
        {dataSource === "loading" ? "Loading" : "Reload"}
      </ControlButton>
      {(hasOlderHistory || isLoadingOlderHistory) ? (
        <ControlButton
          active={historyLoadMode === "user-expanded" || isLoadingOlderHistory}
          onClick={() => {
            if (!isLoadingOlderHistory) {
              onRequestOlderHistory?.();
            }
          }}
        >
          {historyLabel}
        </ControlButton>
      ) : null}
      <div
        title={dataError || spotDataMeta?.source || sourceLabel}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          minHeight: 28,
          padding: "4px 8px",
          borderRadius: 999,
          border: `1px solid ${dataError ? "#fed7aa" : "#dbeafe"}`,
          background: dataError ? "#fff7ed" : "#eff6ff",
          color: dataError ? "#c2410c" : "#2563eb",
          fontSize: 10,
          fontFamily: F,
          fontWeight: 700,
          letterSpacing: "0.04em",
          whiteSpace: "nowrap",
        }}
      >
        <span>{sourceLabel}</span>
        {liveBarCount > 0 ? <span style={{ color: dataError ? "#9a3412" : "#1d4ed8" }}>{liveBarCount}</span> : null}
        {spotDataMeta?.stale ? <span style={{ color: dataError ? "#9a3412" : "#1d4ed8" }}>stale</span> : null}
      </div>
    </>
  );
}

function OverlayPopupButton({ label, value, active = false, open = false, onToggle, children }) {
  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        onClick={onToggle}
        aria-haspopup="menu"
        aria-expanded={open}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 7,
          minHeight: 28,
          padding: "4px 9px",
          borderRadius: 8,
          border: `1px solid ${open || active ? `${B}30` : "transparent"}`,
          background: open ? `${B}10` : (active ? "#ffffff" : "transparent"),
          color: open || active ? B : "#64748b",
          cursor: "pointer",
          transition: "all 0.12s",
          boxShadow: open ? "0 1px 2px rgba(15,23,42,0.06)" : "none",
        }}
      >
        <span style={{ fontSize: 12, fontFamily: F, fontWeight: active ? 700 : 600 }}>{label}</span>
        <span style={{ fontSize: 11, fontFamily: F, color: open || active ? "#334155" : "#94a3b8" }}>{value}</span>
        <ChevronDownIcon open={open} color={open || active ? B : "#64748b"} />
      </button>
      {open ? (
        <div
          role="menu"
          aria-label={label}
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            zIndex: 8,
            width: 248,
            padding: 10,
            borderRadius: 12,
            border: `1px solid ${BORDER}`,
            background: "#ffffff",
            boxShadow: "0 18px 34px rgba(15,23,42,0.14), 0 4px 10px rgba(15,23,42,0.08)",
          }}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

function IndicatorChip({ indicator, onRemove }) {
  return (
    <button
      type="button"
      onClick={onRemove}
      title={`Remove ${indicator.label}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        minHeight: 26,
        padding: "3px 8px",
        borderRadius: 999,
        border: `1px solid ${B}22`,
        background: "#ffffff",
        color: "#334155",
        cursor: "pointer",
      }}
    >
      <span style={{ fontSize: 11, fontFamily: F, fontWeight: 700 }}>{indicator.shortLabel || indicator.label}</span>
      <span style={{ fontSize: 11, fontFamily: F, color: "#94a3b8", lineHeight: 1 }}>×</span>
    </button>
  );
}

function IndicatorMenuItem({ indicator, onToggle }) {
  const detail = `${indicator.paneType === "lower" ? "Lower pane" : "Price pane"} · ${indicator.pineReference?.tradingViewName || indicator.label}`;
  return (
    <button
      type="button"
      onClick={onToggle}
      style={{
        width: "100%",
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        padding: "8px 10px",
        border: "none",
        borderRadius: 10,
        background: indicator.active ? `${B}10` : "transparent",
        color: "#0f172a",
        cursor: "pointer",
        textAlign: "left",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 16,
          height: 16,
          marginTop: 1,
          borderRadius: 5,
          border: `1px solid ${indicator.active ? `${B}38` : "#dbe2ea"}`,
          background: indicator.active ? `${B}14` : "#ffffff",
          color: indicator.active ? B : "transparent",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 11,
          fontFamily: F,
          fontWeight: 800,
          flexShrink: 0,
        }}
      >
        ✓
      </span>
      <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
        <span style={{ fontSize: 12, fontFamily: F, fontWeight: indicator.active ? 700 : 600, color: indicator.active ? B : "#0f172a" }}>
          {indicator.label}
        </span>
        <span style={{ fontSize: 10, fontFamily: F, color: "#64748b", lineHeight: 1.3 }}>{detail}</span>
      </span>
    </button>
  );
}

function WatcherChip({ watcherModel, autoRankAndPin = false, onToggle, onRunNow }) {
  const modeLabel = autoRankAndPin ? "Auto" : "Manual";
  const isUpdating = watcherModel?.status === "loading" || watcherModel?.status === "refreshing";
  const statusLabel = isUpdating
    ? "Updating"
    : watcherModel?.leader
      ? watcherModel.leader.signalTimeframe
      : "--";
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        minHeight: 24,
        padding: "3px 6px",
        borderRadius: 999,
        border: `1px solid ${autoRankAndPin ? `${B}30` : "#dbeafe"}`,
        background: autoRankAndPin ? `${B}10` : "#eff6ff",
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        style={{
          border: "none",
          background: "transparent",
          color: autoRankAndPin ? B : "#2563eb",
          fontSize: 9,
          fontFamily: F,
          fontWeight: 700,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          cursor: "pointer",
          padding: 0,
        }}
      >
        {modeLabel}
      </button>
      <span style={{ fontSize: 10, fontFamily: F, color: "#334155", fontWeight: 700 }}>Best Fit {statusLabel}</span>
      <button
        type="button"
        onClick={onRunNow}
        style={{
          border: "none",
          background: "transparent",
          color: "#64748b",
          fontSize: 10,
          fontFamily: F,
          cursor: "pointer",
          padding: 0,
        }}
      >
        Scan
      </button>
    </div>
  );
}

function MiniField({ label, value, step = "1", onChange, min = undefined }) {
  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span style={{ fontSize: 11, fontFamily: F, color: "#64748b", whiteSpace: "nowrap" }}>{label}</span>
      <DraftNumberInput
        value={value}
        onCommit={onChange}
        step={step}
        min={min}
        style={{
          width: step === "0.05" ? 72 : 60,
          height: 28,
          borderRadius: 8,
          border: `1px solid ${BORDER}`,
          background: "#ffffff",
          padding: "0 8px",
          fontSize: 12,
          fontFamily: F,
          color: "#0f172a",
        }}
      />
    </label>
  );
}

function MiniSelect({ label, value, options = [], onChange, width = 102 }) {
  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span style={{ fontSize: 11, fontFamily: F, color: "#64748b", whiteSpace: "nowrap" }}>{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        style={{
          width,
          height: 28,
          borderRadius: 8,
          border: `1px solid ${BORDER}`,
          background: "#ffffff",
          padding: "0 8px",
          fontSize: 12,
          fontFamily: F,
          color: "#0f172a",
        }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function DashboardStripPill({ label, value, tone = "#0f172a", emphasis = false, title = "", surface = "light" }) {
  const darkSurface = surface === "dark";
  return (
    <span
      title={title || `${label} ${value}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        minWidth: 0,
        maxWidth: "100%",
        height: 24,
        padding: "0 8px",
        borderRadius: 999,
        border: darkSurface
          ? `1px solid ${emphasis ? `${tone}4d` : "rgba(148,163,184,0.22)"}`
          : `1px solid ${emphasis ? `${tone}2e` : "rgba(226,232,240,0.92)"}`,
        background: darkSurface
          ? (emphasis ? "rgba(15,23,42,0.96)" : "rgba(15,23,42,0.78)")
          : (emphasis ? `${tone}10` : "rgba(255,255,255,0.9)"),
        boxShadow: darkSurface ? "none" : (emphasis ? "none" : "inset 0 1px 0 rgba(255,255,255,0.6)"),
        whiteSpace: "nowrap",
        overflow: "hidden",
      }}
    >
      <span style={{ fontSize: 9, fontFamily: F, letterSpacing: "0.08em", textTransform: "uppercase", color: darkSurface ? "rgba(191,219,254,0.78)" : "#94a3b8", flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 11, fontFamily: F, fontWeight: 800, color: tone, overflow: "hidden", textOverflow: "ellipsis" }}>{value}</span>
    </span>
  );
}

function RayAlgoDashboardCard({ dashboardModel, selectedTradeId = null, toastVisible = false }) {
  void selectedTradeId;
  if (!dashboardModel?.visible) {
    return null;
  }

  const top = toastVisible ? 8 : 8;
  const alignRight = dashboardModel.position === "top_right";
  const mtfBlocks = Array.isArray(dashboardModel.mtfBlocks) ? dashboardModel.mtfBlocks : [];
  const mtfRequired = mtfBlocks.filter((block) => block?.required);
  const mtfPassing = mtfRequired.filter((block) => {
    const value = String(block?.value || "").trim().toLowerCase();
    return value && value !== "idle" && value !== "neutral" && value !== "n/a" && value !== "--";
  });
  const mtfSummary = mtfRequired.length
    ? `${mtfPassing.length}/${mtfRequired.length} req`
    : `${mtfBlocks.length} tf`;
  const mtfTitle = mtfBlocks.map((block) => `${block.label} ${block.timeframe}: ${block.value}`).join(" · ");
  const summaryTitle = [dashboardModel.profileLabel, dashboardModel.summaryLabel].filter(Boolean).join(" · ");

  return (
    <div
      style={{
        position: "absolute",
        top,
        left: alignRight ? "auto" : 8,
        right: alignRight ? 8 : "auto",
        zIndex: 5,
        pointerEvents: "none",
        display: "flex",
        flexDirection: "column",
        alignItems: alignRight ? "flex-end" : "flex-start",
        maxWidth: "min(78%, 940px)",
      }}
    >
      <div
        title={summaryTitle}
        style={{
          display: "grid",
          gap: 6,
          minWidth: 244,
          padding: "8px",
          borderRadius: 14,
          border: "1px solid rgba(148,163,184,0.22)",
          background: "rgba(15,23,42,0.82)",
          boxShadow: "0 14px 32px rgba(2,6,23,0.26)",
          backdropFilter: "blur(10px)",
        }}
      >
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            minWidth: 0,
            maxWidth: 260,
            padding: "0 2px 0 2px",
          }}
        >
          <span style={{ fontSize: 9, fontFamily: F, letterSpacing: "0.08em", textTransform: "uppercase", color: "#7dd3fc", fontWeight: 800, flexShrink: 0 }}>
            RayAlgo
          </span>
          <span style={{ fontSize: 11, fontFamily: F, fontWeight: 800, color: "#e2e8f0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {dashboardModel.profileLabel}
          </span>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, maxWidth: 320 }}>
          <DashboardStripPill
            label="Trend"
            value={dashboardModel.trend.label}
            tone={dashboardModel.trend.tone}
            emphasis
            surface="dark"
            title={[dashboardModel.trend.label, dashboardModel.trend.detail].filter(Boolean).join(" · ")}
          />
          <DashboardStripPill
            label="ADX"
            value={dashboardModel.adx.label}
            tone={dashboardModel.adx.tone}
            surface="dark"
            title={dashboardModel.adx.detail}
          />
          <DashboardStripPill
            label="VOL"
            value={dashboardModel.volume.label}
            tone={dashboardModel.volume.tone}
            surface="dark"
            title={dashboardModel.volume.detail}
          />
          <DashboardStripPill
            label="Risk"
            value={dashboardModel.risk.label}
            tone={dashboardModel.risk.tone}
            surface="dark"
            title={dashboardModel.risk.detail}
          />
          <DashboardStripPill
            label="MTF"
            value={mtfSummary}
            tone={mtfRequired.length && mtfPassing.length === mtfRequired.length ? "#22c55e" : "#cbd5e1"}
            surface="dark"
            title={mtfTitle}
          />
        </div>
      </div>
    </div>
  );
}
function CodePreviewCard({ title, subtitle, code, onCopy, copyLabel = "Copy" }) {
  return (
    <div
      style={{
        minWidth: 0,
        border: `1px solid ${BORDER}`,
        borderRadius: 12,
        background: "#ffffff",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 8,
          padding: "10px 12px",
          borderBottom: `1px solid ${BORDER}`,
          background: "#f8fafc",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12, fontFamily: F, fontWeight: 800, color: "#0f172a" }}>{title}</div>
          {subtitle ? (
            <div style={{ marginTop: 2, fontSize: 11, fontFamily: F, color: "#64748b", lineHeight: 1.35 }}>{subtitle}</div>
          ) : null}
        </div>
        <ControlButton onClick={onCopy}>{copyLabel}</ControlButton>
      </div>
      <pre
        style={{
          margin: 0,
          padding: "12px 12px 13px",
          maxHeight: 260,
          overflow: "auto",
          background: "#ffffff",
          color: "#0f172a",
          fontSize: 10,
          lineHeight: 1.45,
          fontFamily: "'JetBrains Mono', monospace",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {code}
      </pre>
    </div>
  );
}

function formatBundleMetric(value, formatter = null) {
  if (!Number.isFinite(Number(value))) {
    return "--";
  }
  const numeric = Number(value);
  return typeof formatter === "function" ? formatter(numeric) : numeric.toFixed(2);
}

function RayAlgoTierPill({ tier = "test" }) {
  const normalizedTier = String(tier || "test").trim().toLowerCase();
  const styles = normalizedTier === "core"
    ? { background: "#dcfce7", color: "#166534", borderColor: "#86efac" }
    : normalizedTier === "experimental"
      ? { background: "#ffedd5", color: "#c2410c", borderColor: "#fdba74" }
      : { background: "#e0f2fe", color: "#0f766e", borderColor: "#7dd3fc" };
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        minHeight: 22,
        padding: "0 8px",
        borderRadius: 999,
        border: `1px solid ${styles.borderColor}`,
        background: styles.background,
        color: styles.color,
        fontSize: 10,
        fontFamily: F,
        fontWeight: 800,
        letterSpacing: "0.05em",
        textTransform: "uppercase",
        whiteSpace: "nowrap",
      }}
    >
      {RAYALGO_BUNDLE_TIER_LABELS[normalizedTier] || "Test"}
    </span>
  );
}

function RayAlgoSuggestionPill({ tier = "test" }) {
  const normalizedTier = String(tier || "test").trim().toLowerCase();
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        minHeight: 22,
        padding: "0 8px",
        borderRadius: 999,
        border: "1px dashed #cbd5e1",
        background: "#f8fafc",
        color: "#475569",
        fontSize: 10,
        fontFamily: F,
        fontWeight: 800,
        letterSpacing: "0.05em",
        textTransform: "uppercase",
        whiteSpace: "nowrap",
      }}
    >
      Suggest {RAYALGO_BUNDLE_TIER_LABELS[normalizedTier] || "Test"}
    </span>
  );
}

function RayAlgoSummaryMetric({ label, value }) {
  return (
    <div
      style={{
        minWidth: 0,
        padding: "7px 8px",
        borderRadius: 10,
        border: "1px solid #e2e8f0",
        background: "#ffffff",
        display: "flex",
        flexDirection: "column",
        gap: 3,
      }}
    >
      <span style={{ fontSize: 9, fontFamily: F, letterSpacing: "0.08em", textTransform: "uppercase", color: "#94a3b8" }}>{label}</span>
      <span style={{ fontSize: 12, fontFamily: F, fontWeight: 800, color: "#0f172a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{value}</span>
    </div>
  );
}

function RayAlgoTagRow({ label, items = [] }) {
  if (!Array.isArray(items) || !items.length) {
    return null;
  }
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      <span style={{ fontSize: 10, fontFamily: F, letterSpacing: "0.06em", textTransform: "uppercase", color: "#94a3b8", whiteSpace: "nowrap" }}>{label}</span>
      {items.map((item) => (
        <span
          key={`${label}-${item}`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            minHeight: 24,
            padding: "0 8px",
            borderRadius: 999,
            border: "1px solid #dbeafe",
            background: "#eff6ff",
            color: "#1d4ed8",
            fontSize: 11,
            fontFamily: F,
            fontWeight: 700,
            whiteSpace: "nowrap",
          }}
        >
          {item}
        </span>
      ))}
    </div>
  );
}

function RayAlgoValidationChecklist({ validation = null }) {
  const checks = Array.isArray(validation?.checks) ? validation.checks : [];
  if (!checks.length) {
    return null;
  }
  return (
    <div
      style={{
        display: "grid",
        gap: 6,
        padding: "10px 12px",
        borderRadius: 12,
        border: "1px solid #dbeafe",
        background: "#ffffff",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 11, fontFamily: F, fontWeight: 800, color: "#0f172a" }}>Validation</span>
        <span style={{ fontSize: 10, fontFamily: F, color: "#64748b" }}>{validation?.statusText || "Awaiting validation"}</span>
      </div>
      {checks.map((check) => (
        <div
          key={check.key}
          style={{
            display: "grid",
            gridTemplateColumns: "auto 1fr auto",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span
            aria-hidden="true"
            style={{
              width: 8,
              height: 8,
              borderRadius: 999,
              background: check.passed ? "#10b981" : "#f59e0b",
              boxShadow: check.passed ? "0 0 0 4px rgba(16,185,129,0.12)" : "0 0 0 4px rgba(245,158,11,0.12)",
            }}
          />
          <span style={{ fontSize: 11, fontFamily: F, color: "#0f172a", minWidth: 0 }}>{check.label}</span>
          <span style={{ fontSize: 10, fontFamily: F, color: "#64748b", whiteSpace: "nowrap" }}>{check.detail || "--"}</span>
        </div>
      ))}
    </div>
  );
}

function RayAlgoEvidenceTable({ title, rows = [], tone = "#2563eb" }) {
  if (!Array.isArray(rows) || !rows.length) {
    return null;
  }
  return (
    <div
      style={{
        minWidth: 0,
        borderRadius: 12,
        border: "1px solid #dbeafe",
        background: "#ffffff",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.4fr repeat(4, minmax(56px, auto))",
          gap: 8,
          padding: "9px 12px",
          background: "#f8fafc",
          borderBottom: "1px solid #e2e8f0",
          alignItems: "center",
        }}
      >
        <span style={{ fontSize: 11, fontFamily: F, fontWeight: 800, color: "#0f172a" }}>{title}</span>
        <span style={{ fontSize: 9, fontFamily: F, letterSpacing: "0.06em", textTransform: "uppercase", color: "#94a3b8", textAlign: "right" }}>Trades</span>
        <span style={{ fontSize: 9, fontFamily: F, letterSpacing: "0.06em", textTransform: "uppercase", color: "#94a3b8", textAlign: "right" }}>Exp</span>
        <span style={{ fontSize: 9, fontFamily: F, letterSpacing: "0.06em", textTransform: "uppercase", color: "#94a3b8", textAlign: "right" }}>Win</span>
        <span style={{ fontSize: 9, fontFamily: F, letterSpacing: "0.06em", textTransform: "uppercase", color: "#94a3b8", textAlign: "right" }}>Net</span>
      </div>
      <div style={{ display: "grid" }}>
        {rows.map((row) => (
          <div
            key={`${title}-${row.key}`}
            style={{
              display: "grid",
              gridTemplateColumns: "1.4fr repeat(4, minmax(56px, auto))",
              gap: 8,
              padding: "9px 12px",
              borderBottom: "1px solid #f1f5f9",
              alignItems: "center",
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 11, fontFamily: F, fontWeight: 700, color: "#0f172a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {row.label}
              </div>
              <div style={{ fontSize: 10, fontFamily: F, color: tone }}>
                {formatBundleMetric(row.expectancyR, (value) => `${value.toFixed(2)}R`)} expectancy
              </div>
            </div>
            <span style={{ fontSize: 11, fontFamily: F, color: "#0f172a", textAlign: "right" }}>{formatBundleMetric(row.trades, (value) => value.toFixed(0))}</span>
            <span style={{ fontSize: 11, fontFamily: F, color: "#0f172a", textAlign: "right" }}>{formatBundleMetric(row.expectancyR, (value) => `${value.toFixed(2)}R`)}</span>
            <span style={{ fontSize: 11, fontFamily: F, color: "#0f172a", textAlign: "right" }}>{formatBundleMetric(row.winRatePct, (value) => `${value.toFixed(1)}%`)}</span>
            <span style={{ fontSize: 11, fontFamily: F, color: "#0f172a", textAlign: "right" }}>{formatBundleMetric(row.netReturnPct, (value) => `${value.toFixed(1)}%`)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function RayAlgoBundleChip({ bundle, active = false, selected = false, onClick }) {
  const directionTone = bundle?.direction === "put" ? "#b45309" : "#2563eb";
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "inline-flex",
        flexDirection: "column",
        alignItems: "flex-start",
        gap: 3,
        minWidth: 0,
        padding: "8px 10px",
        borderRadius: 12,
        border: `1px solid ${active ? `${directionTone}55` : selected ? `${B}38` : "#e2e8f0"}`,
        background: active ? `${directionTone}10` : selected ? `${B}10` : "#ffffff",
        color: "#0f172a",
        cursor: "pointer",
        textAlign: "left",
      }}
    >
      <span style={{ fontSize: 11, fontFamily: F, fontWeight: 800, color: active ? directionTone : "#0f172a" }}>{bundle?.label}</span>
      <span style={{ fontSize: 10, fontFamily: F, color: "#64748b", lineHeight: 1.3 }}>
        {bundle?.playbook?.horizonLabel || bundle?.timeframeFamily} · {bundle?.playbook?.dteLabel || "--"}
      </span>
    </button>
  );
}

function RayAlgoSettingsModal({
  visible = false,
  modalRef = null,
  previewBundle = null,
  activeBundle = null,
  isCustom = false,
  onPreviewBundle = null,
  onApplyBundle = null,
  onApplyRayOnly = null,
  onRevertBundle = null,
  onSaveVariant = null,
  onSetBundleTier = null,
  onClose = null,
  currentBundles = [],
  rayalgoBundleEvaluation = null,
  watcherLeaderLabel = "",
  isRayAlgoStrategy = false,
  watcherModel = null,
  rayalgoWatcherSettings = null,
  setRayalgoWatcher = null,
  runtimeHealth = null,
  controlMarketSymbol = "SPY",
  setMarketSymbol = null,
  reloadSpotBars = null,
  dataSource = "idle",
  dataError = null,
  liveBarCount = 0,
  spotDataMeta = null,
  hasOlderHistory = false,
  isLoadingOlderHistory = false,
  historyLoadMode = "default",
  onRequestOlderHistory = null,
  timeframeTriggerValue = "",
  candleTf = "auto",
  effectiveTf = "5m",
  timeframeMenuSections = [],
  openMenu = null,
  setOpenMenu = null,
  applySpotInterval = null,
  windowTriggerLabel = "Window",
  windowTriggerValue = "1W",
  windowMenuValue = "1W",
  chartWindowMode = "default",
  applySpotWindowPreset = null,
  resetSpotChartWindow = null,
  showResetSpotWindow = false,
  indicatorOverlays = null,
  signalTimeframeOptions = [],
  isSignalFollowingChart = true,
  resolvedSignalTf = null,
  resolvedShadingTf = null,
  signalTimeframeState = null,
  shadingTimeframeState = null,
  setSignalOverlay = null,
  setShadingOverlay = null,
  executionFidelity = "sub_candle",
  setExecutionFidelity = null,
  rayalgoSettings = null,
  updateRayAlgoSettings = null,
  toggleRayAlgoSession = null,
  activeBandProfile = null,
  pineScriptTemplate = "",
  copyTextToClipboard = null,
}) {
  if (!visible) {
    return null;
  }

  const displayBundle = previewBundle || activeBundle || null;
  const runtimeBundleEvaluation = displayBundle?.id && displayBundle.id === activeBundle?.id
    ? rayalgoBundleEvaluation
    : null;
  const groupedBundles = ["call", "put"].map((direction) => ({
    direction,
    label: RAYALGO_BUNDLE_DIRECTION_LABELS[direction] || direction,
    items: currentBundles.filter((bundle) => bundle.direction === direction),
  })).filter((group) => group.items.length > 0);
  const bundleStats = runtimeBundleEvaluation?.summary || displayBundle?.evaluation || {};
  const bundleTier = displayBundle?.evaluation?.tier || "test";
  const playbook = displayBundle?.playbook || {};
  const evidenceReport = runtimeBundleEvaluation?.report || null;
  const showingActiveBundle = displayBundle?.id && displayBundle.id === activeBundle?.id;
  const displayBundleIsCustom = Boolean(showingActiveBundle && isCustom);
  let tierHint = "";
  let tierPrimaryAction = null;
  let tierSecondaryAction = null;

  if (displayBundle) {
    if (displayBundleIsCustom) {
      tierHint = "Save a variant or revert before changing bundle tier.";
    } else if (bundleTier === "test") {
      if (bundleStats.experimentalEligible) {
        tierPrimaryAction = { tier: "experimental", label: "Promote Experimental", tone: "accent" };
        tierHint = "Validation thresholds are met for experimental promotion.";
      } else {
        tierHint = "Needs 25 trades, positive holdout expectancy, PF > 1, and acceptable drawdown.";
      }
    } else if (bundleTier === "experimental") {
      if (bundleStats.coreEligible) {
        tierPrimaryAction = { tier: "core", label: "Approve Core", tone: "dark" };
        tierHint = "Manual core approval is unlocked for this bundle.";
      } else {
        tierHint = "Core needs 75 trades, strong holdout, and max drawdown within 25%.";
      }
      tierSecondaryAction = { tier: "test", label: "Reset Test", tone: "accent" };
    } else if (bundleTier === "core") {
      tierHint = "Core status is manual. Downgrade it if the evidence no longer holds up.";
      tierSecondaryAction = { tier: "experimental", label: "Back To Experimental", tone: "accent" };
    }
  }

  return (
    <div
      style={{
        position: "absolute",
        inset: 8,
        zIndex: 7,
        pointerEvents: "none",
      }}
    >
      <div
        ref={modalRef}
        style={{
          marginLeft: "auto",
          width: "min(640px, 100%)",
          maxHeight: "100%",
          overflow: "hidden",
          borderRadius: 18,
          border: "1px solid rgba(191,219,254,0.92)",
          background: "linear-gradient(180deg, rgba(248,250,252,0.97) 0%, rgba(255,255,255,0.98) 100%)",
          boxShadow: "0 26px 52px rgba(15,23,42,0.20)",
          backdropFilter: "blur(12px)",
          display: "flex",
          flexDirection: "column",
          pointerEvents: "auto",
        }}
      >
        <div
          style={{
            padding: "14px 16px 12px",
            borderBottom: "1px solid #dbeafe",
            background: "linear-gradient(180deg, rgba(239,246,255,0.95) 0%, rgba(248,250,252,0.92) 100%)",
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div style={{ minWidth: 0, flex: "1 1 300px" }}>
              <div style={{ fontSize: 11, fontFamily: F, letterSpacing: "0.08em", textTransform: "uppercase", color: "#2563eb", fontWeight: 800 }}>
                RayAlgo Bundle Lab
              </div>
              <div style={{ marginTop: 3, fontSize: 16, fontFamily: F, fontWeight: 800, color: "#0f172a" }}>
                {displayBundle?.label || "RayAlgo Settings"}
              </div>
              <div style={{ marginTop: 3, fontSize: 12, fontFamily: F, color: "#64748b", lineHeight: 1.45 }}>
                {displayBundle?.playbook?.note || watcherLeaderLabel}
              </div>
              {!isRayAlgoStrategy ? (
                <div style={{ marginTop: 5, fontSize: 11, fontFamily: F, color: "#b45309" }}>
                  Current strategy is not RayAlgo. Bundle apply will switch the Research strategy back to RayGun.
                </div>
              ) : null}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <RayAlgoTierPill tier={bundleTier} />
              {bundleStats.tierSuggestion && bundleStats.tierSuggestion !== bundleTier ? (
                <RayAlgoSuggestionPill tier={bundleStats.tierSuggestion} />
              ) : null}
              {displayBundleIsCustom ? (
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    minHeight: 22,
                    padding: "0 8px",
                    borderRadius: 999,
                    border: "1px solid #fdba74",
                    background: "#ffedd5",
                    color: "#c2410c",
                    fontSize: 10,
                    fontFamily: F,
                    fontWeight: 800,
                    letterSpacing: "0.05em",
                    textTransform: "uppercase",
                  }}
                >
                  Custom
                </span>
              ) : null}
              <ControlButton onClick={() => onApplyBundle?.(displayBundle)}>Load Full</ControlButton>
              <ControlButton onClick={() => onApplyRayOnly?.(displayBundle)}>Ray Only</ControlButton>
              <ControlButton onClick={() => onRevertBundle?.()}>Revert</ControlButton>
              <ControlButton onClick={() => onSaveVariant?.()}>Save Variant</ControlButton>
              {tierPrimaryAction ? (
                <ControlButton
                  active
                  tone={tierPrimaryAction.tone}
                  onClick={() => onSetBundleTier?.(displayBundle, tierPrimaryAction.tier)}
                >
                  {tierPrimaryAction.label}
                </ControlButton>
              ) : null}
              {tierSecondaryAction ? (
                <ControlButton onClick={() => onSetBundleTier?.(displayBundle, tierSecondaryAction.tier)}>
                  {tierSecondaryAction.label}
                </ControlButton>
              ) : null}
              <ControlButton tone="dark" onClick={onClose}>Close</ControlButton>
            </div>
          </div>
          {displayBundle && tierHint ? (
            <div style={{ fontSize: 11, fontFamily: F, color: displayBundleIsCustom ? "#b45309" : "#64748b", lineHeight: 1.4 }}>
              {tierHint}
            </div>
          ) : null}

          {displayBundle ? (
            <div
              style={{
                display: "grid",
                gap: 8,
                border: "1px solid #dbeafe",
                borderRadius: 14,
                background: "rgba(255,255,255,0.88)",
                padding: "10px 12px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 12, fontFamily: F, fontWeight: 800, color: "#0f172a" }}>
                  {playbook.horizonLabel || displayBundle.timeframeFamily}
                </span>
                <span style={{ fontSize: 11, fontFamily: F, color: "#64748b" }}>
                  {displayBundle.symbol} · {displayBundle.direction === "put" ? "Puts" : "Calls"} · {playbook.dteLabel || "--"}
                </span>
                <span style={{ fontSize: 11, fontFamily: F, color: "#64748b" }}>
                  Chart {displayBundle.chartSetup?.candleTf || "--"} · Window {playbook.windowLabel || displayBundle.chartSetup?.chartRange || "--"}
                </span>
                <span style={{ fontSize: 11, fontFamily: F, color: "#64748b" }}>
                  Status {bundleStats.statusText || "Awaiting validation"}
                </span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(96px, 1fr))", gap: 6 }}>
                <RayAlgoSummaryMetric label="Expectancy" value={formatBundleMetric(bundleStats.expectancyR, (value) => `${value.toFixed(2)}R`)} />
                <RayAlgoSummaryMetric label="Drawdown" value={formatBundleMetric(bundleStats.maxDrawdownPct, (value) => `${value.toFixed(1)}%`)} />
                <RayAlgoSummaryMetric label="Win Rate" value={formatBundleMetric(bundleStats.winRatePct, (value) => `${value.toFixed(1)}%`)} />
                <RayAlgoSummaryMetric label="PF" value={formatBundleMetric(bundleStats.profitFactor, (value) => value.toFixed(2))} />
                <RayAlgoSummaryMetric label="Net" value={formatBundleMetric(bundleStats.netReturnPct, (value) => `${value.toFixed(1)}%`)} />
                <RayAlgoSummaryMetric label="Hold" value={formatBundleMetric(bundleStats.avgHoldBars, (value) => `${value.toFixed(1)} bars`)} />
              </div>
              <RayAlgoTagRow label="Sessions" items={bundleStats.sessionBadges} />
              <RayAlgoTagRow label="Regimes" items={bundleStats.regimeBadges} />
            </div>
          ) : null}

          <div style={{ display: "grid", gap: 8 }}>
            {groupedBundles.map((group) => (
              <div key={group.direction} style={{ display: "grid", gap: 6 }}>
                <div style={{ fontSize: 10, fontFamily: F, letterSpacing: "0.08em", textTransform: "uppercase", color: "#94a3b8" }}>
                  {group.label}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 6 }}>
                  {group.items.map((bundle) => (
                    <RayAlgoBundleChip
                      key={bundle.id}
                      bundle={bundle}
                      active={bundle.id === displayBundle?.id}
                      selected={bundle.id === activeBundle?.id}
                      onClick={() => onPreviewBundle?.(bundle.id)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div
          style={{
            padding: "12px 14px 14px",
            overflow: "auto",
            display: "flex",
            flexDirection: "column",
          gap: 10,
          }}
        >
          {displayBundle ? (
            <div
              style={{
                display: "grid",
                gap: 8,
                padding: "10px 12px",
                borderRadius: 14,
                border: "1px solid #dbeafe",
                background: "linear-gradient(180deg, rgba(239,246,255,0.55) 0%, rgba(255,255,255,0.92) 100%)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: 11, fontFamily: F, fontWeight: 800, color: "#0f172a" }}>Bundle Evidence</div>
                  <div style={{ marginTop: 2, fontSize: 11, fontFamily: F, color: "#64748b" }}>
                    {runtimeBundleEvaluation
                      ? isCustom && showingActiveBundle
                        ? "Live backtest evidence for the active custom state."
                        : "Live backtest evidence for the active aligned bundle."
                      : showingActiveBundle
                        ? "Run RayAlgo with this aligned bundle to populate the drilldown."
                        : "Previewing stored bundle summary. Load this bundle to generate live evidence."}
                  </div>
                </div>
                {runtimeBundleEvaluation?.report?.validation?.statusText ? (
                  <span style={{ fontSize: 11, fontFamily: F, fontWeight: 700, color: "#1d4ed8" }}>
                    {runtimeBundleEvaluation.report.validation.statusText}
                  </span>
                ) : null}
              </div>

              {evidenceReport ? (
                <>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8 }}>
                    <div style={{ display: "grid", gap: 6, padding: "10px 12px", borderRadius: 12, border: "1px solid #dbeafe", background: "#ffffff" }}>
                      <span style={{ fontSize: 10, fontFamily: F, letterSpacing: "0.06em", textTransform: "uppercase", color: "#94a3b8" }}>Full Sample</span>
                      <RayAlgoSummaryMetric label="Trades" value={formatBundleMetric(evidenceReport.fullSample?.trades, (value) => value.toFixed(0))} />
                      <RayAlgoSummaryMetric label="Expectancy" value={formatBundleMetric(evidenceReport.fullSample?.expectancyR, (value) => `${value.toFixed(2)}R`)} />
                      <RayAlgoSummaryMetric label="Drawdown" value={formatBundleMetric(evidenceReport.fullSample?.maxDrawdownPct, (value) => `${value.toFixed(1)}%`)} />
                      <RayAlgoSummaryMetric label="PF" value={formatBundleMetric(evidenceReport.fullSample?.profitFactor, (value) => value.toFixed(2))} />
                    </div>
                    <div style={{ display: "grid", gap: 6, padding: "10px 12px", borderRadius: 12, border: "1px solid #dbeafe", background: "#ffffff" }}>
                      <span style={{ fontSize: 10, fontFamily: F, letterSpacing: "0.06em", textTransform: "uppercase", color: "#94a3b8" }}>In Sample</span>
                      <RayAlgoSummaryMetric label="Trades" value={formatBundleMetric(evidenceReport.inSample?.trades, (value) => value.toFixed(0))} />
                      <RayAlgoSummaryMetric label="Expectancy" value={formatBundleMetric(evidenceReport.inSample?.expectancyR, (value) => `${value.toFixed(2)}R`)} />
                      <RayAlgoSummaryMetric label="Drawdown" value={formatBundleMetric(evidenceReport.inSample?.maxDrawdownPct, (value) => `${value.toFixed(1)}%`)} />
                      <RayAlgoSummaryMetric label="PF" value={formatBundleMetric(evidenceReport.inSample?.profitFactor, (value) => value.toFixed(2))} />
                    </div>
                    <div style={{ display: "grid", gap: 6, padding: "10px 12px", borderRadius: 12, border: "1px solid #dbeafe", background: "#ffffff" }}>
                      <span style={{ fontSize: 10, fontFamily: F, letterSpacing: "0.06em", textTransform: "uppercase", color: "#94a3b8" }}>Holdout</span>
                      <RayAlgoSummaryMetric label="Trades" value={formatBundleMetric(evidenceReport.holdout?.trades, (value) => value.toFixed(0))} />
                      <RayAlgoSummaryMetric label="Expectancy" value={formatBundleMetric(evidenceReport.holdout?.expectancyR, (value) => `${value.toFixed(2)}R`)} />
                      <RayAlgoSummaryMetric label="Drawdown" value={formatBundleMetric(evidenceReport.holdout?.maxDrawdownPct, (value) => `${value.toFixed(1)}%`)} />
                      <RayAlgoSummaryMetric label="PF" value={formatBundleMetric(evidenceReport.holdout?.profitFactor, (value) => value.toFixed(2))} />
                    </div>
                  </div>
                  <RayAlgoValidationChecklist validation={evidenceReport.validation} />
                  <div style={{ display: "grid", gap: 8 }}>
                    <RayAlgoEvidenceTable title="Sessions" rows={evidenceReport.sessions} tone="#2563eb" />
                    <RayAlgoEvidenceTable title="Regimes" rows={evidenceReport.regimes} tone="#7c3aed" />
                    <RayAlgoEvidenceTable title="Volatility Buckets" rows={evidenceReport.volatility} tone="#0f766e" />
                  </div>
                </>
              ) : null}
            </div>
          ) : null}

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <ControlGroup label="Spot">
              <SpotSymbolControls
                marketSymbol={controlMarketSymbol}
                setMarketSymbol={setMarketSymbol}
                reloadSpotBars={reloadSpotBars}
                dataSource={dataSource}
                dataError={dataError}
                liveBarCount={liveBarCount}
                spotDataMeta={spotDataMeta}
                hasOlderHistory={hasOlderHistory}
                isLoadingOlderHistory={isLoadingOlderHistory}
                historyLoadMode={historyLoadMode}
                onRequestOlderHistory={onRequestOlderHistory}
              />
            </ControlGroup>

            <ControlGroup label="Display">
              <SelectionDropdown
                label="Interval"
                value={timeframeTriggerValue}
                selectedValue={candleTf === "auto" ? "auto" : candleTf}
                sections={timeframeMenuSections}
                open={openMenu === "timeframe"}
                onToggle={() => setOpenMenu((current) => (current === "timeframe" ? null : "timeframe"))}
                onSelect={(value) => {
                  applySpotInterval?.(value);
                  setOpenMenu(null);
                }}
                width={232}
                compact
              />
              {INTERVAL_FAVORITES.map((option) => (
                <ControlButton
                  key={option.value}
                  active={option.value === "auto" ? candleTf === "auto" : candleTf === option.value}
                  onClick={() => {
                    applySpotInterval?.(option.value);
                    setOpenMenu(null);
                  }}
                >
                  {option.label}
                </ControlButton>
              ))}
              <SelectionDropdown
                label={windowTriggerLabel}
                value={windowTriggerValue}
                selectedValue={windowMenuValue}
                sections={RANGE_MENU_SECTIONS}
                open={openMenu === "range"}
                onToggle={() => setOpenMenu((current) => (current === "range" ? null : "range"))}
                onSelect={(value) => {
                  applySpotWindowPreset?.(value);
                  setOpenMenu(null);
                }}
                width={188}
                emphasis={chartWindowMode === "all" ? "primary" : "secondary"}
                compact
              />
              {showResetSpotWindow ? (
                <ControlButton onClick={() => resetSpotChartWindow?.()}>Reset View</ControlButton>
              ) : null}
              <ControlButton active={Boolean(indicatorOverlays?.signals?.visible)} onClick={() => setSignalOverlay?.({ visible: !indicatorOverlays?.signals?.visible })}>
                {indicatorOverlays?.signals?.visible ? "Signals On" : "Signals Off"}
              </ControlButton>
              <div style={{ fontSize: 11, fontFamily: F, color: isSignalFollowingChart ? "#2563eb" : "#b45309" }}>
                {isSignalFollowingChart
                  ? `Following candle interval · ${resolvedSignalTf || effectiveTf}`
                  : signalTimeframeState?.isCoerced
                    ? `Pinned to ${indicatorOverlays?.signals?.timeframe || "?"} · rendering at ${resolvedSignalTf || "?"}`
                    : `Pinned to ${resolvedSignalTf || indicatorOverlays?.signals?.timeframe || "?"}`}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {signalTimeframeOptions.map((option) => (
                  <ControlButton key={`modal-signal-${option.value}`} active={isSignalFollowingChart ? option.value === "follow_chart" : indicatorOverlays?.signals?.timeframe === option.value} onClick={() => setSignalOverlay?.({ timeframe: option.value })}>
                    {option.label}
                  </ControlButton>
                ))}
              </div>
              {!isSignalFollowingChart ? (
                <ControlButton onClick={() => setSignalOverlay?.({ timeframe: "follow_chart" })}>Reset to Follow</ControlButton>
              ) : null}
              <ControlButton active={rayalgoCandleColorMode === "rayalgo"} onClick={() => setRayalgoCandleColorMode?.("rayalgo")}>
                RayAlgo Colors
              </ControlButton>
              <ControlButton active={rayalgoCandleColorMode === "traditional"} onClick={() => setRayalgoCandleColorMode?.("traditional")}>
                Traditional Colors
              </ControlButton>
              <ControlButton active={Boolean(indicatorOverlays?.shading?.visible)} onClick={() => setShadingOverlay?.({ visible: !indicatorOverlays?.shading?.visible })}>
                {indicatorOverlays?.shading?.visible ? "Shading On" : "Shading Off"}
              </ControlButton>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {signalTimeframeOptions.map((option) => (
                  <ControlButton key={`modal-shading-${option.value}`} active={indicatorOverlays?.shading?.timeframe === option.value} onClick={() => setShadingOverlay?.({ timeframe: option.value })}>
                    {option.label}
                  </ControlButton>
                ))}
              </div>
            </ControlGroup>

            <ControlGroup label="Execution">
              <ControlButton active={executionFidelity === "bar_close"} onClick={() => setExecutionFidelity?.("bar_close")}>Bar Close</ControlButton>
              <ControlButton active={executionFidelity === "sub_candle"} onClick={() => setExecutionFidelity?.("sub_candle")}>Sub-Candle</ControlButton>
              <div style={{ fontSize: 11, fontFamily: F, color: executionFidelity === "sub_candle" ? "#0f766e" : "#64748b" }}>
                {executionFidelity === "sub_candle"
                  ? "Entries and exits use the finer spot tape when available."
                  : "Entries and exits trigger at the signal-bar close."}
              </div>
            </ControlGroup>

            <ControlGroup label="Structure">
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {RAYALGO_TIME_HORIZON_OPTIONS.map((option) => (
                  <ControlButton key={option} active={rayalgoSettings?.marketStructure?.timeHorizon === option} onClick={() => updateRayAlgoSettings?.({ marketStructure: { timeHorizon: option } })}>
                    TH {option}
                  </ControlButton>
                ))}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {RAYALGO_BOS_CONFIRMATION_OPTIONS.map((option) => (
                  <ControlButton key={option.value} active={rayalgoSettings?.marketStructure?.bosConfirmation === option.value} onClick={() => updateRayAlgoSettings?.({ marketStructure: { bosConfirmation: option.value } })}>
                    BOS {option.label}
                  </ControlButton>
                ))}
              </div>
            </ControlGroup>

            <ControlGroup label="Bands">
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {RAYALGO_BAND_PROFILE_OPTIONS.map((profile) => (
                  <ControlButton key={profile.value} active={activeBandProfile?.value === profile.value} onClick={() => updateRayAlgoSettings?.({ bands: profile.settings })}>
                    {profile.label}
                  </ControlButton>
                ))}
              </div>
              <MiniField label="Basis" value={rayalgoSettings?.bands?.basisLength ?? 21} onChange={(value) => updateRayAlgoSettings?.({ bands: { basisLength: value } })} min="1" />
              <MiniField label="ATR" value={rayalgoSettings?.bands?.atrLength ?? 14} onChange={(value) => updateRayAlgoSettings?.({ bands: { atrLength: value } })} min="1" />
              <MiniField label="Smooth" value={rayalgoSettings?.bands?.atrSmoothing ?? 14} onChange={(value) => updateRayAlgoSettings?.({ bands: { atrSmoothing: value } })} min="1" />
              <MiniField label="Mult" value={rayalgoSettings?.bands?.volatilityMultiplier ?? 1.5} onChange={(value) => updateRayAlgoSettings?.({ bands: { volatilityMultiplier: value } })} step="0.05" min="0.1" />
              <ControlButton active={Boolean(rayalgoSettings?.appearance?.waitForBarClose)} onClick={() => updateRayAlgoSettings?.({ appearance: { waitForBarClose: !rayalgoSettings?.appearance?.waitForBarClose } })}>
                {rayalgoSettings?.appearance?.waitForBarClose ? "Close Confirm" : "Wick Confirm"}
              </ControlButton>
            </ControlGroup>

            <ControlGroup label="Confirm">
              <MiniField label="ADX" value={rayalgoSettings?.confirmation?.adxLength ?? 14} onChange={(value) => updateRayAlgoSettings?.({ confirmation: { adxLength: value } })} min="1" />
              <MiniField label="Vol MA" value={rayalgoSettings?.confirmation?.volumeMaLength ?? 20} onChange={(value) => updateRayAlgoSettings?.({ confirmation: { volumeMaLength: value } })} min="1" />
              <MiniSelect label="MTF 1" value={rayalgoSettings?.confirmation?.mtf1 || "15m"} options={RAYALGO_MTF_OPTIONS.map((value) => ({ value, label: value }))} onChange={(value) => updateRayAlgoSettings?.({ confirmation: { mtf1: value } })} />
              <MiniSelect label="MTF 2" value={rayalgoSettings?.confirmation?.mtf2 || "1h"} options={RAYALGO_MTF_OPTIONS.map((value) => ({ value, label: value }))} onChange={(value) => updateRayAlgoSettings?.({ confirmation: { mtf2: value } })} />
              <MiniSelect label="MTF 3" value={rayalgoSettings?.confirmation?.mtf3 || "4h"} options={RAYALGO_MTF_OPTIONS.map((value) => ({ value, label: value }))} onChange={(value) => updateRayAlgoSettings?.({ confirmation: { mtf3: value } })} />
              <ControlButton active={Boolean(rayalgoSettings?.confirmation?.requireMtf1)} onClick={() => updateRayAlgoSettings?.({ confirmation: { requireMtf1: !rayalgoSettings?.confirmation?.requireMtf1 } })}>Req 1</ControlButton>
              <ControlButton active={Boolean(rayalgoSettings?.confirmation?.requireMtf2)} onClick={() => updateRayAlgoSettings?.({ confirmation: { requireMtf2: !rayalgoSettings?.confirmation?.requireMtf2 } })}>Req 2</ControlButton>
              <ControlButton active={Boolean(rayalgoSettings?.confirmation?.requireMtf3)} onClick={() => updateRayAlgoSettings?.({ confirmation: { requireMtf3: !rayalgoSettings?.confirmation?.requireMtf3 } })}>Req 3</ControlButton>
              <ControlButton active={Boolean(rayalgoSettings?.confirmation?.requireAdx)} onClick={() => updateRayAlgoSettings?.({ confirmation: { requireAdx: !rayalgoSettings?.confirmation?.requireAdx } })}>
                {rayalgoSettings?.confirmation?.requireAdx ? "ADX Gate" : "ADX Off"}
              </ControlButton>
              <MiniField label="ADX Min" value={rayalgoSettings?.confirmation?.adxMin ?? 20} onChange={(value) => updateRayAlgoSettings?.({ confirmation: { adxMin: value } })} step="0.5" min="0" />
              <ControlButton active={Boolean(rayalgoSettings?.confirmation?.requireVolScoreRange)} onClick={() => updateRayAlgoSettings?.({ confirmation: { requireVolScoreRange: !rayalgoSettings?.confirmation?.requireVolScoreRange } })}>
                {rayalgoSettings?.confirmation?.requireVolScoreRange ? "Vol Gate" : "Vol Off"}
              </ControlButton>
              <MiniField label="Vol Min" value={rayalgoSettings?.confirmation?.volScoreMin ?? 25} onChange={(value) => updateRayAlgoSettings?.({ confirmation: { volScoreMin: value } })} min="0" />
              <MiniField label="Vol Max" value={rayalgoSettings?.confirmation?.volScoreMax ?? 85} onChange={(value) => updateRayAlgoSettings?.({ confirmation: { volScoreMax: value } })} min="0" />
              <ControlButton active={Boolean(rayalgoSettings?.confirmation?.restrictToSelectedSessions)} onClick={() => updateRayAlgoSettings?.({ confirmation: { restrictToSelectedSessions: !rayalgoSettings?.confirmation?.restrictToSelectedSessions } })}>
                {rayalgoSettings?.confirmation?.restrictToSelectedSessions ? "Session Gate" : "Sessions Off"}
              </ControlButton>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {RAYALGO_SESSION_OPTIONS.map((option) => (
                  <ControlButton key={option.value} active={Boolean(rayalgoSettings?.confirmation?.sessions?.includes(option.value))} onClick={() => toggleRayAlgoSession?.(option.value)}>
                    {option.label}
                  </ControlButton>
                ))}
              </div>
            </ControlGroup>

            <ControlGroup label="Info">
              <ControlButton active={Boolean(rayalgoSettings?.infoPanel?.visible)} onClick={() => updateRayAlgoSettings?.({ infoPanel: { visible: !rayalgoSettings?.infoPanel?.visible } })}>
                {rayalgoSettings?.infoPanel?.visible ? "Dashboard On" : "Dashboard Off"}
              </ControlButton>
              <MiniSelect label="Pos" value={rayalgoSettings?.infoPanel?.position || "top_left"} options={RAYALGO_INFO_PANEL_POSITION_OPTIONS} onChange={(value) => updateRayAlgoSettings?.({ infoPanel: { position: value } })} width={112} />
              <MiniSelect label="Size" value={rayalgoSettings?.infoPanel?.size || "compact"} options={RAYALGO_INFO_PANEL_SIZE_OPTIONS} onChange={(value) => updateRayAlgoSettings?.({ infoPanel: { size: value } })} width={112} />
              <div style={{ fontSize: 11, fontFamily: F, color: "#64748b", maxWidth: 260, lineHeight: 1.35 }}>
                The dashboard mirrors the current shading and signal timeframes plus the configured MTF confirmation blocks.
              </div>
            </ControlGroup>

            <ControlGroup label="Risk">
              <ControlButton active={Boolean(rayalgoSettings?.risk?.showTpSl)} onClick={() => updateRayAlgoSettings?.({ risk: { showTpSl: !rayalgoSettings?.risk?.showTpSl } })}>
                {rayalgoSettings?.risk?.showTpSl ? "TP/SL On" : "TP/SL Off"}
              </ControlButton>
              <MiniField label="TP1" value={rayalgoSettings?.risk?.tp1Rr ?? 1} onChange={(value) => updateRayAlgoSettings?.({ risk: { tp1Rr: value } })} step="0.25" min="0.25" />
              <MiniField label="TP2" value={rayalgoSettings?.risk?.tp2Rr ?? 2} onChange={(value) => updateRayAlgoSettings?.({ risk: { tp2Rr: value } })} step="0.25" min="0.25" />
              <MiniField label="TP3" value={rayalgoSettings?.risk?.tp3Rr ?? 3} onChange={(value) => updateRayAlgoSettings?.({ risk: { tp3Rr: value } })} step="0.25" min="0.25" />
            </ControlGroup>

            <ControlGroup label="Watcher">
              <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 220 }}>
                <div style={{ fontSize: 12, fontFamily: F, fontWeight: 700, color: "#0f172a" }}>
                  {watcherModel?.leader?.summaryLabel || "Scanning best-fit RayAlgo settings"}
                </div>
                <div style={{ fontSize: 11, fontFamily: F, color: "#64748b" }}>
                  {watcherModel?.freshnessLabel || "Idle"} · Confidence {watcherModel?.leader?.confidenceLabel || "Idle"} · {watcherModel?.candidateCount || 0} candidates · Updated {formatWatcherTimestamp(watcherModel?.lastRunAt)}
                </div>
              </div>
              <ControlButton active={Boolean(rayalgoWatcherSettings?.autoRankAndPin)} onClick={() => setRayalgoWatcher?.((previous) => ({ ...previous, autoRankAndPin: !previous.autoRankAndPin }))}>
                {rayalgoWatcherSettings?.autoRankAndPin ? "Auto-rank On" : "Manual Mode"}
              </ControlButton>
              <ControlButton onClick={() => watcherModel?.runNow?.()}>Scan Now</ControlButton>
              <RuntimeHealthChip runtimeHealth={runtimeHealth} />
            </ControlGroup>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 8 }}>
            <CodePreviewCard
              title="PineScript Bridge"
              subtitle="Generated from the active RayAlgo settings. Replace the placeholder signal variables with your invite-only RayAlgo Pine variables before enabling alerts."
              code={pineScriptTemplate}
              onCopy={() => copyTextToClipboard?.(pineScriptTemplate, "Copied RayAlgo Pine template.")}
              copyLabel="Copy Pine"
            />
            <CodePreviewCard
              title="Alert JSON"
              subtitle="Matches the webhook bridge and includes the RayAlgo band-trend and band-retest component slots."
              code={DEFAULT_RAYALGO_ALERT_JSON_EXAMPLE}
              onCopy={() => copyTextToClipboard?.(DEFAULT_RAYALGO_ALERT_JSON_EXAMPLE, "Copied RayAlgo alert JSON.")}
              copyLabel="Copy JSON"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

const DEFAULT_RAYALGO_ALERT_JSON_EXAMPLE = buildRayAlgoAlertJsonExample();

export default function ResearchWorkbenchChartPanel({
  controlsModel,
  statusModel,
  chartModel,
  isActive = true,
}) {
  const {
    marketSymbol: controlMarketSymbol,
    setMarketSymbol,
    reloadSpotBars,
    candleTf,
    spotChartType = DEFAULT_CHART_TYPE,
    setSpotChartType,
    applySpotInterval,
    effectiveTf,
    rayalgoCandleColorMode = "rayalgo",
    setRayalgoCandleColorMode = null,
    chartWindowMode = "default",
    windowDisplayLabel = "1W",
    windowMenuValue = "1W",
    showResetSpotWindow = false,
    applySpotWindowPreset,
    resetSpotChartWindow,
    executionFidelity,
    setExecutionFidelity,
    setIndicatorSelections,
    indicatorSelections = [],
    indicatorOverlays,
    setIndicatorOverlays,
    rayalgoSettings,
    mergeRayalgoSettings,
    rayalgoWatcherSettings,
    setRayalgoWatcher,
    currentRayalgoBundles = [],
    selectedRayalgoBundle = null,
    isSelectedRayalgoBundleCustom = false,
    applyRayalgoBundle,
    revertSelectedRayalgoBundle,
    saveRayalgoBundleVariant,
    rayalgoBundleEvaluation = null,
    setRayalgoBundleTier,
    watcherModel,
    signalOverlaySupportedTimeframes = [],
    resolvedSignalTf = null,
    resolvedShadingTf = null,
    signalTimeframeState = null,
    shadingTimeframeState = null,
  } = controlsModel;
  const {
    regimes,
    dataSource,
    dataError,
    liveBarCount,
    spotDataMeta,
    spotStatus,
    chartSourceLabel,
    runtimeHealth,
    hasOlderHistory,
    isLoadingOlderHistory,
    historyLoadMode,
    indicatorOverlayTapesByTf,
    spotOverlayModeLabel,
    surfaceNotice,
  } = statusModel;
  const {
    spotChartBars,
    spotChartBarRanges,
    defaultVisibleLogicalRange,
    spotTradeOverlays,
    spotTradeMarkerGroups,
    spotEntriesByBarIndex,
    spotExitsByBarIndex,
    spotIndicatorMarkerPayload,
    spotIndicatorZones,
    spotIndicatorWindows,
    spotStudySpecs,
    spotStudyVisibility,
    spotStudyLowerPaneCount,
    spotSmcMarkers,
    strategy,
    rangePresetKey,
    baseSeriesModeKey,
    allowFullIntervalSeries,
    chartType = DEFAULT_CHART_TYPE,
    spotChartEmptyStateLabel,
    selectedTradeId,
    hoveredTradeId,
    onSelectTrade,
    onHoverTrade,
    showSignals,
    showZones,
    onRequestOlderHistory,
    onRuntimeHealthChange,
    linkedViewportRequest,
    coordinationModel,
  } = chartModel;
  const {
    chartsLinked = true,
    setChartsLinked = null,
    viewportLeaderChartId = "spot",
    onViewportChange = null,
    chartId = "spot",
  } = coordinationModel || {};
  const [openMenu, setOpenMenu] = React.useState(null);
  const [showRayAlgoSettings, setShowRayAlgoSettings] = React.useState(false);
  const [rayalgoBundlePreviewId, setRayalgoBundlePreviewId] = React.useState(null);
  const [toastNotice, setToastNotice] = React.useState(null);
  const [indicatorSearch, setIndicatorSearch] = React.useState("");
  const primaryControlRef = React.useRef(null);
  const rayalgoModalRef = React.useRef(null);
  const indicatorSearchRef = React.useRef(null);
  const toastTimerRef = React.useRef(null);
  const signalTimeframeOptions = React.useMemo(() => ([
    { value: "follow_chart", label: "Follow" },
    ...signalOverlaySupportedTimeframes.map((value) => ({ value, label: value })),
  ]), [signalOverlaySupportedTimeframes]);
  const activeBandProfile = React.useMemo(
    () => resolveBandProfile(rayalgoSettings) || { value: "custom", label: "Custom" },
    [rayalgoSettings],
  );
  const previewRayalgoBundle = React.useMemo(
    () => currentRayalgoBundles.find((bundle) => bundle.id === rayalgoBundlePreviewId) || selectedRayalgoBundle || currentRayalgoBundles[0] || null,
    [currentRayalgoBundles, rayalgoBundlePreviewId, selectedRayalgoBundle],
  );
  const activeIndicators = React.useMemo(
    () => (Array.isArray(indicatorSelections) ? indicatorSelections : [])
      .map((id) => INDICATOR_REGISTRY_BY_ID[id])
      .filter(Boolean),
    [indicatorSelections],
  );
  const indicatorSections = React.useMemo(
    () => categorizeIndicators(indicatorSelections, indicatorSearch),
    [indicatorSelections, indicatorSearch],
  );
  const indicatorButtonValue = activeIndicators.length ? String(activeIndicators.length) : "Add";
  const toggleIndicatorSelection = React.useCallback((indicatorId) => {
    setIndicatorSelections((previous) => {
      const current = Array.isArray(previous) ? previous : [];
      if (current.includes(indicatorId)) {
        return current.filter((entry) => entry !== indicatorId);
      }
      return [...current, indicatorId];
    });
  }, [setIndicatorSelections]);
  const setSignalOverlay = React.useCallback((patch) => {
    setIndicatorOverlays((previous) => {
      const nextSignals = {
        ...previous.signals,
        ...patch,
      };
      if (Object.prototype.hasOwnProperty.call(patch || {}, "timeframe")) {
        const nextTimeframe = String(patch?.timeframe || "follow_chart").trim() || "follow_chart";
        if (nextTimeframe === "follow_chart") {
          nextSignals.mode = "follow_chart";
          nextSignals.timeframe = "follow_chart";
        } else {
          nextSignals.mode = "pinned";
          nextSignals.timeframe = nextTimeframe;
        }
      }
      return {
        ...previous,
        signals: nextSignals,
      };
    });
  }, [setIndicatorOverlays]);
  const setShadingOverlay = React.useCallback((patch) => {
    setIndicatorOverlays((previous) => ({
      ...previous,
      shading: { ...previous.shading, ...patch },
    }));
  }, [setIndicatorOverlays]);
  const updateRayAlgoSettings = React.useCallback((patch) => {
    if (typeof mergeRayalgoSettings === "function") {
      mergeRayalgoSettings(patch);
    }
  }, [mergeRayalgoSettings]);
  const applyPreviewRayalgoBundle = React.useCallback((bundle = previewRayalgoBundle, options = { scope: "full" }) => {
    if (!bundle || typeof applyRayalgoBundle !== "function") {
      return;
    }
    applyRayalgoBundle(bundle, options);
    setRayalgoBundlePreviewId(bundle.id);
    setOpenMenu(null);
  }, [applyRayalgoBundle, previewRayalgoBundle]);
  const toggleRayAlgoSession = React.useCallback((sessionKey) => {
    updateRayAlgoSettings({
      confirmation: {
        sessions: Array.isArray(rayalgoSettings?.confirmation?.sessions) && rayalgoSettings.confirmation.sessions.includes(sessionKey)
          ? rayalgoSettings.confirmation.sessions.filter((entry) => entry !== sessionKey)
          : [...(Array.isArray(rayalgoSettings?.confirmation?.sessions) ? rayalgoSettings.confirmation.sessions : []), sessionKey],
      },
    });
  }, [rayalgoSettings?.confirmation?.sessions, updateRayAlgoSettings]);
  const pushToast = React.useCallback((text) => {
    setToastNotice(text);
    window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToastNotice(null), 2800);
  }, []);
  const copyTextToClipboard = React.useCallback(async (text, successLabel) => {
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.setAttribute("readonly", "true");
        textarea.style.position = "absolute";
        textarea.style.left = "-9999px";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      pushToast(successLabel);
    } catch {
      pushToast("Clipboard unavailable. Template left in view.");
    }
  }, [pushToast]);
  const latestRegime = regimes.length ? regimes[regimes.length - 1] : null;
  const latestRegimeColor = getRegimeColor(latestRegime?.regime);
  const viewLabel = `${effectiveTf}${candleTf === "auto" ? " auto" : ""} · ${spotChartBars.length}`;
  const timeframeTriggerValue = candleTf === "auto" ? `Auto · ${effectiveTf}` : effectiveTf;
  const applyIntervalFavorite = React.useCallback((value) => {
    applySpotInterval?.(value);
    setOpenMenu(null);
  }, [applySpotInterval, setOpenMenu]);
  const handleWindowPresetSelect = React.useCallback((value) => {
    applySpotWindowPreset?.(value);
    setOpenMenu(null);
  }, [applySpotWindowPreset, setOpenMenu]);
  const isSignalFollowingChart = indicatorOverlays.signals?.mode !== "pinned"
    || indicatorOverlays.signals?.timeframe === "follow_chart";
  const signalButtonValue = isSignalFollowingChart
    ? `Follow · ${resolvedSignalTf || effectiveTf}`
    : signalTimeframeState?.isCoerced
      ? `Pinned · ${indicatorOverlays.signals?.timeframe || "?"} -> ${resolvedSignalTf || "?"}`
      : `Pinned · ${resolvedSignalTf || indicatorOverlays.signals?.timeframe || "Off"}`;
  const shadingFollowsChart = indicatorOverlays.shading?.timeframe === "follow_chart";
  const shadingButtonValue = shadingFollowsChart
    ? `Follow · ${resolvedShadingTf || effectiveTf}`
    : shadingTimeframeState?.isCoerced
      ? `${indicatorOverlays.shading?.timeframe || "?"} -> ${resolvedShadingTf || "?"}`
      : (resolvedShadingTf || indicatorOverlays.shading?.timeframe || "Off");
  const windowTriggerLabel = "Window";
  const windowTriggerValue = windowDisplayLabel;
  const rayalgoDashboardModel = React.useMemo(() => buildRayAlgoDashboardModel({
    chartBars: spotChartBars,
    indicatorOverlayTapesByTf,
    activeSignalTimeframe: resolvedSignalTf || effectiveTf,
    activeShadingTimeframe: resolvedShadingTf || resolvedSignalTf || effectiveTf,
    rayalgoSettings,
  }), [
    effectiveTf,
    indicatorOverlayTapesByTf,
    rayalgoSettings,
    resolvedShadingTf,
    resolvedSignalTf,
    spotChartBars,
  ]);
  const pineScriptTemplate = React.useMemo(() => buildRayAlgoPineScriptTemplate({
    marketSymbol: controlMarketSymbol,
    signalTimeframe: resolvedSignalTf || effectiveTf,
    shadingTimeframe: resolvedShadingTf || resolvedSignalTf || effectiveTf,
    rayalgoSettings,
  }), [
    controlMarketSymbol,
    effectiveTf,
    rayalgoSettings,
    resolvedShadingTf,
    resolvedSignalTf,
  ]);
  const chartStatusItems = React.useMemo(() => {
    const historyValue = isLoadingOlderHistory
      ? "Loading older"
      : historyLoadMode === "user-expanded"
        ? "Expanded"
        : (hasOlderHistory ? "Recent" : null);
    const items = [
      {
        key: "source",
        label: "Source",
        value: chartSourceLabel || "Unavailable",
        color: spotStatus?.color,
        title: spotStatus?.title,
      },
      {
        key: "mode",
        label: "Mode",
        value: spotOverlayModeLabel || "No overlays",
      },
      String(strategy || "").trim().toLowerCase() === "rayalgo" ? {
        key: "rayalgo-trend",
        label: "Ray",
        value: rayalgoDashboardModel?.trend?.label || "Neutral",
        color: rayalgoDashboardModel?.trend?.tone,
        title: rayalgoDashboardModel?.trend?.detail,
      } : null,
      String(strategy || "").trim().toLowerCase() === "rayalgo" ? {
        key: "rayalgo-bands",
        label: "Bands",
        value: rayalgoDashboardModel?.profileLabel || activeBandProfile.label,
      } : null,
      historyValue ? {
        key: "history",
        label: "History",
        value: historyValue,
      } : null,
      latestRegime ? {
        key: "regime",
        label: "Regime",
        value: latestRegime.regime,
        color: latestRegimeColor,
      } : null,
      {
        key: "view",
        label: "View",
        value: viewLabel,
      },
    ];
    return items.filter(Boolean);
  }, [
    chartSourceLabel,
    hasOlderHistory,
    historyLoadMode,
    isLoadingOlderHistory,
    latestRegime,
    latestRegimeColor,
    activeBandProfile.label,
    rayalgoDashboardModel?.profileLabel,
    rayalgoDashboardModel?.trend?.detail,
    rayalgoDashboardModel?.trend?.label,
    rayalgoDashboardModel?.trend?.tone,
    spotOverlayModeLabel,
    spotStatus?.color,
    spotStatus?.title,
    strategy,
    viewLabel,
  ]);
  const timeframeMenuSections = React.useMemo(() => TIMEFRAME_MENU_SECTIONS.map((section) => (
    section.label === "Adaptive"
      ? {
          ...section,
          options: section.options.map((option) => ({
            ...option,
            detail: `Currently displaying ${effectiveTf} bars.`,
          })),
        }
      : section
  )), [effectiveTf]);

  React.useEffect(() => {
    if (selectedRayalgoBundle?.id) {
      setRayalgoBundlePreviewId(selectedRayalgoBundle.id);
      return;
    }
    if (currentRayalgoBundles[0]?.id) {
      setRayalgoBundlePreviewId(currentRayalgoBundles[0].id);
    }
  }, [currentRayalgoBundles, selectedRayalgoBundle?.id]);

  React.useEffect(() => {
    if (!surfaceNotice?.token || !surfaceNotice?.text) {
      return undefined;
    }
    pushToast(surfaceNotice.text);
    return undefined;
  }, [pushToast, surfaceNotice?.text, surfaceNotice?.token]);

  React.useEffect(() => {
    if (openMenu === "indicators") {
      indicatorSearchRef.current?.focus?.();
      indicatorSearchRef.current?.select?.();
      return;
    }
    setIndicatorSearch("");
  }, [openMenu]);

  React.useEffect(() => () => {
    window.clearTimeout(toastTimerRef.current);
  }, []);

  React.useEffect(() => {
    if (!openMenu) {
      return undefined;
    }

    function handlePointerDown(event) {
      const insidePrimaryControls = primaryControlRef.current?.contains(event.target);
      const insideRayAlgoModal = rayalgoModalRef.current?.contains(event.target);
      if (!insidePrimaryControls && !insideRayAlgoModal) {
        setOpenMenu(null);
      }
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setOpenMenu(null);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [openMenu]);

  React.useEffect(() => {
    if (!showRayAlgoSettings) {
      return undefined;
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setShowRayAlgoSettings(false);
        setOpenMenu(null);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showRayAlgoSettings]);

  const watcherLeaderLabel = watcherModel?.leader?.summaryLabel || "Scanning best-fit RayAlgo settings";
  const isRayAlgoStrategy = String(strategy || "").trim().toLowerCase() === "rayalgo";

  return (
    <div
      style={{
        flex: "1 1 680px",
        display: "flex",
        flexDirection: "column",
        minHeight: 620,
        minWidth: 0,
        background: CARD,
        border: `1px solid ${BORDER}`,
        borderRadius: PANEL_RADIUS,
        overflow: "hidden",
        boxShadow: SH1,
      }}
    >
      <div
        ref={primaryControlRef}
        style={{
          padding: "6px 8px",
          borderBottom: `1px solid ${BORDER}`,
          background: PANEL_HEADER_BACKGROUND,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              flexWrap: "wrap",
              minWidth: 0,
              flex: "1 1 auto",
            }}
          >
            <SpotSymbolControls
              marketSymbol={controlMarketSymbol}
              setMarketSymbol={setMarketSymbol}
              reloadSpotBars={reloadSpotBars}
              dataSource={dataSource}
              dataError={dataError}
              liveBarCount={liveBarCount}
              spotDataMeta={spotDataMeta}
              hasOlderHistory={hasOlderHistory}
              isLoadingOlderHistory={isLoadingOlderHistory}
              historyLoadMode={historyLoadMode}
              onRequestOlderHistory={onRequestOlderHistory}
            />
            <ToolbarDivider />
            <SelectionDropdown
              label="Interval"
              value={timeframeTriggerValue}
              selectedValue={candleTf === "auto" ? "auto" : candleTf}
              sections={timeframeMenuSections}
              open={openMenu === "timeframe"}
              onToggle={() => setOpenMenu((current) => (current === "timeframe" ? null : "timeframe"))}
              onSelect={(value) => {
                applyIntervalFavorite(value);
              }}
              width={220}
              compact
            />
            {INTERVAL_FAVORITES.map((option) => (
              <ControlButton
                key={option.value}
                active={option.value === "auto" ? candleTf === "auto" : candleTf === option.value}
                onClick={() => applyIntervalFavorite(option.value)}
              >
                {option.label}
              </ControlButton>
            ))}
            <InlineControlSection label="Style">
              <ControlButton
                active={spotChartType === DEFAULT_CHART_TYPE}
                onClick={() => setSpotChartType?.(DEFAULT_CHART_TYPE)}
              >
                Candles
              </ControlButton>
              <ControlButton
                active={spotChartType === VOLUME_CHART_TYPE}
                onClick={() => setSpotChartType?.(VOLUME_CHART_TYPE)}
                title="Candle width reflects relative volume."
              >
                Volume
              </ControlButton>
            </InlineControlSection>
            <InlineControlSection label="Color">
              <ControlButton
                active={rayalgoCandleColorMode === "rayalgo"}
                onClick={() => setRayalgoCandleColorMode?.("rayalgo")}
              >
                RayAlgo
              </ControlButton>
              <ControlButton
                active={rayalgoCandleColorMode === "traditional"}
                onClick={() => setRayalgoCandleColorMode?.("traditional")}
              >
                Red/Green
              </ControlButton>
            </InlineControlSection>
            <SelectionDropdown
              label={windowTriggerLabel}
              value={windowTriggerValue}
              selectedValue={windowMenuValue}
              sections={RANGE_MENU_SECTIONS}
              open={openMenu === "range"}
              onToggle={() => setOpenMenu((current) => (current === "range" ? null : "range"))}
              onSelect={(value) => {
                handleWindowPresetSelect(value);
              }}
              width={172}
              emphasis={chartWindowMode === "all" ? "primary" : "secondary"}
              compact
            />
            {showResetSpotWindow ? (
              <ControlButton onClick={() => {
                resetSpotChartWindow();
                setOpenMenu(null);
              }}>
                Reset View
              </ControlButton>
            ) : null}
            <OverlayPopupButton
              label="Indicators"
              value={indicatorButtonValue}
              active={activeIndicators.length > 0}
              open={openMenu === "indicators"}
              onToggle={() => setOpenMenu((current) => (current === "indicators" ? null : "indicators"))}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <input
                  ref={indicatorSearchRef}
                  type="search"
                  value={indicatorSearch}
                  onChange={(event) => setIndicatorSearch(event.target.value)}
                  placeholder="Search indicators"
                  style={{
                    width: "100%",
                    height: 32,
                    borderRadius: 8,
                    border: `1px solid ${BORDER}`,
                    background: "#f8fafc",
                    padding: "0 10px",
                    fontSize: 12,
                    fontFamily: F,
                    color: "#0f172a",
                  }}
                />
                {indicatorSections.length ? indicatorSections.map((section, sectionIndex) => (
                  <div
                    key={section.key}
                    style={{
                      paddingTop: sectionIndex === 0 ? 0 : 8,
                      marginTop: sectionIndex === 0 ? 0 : 8,
                      borderTop: sectionIndex === 0 ? "none" : "1px solid #eef2f7",
                    }}
                  >
                    <div style={{ padding: "0 10px 5px", fontSize: 9, fontFamily: F, letterSpacing: "0.08em", textTransform: "uppercase", color: "#94a3b8" }}>
                      {section.label}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      {section.items.map((indicator) => (
                        <IndicatorMenuItem
                          key={indicator.id}
                          indicator={indicator}
                          onToggle={() => toggleIndicatorSelection(indicator.id)}
                        />
                      ))}
                    </div>
                  </div>
                )) : (
                  <div style={{ padding: "6px 10px", fontSize: 12, fontFamily: F, color: "#64748b" }}>
                    No indicators match your search.
                  </div>
                )}
              </div>
            </OverlayPopupButton>
            <OverlayPopupButton
              label="Signals"
              value={signalButtonValue}
              active={Boolean(indicatorOverlays.signals?.visible)}
              open={openMenu === "signals"}
              onToggle={() => setOpenMenu((current) => (current === "signals" ? null : "signals"))}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div>
                  <div style={{ fontSize: 10, fontFamily: F, fontWeight: 700, color: "#0f172a" }}>RayAlgo Arrows</div>
                  <div style={{ fontSize: 11, fontFamily: F, color: "#64748b", marginTop: 2 }}>Shorter-timeframe signal markers.</div>
                  <div style={{ fontSize: 11, fontFamily: F, color: isSignalFollowingChart ? "#2563eb" : "#b45309", marginTop: 4 }}>
                    {isSignalFollowingChart
                      ? `Following candle interval · ${resolvedSignalTf || effectiveTf}`
                      : signalTimeframeState?.isCoerced
                        ? `Pinned to ${indicatorOverlays.signals?.timeframe || "?"} · rendering at ${resolvedSignalTf || "?"}; candle changes will not move arrows`
                        : `Pinned to ${resolvedSignalTf || indicatorOverlays.signals?.timeframe || "?"} · candle changes will not move arrows`}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <ControlButton active={Boolean(indicatorOverlays.signals?.visible)} onClick={() => setSignalOverlay({ visible: true })}>On</ControlButton>
                  <ControlButton active={!indicatorOverlays.signals?.visible} onClick={() => setSignalOverlay({ visible: false })}>Off</ControlButton>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {signalTimeframeOptions.map((option) => (
                    <ControlButton
                      key={option.value}
                      active={isSignalFollowingChart ? option.value === "follow_chart" : indicatorOverlays.signals?.timeframe === option.value}
                      onClick={() => {
                        setSignalOverlay({ timeframe: option.value });
                        setOpenMenu(null);
                      }}
                    >
                      {option.label}
                    </ControlButton>
                  ))}
                </div>
                {!isSignalFollowingChart ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <ControlButton onClick={() => {
                      setSignalOverlay({ timeframe: "follow_chart" });
                      setOpenMenu(null);
                    }}>
                      Reset to Follow
                    </ControlButton>
                  </div>
                ) : null}
              </div>
            </OverlayPopupButton>
            <OverlayPopupButton
              label="Shading"
              value={shadingButtonValue}
              active={Boolean(indicatorOverlays.shading?.visible)}
              open={openMenu === "shading"}
              onToggle={() => setOpenMenu((current) => (current === "shading" ? null : "shading"))}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div>
                  <div style={{ fontSize: 10, fontFamily: F, fontWeight: 700, color: "#0f172a" }}>RayAlgo Regime</div>
                  <div style={{ fontSize: 11, fontFamily: F, color: "#64748b", marginTop: 2 }}>Higher-timeframe background regime until the opposite signal.</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <ControlButton active={Boolean(indicatorOverlays.shading?.visible)} onClick={() => setShadingOverlay({ visible: true })}>On</ControlButton>
                  <ControlButton active={!indicatorOverlays.shading?.visible} onClick={() => setShadingOverlay({ visible: false })}>Off</ControlButton>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {signalTimeframeOptions.map((option) => (
                    <ControlButton
                      key={option.value}
                      active={indicatorOverlays.shading?.timeframe === option.value}
                      onClick={() => {
                        setShadingOverlay({ timeframe: option.value });
                        setOpenMenu(null);
                      }}
                    >
                      {option.label}
                    </ControlButton>
                  ))}
                </div>
                <div style={{ fontSize: 11, fontFamily: F, color: shadingTimeframeState?.isCoerced ? "#b45309" : "#64748b" }}>
                  {shadingTimeframeState?.isCoerced
                    ? `Pinned to ${indicatorOverlays.shading?.timeframe || "?"} · rendering at ${resolvedShadingTf || "?"}`
                    : "Mode: Until opposite signal"}
                </div>
              </div>
            </OverlayPopupButton>
            <ControlButton active={showRayAlgoSettings} onClick={() => { setShowRayAlgoSettings(true); setOpenMenu(null); }}>
              RayAlgo
            </ControlButton>
          </div>

          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", flexShrink: 0 }}>
            <WatcherChip
              watcherModel={watcherModel}
              autoRankAndPin={Boolean(rayalgoWatcherSettings?.autoRankAndPin)}
              onToggle={() => setRayalgoWatcher((previous) => ({ ...previous, autoRankAndPin: !previous.autoRankAndPin }))}
              onRunNow={() => watcherModel?.runNow?.()}
            />
            <RuntimeHealthChip runtimeHealth={runtimeHealth} />
            <LinkToggleChip
              linked={chartsLinked}
              driving={chartsLinked && viewportLeaderChartId === chartId}
              onClick={() => {
                if (typeof setChartsLinked === "function") {
                  setChartsLinked(!chartsLinked, { preferredLeaderChartId: chartId });
                }
              }}
              title={chartsLinked
                ? (viewportLeaderChartId === chartId
                  ? "Charts are linked. This chart is currently driving the shared viewport."
                  : "Charts are linked. This chart follows contextual viewport changes.")
                : "Charts are unlinked. Toggle to relink the spot and option charts."}
            />
          </div>
        </div>
      </div>
      <div
        style={{
          flex: "0 0 auto",
          minHeight: 420,
          height: "clamp(420px, 58vh, 760px)",
          position: "relative",
          padding: "6px 8px 8px",
          background: PANEL_VIEWPORT_BACKGROUND,
        }}
      >
        {toastNotice ? (
          <div
            style={{
              position: "absolute",
              top: 8,
              right: 8,
              zIndex: 6,
              maxWidth: 360,
              padding: "8px 10px",
              borderRadius: 10,
              border: "1px solid #bfdbfe",
              background: "rgba(239,246,255,0.96)",
              color: "#1d4ed8",
              boxShadow: "0 12px 28px rgba(15,23,42,0.12)",
              fontSize: 12,
              fontFamily: F,
              fontWeight: 700,
            }}
          >
            {toastNotice}
          </div>
        ) : null}
        <RayAlgoSettingsModal
          visible={showRayAlgoSettings}
          modalRef={rayalgoModalRef}
          previewBundle={previewRayalgoBundle}
          activeBundle={selectedRayalgoBundle}
          isCustom={isSelectedRayalgoBundleCustom}
          onPreviewBundle={setRayalgoBundlePreviewId}
          onApplyBundle={(bundle) => applyPreviewRayalgoBundle(bundle, { scope: "full" })}
          onApplyRayOnly={(bundle) => applyPreviewRayalgoBundle(bundle, { scope: "rayalgo_only" })}
          onRevertBundle={() => {
            revertSelectedRayalgoBundle?.();
            setRayalgoBundlePreviewId(selectedRayalgoBundle?.id || previewRayalgoBundle?.id || null);
          }}
          onSaveVariant={() => {
            const savedVariant = saveRayalgoBundleVariant?.();
            if (savedVariant?.id) {
              setRayalgoBundlePreviewId(savedVariant.id);
              pushToast(`Saved ${savedVariant.label}.`);
            }
          }}
          onSetBundleTier={(bundle, nextTier) => {
            const result = setRayalgoBundleTier?.(bundle?.id || bundle, nextTier);
            if (!result?.ok) {
              pushToast(result?.reason || "Tier change blocked.");
              return;
            }
            const tierLabel = RAYALGO_BUNDLE_TIER_LABELS[String(nextTier || "test").trim().toLowerCase()] || "Test";
            if (result.changed) {
              pushToast(`${result.bundle?.label || "Bundle"} set to ${tierLabel}.`);
            } else {
              pushToast(`${result.bundle?.label || "Bundle"} is already ${tierLabel}.`);
            }
          }}
          onClose={() => {
            setShowRayAlgoSettings(false);
            setOpenMenu(null);
          }}
          currentBundles={currentRayalgoBundles}
          rayalgoBundleEvaluation={rayalgoBundleEvaluation}
          watcherLeaderLabel={watcherLeaderLabel}
          isRayAlgoStrategy={isRayAlgoStrategy}
          watcherModel={watcherModel}
          rayalgoWatcherSettings={rayalgoWatcherSettings}
          setRayalgoWatcher={setRayalgoWatcher}
          runtimeHealth={runtimeHealth}
          controlMarketSymbol={controlMarketSymbol}
          setMarketSymbol={setMarketSymbol}
          reloadSpotBars={reloadSpotBars}
          dataSource={dataSource}
          dataError={dataError}
          liveBarCount={liveBarCount}
          spotDataMeta={spotDataMeta}
          hasOlderHistory={hasOlderHistory}
          isLoadingOlderHistory={isLoadingOlderHistory}
          historyLoadMode={historyLoadMode}
          onRequestOlderHistory={onRequestOlderHistory}
          timeframeTriggerValue={timeframeTriggerValue}
          candleTf={candleTf}
          effectiveTf={effectiveTf}
          timeframeMenuSections={timeframeMenuSections}
          openMenu={openMenu}
          setOpenMenu={setOpenMenu}
          applySpotInterval={applySpotInterval}
          windowTriggerLabel={windowTriggerLabel}
          windowTriggerValue={windowTriggerValue}
          windowMenuValue={windowMenuValue}
          chartWindowMode={chartWindowMode}
          applySpotWindowPreset={applySpotWindowPreset}
          resetSpotChartWindow={resetSpotChartWindow}
          showResetSpotWindow={showResetSpotWindow}
          indicatorOverlays={indicatorOverlays}
          signalTimeframeOptions={signalTimeframeOptions}
          isSignalFollowingChart={isSignalFollowingChart}
          resolvedSignalTf={resolvedSignalTf}
          resolvedShadingTf={resolvedShadingTf}
          signalTimeframeState={signalTimeframeState}
          shadingTimeframeState={shadingTimeframeState}
          setSignalOverlay={setSignalOverlay}
          setShadingOverlay={setShadingOverlay}
          executionFidelity={executionFidelity}
          setExecutionFidelity={setExecutionFidelity}
          rayalgoSettings={rayalgoSettings}
          updateRayAlgoSettings={updateRayAlgoSettings}
          toggleRayAlgoSession={toggleRayAlgoSession}
          activeBandProfile={activeBandProfile}
          pineScriptTemplate={pineScriptTemplate}
          copyTextToClipboard={copyTextToClipboard}
        />
        <RayAlgoDashboardCard
          dashboardModel={String(strategy || "").trim().toLowerCase() === "rayalgo" ? rayalgoDashboardModel : null}
          selectedTradeId={selectedTradeId}
          toastVisible={Boolean(toastNotice)}
        />
        <ResearchSpotChart
          isActive={isActive}
          bars={spotChartBars}
          barRanges={spotChartBarRanges}
          defaultVisibleLogicalRange={defaultVisibleLogicalRange}
          tradeOverlays={spotTradeOverlays}
          tradeMarkerGroups={spotTradeMarkerGroups}
          entriesByBarIndex={spotEntriesByBarIndex}
          exitsByBarIndex={spotExitsByBarIndex}
          indicatorMarkerPayload={spotIndicatorMarkerPayload}
          indicatorZones={spotIndicatorZones}
          indicatorWindows={spotIndicatorWindows}
          studySpecs={spotStudySpecs}
          studyVisibility={spotStudyVisibility}
          studyLowerPaneCount={spotStudyLowerPaneCount}
          smcMarkers={spotSmcMarkers}
          strategy={strategy}
          rangePresetKey={rangePresetKey}
          baseSeriesModeKey={baseSeriesModeKey}
          allowFullIntervalSeries={allowFullIntervalSeries}
          chartType={chartType}
          rayalgoCandleColorMode={rayalgoCandleColorMode}
          symbol={controlMarketSymbol}
          emptyStateLabel={spotChartEmptyStateLabel}
          selectedTradeId={selectedTradeId}
          hoveredTradeId={hoveredTradeId}
          onTradeSelect={onSelectTrade}
          onTradeHover={onHoverTrade}
          autoFocusSelectedTrade={false}
          chartId={chartId}
          linkEnabled={chartsLinked}
          linkedViewportRequest={linkedViewportRequest}
          onVisibleTimeBoundsChange={onViewportChange}
          tradeThresholdDisplay="active-lines"
          showSignals={showSignals}
          showZones={showZones}
          hasOlderHistory={hasOlderHistory}
          isLoadingOlderHistory={isLoadingOlderHistory}
          onRequestOlderHistory={onRequestOlderHistory}
          onRuntimeHealthChange={onRuntimeHealthChange}
          statusItems={chartStatusItems}
        />
      </div>
    </div>
  );
}
