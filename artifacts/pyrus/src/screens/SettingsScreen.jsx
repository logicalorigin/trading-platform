import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetSignalMonitorProfileQueryKey,
  getGetSignalMonitorStateQueryKey,
  getListSignalMonitorEventsQueryKey,
  useEvaluateSignalMonitor,
  useGetSignalMonitorProfile,
  useGetSignalMonitorState,
  useListSignalMonitorEvents,
  useUpdateSignalMonitorProfile,
} from "@workspace/api-client-react";
import {
  DiagnosticThresholdSettingsPanel,
} from "./settings/DiagnosticThresholdSettingsPanel";
import { SnapTradeConnectPanel } from "./settings/SnapTradeConnectPanel.jsx";
import {
  getSettingsChangeStatus,
  settleSettingsDrafts,
} from "./settings/settingsChangeStatus.js";
import TaxSettingsPanel from "./settings/TaxSettingsPanel.jsx";
import {
  LOCAL_ALERT_PREFERENCES_EVENT,
  readLocalAlertPreferences,
  writeLocalAlertPreferences,
} from "./diagnostics/localAlerts";
import { buildPyrusRuntimeFingerprint } from "../app/runtimeDiagnostics";
import {
  DEFAULT_FLOW_SCANNER_CONFIG,
  FLOW_SCANNER_CONFIG_LIMITS,
  FLOW_SCANNER_MODE_OPTIONS,
  FLOW_SCANNER_SCOPE,
  normalizeFlowScannerConfig,
} from "../features/platform/marketFlowScannerConfig";
import { FLOW_ROWS_OPTIONS } from "../features/flow/flowRowsConfig.js";
import {
  HEADER_BROADCAST_SPEED_PRESETS,
  resolveHeaderBroadcastSpeedPreset,
} from "../features/platform/headerBroadcastModel";
import {
  buildSignalMonitorStatusSnapshot,
} from "../features/platform/signalMonitorStatusModel";
import {
  useMemoryPressurePreferences,
} from "../features/platform/memoryPressurePreferences";
import { useMemoryPressureSnapshot } from "../features/platform/memoryPressureStore";
import {
  getFlowScannerControlState,
  setFlowScannerControlState,
  useFlowScannerControlState,
} from "../features/platform/marketFlowStore";
import { useToast } from "../features/platform/platformContexts.jsx";
import {
  getChartTimeframeOptions,
  resolveChartTimeframeFavorites,
} from "../features/charting/timeframes";
import {
  DEFAULT_USER_PREFERENCES,
  MAX_CHART_FUTURE_EXPANSION_BARS,
  formatPreferenceTimeZoneLabel,
} from "../features/preferences/userPreferenceModel";
import { useUserPreferences } from "../features/preferences/useUserPreferences";
import { markRouteDataTiming } from "../features/platform/performanceMetrics";
import { ACCOUNT_RANGES } from "./account/accountRanges";
import {
  ACCOUNT_POSITION_TYPE_SETTINGS_OPTIONS,
  normalizeAccountPositionTypeFilter,
} from "../features/account/accountPositionTypes";
import {
  CSS_COLOR,
  cssColorMix,
  ELEVATION,
  FONT_WEIGHTS,
  PYRUS_STORAGE_KEY,
  PYRUS_WORKSPACE_SETTINGS_EVENT,
  MISSING_VALUE,
  RADII,
  T,
  dim,
  fs,
  sp,
  textSize,
} from "../lib/uiTokens.jsx";
import { Button } from "../components/ui/Button.jsx";
import {
  Badge,
  DataUnavailableState,
  MetricChip,
  Pill,
  SegmentedControl,
  Select,
  Skeleton,
  SurfacePanel,
  TextField as PlatformTextField,
} from "../components/platform/primitives.jsx";
import { SEMANTIC_TONE } from "../features/platform/semanticToneModel.js";
import { formatAppTimeForPreferences } from "../lib/timeZone";
import { responsiveFlags, useElementSize } from "../lib/responsive";
import { useDebouncedTextCommit } from "../lib/useDebouncedTextCommit";

const SETTINGS_TABS = [
  {
    id: "Preferences",
    label: "Preferences",
    description: "Appearance, time, privacy",
    keywords: "app theme density time locale privacy tooltips balances",
  },
  {
    id: "Charting",
    label: "Charting",
    description: "Status line, scale, overlays",
    keywords: "chart timeframe ohlc volume grid crosshair dashboard time axis",
  },
  {
    id: "Workspace",
    label: "Workspace",
    description: "Defaults, market, flow",
    keywords: "workspace market flow scanner defaults grid watchlist account",
  },
  {
    id: "Tax",
    label: "Tax",
    description: "Profile, reserve, estimates",
    keywords: "tax wash sale reserve state federal safe harbor lots basis",
  },
  {
    id: "Automation & Alerts",
    label: "Automation",
    description: "Signals, alerts, notifications",
    keywords: "signal monitor alerts diagnostics notifications audio quiet hours",
  },
  {
    id: "Data & Broker",
    label: "Data & Broker",
    description: "Providers, runtime, brokerage",
    keywords: "provider research broker snaptrade brokerage runtime massive data",
  },
  {
    id: "System",
    label: "System",
    description: "Diagnostics, storage, isolation",
    keywords: "system diagnostics thresholds storage isolation inventory backend",
  },
];

const SIGNAL_TIMEFRAMES = ["1m", "2m", "5m", "15m", "1h", "1d"];
const SIGNAL_MONITOR_ENVIRONMENT = "shadow";
const SIGNAL_MONITOR_UNIVERSE_SCOPE_KEY = "__signalMonitorUniverseScope";
const SIGNAL_MONITOR_UNIVERSE_SCOPE_OPTIONS = Object.freeze([
  { value: "selected_watchlist", label: "Selected Watchlist" },
  { value: "all_watchlists", label: "All Watchlists" },
  { value: "all_watchlists_plus_universe", label: "Watchlists + Ranked" },
  { value: "high_beta_500", label: "High Beta 500" },
]);
const SIGNAL_MONITOR_UNIVERSE_SCOPE_VALUES = new Set(
  SIGNAL_MONITOR_UNIVERSE_SCOPE_OPTIONS.map((option) => option.value),
);
const describeHighBetaUniverseAvailability = (status) => {
  if (!status) {
    return {
      label: "checking",
      detail: MISSING_VALUE,
      tone: CSS_COLOR.textDim,
    };
  }
  const accepted =
    typeof status.lastAcceptedCount === "number"
      ? `${status.lastAcceptedCount}/${status.limit || 500}`
      : MISSING_VALUE;
  if (status.available) {
    const cacheLabel =
      status.cacheStatus === "stale_cache"
        ? "cached"
        : status.cacheStatus === "memory_cache"
          ? "memory"
          : "fresh";
    return {
      label: `${cacheLabel} ${accepted}`,
      detail: status.lastGeneratedAt || MISSING_VALUE,
      tone:
        status.cacheStatus === "stale_cache"
          ? CSS_COLOR.amber
          : CSS_COLOR.green,
    };
  }
  return {
    label: status.unavailableCode || "unavailable",
    detail: status.unavailableDetail || MISSING_VALUE,
    tone: CSS_COLOR.amber,
  };
};
const SIGNAL_MONITOR_LIMITS = Object.freeze({
  pollIntervalSeconds: { min: 15, max: 3600 },
  maxSymbols: { min: 1, max: 500 },
  evaluationConcurrency: { min: 1, max: 10 },
  freshWindowBars: { min: 1, max: 20 },
});
const SIGNAL_MONITOR_SCAN_AFFECTING_FIELDS = Object.freeze([
  "enabled",
  "watchlistId",
  "timeframe",
  "freshWindowBars",
  "maxSymbols",
  "evaluationConcurrency",
  "pyrusSignalsSettings",
]);
const pickSignalMonitorEditableSettings = (profile) => {
  const source = profile || {};
  return {
    enabled: Boolean(source.enabled),
    watchlistId: source.watchlistId || null,
    timeframe: source.timeframe || "5m",
    freshWindowBars: Number(source.freshWindowBars),
    pollIntervalSeconds: Number(source.pollIntervalSeconds),
    maxSymbols: Number(source.maxSymbols),
    evaluationConcurrency: Number(source.evaluationConcurrency),
    pyrusSignalsSettings: source.pyrusSignalsSettings || {},
  };
};
const resolveSignalMonitorUniverseScope = (settings) => {
  const raw = settings?.[SIGNAL_MONITOR_UNIVERSE_SCOPE_KEY];
  return SIGNAL_MONITOR_UNIVERSE_SCOPE_VALUES.has(raw)
    ? raw
    : "all_watchlists_plus_universe";
};
const signalMonitorEditableSettingsJson = (profile) =>
  JSON.stringify(pickSignalMonitorEditableSettings(profile));
const signalMonitorScanAffectingSettingsChanged = (current, next) => {
  const currentSettings = pickSignalMonitorEditableSettings(current);
  const nextSettings = pickSignalMonitorEditableSettings(next);
  return SIGNAL_MONITOR_SCAN_AFFECTING_FIELDS.some(
    (field) =>
      JSON.stringify(currentSettings[field]) !==
      JSON.stringify(nextSettings[field]),
  );
};
const FLOW_FILTERS = ["all", "calls", "puts", "unusual", "golden", "sweep", "block", "cluster"];
const FLOW_SORT_OPTIONS = ["time", "premium", "score", "ratio", "ticker"];
const FLOW_DENSITY_OPTIONS = ["compact", "comfortable"];
const MARKET_GRID_LAYOUTS = ["1x1", "2x2", "2x3", "3x3"];
const ACCOUNT_RANGE_OPTIONS = ACCOUNT_RANGES;
const ACCOUNT_ASSET_FILTER_OPTIONS = [
  ...ACCOUNT_POSITION_TYPE_SETTINGS_OPTIONS,
];
const ACCOUNT_ORDER_TAB_OPTIONS = [
  { value: "working", label: "Working orders" },
  { value: "history", label: "Order history" },
];
const ACCOUNT_SECTION_OPTIONS = [
  { value: "real", label: "Live account" },
  { value: "shadow", label: "Shadow account" },
];
const CHART_TIMEFRAME_ROLES = [
  { value: "primary", label: "Primary Chart" },
  { value: "mini", label: "Market Grid" },
  { value: "option", label: "Option Chart" },
];
const CHART_SCALE_PREFS_STORAGE_PREFIX = "pyrus:chart-scale-prefs:";
const OPTION_HYDRATION_HISTORY_STORAGE_KEY = "pyrus.optionHydrationDiagnostics.v1";
const MARKET_GRID_TRACK_SESSION_KEY = "pyrus:market-grid-track-sizes";
const TIME_ZONE_OPTIONS = [
  { value: "America/New_York", label: "New York / ET" },
  { value: "America/Denver", label: "Denver / MT" },
  { value: "America/Chicago", label: "Chicago / CT" },
  { value: "America/Los_Angeles", label: "Los Angeles / PT" },
  { value: "Europe/London", label: "London" },
  { value: "UTC", label: "UTC" },
];
const APP_TIME_ZONE_MODE_OPTIONS = [
  { value: "app", label: "App default" },
  { value: "local", label: "Browser local" },
  { value: "exchange", label: "Exchange" },
  { value: "utc", label: "UTC" },
  { value: "fixed", label: "Fixed zone" },
];
const CHART_TIME_ZONE_MODE_OPTIONS = [
  { value: "exchange", label: "Exchange" },
  { value: "local", label: "Browser local" },
  { value: "utc", label: "UTC" },
  { value: "fixed", label: "Fixed zone" },
];
const USER_THEME_OPTIONS = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
  { value: "system", label: "System" },
];
const USER_SCALE_OPTIONS = ["xs", "s", "m", "l", "xl"];
const DEFAULT_SCREEN_OPTIONS = [
  { value: "market", label: "Market" },
  { value: "trade", label: "Trade" },
  { value: "options", label: "Options" },
  { value: "flow", label: "Flow" },
  { value: "account", label: "Account" },
  { value: "settings", label: "Settings" },
];

const safeRecord = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};

const resolveStockDataProvider = (providers) => {
  const configured = Boolean(providers?.massive);
  const label = configured ? "Massive" : "Massive";
  const code = configured ? "M" : "-";
  return { configured, label, code };
};

const formatBytes = (bytes) => {
  const value = Number(bytes) || 0;
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  if (value >= 1024) return `${Math.round(value / 1024)} KB`;
  return `${value} B`;
};

const formatCount = (value) =>
  Number.isFinite(Number(value)) ? Math.round(Number(value)).toLocaleString() : MISSING_VALUE;

const formatDurationMs = (value) => {
  if (value === null || value === undefined || value === "") return MISSING_VALUE;
  const durationMs = Number(value);
  if (!Number.isFinite(durationMs) || durationMs < 0) return MISSING_VALUE;
  if (durationMs < 60_000) return `${Math.round(durationMs / 1_000)}s`;
  return `${Math.round(durationMs / 60_000)}m`;
};

const estimateStorageBytes = (key, value) =>
  (String(key || "").length + String(value || "").length) * 2;

