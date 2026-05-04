import { RadioTower } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MISSING_VALUE, T, dim, fs, sp } from "../../lib/uiTokens";
import { formatExpirationLabel, formatQuotePrice, formatRelativeTimeShort } from "../../lib/formatters";
import { joinMotionClasses, motionRowStyle, motionVars } from "../../lib/motion.jsx";
import { _initialState, persistState } from "../../lib/workspaceState";
import {
  FLOW_BUILT_IN_PRESETS,
  FLOW_MIN_PREMIUM_OPTIONS,
  FLOW_TAPE_FILTER_OPTIONS,
  buildFlowTapePresetPatch,
  setFlowTapeFilterState,
  useFlowTapeFilterState,
} from "./flowFilterStore";
import {
  HEADER_BROADCAST_SPEED_PRESETS,
  buildHeaderSignalTapeItems,
  buildHeaderUnusualTapeItems,
  getHeaderBroadcastSpeedDurations,
  resolveHeaderBroadcastSpeedPreset,
} from "./headerBroadcastModel";
import {
  BROAD_MARKET_FLOW_STORE_KEY,
  setFlowScannerControlState,
  useFlowScannerControlState,
  useMarketFlowSnapshot,
  useMarketFlowSnapshotForStoreKey,
} from "./marketFlowStore";
import {
  FLOW_SCANNER_CONFIG_LIMITS,
  FLOW_SCANNER_MODE,
  FLOW_SCANNER_SCOPE,
  normalizeFlowScannerConfig,
} from "./marketFlowScannerConfig";
import { useSignalMonitorSnapshot } from "./signalMonitorStore";
import { AppTooltip } from "@/components/ui/tooltip";