function readWorkspaceState() {
  try {
    const raw = window.localStorage.getItem(PYRUS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeWorkspaceState(patch) {
  try {
    const current = readWorkspaceState();
    const next = { ...current, ...patch };
    window.localStorage.setItem(PYRUS_STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent(PYRUS_WORKSPACE_SETTINGS_EVENT, { detail: next }));
    return next;
  } catch {
    return null;
  }
}

function labelStyle() {
  return {
    display: "flex",
    flexDirection: "column",
    gap: sp(4),
    color: CSS_COLOR.textDim,
    fontFamily: T.sans,
    fontSize: textSize("caption"),
    fontWeight: FONT_WEIGHTS.medium,
    minWidth: 0,
  };
}

/**
 * AboutPanel — top-of-System-tab build metadata + one-line health
 * summary. Pulls from the existing build fingerprint so the gitSha,
 * branch, build mode, and "dirty/clean" tag stay accurate as new
 * builds roll. Health summary degrades gracefully if a subsystem is
 * down (renders dim text instead of erroring).
 */
function AboutPanel({ summary, providers }) {
  const fingerprint = useMemo(() => {
    try {
      return buildPyrusRuntimeFingerprint();
    } catch (_e) {
      return null;
    }
  }, []);
  if (!fingerprint) return null;

  const shortSha =
    fingerprint.gitSha && fingerprint.gitSha !== "unknown"
      ? fingerprint.gitSha.slice(0, 7)
      : "—";
  const sourceTreeTone =
    fingerprint.sourceTreeStatus === "dirty"
      ? CSS_COLOR.amber
      : fingerprint.sourceTreeStatus === "clean"
        ? CSS_COLOR.green
        : CSS_COLOR.textDim;
  const tradingTone =
    summary?.tradingMode === "live"
      ? CSS_COLOR.red
      : summary?.tradingMode === "shadow"
        ? CSS_COLOR.green
        : CSS_COLOR.textDim;
  const stockDataProvider = resolveStockDataProvider(providers);
  const providerOk = Boolean(
    stockDataProvider.configured && providers?.research && providers?.ibkr,
  );

  return (
    <Panel title="About">
      <StateRow label="Application" value="PYRUS" />
      <StateRow
        label="Build SHA"
        value={shortSha}
        tone={shortSha === "—" ? CSS_COLOR.textDim : CSS_COLOR.text}
      />
      <StateRow
        label="Source tree"
        value={fingerprint.sourceTreeStatus}
        tone={sourceTreeTone}
      />
      <StateRow label="Branch" value={fingerprint.gitBranch || "—"} />
      <StateRow label="Build mode" value={fingerprint.buildMode} />
      <StateRow
        label="Node env"
        value={fingerprint.nodeEnv || "—"}
        tone={CSS_COLOR.textDim}
      />
      <StateRow
        label="Trading mode"
        value={summary?.tradingMode || "—"}
        tone={tradingTone}
      />
      <StateRow
        label="Providers"
        value={providerOk ? "all configured" : "incomplete"}
        tone={providerOk ? CSS_COLOR.green : CSS_COLOR.amber}
      />
    </Panel>
  );
}

function Panel({ title, action, children }) {
  return (
    <SurfacePanel title={title} action={action}>
      {children}
    </SurfacePanel>
  );
}

function StateRow({ label, value, tone = CSS_COLOR.textSec }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: sp(10),
        borderBottom: `1px solid ${cssColorMix(CSS_COLOR.border, 33)}`,
        padding: sp("7px 0"),
        fontFamily: T.sans,
        fontSize: fs(10),
      }}
    >
      <span style={{ color: CSS_COLOR.textDim, minWidth: 0 }}>{label}</span>
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: sp(4),
          color: tone,
          fontWeight: FONT_WEIGHTS.regular,
          textAlign: "right",
          minWidth: 0,
          overflowWrap: "anywhere",
        }}
      >
        <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{value ?? MISSING_VALUE}</span>
      </span>
    </div>
  );
}

function SelectField({ label, value, onChange, options }) {
  return <Select label={label} value={value} onChange={onChange} options={options} />;
}

function NumberField({ label, value, onChange, min, max, step = 1 }) {
  return (
    <PlatformTextField
      label={label}
      type="number"
      value={value ?? ""}
      onChange={(event) => onChange(event.target.value === "" ? "" : Number(event.target.value))}
      inputProps={{ min, max, step }}
    />
  );
}

function TextField({ label, value, onChange, placeholder = "", transformInput }) {
  const { inputProps } = useDebouncedTextCommit({
    value,
    onCommit: onChange,
    transformInput,
  });

  return (
    <PlatformTextField
      label={label}
      value={inputProps.value}
      onChange={inputProps.onChange}
      placeholder={placeholder}
      inputProps={{ onBlur: inputProps.onBlur, onKeyDown: inputProps.onKeyDown }}
    />
  );
}

function SettingsSearchInput({ value, onCommit }) {
  const { inputProps } = useDebouncedTextCommit({
    value,
    onCommit,
  });

  return (
    <PlatformTextField
      type="search"
      value={inputProps.value}
      onChange={inputProps.onChange}
      placeholder="Search settings"
      inputProps={{
        "data-testid": "settings-search-input",
        "aria-label": "Search settings",
        onBlur: inputProps.onBlur,
        onKeyDown: inputProps.onKeyDown,
      }}
    />
  );
}

function CheckboxField({ label, checked, onChange }) {
  return (
    <label
      style={{
        ...labelStyle(),
        minHeight: dim(30),
        flexDirection: "row",
        alignItems: "center",
        gap: sp(7),
        padding: sp("5px 7px"),
        border: `1px solid ${CSS_COLOR.borderLight}`,
        borderRadius: dim(RADII.xs),
        background: CSS_COLOR.bg1,
        color: CSS_COLOR.textSec,
      }}
    >
      <input
        type="checkbox"
        checked={Boolean(checked)}
        onChange={(event) => onChange(event.target.checked)}
        style={{ accentColor: CSS_COLOR.accent }}
      />
      {label}
    </label>
  );
}

function JsonBlock({ value }) {
  return (
    <pre
      style={{
        margin: 0,
        maxHeight: dim(300),
        overflow: "auto",
        fontFamily: T.sans,
        fontSize: textSize("caption"),
        color: CSS_COLOR.textSec,
        whiteSpace: "pre-wrap",
        lineHeight: 1.45,
      }}
    >
      {JSON.stringify(value || {}, null, 2)}
    </pre>
  );
}

function SourceBadge({ setting }) {
  const source = setting?.source || "default";
  // Doctrine (semantic color + no category colors): the source is not a
  // decorative category — tone reflects operational meaning. pending_restart
  // is a "waiting" state (amber), env/override are actively-set values
  // (accent emphasis), default is inert (muted). Green is not a category tag.
  const color =
    source === "pending_restart"
      ? SEMANTIC_TONE.operationalAttention
      : source === "env" || source === "override"
        ? CSS_COLOR.accent
        : SEMANTIC_TONE.neutral;
  return <Badge color={color}>{source.replace(/_/g, " ")}</Badge>;
}

function SettingCard({ setting, draftValue, onDraftChange }) {
  const editable = setting?.editable && Array.isArray(setting.options);
  const displayValue =
    typeof setting.value === "object" ? JSON.stringify(setting.value) : setting.value;
  return (
    <div
      style={{
        borderTop: `1px solid ${CSS_COLOR.border}`,
        padding: sp("10px 2px 4px"),
        display: "grid",
        gap: sp(6),
        alignSelf: "start",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: sp(8) }}>
        <div style={{ color: CSS_COLOR.text, fontWeight: FONT_WEIGHTS.regular, fontSize: fs(11) }}>
          {setting.label}
        </div>
        <SourceBadge setting={setting} />
      </div>
      <div style={{ color: CSS_COLOR.textDim, fontFamily: T.sans, fontSize: textSize("caption"), lineHeight: 1.45 }}>
        {setting.description}
      </div>
      {editable ? (
        <Select
          value={draftValue ?? setting.pendingValue ?? setting.value ?? ""}
          onChange={(next) => onDraftChange(setting.key, next)}
          ariaLabel={setting.label}
          options={setting.options}
        />
      ) : (
        <div style={{ color: CSS_COLOR.textSec, fontFamily: T.sans, fontSize: fs(10), overflowWrap: "anywhere" }}>
          {displayValue ?? MISSING_VALUE}
        </div>
      )}
      {setting.pendingValue !== undefined && (
        <div style={{ color: CSS_COLOR.amber, fontFamily: T.sans, fontSize: textSize("caption") }}>
          Pending restart: {String(setting.pendingValue)}
        </div>
      )}
      {setting.requiresRestart && (
        <div style={{ color: CSS_COLOR.textDim, fontFamily: T.sans, fontSize: textSize("body"), textTransform: "uppercase" }}>
          restart required
        </div>
      )}
    </div>
  );
}

function useBackendSettings({ enabled = true } = {}) {
  const toast = useToast();
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [applyOutcome, setApplyOutcome] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    setApplyOutcome(null);
    fetch("/api/settings/backend", { headers: { Accept: "application/json" } })
      .then((response) =>
        response.ok
          ? response.json()
          : response.json().then((payload) => Promise.reject(payload)),
      )
      .then((payload) => {
        setSnapshot(payload);
        setDrafts({});
      })
      .catch((err) => {
        setError(err?.detail || err?.message || "Backend settings are unavailable.");
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!enabled) return;
    load();
  }, [enabled, load]);

  const setDraft = useCallback((key, value) => {
    setApplyOutcome(null);
    setDrafts((current) => ({ ...current, [key]: value }));
  }, []);

  const apply = useCallback(() => {
    const changes = Object.entries(drafts).map(([key, value]) => ({ key, value }));
    if (!changes.length) return;
    setSaving(true);
    setError(null);
    setApplyOutcome(null);
    fetch("/api/settings/backend/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ changes }),
    })
      .then((response) =>
        response.ok
          ? response.json()
          : response.json().then((payload) => Promise.reject(payload)),
      )
      .then((payload) => {
        const rejectedKeys = Array.isArray(payload.rejected)
          ? payload.rejected.map((item) => item.key)
          : [];
        setSnapshot(payload.snapshot);
        setDrafts((current) =>
          settleSettingsDrafts({
            currentDrafts: current,
            submittedDrafts: drafts,
            rejectedKeys,
          }),
        );
        if (payload.rejected?.length) {
          const message = payload.rejected.map((item) => item.reason).join(" ");
          setError(message);
          setApplyOutcome("partial");
          toast.push({
            kind: "warn",
            title: "Backend settings partially applied",
            body: message,
          });
        } else {
          setApplyOutcome("success");
          toast.push({
            kind: "success",
            title: "Backend settings applied",
          });
        }
      })
      .catch((err) => {
        const message = err?.detail || err?.message || "Failed to apply backend settings.";
        setError(message);
        setApplyOutcome("error");
        toast.push({
          kind: "error",
          title: "Backend settings failed",
          body: message,
        });
      })
      .finally(() => setSaving(false));
  }, [drafts, toast]);

  return {
    snapshot,
    loading,
    saving,
    error,
    drafts,
    applyOutcome,
    dirtyCount: Object.keys(drafts).length,
    setDraft,
    discard: () => {
      setApplyOutcome(null);
      setDrafts({});
    },
    reload: load,
    apply,
  };
}

function useWatchlists({ enabled = true } = {}) {
  const [watchlists, setWatchlists] = useState([]);
  const [error, setError] = useState(null);
  const load = useCallback(() => {
    fetch("/api/watchlists", { headers: { Accept: "application/json" } })
      .then((response) =>
        response.ok
          ? response.json()
          : response.json().then((payload) => Promise.reject(payload)),
      )
      .then((payload) => {
        setWatchlists(payload.watchlists || []);
        setError(null);
      })
      .catch((err) => {
        setError(err?.detail || err?.message || "Watchlists are unavailable.");
      });
  }, []);

  useEffect(() => {
    if (!enabled) return;
    load();
  }, [enabled, load]);

  return { watchlists, error, reload: load };
}

function useSignalMonitorSettings({ enabled = true } = {}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(null);
  const [localError, setLocalError] = useState(null);
  const lastProfileJsonRef = useRef(null);
  const signalMonitorParams = useMemo(
    () => ({ environment: SIGNAL_MONITOR_ENVIRONMENT }),
    [],
  );
  const signalMonitorEventsParams = useMemo(
    () => ({ environment: SIGNAL_MONITOR_ENVIRONMENT, limit: 20 }),
    [],
  );
  const profileQuery = useGetSignalMonitorProfile(signalMonitorParams, {
    query: {
      enabled,
      staleTime: 15_000,
      retry: false,
    },
  });
  const stateQuery = useGetSignalMonitorState(signalMonitorParams, {
    query: {
      enabled,
      staleTime: 15_000,
      retry: false,
    },
  });
  const eventsQuery = useListSignalMonitorEvents(signalMonitorEventsParams, {
    query: {
      enabled,
      staleTime: 15_000,
      retry: false,
    },
  });
  const profile = profileQuery.data || null;
  const state = stateQuery.data || null;
  const events = eventsQuery.data?.events || [];

  const dirty = useMemo(
    () =>
      signalMonitorEditableSettingsJson(profile) !==
      signalMonitorEditableSettingsJson(draft),
    [draft, profile],
  );

  useEffect(() => {
    if (!profile) return;
    const nextProfileJson = JSON.stringify(profile);
    setDraft((current) => {
      const currentJson = JSON.stringify(current || {});
      const shouldReplace =
        !current || currentJson === (lastProfileJsonRef.current || "{}");
      return shouldReplace ? profile : current;
    });
    lastProfileJsonRef.current = nextProfileJson;
  }, [profile]);

  const describeError = useCallback(
    (err, fallback) => err?.detail || err?.message || fallback,
    [],
  );

  const load = useCallback(() => {
    if (!enabled) return Promise.resolve();
    setLocalError(null);
    return Promise.all([
      profileQuery.refetch(),
      stateQuery.refetch(),
      eventsQuery.refetch(),
    ])
      .then(([nextProfile]) => {
        if (nextProfile.data) {
          setDraft(nextProfile.data);
        }
      })
      .catch((err) => {
        setLocalError(describeError(err, "Signal monitor settings are unavailable."));
      });
  }, [describeError, enabled, eventsQuery, profileQuery, stateQuery]);

  const patchDraft = useCallback((patch) => {
    setDraft((current) => ({ ...(current || {}), ...patch }));
  }, []);

  const updateProfileMutation = useUpdateSignalMonitorProfile({
    mutation: {
      onSuccess: (payload) => {
        if (payload.environment) {
          queryClient.setQueryData(
            getGetSignalMonitorProfileQueryKey({ environment: payload.environment }),
            payload,
          );
          queryClient.invalidateQueries({
            queryKey: getGetSignalMonitorStateQueryKey({
              environment: payload.environment,
            }),
          });
          queryClient.invalidateQueries({
            queryKey: getListSignalMonitorEventsQueryKey({
              environment: payload.environment,
              limit: signalMonitorEventsParams.limit,
            }),
          });
        }
        setDraft(payload);
        toast.push({
          kind: "success",
          title: "Signal monitor settings saved",
        });
      },
      onError: (err) => {
        const message = describeError(err, "Failed to save signal monitor settings.");
        setLocalError(message);
        toast.push({
          kind: "error",
          title: "Signal settings failed",
          body: message,
        });
      },
    },
  });

  const evaluateMutation = useEvaluateSignalMonitor({
    mutation: {
      onSuccess: (payload) => {
        if (payload.profile?.environment) {
          queryClient.setQueryData(
            getGetSignalMonitorStateQueryKey({ environment: payload.profile.environment }),
            payload,
          );
          queryClient.invalidateQueries({
            queryKey: getListSignalMonitorEventsQueryKey({
              environment: payload.profile.environment,
              limit: signalMonitorEventsParams.limit,
            }),
          });
        }
        queryClient.invalidateQueries({
          queryKey: getListSignalMonitorEventsQueryKey(signalMonitorEventsParams),
        });
        if (payload.profile) {
          if (payload.profile.environment) {
            queryClient.setQueryData(
              getGetSignalMonitorProfileQueryKey({ environment: payload.profile.environment }),
              payload.profile,
            );
          }
          setDraft(payload.profile);
        }
        toast.push({
          kind: "success",
          title: "Signal monitor scan complete",
          body: `${payload?.states?.length || 0} symbols evaluated.`,
        });
      },
      onError: (err) => {
        const message = describeError(err, "Signal monitor evaluation failed.");
        setLocalError(message);
        toast.push({
          kind: "error",
          title: "Signal scan failed",
          body: message,
        });
      },
    },
  });

  const save = useCallback(() => {
    if (!draft) return;
    setLocalError(null);
    const shouldEvaluate = signalMonitorScanAffectingSettingsChanged(profile, draft);
    updateProfileMutation.mutate(
      {
        data: {
          environment: SIGNAL_MONITOR_ENVIRONMENT,
          enabled: Boolean(draft.enabled),
          watchlistId: draft.watchlistId || null,
          timeframe: draft.timeframe,
          freshWindowBars: Number(draft.freshWindowBars),
          pollIntervalSeconds: Number(draft.pollIntervalSeconds),
          maxSymbols: Number(draft.maxSymbols),
          evaluationConcurrency: Number(draft.evaluationConcurrency),
          pyrusSignalsSettings: draft.pyrusSignalsSettings || {},
        },
      },
      {
        onSuccess: (payload) => {
          if (payload?.enabled && shouldEvaluate) {
            evaluateMutation.mutate({
              data: {
                environment: SIGNAL_MONITOR_ENVIRONMENT,
                mode: "incremental",
              },
            });
          }
        },
      },
    );
  }, [draft, evaluateMutation, profile, updateProfileMutation]);

  const evaluate = useCallback((mode = "incremental") => {
    setLocalError(null);
    evaluateMutation.mutate({
      data: {
        environment: SIGNAL_MONITOR_ENVIRONMENT,
        mode,
      },
    });
  }, [evaluateMutation]);

  const queryError = profileQuery.error || stateQuery.error || eventsQuery.error;
  const loading =
    profileQuery.isFetching || stateQuery.isFetching || eventsQuery.isFetching;

  return {
    profile,
    draft,
    state,
    events,
    loading,
    saving: updateProfileMutation.isPending,
    evaluating: evaluateMutation.isPending,
    dirty,
    error:
      localError ||
      (queryError
        ? describeError(queryError, "Signal monitor settings are unavailable.")
        : null),
    patchDraft,
    save,
    discard: () => setDraft(profile),
    reload: load,
    evaluate,
  };
}

function useResearchStatus({ enabled = true } = {}) {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const load = useCallback(() => {
    fetch("/api/research/status", { headers: { Accept: "application/json" } })
      .then((response) =>
        response.ok ? response.json() : response.json().then((payload) => Promise.reject(payload)),
      )
      .then((payload) => {
        setStatus(payload);
        setError(null);
      })
      .catch((err) => setError(err?.detail || err?.message || "Research status is unavailable."));
  }, []);

  useEffect(() => {
    if (!enabled) return;
    load();
  }, [enabled, load]);

  return { status, error, reload: load };
}

function useWorkspaceDefaults() {
  const [state, setState] = useState(() => readWorkspaceState());
  const patch = useCallback((nextPatch) => {
    const next = writeWorkspaceState(nextPatch);
    if (next) {
      setState(next);
    }
  }, []);

  useEffect(() => {
    const listener = () => setState(readWorkspaceState());
      window.addEventListener(PYRUS_WORKSPACE_SETTINGS_EVENT, listener);
    window.addEventListener("storage", listener);
    return () => {
      window.removeEventListener(PYRUS_WORKSPACE_SETTINGS_EVENT, listener);
      window.removeEventListener("storage", listener);
    };
  }, []);

  const resetKeys = useCallback((keys) => {
    const current = readWorkspaceState();
    keys.forEach((key) => {
      delete current[key];
    });
    window.localStorage.setItem(PYRUS_STORAGE_KEY, JSON.stringify(current));
    window.dispatchEvent(new CustomEvent(PYRUS_WORKSPACE_SETTINGS_EVENT, { detail: current }));
    setState(current);
  }, []);

  return { state, patch, resetKeys };
}

function useStorageFootprint() {
  const [snapshot, setSnapshot] = useState(() => readStorageFootprint());
  const refresh = useCallback(() => setSnapshot(readStorageFootprint()), []);

  useEffect(() => {
    const listener = () => refresh();
    window.addEventListener(PYRUS_WORKSPACE_SETTINGS_EVENT, listener);
    window.addEventListener("storage", listener);
    return () => {
      window.removeEventListener(PYRUS_WORKSPACE_SETTINGS_EVENT, listener);
      window.removeEventListener("storage", listener);
    };
  }, [refresh]);

  const clearLocalKeys = useCallback((predicate) => {
    try {
      const keys = [];
      for (let index = 0; index < window.localStorage.length; index += 1) {
        const key = window.localStorage.key(index);
        if (key && predicate(key)) keys.push(key);
      }
      keys.forEach((key) => window.localStorage.removeItem(key));
      window.dispatchEvent(
        new CustomEvent(PYRUS_WORKSPACE_SETTINGS_EVENT, { detail: readWorkspaceState() }),
      );
      refresh();
    } catch {}
  }, [refresh]);

  const clearSessionKeys = useCallback((keys) => {
    try {
      keys.forEach((key) => window.sessionStorage.removeItem(key));
      refresh();
    } catch {}
  }, [refresh]);

  return { snapshot, refresh, clearLocalKeys, clearSessionKeys };
}

function readStorageFootprint() {
  const readArea = (storage) => {
    try {
      if (!storage) return { totalBytes: 0, count: 0, entries: [] };
      const entries = [];
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (!key) continue;
        const value = storage.getItem(key) || "";
        entries.push({ key, bytes: estimateStorageBytes(key, value) });
      }
      entries.sort((a, b) => b.bytes - a.bytes);
      return {
        totalBytes: entries.reduce((sum, entry) => sum + entry.bytes, 0),
        count: entries.length,
        entries,
      };
    } catch {
      return { totalBytes: 0, count: 0, entries: [] };
    }
  };

  return {
    local: readArea(typeof window !== "undefined" ? window.localStorage : null),
    session: readArea(typeof window !== "undefined" ? window.sessionStorage : null),
  };
}

function useDiagnosticAlertPreferences() {
  const [preferences, setPreferences] = useState(readLocalAlertPreferences);

  const commit = useCallback((nextPreferences) => {
    writeLocalAlertPreferences(nextPreferences);
    const normalized = readLocalAlertPreferences();
    setPreferences(normalized);
    window.dispatchEvent(
      new CustomEvent(LOCAL_ALERT_PREFERENCES_EVENT, { detail: normalized }),
    );
    return normalized;
  }, []);

  const patch = useCallback((patchValue) => {
    setPreferences((current) => {
      const next = { ...current, ...patchValue };
      writeLocalAlertPreferences(next);
      const normalized = readLocalAlertPreferences();
      window.dispatchEvent(
        new CustomEvent(LOCAL_ALERT_PREFERENCES_EVENT, { detail: normalized }),
      );
      return normalized;
    });
  }, []);

  const snooze = useCallback((minutes) => {
    commit({
      ...preferences,
      audioMutedUntil: minutes > 0 ? Date.now() + minutes * 60_000 : 0,
    });
  }, [commit, preferences]);

  const clearDismissals = useCallback(() => {
    commit({ ...preferences, dismissedAlerts: {} });
  }, [commit, preferences]);

  const reset = useCallback(() => {
    commit({ audioEnabled: true, audioMutedUntil: 0, dismissedAlerts: {} });
  }, [commit]);

  return { preferences, patch, snooze, clearDismissals, reset };
}

function StoragePrunePanel() {
  const toast = useToast();
  const [olderThanDays, setOlderThanDays] = useState(7);
  const [dryRun, setDryRun] = useState(true);
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);

  const run = () => {
    if (!dryRun) {
      const confirmed = window.confirm(
        "Prune diagnostic storage now? Run a dry-run first unless you already reviewed the affected rows.",
      );
      if (!confirmed) return;
    }
    setRunning(true);
    setError(null);
    fetch("/api/settings/backend/actions/diagnostics.storage.prune", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ olderThanDays, dryRun }),
    })
      .then((response) =>
        response.ok
          ? response.json()
          : response.json().then((payload) => Promise.reject(payload)),
      )
      .then((payload) => {
        setResult(payload);
        toast.push({
          kind: dryRun ? "info" : "success",
          title: dryRun ? "Storage dry run complete" : "Diagnostic storage pruned",
          body: dryRun
            ? "Review the prune result before running the destructive action."
            : "Diagnostic storage cleanup completed.",
        });
      })
      .catch((err) => {
        const message = err?.detail || err?.message || "Storage prune failed.";
        setError(message);
        toast.push({
          kind: "error",
          title: "Storage prune failed",
          body: message,
        });
      })
      .finally(() => setRunning(false));
  };

  return (
    <Panel
      title="Diagnostic Storage Prune"
      action={
        <Button
          size="sm"
          variant={dryRun ? "soft-selected" : "soft-danger"}
          onClick={run}
          disabled={running}
        >
          {running ? "Running" : dryRun ? "Dry Run" : "Prune"}
        </Button>
      }
    >
      <div style={{ display: "grid", gridTemplateColumns: `minmax(${dim(160)}px, ${dim(220)}px) 1fr`, gap: sp(10), alignItems: "end" }}>
        <PlatformTextField
          label="Older Than Days"
          type="number"
          value={olderThanDays}
          onChange={(event) => setOlderThanDays(Number(event.target.value))}
          inputProps={{ min: 1 }}
        />
        <label style={{ display: "flex", alignItems: "center", gap: sp(7), color: CSS_COLOR.textSec, fontFamily: T.sans, fontSize: fs(10) }}>
          <input
            type="checkbox"
            checked={dryRun}
            onChange={(event) => setDryRun(event.target.checked)}
          />
          Dry-run only
        </label>
      </div>
      {error && <div role="alert" style={{ color: CSS_COLOR.red, fontFamily: T.sans, fontSize: textSize("caption"), marginTop: sp(10) }}>{error}</div>}
      {result && (
        <div style={{ marginTop: sp(12) }}>
          <JsonBlock value={result} />
        </div>
      )}
    </Panel>
  );
}

function BrowserStorageFootprintPanel() {
  const storage = useStorageFootprint();
  const localEntries = storage.snapshot.local.entries.slice(0, 8);
  const sessionEntries = storage.snapshot.session.entries.slice(0, 5);

  return (
    <Panel
      title="Browser Storage Footprint"
      action={
        <Button size="sm" variant="soft" onClick={storage.refresh}>
          Refresh
        </Button>
      }
    >
      <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(${dim(190)}px, 1fr))`, gap: sp(8), marginBottom: sp(8) }}>
        <StateRow
          label="Local storage"
          value={`${formatBytes(storage.snapshot.local.totalBytes)} / ${storage.snapshot.local.count} keys`}
          tone={storage.snapshot.local.totalBytes > 2 * 1024 * 1024 ? CSS_COLOR.amber : CSS_COLOR.textSec}
        />
        <StateRow
          label="Session storage"
          value={`${formatBytes(storage.snapshot.session.totalBytes)} / ${storage.snapshot.session.count} keys`}
          tone={CSS_COLOR.textSec}
        />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(${dim(260)}px, 1fr))`, gap: sp(8) }}>
        <div>
          <div style={{ color: CSS_COLOR.textDim, fontFamily: T.sans, fontSize: textSize("caption"), fontWeight: FONT_WEIGHTS.regular, marginBottom: sp(6) }}>
            Largest Local Keys
          </div>
          {localEntries.map((entry) => (
            <StateRow key={entry.key} label={entry.key} value={formatBytes(entry.bytes)} />
          ))}
          {!localEntries.length && (
            <DataUnavailableState
              title="No local storage keys"
              detail="This browser has nothing stored in local storage yet."
              minHeight={56}
            />
          )}
        </div>
        <div>
          <div style={{ color: CSS_COLOR.textDim, fontFamily: T.sans, fontSize: textSize("caption"), fontWeight: FONT_WEIGHTS.regular, marginBottom: sp(6) }}>
            Largest Session Keys
          </div>
          {sessionEntries.map((entry) => (
            <StateRow key={entry.key} label={entry.key} value={formatBytes(entry.bytes)} />
          ))}
          {!sessionEntries.length && (
            <DataUnavailableState
              title="No session storage keys"
              detail="This browser has nothing stored in session storage yet."
              minHeight={56}
            />
          )}
        </div>
      </div>
      <div style={{ display: "flex", gap: sp(8), flexWrap: "wrap", marginTop: sp(12) }}>
        <Button
          size="sm"
          variant="soft"
          onClick={() =>
            storage.clearLocalKeys(
              (key) => key.startsWith(CHART_SCALE_PREFS_STORAGE_PREFIX),
            )
          }
        >
          Clear chart scale prefs
        </Button>
        <Button
          size="sm"
          variant="soft"
          onClick={() =>
            storage.clearLocalKeys(
              (key) => key === OPTION_HYDRATION_HISTORY_STORAGE_KEY,
            )
          }
        >
          Clear option hydration history
        </Button>
        <Button
          size="sm"
          variant="soft"
          onClick={() =>
            storage.clearSessionKeys([MARKET_GRID_TRACK_SESSION_KEY])
          }
        >
          Reset market grid sizing
        </Button>
      </div>
    </Panel>
  );
}