const fmtCompactCurrency = (value) => {
  if (value == null || Number.isNaN(value)) return MISSING_VALUE;
  if (Math.abs(value) >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  if (Math.abs(value) >= 1e3) return `$${(value / 1e3).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
};
const HeaderBroadcastSegment = ({
  item,
  duplicate = false,
  tone = T.textSec,
  accent = T.borderLight,
  children,
  onClick,
  title,
}) => {
  const interactive = !duplicate && typeof onClick === "function";
  const Component = interactive ? "button" : "div";

  const segment = (
    <Component
      type={interactive ? "button" : undefined}
      aria-hidden={duplicate || undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={interactive ? () => onClick(item) : undefined}
      className={interactive ? "ra-interactive" : undefined}
      style={{
        ...motionVars({ accent: tone }),
        display: "inline-flex",
        alignItems: "center",
        gap: sp(6),
        height: dim(22),
        maxWidth: dim(360),
        padding: sp("0px 8px"),
        border: `1px solid ${accent}`,
        borderLeft: `3px solid ${tone}`,
        borderRadius: dim(3),
        background: `${tone}10`,
        color: T.textSec,
        fontFamily: T.sans,
        fontSize: fs(10),
        fontWeight: 700,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        cursor: interactive ? "pointer" : "default",
      }}
    >
      {children}
    </Component>
  );

  return interactive ? (
    <AppTooltip content={title}>{segment}</AppTooltip>
  ) : (
    segment
  );
};

const HeaderSignalTapeItem = ({ item, duplicate = false, onClick }) => {
  const isSell = item.direction === "sell";
  const tone = isSell ? T.red : T.green;
  const priceLabel =
    item.price != null && Number.isFinite(Number(item.price))
      ? formatQuotePrice(Number(item.price))
      : null;
  const title = `${item.symbol} ${item.directionLabel} ${item.timeframe || ""}`.trim();

  return (
    <HeaderBroadcastSegment
      item={item}
      duplicate={duplicate}
      tone={tone}
      accent={item.fresh ? tone : T.border}
      onClick={(selected) => onClick?.(selected.symbol, selected.raw)}
      title={title}
    >
      <span style={{ color: tone, fontWeight: 900 }}>{item.directionLabel}</span>
      <span style={{ color: T.text }}>{item.symbol}</span>
      {item.timeframe ? (
        <span style={{ color: T.textDim, fontFamily: T.code }}>
          {item.timeframe}
        </span>
      ) : null}
      {priceLabel ? (
        <span style={{ color: T.textSec, fontFamily: T.code }}>
          {priceLabel}
        </span>
      ) : null}
      <span style={{ color: T.textMuted, fontFamily: T.code }}>
        {formatRelativeTimeShort(item.time)}
      </span>
    </HeaderBroadcastSegment>
  );
};

const HeaderUnusualTapeItem = ({ item, duplicate = false, onClick }) => {
  const isPut =
    item.right === "P" ||
    String(item.sentiment || "").toLowerCase() === "bearish";
  const tone = isPut ? T.red : T.green;
  const contractLabel =
    item.contract ||
    [
      item.strike != null ? String(item.strike) : "",
      item.right,
      formatExpirationLabel(item.expirationDate),
    ]
      .filter((part) => part && part !== MISSING_VALUE)
      .join(" ");
  const scoreLabel = item.score ? `${item.score.toFixed(1)}x` : null;
  const title = `${item.symbol} unusual ${contractLabel}`.trim();

  return (
    <HeaderBroadcastSegment
      item={item}
      duplicate={duplicate}
      tone={tone}
      accent={T.border}
      onClick={(selected) => onClick?.(selected.raw)}
      title={title}
    >
      <span style={{ color: T.text }}>{item.symbol}</span>
      {contractLabel ? (
        <span style={{ color: tone, fontFamily: T.code }}>{contractLabel}</span>
      ) : null}
      <span style={{ color: T.textSec, fontFamily: T.code }}>
        {fmtCompactCurrency(item.premium)}
      </span>
      {scoreLabel ? (
        <span style={{ color: T.amber, fontFamily: T.code }}>{scoreLabel}</span>
      ) : null}
      <span style={{ color: T.textMuted, fontFamily: T.code }}>
        {formatRelativeTimeShort(item.time)}
      </span>
    </HeaderBroadcastSegment>
  );
};

const HeaderLaneSettingsPopover = ({ children, testId }) => (
  <div
    data-testid={testId}
    className="ra-popover-enter"
    style={{
      position: "absolute",
      top: 0,
      left: `calc(100% + ${dim(4)}px)`,
      zIndex: 80,
      width: dim(238),
      padding: sp(8),
      maxHeight: `calc(100vh - ${dim(18)}px)`,
      overflowY: "auto",
      background: T.bg0,
      border: `1px solid ${T.border}`,
      boxShadow: "0 12px 28px rgba(0,0,0,0.32)",
      color: T.text,
      fontFamily: T.sans,
    }}
  >
    {children}
  </div>
);

const HeaderLaneSettingsTitle = ({ label, status, tone = T.textDim }) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: sp(8),
      marginBottom: sp(7),
    }}
  >
    <span
      style={{
        color: T.textSec,
        fontFamily: T.code,
        fontSize: fs(9),
        fontWeight: 900,
      }}
    >
      {label}
    </span>
    <span
      style={{
        color: tone,
        fontFamily: T.code,
        fontSize: fs(8),
        fontWeight: 800,
        whiteSpace: "nowrap",
      }}
    >
      {status}
    </span>
  </div>
);

const HeaderLaneInfoRow = ({ label, value, tone = T.textSec }) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: sp(8),
      minHeight: dim(20),
      color: T.textDim,
      fontFamily: T.code,
      fontSize: fs(8),
      fontWeight: 700,
    }}
  >
    <span>{label}</span>
    <span style={{ color: tone, textAlign: "right" }}>{value}</span>
  </div>
);

const HeaderLaneSectionLabel = ({ children }) => (
  <div
    style={{
      marginTop: sp(8),
      marginBottom: sp(5),
      color: T.textMuted,
      fontFamily: T.code,
      fontSize: fs(7),
      fontWeight: 900,
      letterSpacing: "0.08em",
    }}
  >
    {children}
  </div>
);

const HeaderLaneSegmentedControl = ({ value, onChange }) => (
  <div
    role="group"
    aria-label="Header lane speed"
    style={{
      display: "grid",
      gridTemplateColumns: "repeat(3, 1fr)",
      gap: sp(4),
      marginBottom: sp(7),
    }}
  >
    {Object.entries(HEADER_BROADCAST_SPEED_PRESETS).map(([preset, config]) => {
      const active = value === preset;
      return (
        <button
          key={preset}
          type="button"
          aria-pressed={active}
          data-testid={`header-lane-speed-${preset}`}
          className={joinMotionClasses("ra-interactive", active && "ra-focus-rail")}
          onClick={() => onChange(preset)}
          style={{
            ...motionVars({ accent: T.accent }),
            minHeight: dim(24),
            border: `1px solid ${active ? T.accent : T.border}`,
            background: active ? `${T.accent}18` : T.bg1,
            color: active ? T.accent : T.textDim,
            cursor: "pointer",
            fontFamily: T.code,
            fontSize: fs(8),
            fontWeight: 900,
          }}
        >
          {config.label}
        </button>
      );
    })}
  </div>
);

const HeaderLaneToggleButton = ({
  active,
  disabled = false,
  onClick,
  children,
  testId,
  tone = T.accent,
}) => (
  <button
    type="button"
    data-testid={testId}
    aria-pressed={active}
    disabled={disabled}
    className={joinMotionClasses("ra-interactive", active && "ra-focus-rail")}
    onClick={onClick}
    style={{
      ...motionVars({ accent: tone }),
      width: "100%",
      minHeight: dim(28),
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      gap: sp(6),
      border: `1px solid ${active ? tone : T.border}`,
      background: active ? `${tone}18` : T.bg1,
      color: disabled ? T.textMuted : active ? tone : T.textSec,
      cursor: disabled ? "default" : "pointer",
      fontFamily: T.sans,
      fontSize: fs(9),
      fontWeight: 800,
    }}
  >
    <RadioTower size={dim(12)} strokeWidth={2.3} />
    {children}
  </button>
);

const headerLaneControlInputStyle = {
  width: "100%",
  minHeight: dim(23),
  background: T.bg1,
  border: `1px solid ${T.border}`,
  color: T.textSec,
  fontFamily: T.code,
  fontSize: fs(8),
  fontWeight: 800,
  padding: sp("3px 5px"),
  outline: "none",
};

const HeaderLaneControlRow = ({ label, children }) => (
  <label
    style={{
      display: "grid",
      gridTemplateColumns: `${dim(58)} minmax(0, 1fr)`,
      alignItems: "center",
      gap: sp(6),
      minHeight: dim(25),
      color: T.textDim,
      fontFamily: T.code,
      fontSize: fs(8),
      fontWeight: 800,
    }}
  >
    <span>{label}</span>
    {children}
  </label>
);

const HeaderLaneSelectControl = ({ label, value, onChange, options, testId }) => (
  <HeaderLaneControlRow label={label}>
    <select
      data-testid={testId}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      style={headerLaneControlInputStyle}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  </HeaderLaneControlRow>
);

const HeaderLaneTextControl = ({ label, value, onChange, testId, placeholder }) => (
  <HeaderLaneControlRow label={label}>
    <input
      data-testid={testId}
      type="text"
      value={value ?? ""}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      style={headerLaneControlInputStyle}
    />
  </HeaderLaneControlRow>
);

const HeaderLaneNumberControl = ({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  testId,
  placeholder,
}) => (
  <HeaderLaneControlRow label={label}>
    <input
      data-testid={testId}
      type="number"
      min={min}
      max={max}
      step={step}
      value={value ?? ""}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      style={headerLaneControlInputStyle}
    />
  </HeaderLaneControlRow>
);

const HeaderBroadcastLane = ({
  label,
  items,
  emptyLabel,
  testId,
  action,
  children,
  durationSeconds = 34,
  settingsOpen = false,
  onToggleSettings,
  settingsContent,
}) => {
  const shouldScroll = items.length >= 4;
  const renderedItems = shouldScroll ? [...items, ...items] : items;

  return (
    <div
      data-testid={testId}
      style={{
        display: "grid",
        gridTemplateColumns: "72px minmax(0, 1fr) auto",
        alignItems: "center",
        minHeight: dim(25),
        minWidth: 0,
        borderBottom: `1px solid ${T.border}`,
      }}
    >
      <div
        style={{
          position: "relative",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRight: `1px solid ${T.border}`,
        }}
      >
        <button
          type="button"
          data-testid={`${testId}-settings-trigger`}
          aria-expanded={settingsOpen}
          onClick={onToggleSettings}
          style={{
            width: "100%",
            height: "100%",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            padding: sp("0px 8px"),
            border: "none",
            background: settingsOpen ? T.bg2 : "transparent",
            color: settingsOpen ? T.accent : T.textDim,
            cursor: "pointer",
            fontFamily: T.code,
            fontSize: fs(9),
            fontWeight: 900,
            whiteSpace: "nowrap",
          }}
        >
          {label}
        </button>
        {settingsOpen ? settingsContent : null}
      </div>

      <div
        data-header-broadcast-viewport
        style={{
          minWidth: 0,
          overflowX: shouldScroll ? "hidden" : "auto",
          overflowY: "hidden",
          padding: sp("1px 8px"),
        }}
      >
        {items.length ? (
          <div
            data-header-broadcast-track
            role="list"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: sp(8),
              minWidth: "max-content",
              animation: shouldScroll
                ? `headerBroadcastScroll ${durationSeconds}s linear infinite`
                : "none",
            }}
          >
            {renderedItems.map((item, index) => {
              const duplicate = index >= items.length;
              return (
                <span
                  key={`${item.id}-${index}`}
                  role={duplicate ? "presentation" : "listitem"}
                  className={duplicate ? undefined : "ra-row-enter"}
                  style={{
                    display: "inline-flex",
                    ...(duplicate ? null : motionRowStyle(index, 10, 90)),
                  }}
                >
                  {children(item, duplicate)}
                </span>
              );
            })}
          </div>
        ) : (
          <span
            role="status"
            style={{
              display: "inline-flex",
              alignItems: "center",
              height: dim(22),
              color: T.textMuted,
              fontFamily: T.code,
              fontSize: fs(10),
              fontWeight: 700,
              whiteSpace: "nowrap",
            }}
          >
            {emptyLabel}
          </span>
        )}
      </div>

      <div
        style={{
          height: "100%",
          minWidth: dim(28),
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderLeft: `1px solid ${T.border}`,
        }}
      >
        {action}
      </div>
    </div>
  );
};

export const HeaderBroadcastScrollerStack = memo(({
  symbols = [],
  enabled = true,
  onSignalAction,
  onFlowAction,
  signalScanEnabled = false,
  signalScanPending = false,
  signalEvaluationPending = false,
  signalScanErrored = false,
  onToggleSignalScan,
}) => {
  const rootRef = useRef(null);
  const signalSnapshot = useSignalMonitorSnapshot({
    subscribeToUpdates: enabled,
  });
  const sharedFlowSnapshot = useMarketFlowSnapshot(symbols, {
    subscribe: enabled,
  });
  const flowScannerControl = useFlowScannerControlState({
    subscribe: enabled,
  });
  const broadFlowSnapshot = useMarketFlowSnapshotForStoreKey(
    BROAD_MARKET_FLOW_STORE_KEY,
    { subscribe: enabled },
  );
  const broadScanEnabled = Boolean(flowScannerControl.enabled);
  const broadScanOwnerActive = Boolean(flowScannerControl.ownerActive);
  const flowScannerConfig = flowScannerControl.config;
  const flowTapeFilters = useFlowTapeFilterState({
    subscribe: enabled,
  });
  const broadScanSnapshotActive = broadScanEnabled && broadScanOwnerActive;
  const [openSettingsLane, setOpenSettingsLane] = useState(null);
  const [speedPreset, setSpeedPreset] = useState(() =>
    resolveHeaderBroadcastSpeedPreset(_initialState.headerBroadcastSpeedPreset),
  );
  const speedDurations = useMemo(
    () => getHeaderBroadcastSpeedDurations(speedPreset),
    [speedPreset],
  );
  const changeSpeedPreset = useCallback((nextPreset) => {
    const resolved = resolveHeaderBroadcastSpeedPreset(nextPreset);
    setSpeedPreset(resolved);
    persistState({ headerBroadcastSpeedPreset: resolved });
  }, []);
  useEffect(() => {
    const listener = (event) => {
      const nextPreset = event?.detail?.headerBroadcastSpeedPreset;
      if (!nextPreset) return;
      setSpeedPreset(resolveHeaderBroadcastSpeedPreset(nextPreset));
    };
    window.addEventListener("rayalgo:workspace-settings-updated", listener);
    return () => {
      window.removeEventListener("rayalgo:workspace-settings-updated", listener);
    };
  }, []);
  const changeFlowScannerConfig = useCallback((patch) => {
    setFlowScannerControlState({
      config: normalizeFlowScannerConfig({
        ...flowScannerConfig,
        ...patch,
      }),
    });
  }, [flowScannerConfig]);
  const changeFlowTapeFilters = useCallback((patch) => {
    setFlowTapeFilterState({
      ...patch,
      activeFlowPresetId: null,
    });
  }, []);
  const changeFlowTapePreset = useCallback((presetId) => {
    setFlowTapeFilterState(buildFlowTapePresetPatch(presetId, flowTapeFilters));
  }, [flowTapeFilters]);
  const toggleBroadScan = useCallback(() => {
    setFlowScannerControlState({ enabled: !broadScanEnabled });
  }, [broadScanEnabled]);
  useEffect(() => {
    if (!openSettingsLane || typeof document === "undefined") {
      return undefined;
    }

    const handlePointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) {
        setOpenSettingsLane(null);
      }
    };
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setOpenSettingsLane(null);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [openSettingsLane]);
  const signalItems = useMemo(
    () => buildHeaderSignalTapeItems(signalSnapshot),
    [signalSnapshot],
  );
  const unusualEvents = useMemo(
    () =>
      broadScanSnapshotActive
        ? [
            ...(broadFlowSnapshot.flowEvents || []),
            ...(sharedFlowSnapshot.flowEvents || []),
          ]
        : sharedFlowSnapshot.flowEvents || [],
    [
      broadFlowSnapshot.flowEvents,
      broadScanSnapshotActive,
      sharedFlowSnapshot.flowEvents,
    ],
  );
  const unusualItems = useMemo(
    () => buildHeaderUnusualTapeItems(unusualEvents),
    [unusualEvents],
  );

  const signalBusy = Boolean(
    signalScanPending || signalEvaluationPending || signalSnapshot?.pending,
  );
  const signalHasError = Boolean(!signalBusy && signalScanErrored);
  const signalEmptyLabel = signalHasError
    ? "SIGNALS ERROR"
    : signalBusy
      ? "SYNCING"
      : signalScanEnabled
        ? "NO SIGNALS"
        : "SIGNALS OFF";
  const flowStatus = broadScanSnapshotActive
    ? broadFlowSnapshot.flowStatus
    : sharedFlowSnapshot.flowStatus;
  const flowProviderSummary = broadScanSnapshotActive
    ? broadFlowSnapshot.providerSummary
    : sharedFlowSnapshot.providerSummary;
  const flowHasError =
    flowStatus === "offline" ||
    Boolean(flowProviderSummary?.erroredSource) ||
    Boolean(flowProviderSummary?.failures?.length);
  const flowScanHasError = Boolean(broadScanSnapshotActive && flowHasError);
  const flowScanBusy = Boolean(
    broadScanSnapshotActive &&
      !flowScanHasError &&
      (flowStatus === "loading" || flowProviderSummary?.coverage?.isFetching),
  );
  const unusualEmptyLabel =
    flowStatus === "loading"
      ? "SYNCING"
      : flowHasError
        ? "FLOW OFFLINE"
        : unusualEvents.length
          ? "NO UNUSUAL FLOW"
          : "NO FLOW";

  const flowScanTone = flowScanHasError
    ? T.red
    : flowScanBusy
      ? T.amber
      : broadScanSnapshotActive
        ? T.green
        : broadScanEnabled
          ? T.textMuted
          : T.textMuted;
  const flowScanStatusLabel = flowScanHasError
    ? "SCAN ERROR"
    : flowScanBusy
      ? "SCANNING"
      : broadScanSnapshotActive
        ? "SCAN ON"
        : broadScanEnabled
          ? "SCAN IDLE"
        : "SCAN OFF";
  const broadToggleTitle = flowScanHasError
    ? "Flow scan degraded"
    : flowScanBusy
      ? "Flow scan updating"
      : broadScanSnapshotActive
        ? "Flow scan active"
        : broadScanEnabled
          ? "Flow scan waiting for app visibility"
        : "Start Flow scan";
  const signalScanTone = signalHasError
    ? T.red
    : signalBusy
      ? T.amber
      : signalScanEnabled
        ? T.green
        : T.textMuted;
  const signalToggleTitle = signalHasError
    ? "Signal scan degraded"
    : signalBusy
      ? "Signal scan updating"
      : signalScanEnabled
        ? "Signal scan active"
        : "Start signal scan";
  const signalStatusLabel = signalHasError
    ? "SCAN ERROR"
    : signalScanPending
      ? "UPDATING"
      : signalEvaluationPending || signalSnapshot?.pending
        ? "SCANNING"
        : signalScanEnabled
          ? "SCAN ON"
          : "SCAN OFF";
  const signalLastEvaluatedAt =
    signalSnapshot?.profile?.lastEvaluatedAt ||
    signalSnapshot?.states?.find?.((state) => state?.lastEvaluatedAt)
      ?.lastEvaluatedAt ||
    null;
  const signalSettings = (
    <HeaderLaneSettingsPopover testId="header-signal-settings-popover">
      <HeaderLaneSettingsTitle
        label="SIGNALS"
        status={signalStatusLabel}
        tone={signalScanTone}
      />
      <HeaderLaneInfoRow
        label="Speed"
        value={HEADER_BROADCAST_SPEED_PRESETS[speedPreset].label}
        tone={T.textSec}
      />
      <HeaderLaneSegmentedControl
        value={speedPreset}
        onChange={changeSpeedPreset}
      />
      <HeaderLaneToggleButton
        active={signalScanEnabled}
        disabled={signalBusy || !onToggleSignalScan}
        onClick={onToggleSignalScan}
        testId="header-signal-scan-settings-toggle"
        tone={signalScanTone}
      >
        {signalScanEnabled ? "Signal Scan On" : "Signal Scan Off"}
      </HeaderLaneToggleButton>
      <div style={{ height: dim(7) }} />
      <HeaderLaneInfoRow label="Visible" value={signalItems.length} />
      <HeaderLaneInfoRow
        label="State"
        value={
          signalHasError
            ? "Error"
            : signalBusy
              ? "Evaluating"
              : signalScanEnabled
                ? "Watching"
                : "Off"
        }
        tone={signalScanTone}
      />
      <HeaderLaneInfoRow
        label="Last"
        value={
          signalLastEvaluatedAt
            ? formatRelativeTimeShort(signalLastEvaluatedAt)
            : MISSING_VALUE
        }
      />
    </HeaderLaneSettingsPopover>
  );
  const unusualCoverage = flowProviderSummary?.coverage || null;
  const unusualCurrentBatch = unusualCoverage?.currentBatch || [];
  const unusualScanningNow = unusualCurrentBatch.length
    ? unusualCurrentBatch.slice(0, 4).join(" ")
    : MISSING_VALUE;
  const unusualLineDetail =
    unusualCoverage && Number.isFinite(unusualCoverage.cycleScannedSymbols)
      ? `${unusualCoverage.cycleScannedSymbols}/${unusualCoverage.totalSymbols || unusualCoverage.activeTargetSize || unusualCoverage.cycleScannedSymbols}`
      : MISSING_VALUE;
  const unusualSettings = (
    <HeaderLaneSettingsPopover testId="header-unusual-settings-popover">
      <HeaderLaneSettingsTitle
        label="FLOW"
        status={flowScanStatusLabel}
        tone={flowScanTone}
      />
      <HeaderLaneInfoRow
        label="Speed"
        value={HEADER_BROADCAST_SPEED_PRESETS[speedPreset].label}
        tone={T.textSec}
      />
      <HeaderLaneSegmentedControl
        value={speedPreset}
        onChange={changeSpeedPreset}
      />
      <HeaderLaneToggleButton
        active={broadScanEnabled}
        onClick={toggleBroadScan}
        testId="header-unusual-settings-broad-toggle"
        tone={flowScanTone}
      >
        {broadScanSnapshotActive
          ? "Flow Scan On"
          : broadScanEnabled
            ? "Flow Scan Idle"
            : "Flow Scan Off"}
      </HeaderLaneToggleButton>
      <HeaderLaneSectionLabel>TAPE FILTERS</HeaderLaneSectionLabel>
      <HeaderLaneTextControl
        label="Include"
        value={flowTapeFilters.includeQuery}
        onChange={(value) => changeFlowTapeFilters({ includeQuery: value })}
        testId="header-flow-filter-include"
        placeholder="SPY, QQQ"
      />
      <HeaderLaneTextControl
        label="Exclude"
        value={flowTapeFilters.excludeQuery}
        onChange={(value) => changeFlowTapeFilters({ excludeQuery: value })}
        testId="header-flow-filter-exclude"
        placeholder="AAPL, TSLA"
      />
      <HeaderLaneSelectControl
        label="Flow"
        value={flowTapeFilters.filter}
        onChange={(value) => changeFlowTapeFilters({ filter: value })}
        testId="header-flow-filter-type"
        options={FLOW_TAPE_FILTER_OPTIONS.map((option) => ({
          value: option.id,
          label: option.label,
        }))}
      />
      <HeaderLaneSelectControl
        label="Min Prem"
        value={String(flowTapeFilters.minPrem)}
        onChange={(value) => changeFlowTapeFilters({ minPrem: Number(value) })}
        testId="header-flow-filter-min-premium"
        options={FLOW_MIN_PREMIUM_OPTIONS.map((option) => ({
          value: String(option.value),
          label: option.label,
        }))}
      />
      <HeaderLaneSelectControl
        label="Preset"
        value={flowTapeFilters.activeFlowPresetId || ""}
        onChange={changeFlowTapePreset}
        testId="header-flow-filter-preset"
        options={[
          { value: "", label: "None" },
          ...FLOW_BUILT_IN_PRESETS.map((preset) => ({
            value: preset.id,
            label: preset.label,
          })),
        ]}
      />
      <HeaderLaneSectionLabel>SCANNER</HeaderLaneSectionLabel>
      <HeaderLaneSelectControl
        label="Mode"
        value={flowScannerConfig.mode}
        onChange={(value) => changeFlowScannerConfig({ mode: value })}
        testId="header-flow-scan-mode"
        options={[
          { value: FLOW_SCANNER_MODE.market, label: "Market" },
          { value: FLOW_SCANNER_MODE.watchlist, label: "Watchlist" },
        ]}
      />
      <HeaderLaneSelectControl
        label="Scope"
        value={flowScannerConfig.scope}
        onChange={(value) => changeFlowScannerConfig({ scope: value })}
        testId="header-flow-scan-scope"
        options={[
          { value: FLOW_SCANNER_SCOPE.unusual, label: "Unusual" },
          { value: FLOW_SCANNER_SCOPE.all, label: "All Flow" },
        ]}
      />
      <HeaderLaneNumberControl
        label="Symbols"
        value={flowScannerConfig.maxSymbols}
        min={FLOW_SCANNER_CONFIG_LIMITS.maxSymbols.min}
        max={FLOW_SCANNER_CONFIG_LIMITS.maxSymbols.max}
        onChange={(value) => changeFlowScannerConfig({ maxSymbols: value })}
        testId="header-flow-scan-max-symbols"
      />
      <HeaderLaneNumberControl
        label="Batch"
        value={flowScannerConfig.batchSize}
        min={FLOW_SCANNER_CONFIG_LIMITS.batchSize.min}
        max={FLOW_SCANNER_CONFIG_LIMITS.batchSize.max}
        onChange={(value) => changeFlowScannerConfig({ batchSize: value })}
        testId="header-flow-scan-batch-size"
      />
      <HeaderLaneNumberControl
        label="Conc"
        value={flowScannerConfig.concurrency}
        min={FLOW_SCANNER_CONFIG_LIMITS.concurrency.min}
        max={FLOW_SCANNER_CONFIG_LIMITS.concurrency.max}
        onChange={(value) => changeFlowScannerConfig({ concurrency: value })}
        testId="header-flow-scan-concurrency"
      />
      <HeaderLaneNumberControl
        label="Vol/OI"
        value={flowScannerConfig.unusualThreshold}
        min={FLOW_SCANNER_CONFIG_LIMITS.unusualThreshold.min}
        max={FLOW_SCANNER_CONFIG_LIMITS.unusualThreshold.max}
        step={0.1}
        onChange={(value) =>
          changeFlowScannerConfig({ unusualThreshold: value })
        }
        testId="header-flow-scan-unusual-threshold"
      />
      <HeaderLaneNumberControl
        label="Min $"
        value={flowScannerConfig.minPremium}
        min={FLOW_SCANNER_CONFIG_LIMITS.minPremium.min}
        max={FLOW_SCANNER_CONFIG_LIMITS.minPremium.max}
        step={5_000}
        onChange={(value) => changeFlowScannerConfig({ minPremium: value })}
        testId="header-flow-scan-min-premium"
      />
      <HeaderLaneNumberControl
        label="Max DTE"
        value={flowScannerConfig.maxDte}
        min={FLOW_SCANNER_CONFIG_LIMITS.maxDte.min}
        max={FLOW_SCANNER_CONFIG_LIMITS.maxDte.max}
        onChange={(value) =>
          changeFlowScannerConfig({ maxDte: value === "" ? null : value })
        }
        testId="header-flow-scan-max-dte"
        placeholder="Any"
      />
      <div style={{ height: dim(7) }} />
      <HeaderLaneInfoRow label="Visible" value={unusualItems.length} />
      <HeaderLaneInfoRow
        label="Batch"
        value={`${flowScannerConfig.batchSize}/${flowScannerConfig.concurrency}`}
      />
      <HeaderLaneInfoRow
        label="Scanning"
        value={unusualScanningNow}
        tone={unusualCurrentBatch.length ? T.accent : T.textDim}
      />
      <HeaderLaneInfoRow
        label="Flow"
        value={flowStatus.toUpperCase()}
        tone={flowHasError ? T.red : flowStatus === "loading" ? T.amber : T.textSec}
      />
      <HeaderLaneInfoRow
        label="Scanned"
        value={
          unusualCoverage
            ? `${unusualCoverage.scannedSymbols}/${unusualCoverage.totalSymbols}`
            : MISSING_VALUE
        }
      />
      <HeaderLaneInfoRow
        label="Cycle"
        value={unusualLineDetail}
        tone={flowScanTone}
      />
    </HeaderLaneSettingsPopover>
  );

  return (
    <div
      ref={rootRef}
      data-testid="header-broadcast-scrollers"
      style={{
        flexShrink: 0,
        display: "grid",
        gridTemplateRows: "auto auto",
        minWidth: 0,
        background: T.bg0,
        borderBottom: `1px solid ${T.border}`,
      }}
    >
      <HeaderBroadcastLane
        label="SIGNALS"
        items={signalItems}
        emptyLabel={signalEmptyLabel}
        testId="header-signal-tape"
        durationSeconds={speedDurations.signalDurationSeconds}
        settingsOpen={openSettingsLane === "signals"}
        onToggleSettings={() =>
          setOpenSettingsLane((lane) => (lane === "signals" ? null : "signals"))
        }
        settingsContent={signalSettings}
        action={
          <AppTooltip content={signalToggleTitle}><button
            type="button"
            data-testid="header-signal-scan-toggle"
            aria-label={signalToggleTitle}
            aria-pressed={signalScanEnabled}
            disabled={signalBusy || !onToggleSignalScan}
            onClick={onToggleSignalScan}
            style={{
              width: dim(24),
              height: dim(22),
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              border: "none",
              borderRadius: dim(3),
              background: signalScanEnabled ? `${signalScanTone}18` : "transparent",
              color: signalScanTone,
              cursor: signalBusy ? "wait" : onToggleSignalScan ? "pointer" : "default",
            }}
          >
            <RadioTower size={14} strokeWidth={2.4} />
          </button></AppTooltip>
        }
      >
        {(item, duplicate) => (
          <HeaderSignalTapeItem
            item={item}
            duplicate={duplicate}
            onClick={onSignalAction}
          />
        )}
      </HeaderBroadcastLane>

      <HeaderBroadcastLane
        label="FLOW"
        items={unusualItems}
        emptyLabel={unusualEmptyLabel}
        testId="header-unusual-tape"
        durationSeconds={speedDurations.unusualDurationSeconds}
        settingsOpen={openSettingsLane === "unusual"}
        onToggleSettings={() =>
          setOpenSettingsLane((lane) => (lane === "unusual" ? null : "unusual"))
        }
        settingsContent={unusualSettings}
        action={
          <AppTooltip content={broadToggleTitle}><button
            type="button"
            data-testid="header-unusual-broad-toggle"
            aria-label={broadToggleTitle}
            aria-pressed={broadScanEnabled}
            onClick={toggleBroadScan}
            style={{
              width: dim(24),
              height: dim(22),
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              border: "none",
              borderRadius: dim(3),
              background: broadScanEnabled ? `${flowScanTone}18` : "transparent",
              color: flowScanTone,
              cursor: "pointer",
            }}
          >
            <RadioTower size={14} strokeWidth={2.4} />
          </button></AppTooltip>
        }
      >
        {(item, duplicate) => (
          <HeaderUnusualTapeItem
            item={item}
            duplicate={duplicate}
            onClick={onFlowAction}
          />
        )}
      </HeaderBroadcastLane>
    </div>
  );
});