function AppPreferencesPanel({
  sidebarCollapsed = false,
  onToggleSidebar,
  activitySidebarCollapsed = false,
  onToggleActivitySidebar,
}) {
  // Unframed rows (no card-inside-card): each preference is a labeled row with
  // a SegmentedControl carrying the current + alternate state, replacing the
  // nested mini-card + single toggle button.
  const rowStyle = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: sp(10),
    borderBottom: `1px solid ${cssColorMix(CSS_COLOR.border, 33)}`,
    padding: sp("7px 0"),
    fontFamily: T.sans,
    fontSize: fs(10),
  };
  const rowLabelStyle = { color: CSS_COLOR.textDim, minWidth: 0 };
  return (
    <Panel title="App Preferences">
      <div style={{ display: "grid", gap: sp(2) }}>
        <div style={rowStyle}>
          <span style={rowLabelStyle}>Watchlist sidebar</span>
          <SegmentedControl
            radioGroup
            ariaLabel="Watchlist sidebar"
            value={sidebarCollapsed ? "collapsed" : "expanded"}
            onChange={(value) => {
              if ((value === "collapsed") !== sidebarCollapsed) onToggleSidebar?.();
            }}
            options={[
              { value: "expanded", label: "Expanded" },
              { value: "collapsed", label: "Collapsed" },
            ]}
          />
        </div>
        <div style={rowStyle}>
          <span style={rowLabelStyle}>Algo monitor sidebar</span>
          <SegmentedControl
            radioGroup
            ariaLabel="Algo monitor sidebar"
            value={activitySidebarCollapsed ? "collapsed" : "expanded"}
            onChange={(value) => {
              if ((value === "collapsed") !== activitySidebarCollapsed)
                onToggleActivitySidebar?.();
            }}
            options={[
              { value: "expanded", label: "Expanded" },
              { value: "collapsed", label: "Collapsed" },
            ]}
          />
        </div>
      </div>
    </Panel>
  );
}

function SyncedUserPreferencesPanel({ userPreferences, theme = "dark", onToggleTheme }) {
  const prefs = userPreferences.preferences || DEFAULT_USER_PREFERENCES;
  const patchSection = (section, patch) => userPreferences.patch({ [section]: patch });
  const setThemePreference = (value) => {
    patchSection("appearance", { theme: value });
    if ((value === "dark" || value === "light") && value !== theme) {
      onToggleTheme?.();
    }
  };
  const setAccentPreset = (value) => {
    patchSection("appearance", { accentPreset: value });
    if (typeof document !== "undefined") {
      document.documentElement.setAttribute("data-pyrus-accent-preset", value);
    }
  };

  return (
    <div style={{ display: "grid", gap: sp(14) }}>
      <Panel
        title="Synced Preferences"
        action={
          <div style={{ display: "flex", gap: sp(7), flexWrap: "wrap", justifyContent: "flex-end" }}>
            <Button size="sm" variant="soft" onClick={userPreferences.reload} disabled={userPreferences.loading}>
              Refresh
            </Button>
            <Button size="sm" variant="soft-danger" onClick={userPreferences.reset} disabled={userPreferences.saving}>
              Reset
            </Button>
          </div>
        }
      >
        {userPreferences.error && (
          <div role="alert" style={{ color: CSS_COLOR.red, fontFamily: T.sans, fontSize: textSize("caption"), marginBottom: sp(10) }}>
            {userPreferences.error}
          </div>
        )}
        <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(${dim(180)}px, 1fr))`, gap: sp(8) }}>
          <StateRow label="Source" value={userPreferences.snapshot?.source || "local"} tone={userPreferences.snapshot?.source === "database" ? CSS_COLOR.green : CSS_COLOR.amber} />
          <StateRow label="Status" value={userPreferences.saving ? "saving" : userPreferences.loading ? "loading" : "synced"} tone={userPreferences.saving || userPreferences.loading ? CSS_COLOR.amber : CSS_COLOR.green} />
          <StateRow label="App time" value={formatPreferenceTimeZoneLabel(prefs, "app")} />
          <StateRow label="Chart time" value={formatPreferenceTimeZoneLabel(prefs, "chart")} />
        </div>
      </Panel>

      <Panel title="Appearance">
        <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(${dim(175)}px, 1fr))`, gap: sp(8) }}>
          <SelectField
            label="Theme"
            value={prefs.appearance.theme}
            onChange={setThemePreference}
            options={USER_THEME_OPTIONS}
          />
          <SelectField
            label="Accent Preset"
            value={prefs.appearance.accentPreset || "pyrus"}
            onChange={setAccentPreset}
            options={[
              { value: "pyrus", label: "PYRUS Blue" },
              { value: "coral", label: "Coral" },
              { value: "amber", label: "Bloomberg Amber" },
              { value: "green", label: "Robinhood Green" },
              { value: "aurora", label: "Aurora Purple" },
            ]}
          />
          <SelectField
            label="Density"
            value={prefs.appearance.density}
            onChange={(value) => patchSection("appearance", { density: value })}
            options={["compact", "comfortable"]}
          />
          <SelectField
            label="Scale"
            value={prefs.appearance.scale}
            onChange={(value) => patchSection("appearance", { scale: value })}
            options={USER_SCALE_OPTIONS}
          />
          <SelectField
            label="Reduced Motion"
            value={prefs.appearance.reducedMotion}
            onChange={(value) => patchSection("appearance", { reducedMotion: value })}
            options={["system", "on", "off"]}
          />
          <CheckboxField
            label="Mask balances"
            checked={prefs.appearance.maskBalances}
            onChange={(value) => patchSection("appearance", { maskBalances: value })}
          />
        </div>
        <div style={{ marginTop: sp(8), display: "grid", gap: sp(3) }}>
          <TextField
            label="Header KPI symbols (comma-separated, blank = active watchlist)"
            value={Array.isArray(prefs.appearance.headerKpiSymbols)
              ? prefs.appearance.headerKpiSymbols.join(", ")
              : ""}
            placeholder="e.g. SPY, QQQ, AAPL, MSFT, NVDA"
            onChange={(raw) => {
              const parsed = String(raw || "")
                .split(/[,\s]+/)
                .map((token) => token.trim().toUpperCase())
                .filter(Boolean);
              patchSection("appearance", { headerKpiSymbols: parsed });
            }}
          />
          <div style={{ display: "flex", gap: sp(4), alignItems: "center" }}>
            <span style={{ color: CSS_COLOR.textMuted, fontSize: fs(10), fontFamily: T.sans }}>
              Up to 10 symbols. Invalid entries are dropped on save.
            </span>
            <button
              type="button"
              onClick={() => patchSection("appearance", { headerKpiSymbols: [] })}
              style={{
                background: "transparent",
                border: "none",
                color: CSS_COLOR.accent,
                cursor: "pointer",
                fontFamily: T.sans,
                fontSize: fs(10),
                padding: sp("2px 4px"),
              }}
            >
              Use active watchlist
            </button>
          </div>
        </div>
      </Panel>

      <Panel title="Time Display">
        <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(${dim(175)}px, 1fr))`, gap: sp(8) }}>
          <SelectField
            label="App Time Zone"
            value={prefs.time.appTimeZoneMode}
            onChange={(value) => patchSection("time", { appTimeZoneMode: value })}
            options={APP_TIME_ZONE_MODE_OPTIONS}
          />
          <SelectField
            label="Chart Time Zone"
            value={prefs.time.chartTimeZoneMode}
            onChange={(value) => patchSection("time", { chartTimeZoneMode: value })}
            options={CHART_TIME_ZONE_MODE_OPTIONS}
          />
          <SelectField
            label="Fixed Zone"
            value={prefs.time.fixedTimeZone}
            onChange={(value) => patchSection("time", { fixedTimeZone: value })}
            options={TIME_ZONE_OPTIONS}
          />
          <SelectField
            label="Hour Cycle"
            value={prefs.time.hourCycle}
            onChange={(value) => patchSection("time", { hourCycle: value })}
            options={[
              { value: "auto", label: "Auto" },
              { value: "h12", label: "12 hour" },
              { value: "h23", label: "24 hour" },
            ]}
          />
          <SelectField
            label="Date Format"
            value={prefs.time.dateFormat}
            onChange={(value) => patchSection("time", { dateFormat: value })}
            options={[
              { value: "locale", label: "Locale" },
              { value: "mdy", label: "MM/DD/YYYY" },
              { value: "ymd", label: "YYYY/MM/DD" },
              { value: "dmy", label: "DD/MM/YYYY" },
            ]}
          />
          <CheckboxField
            label="Seconds"
            checked={prefs.time.showSeconds}
            onChange={(value) => patchSection("time", { showSeconds: value })}
          />
          <CheckboxField
            label="Time zone badge"
            checked={prefs.time.showTimeZoneBadge}
            onChange={(value) => patchSection("time", { showTimeZoneBadge: value })}
          />
        </div>
      </Panel>

      <Panel title="Privacy">
        <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(${dim(190)}px, 1fr))`, gap: sp(8) }}>
          <CheckboxField
            label="Hide account values"
            checked={prefs.privacy.hideAccountValues}
            onChange={(value) => patchSection("privacy", { hideAccountValues: value })}
          />
          <CheckboxField
            label="Persist chart viewports"
            checked={prefs.privacy.persistChartViewports}
            onChange={(value) => patchSection("privacy", { persistChartViewports: value })}
          />
          <CheckboxField
            label="Show diagnostics here"
            checked={prefs.privacy.showDiagnosticsInSettings}
            onChange={(value) => patchSection("privacy", { showDiagnosticsInSettings: value })}
          />
        </div>
      </Panel>
    </div>
  );
}

function ChartDisplayPreferencesPanel({ userPreferences }) {
  const prefs = userPreferences.preferences || DEFAULT_USER_PREFERENCES;
  const chart = prefs.chart;
  const patchChart = (patch) => userPreferences.patch({ chart: patch });

  return (
    <Panel title="Chart Display">
      <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(${dim(175)}px, 1fr))`, gap: sp(8) }}>
        <SelectField
          label="Status Line"
          value={chart.statusLineDetail}
          onChange={(value) => patchChart({ statusLineDetail: value })}
          options={[
            { value: "full", label: "Full" },
            { value: "compact", label: "Compact" },
            { value: "minimal", label: "Minimal" },
          ]}
        />
        <SelectField
          label="Crosshair"
          value={chart.crosshairMode}
          onChange={(value) => patchChart({ crosshairMode: value })}
          options={[
            { value: "magnet", label: "Magnet" },
            { value: "free", label: "Free" },
          ]}
        />
        <SelectField
          label="Price Scale"
          value={chart.priceScaleMode}
          onChange={(value) => patchChart({ priceScaleMode: value })}
          options={[
            { value: "linear", label: "Linear" },
            { value: "log", label: "Log" },
            { value: "percent", label: "Percent" },
            { value: "indexed", label: "Indexed" },
          ]}
        />
        <SelectField
          label="PYRUS Panel"
          value={chart.pyrusSignalsDashboard}
          onChange={(value) => patchChart({ pyrusSignalsDashboard: value })}
          options={[
            { value: "auto", label: "Auto" },
            { value: "full", label: "Full" },
            { value: "compact", label: "Compact" },
            { value: "hidden", label: "Hidden" },
          ]}
        />
        <NumberField
          label="Future Bars"
          value={chart.futureExpansionBars}
          min={0}
          max={MAX_CHART_FUTURE_EXPANSION_BARS}
          onChange={(value) => patchChart({ futureExpansionBars: value })}
        />
        <CheckboxField label="OHLC" checked={chart.showOhlc} onChange={(value) => patchChart({ showOhlc: value })} />
        <CheckboxField label="Volume" checked={chart.showVolume} onChange={(value) => patchChart({ showVolume: value })} />
        <CheckboxField label="Flow events" checked={chart.showFlowEvents} onChange={(value) => patchChart({ showFlowEvents: value })} />
        <CheckboxField label="Indicator values" checked={chart.showIndicatorValues} onChange={(value) => patchChart({ showIndicatorValues: value })} />
        <CheckboxField label="Time axis" checked={chart.showTimeScale} onChange={(value) => patchChart({ showTimeScale: value })} />
        <CheckboxField label="Grid" checked={chart.showGrid} onChange={(value) => patchChart({ showGrid: value })} />
        <CheckboxField label="Keep zoom" checked={chart.keepTimeZoom} onChange={(value) => patchChart({ keepTimeZoom: value })} />
        <CheckboxField label="Extended hours" checked={chart.extendedHours} onChange={(value) => patchChart({ extendedHours: value })} />
        <CheckboxField label="Session breaks" checked={chart.sessionBreaks} onChange={(value) => patchChart({ sessionBreaks: value })} />
        <CheckboxField
          label="Desktop crosshair badge"
          checked={chart.desktopCrosshairBadge}
          onChange={(value) => patchChart({ desktopCrosshairBadge: value })}
        />
        <CheckboxField
          label="Ticker watermark"
          checked={chart.showTickerWatermark}
          onChange={(value) => patchChart({ showTickerWatermark: value })}
        />
      </div>
    </Panel>
  );
}

function WorkspaceProfilePreferencesPanel({ userPreferences }) {
  const prefs = userPreferences.preferences || DEFAULT_USER_PREFERENCES;
  const workspace = prefs.workspace;
  const patchWorkspace = (patch) => userPreferences.patch({ workspace: patch });

  return (
    <Panel title="Synced Workspace Profile">
      <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(${dim(175)}px, 1fr))`, gap: sp(8) }}>
        <SelectField
          label="Default Screen"
          value={workspace.defaultScreen}
          onChange={(value) => patchWorkspace({ defaultScreen: value })}
          options={DEFAULT_SCREEN_OPTIONS}
        />
        <TextField
          label="Default Symbol"
          value={workspace.defaultSymbol}
          placeholder="SPY"
          onChange={(value) => patchWorkspace({ defaultSymbol: value.toUpperCase() })}
          transformInput={(value) => value.toUpperCase()}
        />
        <SelectField
          label="Market Grid"
          value={workspace.marketGridLayout}
          onChange={(value) => patchWorkspace({ marketGridLayout: value })}
          options={MARKET_GRID_LAYOUTS}
        />
        <SelectField
          label="Flow Density"
          value={workspace.flowDensity}
          onChange={(value) => patchWorkspace({ flowDensity: value })}
          options={FLOW_DENSITY_OPTIONS}
        />
        <SelectField
          label="Flow Rows"
          value={String(workspace.flowRowsPerPage)}
          onChange={(value) => patchWorkspace({ flowRowsPerPage: Number(value) })}
          options={FLOW_ROWS_OPTIONS.map((value) => String(value))}
        />
      </div>
    </Panel>
  );
}

function NotificationPreferencePanel({ userPreferences }) {
  const prefs = userPreferences.preferences || DEFAULT_USER_PREFERENCES;
  const notifications = prefs.notifications;
  const trading = prefs.trading;
  const patchNotifications = (patch) => {
    userPreferences.patch({ notifications: patch });
    if (
      Object.prototype.hasOwnProperty.call(patch, "audioEnabled") ||
      Object.prototype.hasOwnProperty.call(patch, "alertVolume")
    ) {
      const next = {
        ...readLocalAlertPreferences(),
        ...(Object.prototype.hasOwnProperty.call(patch, "audioEnabled")
          ? { audioEnabled: patch.audioEnabled }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(patch, "alertVolume")
          ? { alertVolume: patch.alertVolume }
          : {}),
      };
      writeLocalAlertPreferences(next);
      window.dispatchEvent(
        new CustomEvent(LOCAL_ALERT_PREFERENCES_EVENT, { detail: next }),
      );
    }
    if (
      patch.desktopNotifications === "on" &&
      typeof Notification !== "undefined" &&
      Notification.permission === "default"
    ) {
      void Notification.requestPermission();
    }
  };
  const patchTrading = (patch) => userPreferences.patch({ trading: patch });

  return (
    <div style={{ display: "grid", gap: sp(14) }}>
      <Panel title="Notifications">
        <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(${dim(175)}px, 1fr))`, gap: sp(8) }}>
          <SelectField
            label="Desktop"
            value={notifications.desktopNotifications}
            onChange={(value) => patchNotifications({ desktopNotifications: value })}
            options={[
              { value: "ask", label: "Ask" },
              { value: "on", label: "On" },
              { value: "off", label: "Off" },
            ]}
          />
          <NumberField
            label="Alert Volume"
            value={notifications.alertVolume}
            min={0}
            max={100}
            onChange={(value) => patchNotifications({ alertVolume: value })}
          />
          <TextField
            label="Quiet Start"
            value={notifications.quietHoursStart}
            placeholder="20:00"
            onChange={(value) => patchNotifications({ quietHoursStart: value })}
          />
          <TextField
            label="Quiet End"
            value={notifications.quietHoursEnd}
            placeholder="06:00"
            onChange={(value) => patchNotifications({ quietHoursEnd: value })}
          />
          <CheckboxField label="Audio" checked={notifications.audioEnabled} onChange={(value) => patchNotifications({ audioEnabled: value })} />
          <CheckboxField label="Quiet hours" checked={notifications.quietHoursEnabled} onChange={(value) => patchNotifications({ quietHoursEnabled: value })} />
        </div>
      </Panel>
      <Panel title="Trading Display">
        <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(${dim(190)}px, 1fr))`, gap: sp(8) }}>
          <CheckboxField label="Confirm orders" checked={trading.confirmOrders} onChange={(value) => patchTrading({ confirmOrders: value })} />
          <CheckboxField label="Execution markers" checked={trading.showExecutionMarkers} onChange={(value) => patchTrading({ showExecutionMarkers: value })} />
          <CheckboxField label="Position lines" checked={trading.showPositionLines} onChange={(value) => patchTrading({ showPositionLines: value })} />
        </div>
      </Panel>
    </div>
  );
}

function ChartTimeframeFavoritesPanel() {
  const workspace = useWorkspaceDefaults();
  const favoritesState = safeRecord(workspace.state.chartTimeframeFavorites);
  const resetRole = (role) => {
    const { [role]: _removed, ...nextFavorites } = favoritesState;
    workspace.patch({
      chartTimeframeFavorites: nextFavorites,
    });
  };
  const toggle = (role, timeframe) => {
    const current = resolveChartTimeframeFavorites(favoritesState[role], role);
    const next = current.includes(timeframe)
      ? current.length <= 1
        ? current
        : current.filter((item) => item !== timeframe)
      : [...current, timeframe];
    workspace.patch({
      chartTimeframeFavorites: {
        ...favoritesState,
        [role]: resolveChartTimeframeFavorites(next, role),
      },
    });
  };

  return (
    <Panel title="Chart Timeframe Favorites">
      <div style={{ color: CSS_COLOR.textDim, fontFamily: T.sans, fontSize: textSize("caption"), marginBottom: sp(10) }}>
        Controls the quick-pick timeframe buttons used by the primary chart, market grid charts, and option charts.
      </div>
      <div style={{ display: "grid", gap: sp(14) }}>
        {CHART_TIMEFRAME_ROLES.map((role, roleIndex) => {
          const options = getChartTimeframeOptions(role.value);
          const favorites = resolveChartTimeframeFavorites(favoritesState[role.value], role.value);
          const atCap = favorites.length >= 8;
          return (
            <div
              key={role.value}
              style={{
                display: "grid",
                gap: sp(8),
                // Unframed labeled band (no card-inside-card): roles separate
                // with a hairline divider instead of a nested bordered surface.
                ...(roleIndex > 0
                  ? {
                      borderTop: `1px solid ${cssColorMix(CSS_COLOR.border, 33)}`,
                      paddingTop: sp(12),
                    }
                  : null),
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: sp(10) }}>
                <div style={{ color: CSS_COLOR.text, fontWeight: FONT_WEIGHTS.medium, fontSize: textSize("paragraphMuted") }}>{role.label}</div>
                <Button size="sm" variant="soft" onClick={() => resetRole(role.value)}>
                  Reset
                </Button>
              </div>
              <div style={{ display: "flex", gap: sp(6), flexWrap: "wrap" }}>
                {options.map((option) => {
                  const active = favorites.includes(option.value);
                  return (
                    <span
                      key={option.value}
                      style={{ display: "inline-flex", opacity: !active && atCap ? 0.75 : 1 }}
                    >
                      <Pill active={active} onClick={() => toggle(role.value, option.value)}>
                        {option.label}
                      </Pill>
                    </span>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

function DiagnosticAlertPreferencesPanel() {
  const alerts = useDiagnosticAlertPreferences();
  const { preferences: userPreferences } = useUserPreferences();
  const prefs = alerts.preferences;
  const dismissedCount = Object.keys(safeRecord(prefs.dismissedAlerts)).length;
  const mutedUntil = Number(prefs.audioMutedUntil) || 0;
  const mutedActive = mutedUntil > Date.now();

  return (
    <Panel
      title="Diagnostic Alert Preferences"
      action={
        <Button size="sm" variant="soft-danger" onClick={alerts.reset}>
          Reset alerts
        </Button>
      }
    >
      <div style={{ color: CSS_COLOR.textDim, fontFamily: T.sans, fontSize: textSize("caption"), marginBottom: sp(10) }}>
        Controls the local browser alert state used by Diagnostics for crash-risk, cache, and memory warnings.
      </div>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(${dim(190)}px, 1fr))`, gap: sp(8) }}>
        <label style={{ ...labelStyle(), flexDirection: "row", alignItems: "center" }}>
          <input
            type="checkbox"
            checked={prefs.audioEnabled !== false}
            onChange={(event) => alerts.patch({ audioEnabled: event.target.checked })}
          />
          Audio alerts
        </label>
        <StateRow
          label="Audio snooze"
          value={
            mutedActive
              ? formatAppTimeForPreferences(mutedUntil, userPreferences)
              : "not snoozed"
          }
          tone={mutedActive ? CSS_COLOR.amber : CSS_COLOR.green}
        />
        <StateRow label="Dismissed alerts" value={dismissedCount} tone={dismissedCount > 0 ? CSS_COLOR.amber : CSS_COLOR.textSec} />
      </div>
      <div style={{ display: "flex", gap: sp(8), flexWrap: "wrap", marginTop: sp(12) }}>
        <Button size="sm" variant="soft" onClick={() => alerts.snooze(15)}>
          Snooze 15m
        </Button>
        <Button size="sm" variant="soft" onClick={() => alerts.snooze(60)}>
          Snooze 1h
        </Button>
        <Button size="sm" variant={mutedActive ? "soft-selected" : "soft"} onClick={() => alerts.snooze(0)}>
          Clear snooze
        </Button>
        <Button size="sm" variant={dismissedCount > 0 ? "soft-danger" : "soft"} onClick={alerts.clearDismissals}>
          Clear dismissals
        </Button>
      </div>
    </Panel>
  );
}

function WorkspaceDefaultsPanel() {
  const workspace = useWorkspaceDefaults();
  const state = workspace.state || {};
  const headerPreset = resolveHeaderBroadcastSpeedPreset(state.headerBroadcastSpeedPreset);
  const flowRows = FLOW_ROWS_OPTIONS.includes(Number(state.flowRowsPerPage))
    ? Number(state.flowRowsPerPage)
    : 40;
  const accountRange = ACCOUNT_RANGE_OPTIONS.includes(state.accountRange)
    ? state.accountRange
    : "ALL";
  const accountAssetFilter = normalizeAccountPositionTypeFilter(
    state.accountAssetFilter,
  );
  const accountOrderTab = ACCOUNT_ORDER_TAB_OPTIONS.some((option) => option.value === state.accountOrderTab)
    ? state.accountOrderTab
    : "working";
  const accountSection = ACCOUNT_SECTION_OPTIONS.some((option) => option.value === state.accountSection)
    ? state.accountSection
    : "real";

  return (
    <div style={{ display: "grid", gap: sp(14) }}>
      <Panel
        title="Workspace Defaults"
        action={
          <Button
            size="sm"
            variant="soft-danger"
            onClick={() => {
              if (!window.confirm("Reset all workspace defaults? This clears your saved layout, filters, and view preferences across every screen and cannot be undone.")) return;
              workspace.resetKeys([
                "activitySidebarCollapsed",
                "activitySidebarWidth",
                "marketUnusualThreshold",
                "flowFilter",
                "flowMinPrem",
                "flowSortBy",
                "flowIncludeQuery",
                "flowExcludeQuery",
                "flowDensity",
                "flowRowsPerPage",
                "flowLivePaused",
                "flowFiltersOpen",
                "flowColumnsOpen",
                "marketGridLayout",
                "marketGridSyncTimeframes",
                "marketGridTickerSearchMarketFilter",
                "headerBroadcastSpeedPreset",
                "accountRange",
                "accountAssetFilter",
                "accountOrderTab",
                "accountSection",
                "tradeChainHeatmapEnabled",
              ]);
            }}
          >
            Reset defaults
          </Button>
        }
      >
        <div style={{ color: CSS_COLOR.textDim, fontFamily: T.sans, fontSize: textSize("caption"), marginBottom: sp(10) }}>
          These settings update the same workspace state read by the app. Mounted screens may need a revisit or reload to pick up default-only values.
        </div>
        <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(${dim(190)}px, 1fr))`, gap: sp(8) }}>
          <SelectField
            label="Header Tape Speed"
            value={headerPreset}
            onChange={(value) => workspace.patch({ headerBroadcastSpeedPreset: resolveHeaderBroadcastSpeedPreset(value) })}
            options={Object.entries(HEADER_BROADCAST_SPEED_PRESETS).map(([value, config]) => ({ value, label: config.label }))}
          />
          <NumberField
            label="Algo Monitor Width"
            value={Number.isFinite(state.activitySidebarWidth) ? state.activitySidebarWidth : 220}
            min={196}
            max={320}
            onChange={(value) => workspace.patch({ activitySidebarWidth: value })}
          />
          <NumberField
            label="Market Flow Threshold"
            value={Number.isFinite(state.marketUnusualThreshold) ? state.marketUnusualThreshold : 1}
            min={0.1}
            max={100}
            step={0.1}
            onChange={(value) => workspace.patch({ marketUnusualThreshold: value })}
          />
          <SelectField
            label="Flow Filter"
            value={FLOW_FILTERS.includes(state.flowFilter) ? state.flowFilter : "all"}
            onChange={(value) => workspace.patch({ flowFilter: value })}
            options={FLOW_FILTERS}
          />
          <NumberField
            label="Flow Min Premium"
            value={Number.isFinite(state.flowMinPrem) ? state.flowMinPrem : 0}
            min={0}
            max={50_000_000}
            onChange={(value) => workspace.patch({ flowMinPrem: value })}
          />
          <SelectField
            label="Flow Sort"
            value={FLOW_SORT_OPTIONS.includes(state.flowSortBy) ? state.flowSortBy : "time"}
            onChange={(value) => workspace.patch({ flowSortBy: value })}
            options={FLOW_SORT_OPTIONS}
          />
          <TextField
            label="Flow Include Query"
            value={state.flowIncludeQuery || ""}
            placeholder="AAPL, TSLA"
            onChange={(value) => workspace.patch({ flowIncludeQuery: value })}
          />
          <TextField
            label="Flow Exclude Query"
            value={state.flowExcludeQuery || ""}
            placeholder="SPY, QQQ"
            onChange={(value) => workspace.patch({ flowExcludeQuery: value })}
          />
          <SelectField
            label="Flow Density"
            value={FLOW_DENSITY_OPTIONS.includes(state.flowDensity) ? state.flowDensity : "compact"}
            onChange={(value) => workspace.patch({ flowDensity: value })}
            options={FLOW_DENSITY_OPTIONS}
          />
          <SelectField
            label="Flow Rows"
            value={String(flowRows)}
            onChange={(value) => workspace.patch({ flowRowsPerPage: Number(value) })}
            options={FLOW_ROWS_OPTIONS.map((value) => String(value))}
          />
          <SelectField
            label="Market Grid Layout"
            value={MARKET_GRID_LAYOUTS.includes(state.marketGridLayout) ? state.marketGridLayout : "2x3"}
            onChange={(value) => workspace.patch({ marketGridLayout: value })}
            options={MARKET_GRID_LAYOUTS}
          />
          <SelectField
            label="Ticker Search Market"
            value={state.marketGridTickerSearchMarketFilter || "all"}
            onChange={(value) => workspace.patch({ marketGridTickerSearchMarketFilter: value })}
            options={["all", "us", "international", "crypto", "etf"]}
          />
          <SelectField
            label="Account Range"
            value={accountRange}
            onChange={(value) => workspace.patch({ accountRange: value })}
            options={ACCOUNT_RANGE_OPTIONS}
          />
          <SelectField
            label="Account Asset Filter"
            value={accountAssetFilter}
            onChange={(value) => workspace.patch({ accountAssetFilter: value })}
            options={ACCOUNT_ASSET_FILTER_OPTIONS}
          />
          <SelectField
            label="Account Orders Tab"
            value={accountOrderTab}
            onChange={(value) => workspace.patch({ accountOrderTab: value })}
            options={ACCOUNT_ORDER_TAB_OPTIONS}
          />
          <SelectField
            label="Account Mode"
            value={accountSection}
            onChange={(value) => workspace.patch({ accountSection: value })}
            options={ACCOUNT_SECTION_OPTIONS}
          />
          <label style={{ ...labelStyle(), flexDirection: "row", alignItems: "center", marginTop: sp(18) }}>
            <input
              type="checkbox"
              checked={state.marketGridSyncTimeframes === true}
              onChange={(event) => workspace.patch({ marketGridSyncTimeframes: event.target.checked })}
            />
            Sync market grid timeframes
          </label>
          <label style={{ ...labelStyle(), flexDirection: "row", alignItems: "center", marginTop: sp(18) }}>
            <input
              type="checkbox"
              checked={state.flowLivePaused === true}
              onChange={(event) => workspace.patch({ flowLivePaused: event.target.checked })}
            />
            Flow starts paused
          </label>
          <label style={{ ...labelStyle(), flexDirection: "row", alignItems: "center", marginTop: sp(18) }}>
            <input
              type="checkbox"
              checked={state.flowFiltersOpen !== false}
              onChange={(event) => workspace.patch({ flowFiltersOpen: event.target.checked })}
            />
            Flow filters open
          </label>
          <label style={{ ...labelStyle(), flexDirection: "row", alignItems: "center", marginTop: sp(18) }}>
            <input
              type="checkbox"
              checked={state.flowColumnsOpen === true}
              onChange={(event) => workspace.patch({ flowColumnsOpen: event.target.checked })}
            />
            Flow columns open
          </label>
          <label style={{ ...labelStyle(), flexDirection: "row", alignItems: "center", marginTop: sp(18) }}>
            <input
              type="checkbox"
              checked={state.tradeChainHeatmapEnabled !== false}
              onChange={(event) => workspace.patch({ tradeChainHeatmapEnabled: event.target.checked })}
            />
            Trade chain heatmap
          </label>
        </div>
      </Panel>
      <Panel title="Local Workspace Cleanup">
        <div style={{ display: "flex", gap: sp(8), flexWrap: "wrap" }}>
          <Button
            size="sm"
            variant="soft"
            onClick={() =>
              workspace.resetKeys([
                "marketGridTickerSearchCache",
                "marketGridTickerSearchFavorites",
                "marketGridRecentTickerRows",
                "marketGridRecentTickers",
              ])
            }
          >
            Clear ticker search history
          </Button>
          <Button
            size="sm"
            variant="soft"
            onClick={() =>
              workspace.resetKeys([
                "tradeRecentTickers",
                "tradeRecentTickerRows",
                "tradeContracts",
              ])
            }
          >
            Clear trade recents
          </Button>
          <Button
            size="sm"
            variant="soft"
            onClick={() => {
              if (!window.confirm("Clear all saved Flow scans? Your saved scans and presets will be permanently removed.")) return;
              workspace.resetKeys([
                "flowSavedScans",
                "flowActiveScanId",
                "flowActivePresetId",
              ]);
            }}
          >
            Clear Flow saved scans
          </Button>
        </div>
      </Panel>
    </div>
  );
}

function FlowScannerSettingsPanel() {
  const control = useFlowScannerControlState();
  const config = control.config || DEFAULT_FLOW_SCANNER_CONFIG;
  const updateConfig = (patch) => {
    setFlowScannerControlState({
      config: normalizeFlowScannerConfig({
        ...getFlowScannerControlState().config,
        ...patch,
      }),
    });
  };

  return (
    <Panel
      title="Flow Scanner"
      action={
        <Button
          size="sm"
          variant={control.enabled ? "soft-selected" : "soft"}
          onClick={() => setFlowScannerControlState({ enabled: !control.enabled })}
        >
          {control.enabled ? "Broad Scan On" : "Broad Scan Off"}
        </Button>
      }
    >
      <div style={{ color: CSS_COLOR.textDim, fontFamily: T.sans, fontSize: textSize("caption"), marginBottom: sp(10) }}>
        Shared with the header flow scan controls and Flow page scanner.
      </div>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(${dim(170)}px, 1fr))`, gap: sp(8) }}>
        <SelectField
          label="Watchlist Source"
          value={config.mode}
          onChange={(value) => updateConfig({ mode: value })}
          options={FLOW_SCANNER_MODE_OPTIONS}
        />
        <SelectField
          label="Scope"
          value={config.scope}
          onChange={(value) => updateConfig({ scope: value })}
          options={Object.values(FLOW_SCANNER_SCOPE)}
        />
        <NumberField label="Symbol Limit" value={config.maxSymbols} onChange={(value) => updateConfig({ maxSymbols: value })} {...FLOW_SCANNER_CONFIG_LIMITS.maxSymbols} />
        <NumberField label="Batch Size" value={config.batchSize} onChange={(value) => updateConfig({ batchSize: value })} {...FLOW_SCANNER_CONFIG_LIMITS.batchSize} />
        <NumberField label="Concurrency" value={config.concurrency} onChange={(value) => updateConfig({ concurrency: value })} {...FLOW_SCANNER_CONFIG_LIMITS.concurrency} />
        <NumberField label="Interval Ms" value={config.intervalMs} onChange={(value) => updateConfig({ intervalMs: value })} {...FLOW_SCANNER_CONFIG_LIMITS.intervalMs} />
        <NumberField label="Per-symbol Limit" value={config.limit} onChange={(value) => updateConfig({ limit: value })} {...FLOW_SCANNER_CONFIG_LIMITS.limit} />
        <NumberField label="Unusual Score" value={config.unusualThreshold} onChange={(value) => updateConfig({ unusualThreshold: value })} step={0.1} {...FLOW_SCANNER_CONFIG_LIMITS.unusualThreshold} />
        <NumberField label="Min Premium" value={config.minPremium} onChange={(value) => updateConfig({ minPremium: value })} {...FLOW_SCANNER_CONFIG_LIMITS.minPremium} />
        <NumberField label="Max DTE" value={config.maxDte ?? ""} onChange={(value) => updateConfig({ maxDte: value === "" ? null : value })} {...FLOW_SCANNER_CONFIG_LIMITS.maxDte} />
      </div>
    </Panel>
  );
}

function SignalMonitorSettingsPanel({ enabled, watchlists }) {
  const monitor = useSignalMonitorSettings({ enabled });
  const research = useResearchStatus({ enabled });
  const draft = monitor.draft;
  const states = monitor.state?.states || [];
  const liveProfile = monitor.state?.profile || monitor.profile || null;
  const highBetaUniverseStatus = describeHighBetaUniverseAvailability(
    research.status?.highBetaUniverse,
  );
  const statusSnapshot = useMemo(
    () =>
      buildSignalMonitorStatusSnapshot({
        profile: liveProfile,
        states,
        universe: monitor.state?.universe,
      }),
    [liveProfile, monitor.state?.universe, states],
  );
  const watchlistOptions = [
    { value: "", label: "Default Watchlist Source" },
    ...watchlists.map((watchlist) => ({
      value: watchlist.id,
      label: `${watchlist.name || "Watchlist"} (${watchlist.items?.length || 0})`,
    })),
  ];

  return (
    <div style={{ display: "grid", gap: sp(14) }}>
      <Panel
        title="Signal Monitor"
        action={
          <div style={{ display: "flex", gap: sp(7), flexWrap: "wrap", justifyContent: "flex-end" }}>
            <Button size="sm" variant="soft" onClick={monitor.reload} disabled={monitor.loading}>
              Refresh
            </Button>
            <Button size="sm" variant="soft" onClick={() => monitor.evaluate("incremental")} disabled={monitor.evaluating}>
              {monitor.evaluating ? "Scanning" : "Scan Now"}
            </Button>
            <Button size="sm" variant="soft" onClick={monitor.discard} disabled={!monitor.dirty || monitor.saving}>
              Discard
            </Button>
            <Button size="sm" variant={monitor.dirty ? "soft-selected" : "soft"} onClick={monitor.save} disabled={!monitor.dirty || monitor.saving}>
              {monitor.saving ? "Saving" : "Save"}
            </Button>
          </div>
        }
      >
        {monitor.error && (
          <div role="alert" style={{ color: CSS_COLOR.red, fontFamily: T.sans, fontSize: textSize("caption"), marginBottom: sp(10) }}>
            {monitor.error}
          </div>
        )}
        {!draft ? (
          <div
            role="status"
            aria-label="Loading signal monitor profile"
            style={{ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(${dim(170)}px, 1fr))`, gap: sp(8) }}
          >
            {Array.from({ length: 8 }).map((_, index) => (
              <div key={index} style={{ display: "flex", flexDirection: "column", gap: sp(4) }}>
                <Skeleton width="45%" height={dim(8)} />
                <Skeleton width="100%" height={dim(24)} radius={RADII.sm} />
              </div>
            ))}
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(${dim(170)}px, 1fr))`, gap: sp(8) }}>
            <label style={{ ...labelStyle(), flexDirection: "row", alignItems: "center" }}>
              <input
                type="checkbox"
                checked={Boolean(draft.enabled)}
                onChange={(event) => monitor.patchDraft({ enabled: event.target.checked })}
              />
              Enabled
            </label>
            <SelectField label="Timeframe" value={draft.timeframe} onChange={(value) => monitor.patchDraft({ timeframe: value })} options={SIGNAL_TIMEFRAMES} />
            <SelectField label="Watchlist Source" value={draft.watchlistId || ""} onChange={(value) => monitor.patchDraft({ watchlistId: value || null })} options={watchlistOptions} />
            <SelectField
              label="Universe"
              value={resolveSignalMonitorUniverseScope(draft.pyrusSignalsSettings)}
              onChange={(value) =>
                monitor.patchDraft({
                  pyrusSignalsSettings: {
                    ...(draft.pyrusSignalsSettings || {}),
                    [SIGNAL_MONITOR_UNIVERSE_SCOPE_KEY]: value,
                  },
                  ...(value === "high_beta_500"
                    ? { maxSymbols: SIGNAL_MONITOR_LIMITS.maxSymbols.max }
                    : {}),
                })
              }
              options={SIGNAL_MONITOR_UNIVERSE_SCOPE_OPTIONS}
            />
            <NumberField label="Poll Seconds" value={draft.pollIntervalSeconds} {...SIGNAL_MONITOR_LIMITS.pollIntervalSeconds} onChange={(value) => monitor.patchDraft({ pollIntervalSeconds: value })} />
            <NumberField label="Symbol Limit" value={draft.maxSymbols} {...SIGNAL_MONITOR_LIMITS.maxSymbols} onChange={(value) => monitor.patchDraft({ maxSymbols: value })} />
            <NumberField label="Concurrency" value={draft.evaluationConcurrency} {...SIGNAL_MONITOR_LIMITS.evaluationConcurrency} onChange={(value) => monitor.patchDraft({ evaluationConcurrency: value })} />
            <NumberField label="Fresh Bars" value={draft.freshWindowBars} {...SIGNAL_MONITOR_LIMITS.freshWindowBars} onChange={(value) => monitor.patchDraft({ freshWindowBars: value })} />
          </div>
        )}
      </Panel>
      <Panel title="Signal Monitor Status">
        <StateRow label="Environment" value={liveProfile?.environment || SIGNAL_MONITOR_ENVIRONMENT} />
        <StateRow label="Configured symbols" value={statusSnapshot.configuredMaxSymbols ?? MISSING_VALUE} />
        <StateRow label="Resolved symbols" value={statusSnapshot.resolvedSymbols ?? MISSING_VALUE} tone={statusSnapshot.shortfall ? CSS_COLOR.amber : CSS_COLOR.textSec} />
        <StateRow label="Tracked symbols" value={statusSnapshot.stateSummary.symbols} />
        <StateRow label="Pinned symbols" value={statusSnapshot.pinnedSymbols ?? MISSING_VALUE} />
        <StateRow label="Expanded symbols" value={statusSnapshot.expansionSymbols ?? MISSING_VALUE} />
        <StateRow label="High Beta 500" value={highBetaUniverseStatus.label} tone={highBetaUniverseStatus.tone} />
        <StateRow label="High Beta Cache" value={highBetaUniverseStatus.detail} tone={highBetaUniverseStatus.tone} />
        <StateRow label="Fresh signals" value={statusSnapshot.stateSummary.fresh} />
        <StateRow label="Recent events" value={monitor.events.length} />
        <StateRow label="Signal Source" value={statusSnapshot.universeSource || MISSING_VALUE} tone={statusSnapshot.universeFallbackUsed ? CSS_COLOR.amber : CSS_COLOR.textSec} />
        <StateRow label="Shortfall" value={statusSnapshot.shortfall ?? MISSING_VALUE} tone={statusSnapshot.shortfall ? CSS_COLOR.amber : CSS_COLOR.textSec} />
        <StateRow label="Last evaluated" value={statusSnapshot.lastEvaluatedAt || MISSING_VALUE} />
        <StateRow label="Last error" value={liveProfile?.lastError || statusSnapshot.universeDegradedReason || MISSING_VALUE} tone={liveProfile?.lastError || statusSnapshot.universeDegradedReason ? CSS_COLOR.red : CSS_COLOR.textSec} />
      </Panel>
    </div>
  );
}

function SettingsStatusStrip({ summary, dirtyCount, compact = false }) {
  const providers = safeRecord(summary.providers);
  const stockDataProvider = resolveStockDataProvider(providers);
  const items = [
    {
      label: "Restart",
      value: `${summary.pendingRestartCount || 0} pending`,
      tone: summary.pendingRestartCount > 0 ? CSS_COLOR.amber : CSS_COLOR.green,
    },
    {
      label: "Diagnostics",
      value: summary.diagnosticsSeverity || summary.diagnosticsStatus || "unknown",
      tone:
        summary.diagnosticsSeverity === "error"
          ? CSS_COLOR.red
          : summary.diagnosticsSeverity === "warning" || summary.diagnosticsSeverity === "unknown" || summary.diagnosticsSeverity === "degraded"
            ? CSS_COLOR.amber
            : CSS_COLOR.green,
    },
    {
      label: "Trading",
      value: summary.tradingMode || "shadow",
      tone: summary.tradingMode === "live" ? CSS_COLOR.red : CSS_COLOR.green,
    },
    {
      label: "Providers",
      value: `${stockDataProvider.code} ${providers.research ? "R" : "-"} ${providers.ibkr ? "I" : "-"}`,
      tone: stockDataProvider.configured && providers.research && providers.ibkr ? CSS_COLOR.green : CSS_COLOR.amber,
    },
    {
      label: "Unsaved",
      value: dirtyCount || 0,
      tone: dirtyCount > 0 ? CSS_COLOR.amber : CSS_COLOR.textSec,
    },
  ];

  return (
    <div
      className="ra-hide-scrollbar"
      style={{
        display: compact ? "flex" : "grid",
        gridTemplateColumns: compact ? undefined : `repeat(auto-fit, minmax(${dim(135)}px, 1fr))`,
        gap: sp(compact ? 6 : 8),
        marginBottom: sp(compact ? 10 : 14),
        overflowX: compact ? "auto" : undefined,
        paddingBottom: compact ? sp(2) : undefined,
        minWidth: 0,
      }}
    >
      {items.map((item) => (
        <MetricChip
          key={item.label}
          label={item.label}
          value={item.value}
          tone={item.tone}
          dot
          style={compact ? { flex: "0 0 auto", minWidth: dim(92) } : { width: "100%" }}
        />
      ))}
    </div>
  );
}

function ResearchProviderPanel({ backendSnapshot, enabled }) {
  const research = useResearchStatus({ enabled });
  const providers = safeRecord(backendSnapshot?.summary?.providers);
  const stockDataProvider = resolveStockDataProvider(providers);
  const highBetaUniverseStatus = describeHighBetaUniverseAvailability(
    research.status?.highBetaUniverse,
  );
  return (
    <Panel title="Research / Provider Wiring" action={<Button size="sm" variant="soft" onClick={research.reload}>Refresh</Button>}>
      {research.error && (
        <div role="alert" style={{ color: CSS_COLOR.red, fontFamily: T.sans, fontSize: textSize("caption"), marginBottom: sp(10) }}>
          {research.error}
        </div>
      )}
      <StateRow label="Research provider" value={research.status?.provider || "none"} tone={research.status?.configured ? CSS_COLOR.green : CSS_COLOR.amber} />
      <StateRow label="Research configured" value={research.status?.configured ? "yes" : "no"} tone={research.status?.configured ? CSS_COLOR.green : CSS_COLOR.amber} />
      <StateRow label="High Beta 500" value={highBetaUniverseStatus.label} tone={highBetaUniverseStatus.tone} />
      <StateRow label="High Beta Cache" value={highBetaUniverseStatus.detail} tone={highBetaUniverseStatus.tone} />
      <StateRow label="Stock data provider" value={stockDataProvider.configured ? `${stockDataProvider.label} configured` : "missing"} tone={stockDataProvider.configured ? CSS_COLOR.green : CSS_COLOR.amber} />
      <StateRow label="IBKR provider" value={providers.ibkr ? "configured" : "missing"} tone={providers.ibkr ? CSS_COLOR.green : CSS_COLOR.amber} />
    </Panel>
  );
}

function SettingsInventoryPanel() {
  const rows = [
    ["Market", "Grid layout, ticker search filters, sector timeframe", "local workspace", "Visible here through app/flow preferences or in Market"],
    ["Flow", "Saved scans, inspector preferences, broad flow scanner", "mixed", "Broad scanner wired here; scan lists remain in Flow"],
    ["Charting", "Timeframe favorites, scale preferences, grid sizing cleanup", "local workspace/browser", "Favorites wired here; per-chart viewport edits stay in chart surfaces"],
    ["Trade", "Tabs, recent tickers, contracts, chart/chain preferences", "local workspace", "Keep in Trade because values are workspace-specific"],
    ["Account", "Selected account, risk panels", "local + backend", "Account selection stays global header/account workflow"],
    ["Research", "Provider status, theme views, research data", "backend env + local", "Provider status wired here; theme exploration remains Research"],
    ["Algo", "Deployments and signal-options execution profiles", "backend per deployment", "Keep edits in Algo to avoid accidental live deployment changes"],
    ["Backtest", "Studies, draft strategies, run options", "backend per run/study", "Keep in Backtest because settings are experiment-specific"],
    ["Diagnostics", "Thresholds, memory/cache alerts, storage prune", "backend persisted", "Wired here and duplicated in Diagnostics"],
    ["IBKR", "Lanes, scanner, client portal runtime", "backend persisted/runtime", "Settings-owned controls; Diagnostics is read-only"],
    ["Security", "COOP/COEP isolation target", "server persisted pending restart", "Wired here with restart-required state"],
  ];

  return (
    <Panel title="Settings Coverage Inventory">
      <div style={{ display: "grid", gap: sp(8) }}>
        {rows.map(([area, controls, source, placement]) => (
          <div
            key={area}
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(auto-fit, minmax(${dim(150)}px, 1fr))`,
              gap: sp(10),
              borderBottom: `1px solid ${cssColorMix(CSS_COLOR.border, 33)}`,
              padding: sp("8px 0"),
              fontFamily: T.sans,
              fontSize: textSize("caption"),
            }}
          >
            <strong style={{ color: CSS_COLOR.text }}>{area}</strong>
            <span style={{ color: CSS_COLOR.textSec }}>{controls}</span>
            <span style={{ color: CSS_COLOR.accent }}>{source}</span>
            <span style={{ color: CSS_COLOR.textDim }}>{placement}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function FooterMemorySignalSettingsPanel() {
  const { preferences, updatePreferences } = useMemoryPressurePreferences();
  const memoryPressure = useMemoryPressureSnapshot(true);

  return (
    <Panel title="Footer Memory Signal">
      <div style={{ display: "grid", gap: sp(10) }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(auto-fit, minmax(${dim(160)}px, 1fr))`,
            gap: sp(8),
          }}
        >
          <StateRow
            label="Current level"
            value={String(memoryPressure.level || "normal").toUpperCase()}
            tone={
              memoryPressure.level === "high" ||
                    memoryPressure.level === "watch"
                  ? CSS_COLOR.amber
                  : CSS_COLOR.green
            }
          />
          <StateRow label="Trend" value={String(memoryPressure.trend || "steady").toUpperCase()} />
          <StateRow label="Source" value={memoryPressure.browserSource || MISSING_VALUE} />
          <StateRow label="Browser estimate" value={Number.isFinite(memoryPressure.browserMemoryMb) ? formatBytes(memoryPressure.browserMemoryMb * 1024 * 1024) : MISSING_VALUE} />
          <StateRow label="Browser limit" value={Number.isFinite(memoryPressure.browserMemoryLimitMb) ? formatBytes(memoryPressure.browserMemoryLimitMb * 1024 * 1024) : MISSING_VALUE} />
        </div>

        <div style={{ display: "grid", gap: sp(6) }}>
          <div style={{ ...labelStyle(), gap: sp(6) }}>
            Animation
            <SegmentedControl
              radioGroup
              ariaLabel="Animation"
              value={preferences.animationEnabled}
              onChange={(value) => updatePreferences({ animationEnabled: value })}
              options={[
                { value: true, label: "On" },
                { value: false, label: "Off" },
              ]}
            />
          </div>

          <div style={{ ...labelStyle(), gap: sp(6) }}>
            Compact label
            <SegmentedControl
              radioGroup
              ariaLabel="Compact label"
              value={preferences.showCompactLabel}
              onChange={(value) => updatePreferences({ showCompactLabel: value })}
              options={[
                { value: true, label: "On" },
                { value: false, label: "Off" },
              ]}
            />
          </div>

          <div style={{ ...labelStyle(), gap: sp(6) }}>
            Pulse threshold
            <SegmentedControl
              radioGroup
              ariaLabel="Pulse threshold"
              value={preferences.alertThreshold}
              onChange={(value) => updatePreferences({ alertThreshold: value })}
              options={[
                { value: "watch", label: "Watch" },
                { value: "high", label: "High" },
              ]}
            />
          </div>
        </div>

        <JsonBlock
          value={{
            current: memoryPressure,
            preferences,
          }}
        />
      </div>
    </Panel>
  );
}

export default function SettingsScreen({
  theme = "dark",
  onToggleTheme,
  sidebarCollapsed = false,
  onToggleSidebar,
  activitySidebarCollapsed = false,
  onToggleActivitySidebar,
  isVisible = false,
  onReadinessChange,
} = {}) {
  const [settingsRootRef, settingsRootSize] = useElementSize();
  const { isPhone: settingsIsPhone, isNarrow: settingsIsNarrow } =
    responsiveFlags(settingsRootSize.width);
  const settingsShellGridTemplate = settingsIsPhone
    ? "minmax(0, 1fr)"
    : settingsIsNarrow
      ? "minmax(160px, 210px) minmax(0, 1fr)"
      : "minmax(190px, 230px) minmax(0, 1fr)";
  const [activeTab, setActiveTab] = useState(SETTINGS_TABS[0].id);
  const [settingsSearch, setSettingsSearch] = useState("");
  const settingsVisible = Boolean(isVisible);
  const dataBrokerTabActive = settingsVisible && activeTab === "Data & Broker";
  const taxTabActive = settingsVisible && activeTab === "Tax";
  const automationTabActive = settingsVisible && activeTab === "Automation & Alerts";
  const systemTabActive = settingsVisible && activeTab === "System";
  const backendSettingsEnabled = dataBrokerTabActive || systemTabActive;
  useEffect(() => {
    onReadinessChange?.({
      contentReady: settingsVisible,
      primaryReady: settingsVisible,
      derivedReady: settingsVisible,
      backgroundAllowed: settingsVisible,
    });
  }, [onReadinessChange, settingsVisible]);
  const settingsTimingStagesRef = useRef(new Set());
  useEffect(() => {
    if (!settingsVisible) {
      settingsTimingStagesRef.current = new Set();
      return;
    }
    if (settingsTimingStagesRef.current.has("interactive-ready")) return;
    settingsTimingStagesRef.current.add("interactive-ready");
    markRouteDataTiming("settings", "interactive-ready", {
      tab: activeTab,
      source: "local-shell",
    });
  }, [activeTab, settingsVisible]);
  const backend = useBackendSettings({ enabled: backendSettingsEnabled });
  const userPreferences = useUserPreferences();
  const { watchlists } = useWatchlists({ enabled: automationTabActive });
  const settings = backend.snapshot?.settings || [];
  const settingsByGroup = useMemo(() => {
    const groups = new Map();
    settings.forEach((setting) => {
      const list = groups.get(setting.group) || [];
      list.push(setting);
      groups.set(setting.group, list);
    });
    return groups;
  }, [settings]);
  const summary = backend.snapshot?.summary || {};
  const providers = safeRecord(summary.providers);
  const stockDataProvider = resolveStockDataProvider(providers);
  const matchingTabs = useMemo(() => {
    const query = settingsSearch.trim().toLowerCase();
    if (!query) return [];
    return SETTINGS_TABS.filter((tab) =>
      `${tab.label} ${tab.description} ${tab.keywords}`.toLowerCase().includes(query),
    );
  }, [settingsSearch]);
  const settingsChangeStatus = getSettingsChangeStatus({
    loading: backend.loading,
    saving: backend.saving,
    error: backend.error,
    dirtyCount: backend.dirtyCount,
    applyOutcome: backend.applyOutcome,
    hasSnapshot: Boolean(backend.snapshot),
  });
  const settingsChangeTone =
    settingsChangeStatus.kind === "error"
      ? CSS_COLOR.red
      : settingsChangeStatus.kind === "dirty"
        ? CSS_COLOR.amber
        : settingsChangeStatus.kind === "success"
          ? CSS_COLOR.green
          : settingsChangeStatus.kind === "working"
            ? CSS_COLOR.accent
            : CSS_COLOR.textDim;

  const renderSettingGrid = (group) => (
    <div style={{ display: "grid", gridTemplateColumns: settingsIsPhone ? "minmax(0, 1fr)" : `repeat(auto-fit, minmax(min(100%, ${dim(270)}px), 1fr))`, gap: sp(8), alignItems: "start" }}>
      {(settingsByGroup.get(group) || []).map((setting) => (
        <SettingCard
          key={setting.key}
          setting={setting}
          draftValue={backend.drafts[setting.key]}
          onDraftChange={backend.setDraft}
        />
      ))}
    </div>
  );

  return (
    <div
      ref={settingsRootRef}
      data-testid="settings-screen"
      data-onboarding-anchor="settings-root"
      data-onboarding-state="ready"
      data-layout={settingsIsPhone ? "phone" : settingsIsNarrow ? "tablet" : "desktop"}
      style={{
        height: "100%",
        width: "100%",
        overflow: "auto",
        background: CSS_COLOR.bg0,
        color: CSS_COLOR.text,
        padding: sp(settingsIsPhone ? "8px 10px 18px" : "20px 28px"),
        fontFamily: T.sans,
        minWidth: 0,
        WebkitOverflowScrolling: settingsIsPhone ? "touch" : undefined,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: settingsIsPhone ? "space-between" : "flex-end",
          gap: sp(8),
          flexWrap: "wrap",
          minWidth: 0,
          marginBottom: sp(settingsIsPhone ? 8 : 0),
        }}
      >
        <div
          data-testid="settings-change-status"
          role="status"
          aria-live="polite"
          aria-atomic="true"
          style={{
            display: "flex",
            alignItems: "center",
            gap: sp(8),
            flexWrap: "wrap",
            fontFamily: T.sans,
            fontSize: fs(10),
            fontWeight: FONT_WEIGHTS.regular,
          }}
        >
          <span style={{ color: settingsChangeTone }}>
            {settingsChangeStatus.label}
          </span>
          <span
            style={{
              color:
                summary.pendingRestartCount > 0
                  ? CSS_COLOR.amber
                  : CSS_COLOR.green,
            }}
          >
            {summary.pendingRestartCount || 0} pending restart
          </span>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={backend.reload}
          disabled={backend.loading || backend.saving}
        >
          Refresh
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={backend.discard}
          disabled={backend.dirtyCount === 0 || backend.saving}
        >
          Discard
        </Button>
        <Button
          variant={backend.dirtyCount > 0 ? "primary" : "secondary"}
          size="sm"
          onClick={backend.apply}
          disabled={
            backend.dirtyCount === 0 || backend.loading || backend.saving
          }
          loading={backend.saving}
        >
          {backend.saving ? "Applying" : `Apply ${backend.dirtyCount || ""}`.trim()}
        </Button>
      </div>

      {backend.error && (
        <div role="alert" style={{ color: CSS_COLOR.red, fontFamily: T.sans, fontSize: textSize("caption"), marginBottom: sp(10) }}>
          {backend.error}
        </div>
      )}

      <SettingsStatusStrip
        summary={summary}
        dirtyCount={backend.dirtyCount}
        compact={settingsIsPhone}
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: settingsShellGridTemplate,
          gap: sp(14),
          alignItems: "start",
          minWidth: 0,
        }}
      >
        <aside
          style={{
            border: "none",
            background: CSS_COLOR.bg1,
            borderRadius: dim(RADII.md),
            padding: sp(settingsIsPhone ? 8 : 12),
            display: "grid",
            gap: sp(8),
            boxShadow: ELEVATION.sm,
            position: settingsIsPhone ? "relative" : "sticky",
            top: settingsIsPhone ? undefined : sp(10),
            minWidth: 0,
          }}
        >
          <SettingsSearchInput
            value={settingsSearch}
            onCommit={setSettingsSearch}
          />
          {settingsSearch.trim() ? (
            <div
              role="region"
              aria-label="Settings search results"
              style={{
                display: "grid",
                gap: sp(5),
                padding: sp("2px 0 4px"),
              }}
            >
              <div
                role="status"
                style={{
                  color: CSS_COLOR.textDim,
                  fontFamily: T.sans,
                  fontSize: textSize("body"),
                }}
              >
                {matchingTabs.length
                  ? `${matchingTabs.length} matching ${matchingTabs.length === 1 ? "section" : "sections"}`
                  : "No matching sections"}
              </div>
              {matchingTabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  aria-label={`Open ${tab.label} settings`}
                  aria-current={activeTab === tab.id ? "page" : undefined}
                  className="ra-touch-target"
                  onClick={() => setActiveTab(tab.id)}
                  style={{
                    border: `1px solid ${activeTab === tab.id ? CSS_COLOR.accent : CSS_COLOR.border}`,
                    background: activeTab === tab.id ? CSS_COLOR.bg2 : "transparent",
                    color: CSS_COLOR.text,
                    borderRadius: dim(RADII.sm),
                    padding: sp("7px 9px"),
                    display: "grid",
                    gap: sp(2),
                    textAlign: "left",
                    cursor: "pointer",
                    fontFamily: T.sans,
                  }}
                >
                  <span style={{ fontSize: textSize("caption"), fontWeight: FONT_WEIGHTS.label }}>
                    {tab.label}
                  </span>
                  <span style={{ color: CSS_COLOR.textDim, fontSize: textSize("body") }}>
                    {tab.description}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
          <div
            className="ra-hide-scrollbar"
            style={{
              display: "flex",
              flexDirection: settingsIsPhone ? "row" : "column",
              gap: sp(settingsIsPhone ? 5 : 8),
              overflowX: settingsIsPhone ? "auto" : undefined,
              paddingBottom: settingsIsPhone ? sp(2) : undefined,
              minWidth: 0,
            }}
          >
            {SETTINGS_TABS.map((tab) => (
              <button
                key={tab.id}
                data-testid={`settings-tab-${tab.id.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`}
                data-onboarding-anchor={
                  tab.id === "Data & Broker"
                    ? "settings-data-broker-tab"
                    : undefined
                }
                data-onboarding-state={
                  tab.id === "Data & Broker" ? "ready" : undefined
                }
                className="ra-touch-target"
                type="button"
                aria-pressed={activeTab === tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  border: "none",
                  background: activeTab === tab.id ? CSS_COLOR.bg2 : "transparent",
                  color: activeTab === tab.id ? CSS_COLOR.text : CSS_COLOR.textSec,
                  fontWeight: activeTab === tab.id ? FONT_WEIGHTS.label : FONT_WEIGHTS.medium,
                  borderRadius: dim(settingsIsPhone ? RADII.sm : RADII.pill),
                  padding: sp(settingsIsPhone ? "7px 10px" : "8px 12px"),
                  textAlign: "left",
                  cursor: "pointer",
                  fontFamily: T.sans,
                  flex: settingsIsPhone ? "0 0 auto" : undefined,
                  minWidth: settingsIsPhone ? dim(132) : undefined,
                  maxWidth: settingsIsPhone ? dim(170) : undefined,
                }}
              >
                <div style={{ fontFamily: T.sans, fontSize: textSize("caption"), fontWeight: FONT_WEIGHTS.regular, whiteSpace: "nowrap" }}>
                  {tab.label}
                </div>
                {!settingsIsPhone ? (
                  <div style={{ color: CSS_COLOR.textDim, fontFamily: T.sans, fontSize: textSize("body"), marginTop: sp(2) }}>
                    {tab.description}
                  </div>
                ) : null}
              </button>
            ))}
          </div>
        </aside>

        <main style={{ display: "grid", gap: sp(14), minWidth: 0 }}>
          {activeTab === "Preferences" && (
            <>
              <AppPreferencesPanel
                sidebarCollapsed={sidebarCollapsed}
                onToggleSidebar={onToggleSidebar}
                activitySidebarCollapsed={activitySidebarCollapsed}
                onToggleActivitySidebar={onToggleActivitySidebar}
              />
              <SyncedUserPreferencesPanel
                userPreferences={userPreferences}
                theme={theme}
                onToggleTheme={onToggleTheme}
              />
            </>
          )}

          {activeTab === "Charting" && (
            <>
              <ChartDisplayPreferencesPanel userPreferences={userPreferences} />
              <ChartTimeframeFavoritesPanel />
            </>
          )}

          {activeTab === "Workspace" && (
            <>
              <WorkspaceProfilePreferencesPanel userPreferences={userPreferences} />
              <WorkspaceDefaultsPanel />
            </>
          )}

          {activeTab === "Tax" && (
            <TaxSettingsPanel
              enabled={taxTabActive}
              isPhone={settingsIsPhone}
            />
          )}

          {activeTab === "Automation & Alerts" && (
            <>
              <SignalMonitorSettingsPanel
                enabled={automationTabActive}
                watchlists={watchlists}
              />
              <FlowScannerSettingsPanel />
              <NotificationPreferencePanel userPreferences={userPreferences} />
              <DiagnosticAlertPreferencesPanel />
            </>
          )}

          {activeTab === "Data & Broker" && (
            <>
              <SnapTradeConnectPanel enabled={dataBrokerTabActive} />
              <ResearchProviderPanel
                backendSnapshot={backend.snapshot}
                enabled={dataBrokerTabActive}
              />
              <Panel title="Runtime Settings">{renderSettingGrid("runtime")}</Panel>
            </>
          )}

          {activeTab === "System" && (
            <>
              <AboutPanel summary={summary} providers={providers} />
              <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(${dim(180)}px, 1fr))`, gap: sp(8) }}>
                <Panel title="Runtime">
                  <StateRow label="Trading mode" value={summary.tradingMode} tone={summary.tradingMode === "live" ? CSS_COLOR.red : CSS_COLOR.green} />
                  <StateRow label="Diagnostics" value={summary.diagnosticsStatus} />
                  <StateRow label="Severity" value={summary.diagnosticsSeverity} />
                </Panel>
                <Panel title="Providers">
                  <StateRow label="Stock data" value={stockDataProvider.configured ? `${stockDataProvider.label} configured` : "missing"} tone={stockDataProvider.configured ? CSS_COLOR.green : CSS_COLOR.amber} />
                  <StateRow label="Research" value={providers.research ? "configured" : "missing"} tone={providers.research ? CSS_COLOR.green : CSS_COLOR.amber} />
                  <StateRow label="IBKR" value={providers.ibkr ? "configured" : "missing"} tone={providers.ibkr ? CSS_COLOR.green : CSS_COLOR.amber} />
                </Panel>
                <Panel title="Controls">
                  <StateRow label="Thresholds" value={summary.thresholdCount} />
                </Panel>
                <Panel title="Workspace">
                  <StateRow label="Watchlists" value={summary.watchlistCount} />
                  <StateRow label="Watchlist symbols" value={summary.watchlistSymbolCount} />
                  <StateRow label="Signal monitor" value={summary.signalMonitor?.enabled ? "enabled" : "paused"} tone={summary.signalMonitor?.enabled ? CSS_COLOR.green : CSS_COLOR.textDim} />
                </Panel>
                <Panel title="Automation / Charting">
                  <StateRow label="Algo deployments" value={summary.algoDeploymentCount} />
                  <StateRow label="Enabled deployments" value={summary.enabledAlgoDeploymentCount} tone={summary.enabledAlgoDeploymentCount > 0 ? CSS_COLOR.amber : CSS_COLOR.textSec} />
                  <StateRow label="Pine scripts" value={`${summary.chartEnabledPineScriptCount || 0}/${summary.pineScriptCount || 0} chart-enabled`} />
                </Panel>
              </div>
              <DiagnosticThresholdSettingsPanel
                description="These controls are shared with Diagnostics and persist through the diagnostics threshold service."
              />
              <FooterMemorySignalSettingsPanel />
              <BrowserStorageFootprintPanel />
              <StoragePrunePanel />
              <Panel title="COOP / COEP Isolation Settings">{renderSettingGrid("isolation")}</Panel>
              <Panel title="Isolation Apply Rules">
                <StateRow label="Live apply" value="no" tone={CSS_COLOR.amber} />
                <StateRow label="Persistence" value="server override file" />
                <StateRow label="Header source" value="effective env at process start" />
              </Panel>
              <Panel title="Backend Settings Snapshot">
                <details>
                  <summary
                    style={{
                      color: CSS_COLOR.textSec,
                      cursor: "pointer",
                      fontFamily: T.sans,
                      fontSize: fs(10),
                      fontWeight: FONT_WEIGHTS.regular,
                    }}
                  >
                    View raw backend payload
                  </summary>
                  <div style={{ marginTop: sp(10) }}>
                    <JsonBlock value={backend.snapshot} />
                  </div>
                </details>
              </Panel>
              {userPreferences.preferences?.privacy?.showDiagnosticsInSettings !== false ? (
                <SettingsInventoryPanel />
              ) : null}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
