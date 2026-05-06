import { useCallback, useEffect, useMemo, useState } from "react";
import {
  buildLanePresetPatch,
  normalizeLaneSymbolList,
} from "./settings/ibkrLaneUiModel";
import {
  readLocalAlertPreferences,
  writeLocalAlertPreferences,
} from "./diagnostics/localAlerts";
import { IbkrLaneArchitecturePanel } from "./settings/IbkrLaneArchitecturePanel";
import {
  DEFAULT_FLOW_SCANNER_CONFIG,
  FLOW_SCANNER_CONFIG_LIMITS,
  FLOW_SCANNER_MODE_OPTIONS,
  FLOW_SCANNER_SCOPE,
  normalizeFlowScannerConfig,
} from "../features/platform/marketFlowScannerConfig";
import {
  HEADER_BROADCAST_SPEED_PRESETS,
  resolveHeaderBroadcastSpeedPreset,
} from "../features/platform/headerBroadcastModel";
import {
  useMemoryPressurePreferences,
} from "../features/platform/memoryPressurePreferences";
import { useMemoryPressureSnapshot } from "../features/platform/memoryPressureStore";
import {
  getFlowScannerControlState,
  setFlowScannerControlState,
  useFlowScannerControlState,
} from "../features/platform/marketFlowStore";
import { useRuntimeControlSnapshot } from "../features/platform/useRuntimeControlSnapshot";
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
import { DiagnosticThresholdSettingsPanel } from "./settings/DiagnosticThresholdSettingsPanel";
import { ACCOUNT_RANGES } from "./account/accountRanges";
import { MISSING_VALUE, RAYALGO_STORAGE_KEY, T, dim, fs, sp } from "../lib/uiTokens";
import { formatAppTimeForPreferences } from "../lib/timeZone";
import { responsiveFlags, useElementSize } from "../lib/responsive";

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
    id: "Automation & Alerts",
    label: "Automation",
    description: "Signals, alerts, notifications",
    keywords: "signal monitor alerts diagnostics notifications audio quiet hours",
  },
  {
    id: "Data & Broker",
    label: "Data & Broker",
    description: "Providers, runtime, IBKR",
    keywords: "provider research ibkr broker lanes runtime polygon data",
  },
  {
    id: "System",
    label: "System",
    description: "Diagnostics, storage, isolation",
    keywords: "system diagnostics thresholds storage isolation inventory backend",
  },
];

const SIGNAL_TIMEFRAMES = ["1m", "5m", "15m", "1h", "1d"];
const FLOW_FILTERS = ["all", "calls", "puts", "unusual", "golden", "sweep", "block", "cluster"];
const FLOW_SORT_OPTIONS = ["time", "premium", "score", "ratio", "ticker"];
const FLOW_DENSITY_OPTIONS = ["compact", "comfortable"];
const FLOW_ROWS_OPTIONS = [24, 40, 60, 100];
const MARKET_GRID_LAYOUTS = ["1x1", "2x2", "2x3", "3x3"];
const ACCOUNT_RANGE_OPTIONS = ACCOUNT_RANGES;
const ACCOUNT_ASSET_FILTER_OPTIONS = [
  { value: "all", label: "All positions" },
  { value: "Stocks", label: "Stocks" },
  { value: "ETF", label: "ETFs" },
  { value: "Options", label: "Options" },
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
const CHART_SCALE_PREFS_STORAGE_PREFIX = "rayalgo:chart-scale-prefs:";
const OPTION_HYDRATION_HISTORY_STORAGE_KEY = "rayalgo.optionHydrationDiagnostics.v1";
const MARKET_GRID_TRACK_SESSION_KEY = "rayalgo:market-grid-track-sizes";
const DIAGNOSTIC_ALERT_PREF_EVENT = "rayalgo:diagnostic-alert-preferences-updated";
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

const readSessionValue = (key) => {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
};

const safeRecord = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};

const formatBytes = (bytes) => {
  const value = Number(bytes) || 0;
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  if (value >= 1024) return `${Math.round(value / 1024)} KB`;
  return `${value} B`;
};

const formatCount = (value) =>
  Number.isFinite(Number(value)) ? Math.round(Number(value)).toLocaleString() : MISSING_VALUE;

const formatFreshnessAge = (value) => {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp)) return MISSING_VALUE;
  const ageMs = Math.max(0, Date.now() - timestamp);
  if (ageMs < 1_000) return "now";
  if (ageMs < 60_000) return `${Math.round(ageMs / 1_000)}s ago`;
  return `${Math.round(ageMs / 60_000)}m ago`;
};

const estimateStorageBytes = (key, value) =>
  (String(key || "").length + String(value || "").length) * 2;

function readWorkspaceState() {
  try {
    const raw = window.localStorage.getItem(RAYALGO_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeWorkspaceState(patch) {
  try {
    const current = readWorkspaceState();
    const next = { ...current, ...patch };
    window.localStorage.setItem(RAYALGO_STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent("rayalgo:workspace-settings-updated", { detail: next }));
    return next;
  } catch {
    return null;
  }
}

function smallButton({ active = false, danger = false } = {}) {
  return {
    border: `1px solid ${danger ? T.red : active ? T.green : T.border}`,
    background: danger ? `${T.red}18` : active ? T.greenBg : T.bg2,
    color: danger ? T.red : active ? T.green : T.textSec,
    borderRadius: dim(4),
    padding: sp("6px 9px"),
    fontFamily: T.mono,
    fontSize: fs(9),
    fontWeight: 900,
    cursor: "pointer",
  };
}

function inputStyle() {
  return {
    border: `1px solid ${T.border}`,
    background: T.bg0,
    color: T.text,
    borderRadius: dim(4),
    padding: sp("7px 8px"),
    fontFamily: T.mono,
    fontSize: fs(10),
    minWidth: 0,
    width: "100%",
  };
}

function labelStyle() {
  return {
    display: "flex",
    flexDirection: "column",
    gap: sp(4),
    color: T.textDim,
    fontFamily: T.mono,
    fontSize: fs(9),
    fontWeight: 800,
    minWidth: 0,
  };
}

function Panel({ title, action, children }) {
  return (
    <section
      className="ra-panel-enter"
      style={{
        border: `1px solid ${T.border}`,
        background: T.bg1,
        borderRadius: dim(6),
        padding: sp("8px 10px"),
        minWidth: 0,
        alignSelf: "start",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: sp(10),
          marginBottom: sp(10),
        }}
      >
        <div style={{ fontSize: fs(12), fontWeight: 800 }}>{title}</div>
        {action}
      </div>
      {children}
    </section>
  );
}

function StateRow({ label, value, tone = T.textSec }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: sp(10),
        borderBottom: `1px solid ${T.border}55`,
        padding: sp("7px 0"),
        fontFamily: T.mono,
        fontSize: fs(10),
      }}
    >
      <span style={{ color: T.textDim, minWidth: 0 }}>{label}</span>
      <span
        style={{
          color: tone,
          fontWeight: 800,
          textAlign: "right",
          minWidth: 0,
          overflowWrap: "anywhere",
        }}
      >
        {value ?? MISSING_VALUE}
      </span>
    </div>
  );
}

function SelectField({ label, value, onChange, options }) {
  return (
    <label style={labelStyle()}>
      {label}
      <select value={value ?? ""} onChange={(event) => onChange(event.target.value)} style={inputStyle()}>
        {options.map((option) => (
          <option key={option.value ?? option} value={option.value ?? option}>
            {option.label ?? option}
          </option>
        ))}
      </select>
    </label>
  );
}

function NumberField({ label, value, onChange, min, max, step = 1 }) {
  return (
    <label style={labelStyle()}>
      {label}
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value === "" ? "" : Number(event.target.value))}
        style={inputStyle()}
      />
    </label>
  );
}

function TextField({ label, value, onChange, placeholder = "" }) {
  return (
    <label style={labelStyle()}>
      {label}
      <input
        type="text"
        value={value ?? ""}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        style={inputStyle()}
      />
    </label>
  );
}

function CheckboxField({ label, checked, onChange }) {
  return (
    <label style={{ ...labelStyle(), flexDirection: "row", alignItems: "center", gap: sp(7) }}>
      <input
        type="checkbox"
        checked={Boolean(checked)}
        onChange={(event) => onChange(event.target.checked)}
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
        fontFamily: T.mono,
        fontSize: fs(9),
        color: T.textSec,
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
  const color =
    source === "pending_restart"
      ? T.amber
      : source === "override"
        ? T.green
        : source === "env"
          ? T.accent
          : T.textDim;
  return (
    <span
      style={{
        border: `1px solid ${color}66`,
        color,
        background: T.bg2,
        borderRadius: dim(4),
        padding: sp("2px 5px"),
        fontFamily: T.mono,
        fontSize: fs(8),
        fontWeight: 900,
        textTransform: "uppercase",
      }}
    >
      {source.replace(/_/g, " ")}
    </span>
  );
}

function SettingCard({ setting, draftValue, onDraftChange }) {
  const editable = setting?.editable && Array.isArray(setting.options);
  const displayValue =
    typeof setting.value === "object" ? JSON.stringify(setting.value) : setting.value;
  return (
    <div
      style={{
        border: `1px solid ${T.border}`,
        borderRadius: dim(5),
        background: T.bg2,
        padding: sp("7px 8px"),
        display: "grid",
        gap: sp(5),
        alignSelf: "start",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: sp(8) }}>
        <div style={{ color: T.text, fontWeight: 900, fontSize: fs(11) }}>
          {setting.label}
        </div>
        <SourceBadge setting={setting} />
      </div>
      <div style={{ color: T.textDim, fontFamily: T.mono, fontSize: fs(9), lineHeight: 1.45 }}>
        {setting.description}
      </div>
      {editable ? (
        <select
          value={draftValue ?? setting.pendingValue ?? setting.value ?? ""}
          onChange={(event) => onDraftChange(setting.key, event.target.value)}
          style={inputStyle()}
        >
          {setting.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : (
        <div style={{ color: T.textSec, fontFamily: T.mono, fontSize: fs(10), overflowWrap: "anywhere" }}>
          {displayValue ?? MISSING_VALUE}
        </div>
      )}
      {setting.pendingValue !== undefined && (
        <div style={{ color: T.amber, fontFamily: T.mono, fontSize: fs(9) }}>
          Pending restart: {String(setting.pendingValue)}
        </div>
      )}
      {setting.requiresRestart && (
        <div style={{ color: T.textDim, fontFamily: T.mono, fontSize: fs(8), textTransform: "uppercase" }}>
          restart required
        </div>
      )}
    </div>
  );
}

function useBackendSettings() {
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [drafts, setDrafts] = useState({});

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
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
    load();
  }, [load]);

  const setDraft = useCallback((key, value) => {
    setDrafts((current) => ({ ...current, [key]: value }));
  }, []);

  const apply = useCallback(() => {
    const changes = Object.entries(drafts).map(([key, value]) => ({ key, value }));
    if (!changes.length) return;
    setSaving(true);
    setError(null);
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
        setSnapshot(payload.snapshot);
        setDrafts({});
        if (payload.rejected?.length) {
          setError(payload.rejected.map((item) => item.reason).join(" "));
        }
      })
      .catch((err) => {
        setError(err?.detail || err?.message || "Failed to apply backend settings.");
      })
      .finally(() => setSaving(false));
  }, [drafts]);

  return {
    snapshot,
    loading,
    saving,
    error,
    drafts,
    dirtyCount: Object.keys(drafts).length,
    setDraft,
    discard: () => setDrafts({}),
    reload: load,
    apply,
  };
}

function useWatchlists() {
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
    load();
  }, [load]);

  return { watchlists, error, reload: load };
}

function useSignalMonitorSettings() {
  const [profile, setProfile] = useState(null);
  const [draft, setDraft] = useState(null);
  const [state, setState] = useState(null);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [evaluating, setEvaluating] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      fetch("/api/signal-monitor/profile", { headers: { Accept: "application/json" } }).then((response) =>
        response.ok ? response.json() : response.json().then((payload) => Promise.reject(payload)),
      ),
      fetch("/api/signal-monitor/state", { headers: { Accept: "application/json" } }).then((response) =>
        response.ok ? response.json() : response.json().then((payload) => Promise.reject(payload)),
      ),
      fetch("/api/signal-monitor/events?limit=20", { headers: { Accept: "application/json" } }).then((response) =>
        response.ok ? response.json() : response.json().then((payload) => Promise.reject(payload)),
      ),
    ])
      .then(([nextProfile, nextState, nextEvents]) => {
        setProfile(nextProfile);
        setDraft(nextProfile);
        setState(nextState);
        setEvents(nextEvents.events || []);
      })
      .catch((err) => {
        setError(err?.detail || err?.message || "Signal monitor settings are unavailable.");
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const dirty = useMemo(
    () => JSON.stringify(profile || {}) !== JSON.stringify(draft || {}),
    [draft, profile],
  );

  const patchDraft = useCallback((patch) => {
    setDraft((current) => ({ ...(current || {}), ...patch }));
  }, []);

  const save = useCallback(() => {
    if (!draft) return;
    setSaving(true);
    setError(null);
    fetch("/api/signal-monitor/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        environment: draft.environment,
        enabled: Boolean(draft.enabled),
        watchlistId: draft.watchlistId || null,
        timeframe: draft.timeframe,
        freshWindowBars: Number(draft.freshWindowBars),
        pollIntervalSeconds: Number(draft.pollIntervalSeconds),
        maxSymbols: Number(draft.maxSymbols),
        evaluationConcurrency: Number(draft.evaluationConcurrency),
        rayReplicaSettings: draft.rayReplicaSettings || {},
      }),
    })
      .then((response) =>
        response.ok ? response.json() : response.json().then((payload) => Promise.reject(payload)),
      )
      .then((payload) => {
        setProfile(payload);
        setDraft(payload);
      })
      .catch((err) => setError(err?.detail || err?.message || "Failed to save signal monitor settings."))
      .finally(() => setSaving(false));
  }, [draft]);

  const evaluate = useCallback((mode = "incremental") => {
    setEvaluating(true);
    setError(null);
    fetch("/api/signal-monitor/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ environment: draft?.environment || profile?.environment, mode }),
    })
      .then((response) =>
        response.ok ? response.json() : response.json().then((payload) => Promise.reject(payload)),
      )
      .then((payload) => {
        setState(payload);
        if (payload.profile) {
          setProfile(payload.profile);
          setDraft(payload.profile);
        }
      })
      .catch((err) => setError(err?.detail || err?.message || "Signal monitor evaluation failed."))
      .finally(() => setEvaluating(false));
  }, [draft?.environment, profile?.environment]);

  return {
    profile,
    draft,
    state,
    events,
    loading,
    saving,
    evaluating,
    dirty,
    error,
    patchDraft,
    save,
    discard: () => setDraft(profile),
    reload: load,
    evaluate,
  };
}

function useResearchStatus() {
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
    load();
  }, [load]);

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
    window.addEventListener("rayalgo:workspace-settings-updated", listener);
    window.addEventListener("storage", listener);
    return () => {
      window.removeEventListener("rayalgo:workspace-settings-updated", listener);
      window.removeEventListener("storage", listener);
    };
  }, []);

  const resetKeys = useCallback((keys) => {
    const current = readWorkspaceState();
    keys.forEach((key) => {
      delete current[key];
    });
    window.localStorage.setItem(RAYALGO_STORAGE_KEY, JSON.stringify(current));
    window.dispatchEvent(new CustomEvent("rayalgo:workspace-settings-updated", { detail: current }));
    setState(current);
  }, []);

  return { state, patch, resetKeys };
}

function useStorageFootprint() {
  const [snapshot, setSnapshot] = useState(() => readStorageFootprint());
  const refresh = useCallback(() => setSnapshot(readStorageFootprint()), []);

  useEffect(() => {
    const listener = () => refresh();
    window.addEventListener("rayalgo:workspace-settings-updated", listener);
    window.addEventListener("storage", listener);
    return () => {
      window.removeEventListener("rayalgo:workspace-settings-updated", listener);
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
      window.dispatchEvent(new CustomEvent("rayalgo:workspace-settings-updated", { detail: readWorkspaceState() }));
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
    window.dispatchEvent(new CustomEvent(DIAGNOSTIC_ALERT_PREF_EVENT, { detail: normalized }));
    return normalized;
  }, []);

  const patch = useCallback((patchValue) => {
    setPreferences((current) => {
      const next = { ...current, ...patchValue };
      writeLocalAlertPreferences(next);
      const normalized = readLocalAlertPreferences();
      window.dispatchEvent(new CustomEvent(DIAGNOSTIC_ALERT_PREF_EVENT, { detail: normalized }));
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

function useIbkrLaneSettings() {
  const [snapshot, setSnapshot] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [policyDrafts, setPolicyDrafts] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    fetch("/api/settings/ibkr-lanes", { headers: { Accept: "application/json" } })
      .then((response) =>
        response.ok
          ? response.json()
          : response.json().then((payload) => Promise.reject(payload)),
      )
      .then((payload) => {
        setSnapshot(payload);
        setError(null);
      })
      .catch((err) => {
        setError(err?.detail || err?.message || "IBKR lane architecture is unavailable.");
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const applyPolicyPatch = useCallback((patch) => {
    setPolicyDrafts((current) => {
      const next = { ...current };
      Object.entries(patch || {}).forEach(([laneId, lanePatch]) => {
        next[laneId] = {
          ...(next[laneId] || {}),
          ...lanePatch,
          sources: {
            ...(next[laneId]?.sources || {}),
            ...(lanePatch.sources || {}),
          },
          manualSymbols:
            lanePatch.manualSymbols !== undefined
              ? normalizeLaneSymbolList(lanePatch.manualSymbols)
              : next[laneId]?.manualSymbols,
          excludedSymbols:
            lanePatch.excludedSymbols !== undefined
              ? normalizeLaneSymbolList(lanePatch.excludedSymbols)
              : next[laneId]?.excludedSymbols,
          priority: Array.isArray(lanePatch.priority)
            ? [...lanePatch.priority]
            : next[laneId]?.priority,
        };
      });
      return next;
    });
  }, []);

  const save = useCallback(() => {
    const managementToken = readSessionValue("rayalgo.ibkrBridgeManagementToken");
    if (!managementToken) {
      setError("Start or reconnect IB Gateway before saving lane overrides.");
      return;
    }
    if (Object.keys(drafts).length === 0 && Object.keys(policyDrafts).length === 0) {
      return;
    }
    setSaving(true);
    setError(null);
    fetch("/api/settings/ibkr-lanes", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        managementToken,
        overrides: drafts,
        lanePolicy: policyDrafts,
      }),
    })
      .then((response) =>
        response.ok
          ? response.json()
          : response.json().then((payload) => Promise.reject(payload)),
      )
      .then((payload) => {
        setSnapshot(payload);
        setDrafts({});
        setPolicyDrafts({});
      })
      .catch((err) => {
        setError(err?.detail || err?.message || "Failed to save IBKR lane overrides.");
      })
      .finally(() => setSaving(false));
  }, [drafts, policyDrafts]);

  return {
    snapshot,
    drafts,
    policyDrafts,
    saving,
    error,
    bridgeReady: Boolean(readSessionValue("rayalgo.ibkrBridgeManagementToken")),
    onChange: (id, value) => setDrafts((current) => ({ ...current, [id]: value })),
    onReset: (id) => setDrafts((current) => ({ ...current, [id]: null })),
    onPolicyChange: (laneId, patch) =>
      setPolicyDrafts((current) => ({
        ...current,
        [laneId]: {
          ...(current[laneId] || {}),
          ...patch,
          sources: {
            ...(current[laneId]?.sources || {}),
            ...(patch.sources || {}),
          },
        },
      })),
    onResetPolicy: (laneId, defaultPolicy) => {
      if (!defaultPolicy) return;
      applyPolicyPatch({
        [laneId]: {
          ...defaultPolicy,
          sources: { ...(defaultPolicy.sources || {}) },
          manualSymbols: normalizeLaneSymbolList(defaultPolicy.manualSymbols || []),
          excludedSymbols: normalizeLaneSymbolList(defaultPolicy.excludedSymbols || []),
          priority: Array.isArray(defaultPolicy.priority)
            ? [...defaultPolicy.priority]
            : undefined,
        },
      });
    },
    onApplyPreset: (presetId, defaults) => applyPolicyPatch(buildLanePresetPatch(presetId, defaults)),
    onDiscard: () => {
      setDrafts({});
      setPolicyDrafts({});
    },
    onSave: save,
    onReload: load,
  };
}

function IbkrLineUsagePanel({ runtimeControl }) {
  const snapshot = runtimeControl.lineUsageSnapshot;
  const brokerStreamFreshness = runtimeControl.streams;
  const error = runtimeControl.lineUsageError
    ? runtimeControl.lineUsageError instanceof Error
      ? runtimeControl.lineUsageError.message
      : String(runtimeControl.lineUsageError)
    : null;
  const admission = safeRecord(snapshot?.admission);
  const budget = safeRecord(admission.budget);
  const bridge = safeRecord(snapshot?.bridge);
  const governor = safeRecord(snapshot?.governor || bridge.governor);
  const drift = safeRecord(snapshot?.drift);
  const streams = safeRecord(snapshot?.streams);
  const quoteStreams = safeRecord(streams.quoteStreams);
  const optionQuoteStreams = safeRecord(streams.optionQuoteStreams);
  const lineUsage = runtimeControl.lineUsage;
  const accountMonitor = lineUsage.accountMonitor || {};
  const flowScanner = lineUsage.flowScanner || {};
  const automation = lineUsage.pools.automation || {};
  const governorRows = Object.entries(governor).filter(
    ([, lane]) => lane && typeof lane === "object",
  );

  return (
    <Panel
      title="IBKR Line Usage"
      action={
        <button type="button" onClick={runtimeControl.reload} style={smallButton()}>
          Refresh
        </button>
      }
    >
      {error && (
        <div style={{ color: T.amber, fontFamily: T.mono, fontSize: fs(9), marginBottom: sp(10) }}>
          {error}
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: sp(14) }}>
        <div>
          <StateRow label="Account allowance" value={formatCount(budget.maxLines)} />
          <StateRow label="API usable lines" value={formatCount(budget.usableLines)} />
          <StateRow label="API active lines" value={formatCount(admission.activeLineCount)} />
          <StateRow label="Line reserve" value={formatCount(budget.reserveLines)} />
          <StateRow label="Usable remaining" value={formatCount(admission.usableRemainingLineCount)} tone={Number(admission.usableRemainingLineCount) <= 5 ? T.amber : T.green} />
          <StateRow label="Bridge live cap" value={formatCount(bridge.lineBudget)} />
          <StateRow label="Bridge active lines" value={formatCount(bridge.activeLineCount)} />
        </div>
        <div>
          <StateRow label="Flow scanner" value={`${formatCount(flowScanner.used)} / ${formatCount(flowScanner.cap)}`} />
          <StateRow label="Account monitor" value={`${formatCount(accountMonitor.used)} / ${formatCount(accountMonitor.cap)}`} />
          <StateRow label="Automation" value={`${formatCount(automation.used)} / ${formatCount(automation.cap)}`} />
          <StateRow label="Quote stream symbols" value={formatCount(quoteStreams.unionSymbolCount)} />
          <StateRow label="Option quote contracts" value={formatCount(optionQuoteStreams.unionProviderContractIdCount)} />
          <StateRow label="API vs bridge delta" value={formatCount(drift.admissionVsBridgeLineDelta)} />
          <StateRow
            label="Account stream"
            value={brokerStreamFreshness.account.fresh ? "fresh" : "pending"}
            tone={brokerStreamFreshness.account.fresh ? T.green : T.amber}
          />
          <StateRow
            label="Account age"
            value={formatFreshnessAge(brokerStreamFreshness.account.lastEventAt)}
          />
          <StateRow
            label="Order stream"
            value={brokerStreamFreshness.order.fresh ? "fresh" : "pending"}
            tone={brokerStreamFreshness.order.fresh ? T.green : T.amber}
          />
          <StateRow
            label="Order age"
            value={formatFreshnessAge(brokerStreamFreshness.order.lastEventAt)}
          />
        </div>
      </div>
      {lineUsage.rows.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: sp(8), marginTop: sp(12) }}>
          {lineUsage.rows.map((pool) => (
            <div key={pool.id} style={{ border: `1px solid ${T.border}`, borderRadius: dim(5), padding: sp(9), background: T.bg2 }}>
              <div style={{ color: T.text, fontSize: fs(10), fontWeight: 900 }}>{pool.label}</div>
              <div style={{ color: Number(pool.used) > Number(pool.cap) ? T.amber : T.textSec, fontFamily: T.mono, fontSize: fs(11), fontWeight: 900, marginTop: sp(4) }}>
                {formatCount(pool.used)} / {formatCount(pool.cap)}
              </div>
              <div style={{ color: T.textDim, fontFamily: T.mono, fontSize: fs(8), marginTop: sp(3) }}>
                {pool.strict ? "hard cap" : "borrowable"}
                {pool.legacyNormalized ? " · normalized" : ""}
              </div>
            </div>
          ))}
        </div>
      )}
      {governorRows.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: sp(8), marginTop: sp(12) }}>
          {governorRows.map(([id, lane]) => (
            <div key={id} style={{ border: `1px solid ${T.border}`, borderRadius: dim(5), padding: sp(9), background: T.bg2 }}>
              <div style={{ color: T.text, fontSize: fs(10), fontWeight: 900 }}>{id}</div>
              <div style={{ color: lane.circuitOpen ? T.amber : T.textSec, fontFamily: T.mono, fontSize: fs(10), fontWeight: 900, marginTop: sp(4) }}>
                {formatCount(lane.active)} active / {formatCount(lane.queued)} queued
              </div>
              <div style={{ color: T.textDim, fontFamily: T.mono, fontSize: fs(8), marginTop: sp(3) }}>
                {lane.circuitOpen ? `backoff ${formatCount(lane.backoffRemainingMs)}ms` : lane.lastFailure || "ready"}
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function StoragePrunePanel() {
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
      .then(setResult)
      .catch((err) => setError(err?.detail || err?.message || "Storage prune failed."))
      .finally(() => setRunning(false));
  };

  return (
    <Panel
      title="Diagnostic Storage Prune"
      action={
        <button
          type="button"
          onClick={run}
          disabled={running}
          style={smallButton({ active: dryRun, danger: !dryRun })}
        >
          {running ? "Running" : dryRun ? "Dry Run" : "Prune"}
        </button>
      }
    >
      <div style={{ display: "grid", gridTemplateColumns: "minmax(160px, 220px) 1fr", gap: sp(10), alignItems: "end" }}>
        <label style={{ color: T.textDim, fontFamily: T.mono, fontSize: fs(9), fontWeight: 800 }}>
          Older Than Days
          <input
            type="number"
            min="1"
            value={olderThanDays}
            onChange={(event) => setOlderThanDays(Number(event.target.value))}
            style={{ ...inputStyle(), marginTop: sp(4) }}
          />
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: sp(7), color: T.textSec, fontFamily: T.mono, fontSize: fs(10) }}>
          <input
            type="checkbox"
            checked={dryRun}
            onChange={(event) => setDryRun(event.target.checked)}
          />
          Dry-run only
        </label>
      </div>
      {error && <div style={{ color: T.amber, fontFamily: T.mono, fontSize: fs(9), marginTop: sp(10) }}>{error}</div>}
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
        <button type="button" onClick={storage.refresh} style={smallButton()}>
          Refresh
        </button>
      }
    >
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: sp(10), marginBottom: sp(12) }}>
        <StateRow
          label="Local storage"
          value={`${formatBytes(storage.snapshot.local.totalBytes)} / ${storage.snapshot.local.count} keys`}
          tone={storage.snapshot.local.totalBytes > 2 * 1024 * 1024 ? T.amber : T.textSec}
        />
        <StateRow
          label="Session storage"
          value={`${formatBytes(storage.snapshot.session.totalBytes)} / ${storage.snapshot.session.count} keys`}
          tone={T.textSec}
        />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: sp(12) }}>
        <div>
          <div style={{ color: T.textDim, fontFamily: T.mono, fontSize: fs(9), fontWeight: 900, marginBottom: sp(6) }}>
            Largest Local Keys
          </div>
          {localEntries.map((entry) => (
            <StateRow key={entry.key} label={entry.key} value={formatBytes(entry.bytes)} />
          ))}
          {!localEntries.length && <StateRow label="No local storage keys" value="empty" />}
        </div>
        <div>
          <div style={{ color: T.textDim, fontFamily: T.mono, fontSize: fs(9), fontWeight: 900, marginBottom: sp(6) }}>
            Largest Session Keys
          </div>
          {sessionEntries.map((entry) => (
            <StateRow key={entry.key} label={entry.key} value={formatBytes(entry.bytes)} />
          ))}
          {!sessionEntries.length && <StateRow label="No session storage keys" value="empty" />}
        </div>
      </div>
      <div style={{ display: "flex", gap: sp(8), flexWrap: "wrap", marginTop: sp(12) }}>
        <button
          type="button"
          onClick={() => storage.clearLocalKeys((key) => key.startsWith(CHART_SCALE_PREFS_STORAGE_PREFIX))}
          style={smallButton()}
        >
          Clear chart scale prefs
        </button>
        <button
          type="button"
          onClick={() => storage.clearLocalKeys((key) => key === OPTION_HYDRATION_HISTORY_STORAGE_KEY)}
          style={smallButton()}
        >
          Clear option hydration history
        </button>
        <button
          type="button"
          onClick={() => storage.clearSessionKeys([MARKET_GRID_TRACK_SESSION_KEY])}
          style={smallButton()}
        >
          Reset market grid sizing
        </button>
      </div>
    </Panel>
  );
}

function AppPreferencesPanel({
  theme = "dark",
  onToggleTheme,
  sidebarCollapsed = false,
  onToggleSidebar,
}) {
  return (
    <Panel title="App Preferences">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: sp(10) }}>
        <div style={{ border: `1px solid ${T.border}`, background: T.bg2, borderRadius: dim(5), padding: sp(10) }}>
          <StateRow label="Theme" value={theme} />
          <button type="button" onClick={onToggleTheme} style={smallButton({ active: true })}>
            Switch to {theme === "dark" ? "light" : "dark"}
          </button>
        </div>
        <div style={{ border: `1px solid ${T.border}`, background: T.bg2, borderRadius: dim(5), padding: sp(10) }}>
          <StateRow label="Sidebar" value={sidebarCollapsed ? "collapsed" : "expanded"} />
          <button type="button" onClick={onToggleSidebar} style={smallButton()}>
            {sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          </button>
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

  return (
    <div style={{ display: "grid", gap: sp(14) }}>
      <Panel
        title="Synced Preferences"
        action={
          <div style={{ display: "flex", gap: sp(7), flexWrap: "wrap", justifyContent: "flex-end" }}>
            <button type="button" onClick={userPreferences.reload} disabled={userPreferences.loading} style={smallButton()}>
              Refresh
            </button>
            <button type="button" onClick={userPreferences.reset} disabled={userPreferences.saving} style={smallButton({ danger: true })}>
              Reset
            </button>
          </div>
        }
      >
        {userPreferences.error && (
          <div style={{ color: T.amber, fontFamily: T.mono, fontSize: fs(9), marginBottom: sp(10) }}>
            {userPreferences.error}
          </div>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: sp(10) }}>
          <StateRow label="Source" value={userPreferences.snapshot?.source || "local"} tone={userPreferences.snapshot?.source === "database" ? T.green : T.amber} />
          <StateRow label="Status" value={userPreferences.saving ? "saving" : userPreferences.loading ? "loading" : "synced"} tone={userPreferences.saving || userPreferences.loading ? T.amber : T.green} />
          <StateRow label="App time" value={formatPreferenceTimeZoneLabel(prefs, "app")} />
          <StateRow label="Chart time" value={formatPreferenceTimeZoneLabel(prefs, "chart")} />
        </div>
      </Panel>

      <Panel title="Appearance">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(175px, 1fr))", gap: sp(10) }}>
          <SelectField
            label="Theme"
            value={prefs.appearance.theme}
            onChange={setThemePreference}
            options={USER_THEME_OPTIONS}
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
      </Panel>

      <Panel title="Time Display">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(175px, 1fr))", gap: sp(10) }}>
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
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: sp(10) }}>
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
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(175px, 1fr))", gap: sp(10) }}>
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
          label="RayAlgo Panel"
          value={chart.rayAlgoDashboard}
          onChange={(value) => patchChart({ rayAlgoDashboard: value })}
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
        <CheckboxField label="Indicator values" checked={chart.showIndicatorValues} onChange={(value) => patchChart({ showIndicatorValues: value })} />
        <CheckboxField label="Time axis" checked={chart.showTimeScale} onChange={(value) => patchChart({ showTimeScale: value })} />
        <CheckboxField label="Grid" checked={chart.showGrid} onChange={(value) => patchChart({ showGrid: value })} />
        <CheckboxField label="Keep zoom" checked={chart.keepTimeZoom} onChange={(value) => patchChart({ keepTimeZoom: value })} />
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
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(175px, 1fr))", gap: sp(10) }}>
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
      window.dispatchEvent(new CustomEvent(DIAGNOSTIC_ALERT_PREF_EVENT, { detail: next }));
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
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(175px, 1fr))", gap: sp(10) }}>
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
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: sp(10) }}>
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
      <div style={{ color: T.textDim, fontFamily: T.mono, fontSize: fs(9), marginBottom: sp(10) }}>
        Controls the quick-pick timeframe buttons used by the primary chart, market grid charts, and option charts.
      </div>
      <div style={{ display: "grid", gap: sp(12) }}>
        {CHART_TIMEFRAME_ROLES.map((role) => {
          const options = getChartTimeframeOptions(role.value);
          const favorites = resolveChartTimeframeFavorites(favoritesState[role.value], role.value);
          return (
            <div
              key={role.value}
              style={{
                border: `1px solid ${T.border}`,
                background: T.bg2,
                borderRadius: dim(5),
                padding: sp(10),
                display: "grid",
                gap: sp(8),
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: sp(10) }}>
                <div style={{ color: T.text, fontWeight: 900, fontSize: fs(11) }}>{role.label}</div>
                <button type="button" onClick={() => resetRole(role.value)} style={smallButton()}>
                  Reset
                </button>
              </div>
              <div style={{ display: "flex", gap: sp(6), flexWrap: "wrap" }}>
                {options.map((option) => {
                  const active = favorites.includes(option.value);
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => toggle(role.value, option.value)}
                      style={{
                        ...smallButton({ active }),
                        opacity: !active && favorites.length >= 8 ? 0.75 : 1,
                      }}
                    >
                      {option.label}
                    </button>
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
        <button type="button" onClick={alerts.reset} style={smallButton({ danger: true })}>
          Reset alerts
        </button>
      }
    >
      <div style={{ color: T.textDim, fontFamily: T.mono, fontSize: fs(9), marginBottom: sp(10) }}>
        Controls the local browser alert state used by Diagnostics for crash-risk, cache, and memory warnings.
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: sp(10) }}>
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
          tone={mutedActive ? T.amber : T.green}
        />
        <StateRow label="Dismissed alerts" value={dismissedCount} tone={dismissedCount > 0 ? T.amber : T.textSec} />
      </div>
      <div style={{ display: "flex", gap: sp(8), flexWrap: "wrap", marginTop: sp(12) }}>
        <button type="button" onClick={() => alerts.snooze(15)} style={smallButton()}>
          Snooze 15m
        </button>
        <button type="button" onClick={() => alerts.snooze(60)} style={smallButton()}>
          Snooze 1h
        </button>
        <button type="button" onClick={() => alerts.snooze(0)} style={smallButton({ active: mutedActive })}>
          Clear snooze
        </button>
        <button type="button" onClick={alerts.clearDismissals} style={smallButton({ danger: dismissedCount > 0 })}>
          Clear dismissals
        </button>
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
  const accountAssetFilter = ACCOUNT_ASSET_FILTER_OPTIONS.some((option) => option.value === state.accountAssetFilter)
    ? state.accountAssetFilter
    : "all";
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
          <button
            type="button"
            onClick={() =>
              workspace.resetKeys([
                "marketActivityPanelWidth",
                "marketUnusualThreshold",
                "flowFilter",
                "flowMinPrem",
                "flowSortBy",
                "flowIncludeQuery",
                "flowExcludeQuery",
                "flowDensity",
                "flowRowsPerPage",
                "flowLivePaused",
                "flowShowUnusualScanner",
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
              ])
            }
            style={smallButton({ danger: true })}
          >
            Reset defaults
          </button>
        }
      >
        <div style={{ color: T.textDim, fontFamily: T.mono, fontSize: fs(9), marginBottom: sp(10) }}>
          These settings update the same workspace state read by the app. Mounted screens may need a revisit or reload to pick up default-only values.
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: sp(10) }}>
          <SelectField
            label="Header Tape Speed"
            value={headerPreset}
            onChange={(value) => workspace.patch({ headerBroadcastSpeedPreset: resolveHeaderBroadcastSpeedPreset(value) })}
            options={Object.entries(HEADER_BROADCAST_SPEED_PRESETS).map(([value, config]) => ({ value, label: config.label }))}
          />
          <NumberField
            label="Market Activity Width"
            value={Number.isFinite(state.marketActivityPanelWidth) ? state.marketActivityPanelWidth : 420}
            min={320}
            max={720}
            onChange={(value) => workspace.patch({ marketActivityPanelWidth: value })}
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
              checked={state.flowShowUnusualScanner !== false}
              onChange={(event) => workspace.patch({ flowShowUnusualScanner: event.target.checked })}
            />
            Show Flow scanner by default
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
          <button
            type="button"
            onClick={() =>
              workspace.resetKeys([
                "marketGridTickerSearchCache",
                "marketGridTickerSearchFavorites",
                "marketGridRecentTickerRows",
                "marketGridRecentTickers",
              ])
            }
            style={smallButton()}
          >
            Clear ticker search history
          </button>
          <button
            type="button"
            onClick={() =>
              workspace.resetKeys([
                "tradeRecentTickers",
                "tradeRecentTickerRows",
                "tradeContracts",
              ])
            }
            style={smallButton()}
          >
            Clear trade recents
          </button>
          <button
            type="button"
            onClick={() =>
              workspace.resetKeys([
                "flowSavedScans",
                "flowActiveScanId",
                "flowActivePresetId",
              ])
            }
            style={smallButton()}
          >
            Clear Flow saved scans
          </button>
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
      title="Market / Flow Scanner"
      action={
        <button
          type="button"
          onClick={() => setFlowScannerControlState({ enabled: !control.enabled })}
          style={smallButton({ active: control.enabled })}
        >
          {control.enabled ? "Broad Scan On" : "Broad Scan Off"}
        </button>
      }
    >
      <div style={{ color: T.textDim, fontFamily: T.mono, fontSize: fs(9), marginBottom: sp(10) }}>
        Shared with the header flow scan controls and persisted in the app workspace state.
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: sp(10) }}>
        <SelectField
          label="Universe"
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
        <NumberField label="Max Symbols" value={config.maxSymbols} onChange={(value) => updateConfig({ maxSymbols: value })} {...FLOW_SCANNER_CONFIG_LIMITS.maxSymbols} />
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

function SignalMonitorSettingsPanel({ watchlists }) {
  const monitor = useSignalMonitorSettings();
  const draft = monitor.draft;
  const states = monitor.state?.states || [];
  const watchlistOptions = [
    { value: "", label: "Default watchlist" },
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
            <button type="button" onClick={monitor.reload} disabled={monitor.loading} style={smallButton()}>
              Refresh
            </button>
            <button type="button" onClick={() => monitor.evaluate("incremental")} disabled={monitor.evaluating} style={smallButton()}>
              {monitor.evaluating ? "Scanning" : "Scan Now"}
            </button>
            <button type="button" onClick={monitor.discard} disabled={!monitor.dirty || monitor.saving} style={smallButton()}>
              Discard
            </button>
            <button type="button" onClick={monitor.save} disabled={!monitor.dirty || monitor.saving} style={smallButton({ active: monitor.dirty })}>
              {monitor.saving ? "Saving" : "Save"}
            </button>
          </div>
        }
      >
        {monitor.error && (
          <div style={{ color: T.amber, fontFamily: T.mono, fontSize: fs(9), marginBottom: sp(10) }}>
            {monitor.error}
          </div>
        )}
        {!draft ? (
          <div style={{ color: T.textDim, fontFamily: T.mono, fontSize: fs(10) }}>
            Loading signal monitor profile.
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: sp(10) }}>
            <label style={{ ...labelStyle(), flexDirection: "row", alignItems: "center" }}>
              <input
                type="checkbox"
                checked={Boolean(draft.enabled)}
                onChange={(event) => monitor.patchDraft({ enabled: event.target.checked })}
              />
              Enabled
            </label>
            <SelectField label="Timeframe" value={draft.timeframe} onChange={(value) => monitor.patchDraft({ timeframe: value })} options={SIGNAL_TIMEFRAMES} />
            <SelectField label="Watchlist" value={draft.watchlistId || ""} onChange={(value) => monitor.patchDraft({ watchlistId: value || null })} options={watchlistOptions} />
            <NumberField label="Poll Seconds" value={draft.pollIntervalSeconds} min={15} max={3600} onChange={(value) => monitor.patchDraft({ pollIntervalSeconds: value })} />
            <NumberField label="Max Symbols" value={draft.maxSymbols} min={1} max={500} onChange={(value) => monitor.patchDraft({ maxSymbols: value })} />
            <NumberField label="Concurrency" value={draft.evaluationConcurrency} min={1} max={16} onChange={(value) => monitor.patchDraft({ evaluationConcurrency: value })} />
            <NumberField label="Fresh Bars" value={draft.freshWindowBars} min={1} max={100} onChange={(value) => monitor.patchDraft({ freshWindowBars: value })} />
          </div>
        )}
      </Panel>
      <Panel title="Signal Monitor Status">
        <StateRow label="Tracked symbols" value={states.length} />
        <StateRow label="Fresh signals" value={states.filter((state) => state.fresh && state.status === "ok").length} />
        <StateRow label="Recent events" value={monitor.events.length} />
        <StateRow label="Last evaluated" value={draft?.lastEvaluatedAt || MISSING_VALUE} />
        <StateRow label="Last error" value={draft?.lastError || MISSING_VALUE} tone={draft?.lastError ? T.red : T.textSec} />
      </Panel>
    </div>
  );
}

function SettingsStatusStrip({ summary, dirtyCount }) {
  const providers = safeRecord(summary.providers);
  const items = [
    {
      label: "Restart",
      value: `${summary.pendingRestartCount || 0} pending`,
      tone: summary.pendingRestartCount > 0 ? T.amber : T.green,
    },
    {
      label: "Diagnostics",
      value: summary.diagnosticsSeverity || summary.diagnosticsStatus || "unknown",
      tone: summary.diagnosticsSeverity === "critical" ? T.red : summary.diagnosticsSeverity === "warning" ? T.amber : T.green,
    },
    {
      label: "Trading",
      value: summary.tradingMode || "paper",
      tone: summary.tradingMode === "live" ? T.red : T.green,
    },
    {
      label: "Providers",
      value: `${providers.polygon ? "P" : "-"} ${providers.research ? "R" : "-"} ${providers.ibkr ? "I" : "-"}`,
      tone: providers.polygon && providers.research && providers.ibkr ? T.green : T.amber,
    },
    {
      label: "Unsaved",
      value: dirtyCount || 0,
      tone: dirtyCount > 0 ? T.amber : T.textSec,
    },
  ];

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(135px, 1fr))",
        gap: sp(8),
        marginBottom: sp(14),
      }}
    >
      {items.map((item) => (
        <div
          key={item.label}
          style={{
            border: `1px solid ${T.border}`,
            background: T.bg1,
            borderRadius: dim(5),
            padding: sp("8px 10px"),
            display: "grid",
            gap: sp(3),
            minWidth: 0,
          }}
        >
          <span style={{ color: T.textDim, fontFamily: T.mono, fontSize: fs(8), fontWeight: 900 }}>
            {item.label}
          </span>
          <span style={{ color: item.tone, fontFamily: T.mono, fontSize: fs(11), fontWeight: 900 }}>
            {item.value}
          </span>
        </div>
      ))}
    </div>
  );
}

function ResearchProviderPanel({ backendSnapshot }) {
  const research = useResearchStatus();
  const providers = safeRecord(backendSnapshot?.summary?.providers);
  return (
    <Panel title="Research / Provider Wiring" action={<button type="button" onClick={research.reload} style={smallButton()}>Refresh</button>}>
      {research.error && (
        <div style={{ color: T.amber, fontFamily: T.mono, fontSize: fs(9), marginBottom: sp(10) }}>
          {research.error}
        </div>
      )}
      <StateRow label="Research provider" value={research.status?.provider || "none"} tone={research.status?.configured ? T.green : T.amber} />
      <StateRow label="Research configured" value={research.status?.configured ? "yes" : "no"} tone={research.status?.configured ? T.green : T.amber} />
      <StateRow label="Market data provider" value={providers.polygon ? "configured" : "missing"} tone={providers.polygon ? T.green : T.amber} />
      <StateRow label="IBKR provider" value={providers.ibkr ? "configured" : "missing"} tone={providers.ibkr ? T.green : T.amber} />
    </Panel>
  );
}

function IbkrBridgeOverridePanel({ active, onReload }) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const clearOverride = () => {
    const confirmed = window.confirm(
      "Clear the persisted IBKR bridge override? This removes the current tunnel URL and requires a new Gateway bridge attach.",
    );
    if (!confirmed) return;

    setRunning(true);
    setError(null);
    fetch("/api/settings/backend/actions/ibkr.bridgeOverride.clear", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ force: false }),
    })
      .then((response) =>
        response.ok
          ? response.json()
          : response.json().then((payload) => Promise.reject(payload)),
      )
      .then((payload) => {
        setResult(payload);
        onReload?.();
      })
      .catch((err) => {
        setError(err?.detail || err?.message || "Failed to clear IBKR bridge override.");
      })
      .finally(() => setRunning(false));
  };

  return (
    <Panel
      title="IBKR Bridge Override"
      action={
        <button
          type="button"
          onClick={clearOverride}
          disabled={running || !active}
          style={smallButton({ danger: active })}
        >
          {running ? "Clearing" : "Clear"}
        </button>
      }
    >
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: sp(8) }}>
        <StateRow label="Override" value={active ? "active" : "inactive"} tone={active ? T.amber : T.green} />
        <StateRow
          label="Last clear"
          value={
            result?.cleared
              ? "cleared"
              : result?.reason === "no_override"
                ? "no override"
                : MISSING_VALUE
          }
          tone={result?.cleared || result?.reason === "no_override" ? T.green : T.textSec}
        />
      </div>
      {error ? (
        <div style={{ marginTop: sp(8), color: T.red, fontFamily: T.mono, fontSize: fs(9) }}>
          {error}
        </div>
      ) : null}
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
    ["IBKR", "Lanes, governor, scanner, bridge runtime", "backend persisted/runtime", "Settings-owned controls; Diagnostics is read-only"],
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
              gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
              gap: sp(10),
              borderBottom: `1px solid ${T.border}55`,
              padding: sp("8px 0"),
              fontFamily: T.mono,
              fontSize: fs(9),
            }}
          >
            <strong style={{ color: T.text }}>{area}</strong>
            <span style={{ color: T.textSec }}>{controls}</span>
            <span style={{ color: T.accent }}>{source}</span>
            <span style={{ color: T.textDim }}>{placement}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function FooterMemorySignalSettingsPanel() {
  const { preferences, updatePreferences } = useMemoryPressurePreferences();
  const memoryPressure = useMemoryPressureSnapshot(true);

  const thresholdOptions = ["watch", "high", "critical"];

  return (
    <Panel title="Footer Memory Signal">
      <div style={{ display: "grid", gap: sp(10) }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
            gap: sp(8),
          }}
        >
          <StateRow
            label="Current level"
            value={String(memoryPressure.level || "normal").toUpperCase()}
            tone={
              memoryPressure.level === "critical"
                ? T.red
                : memoryPressure.level === "high" ||
                    memoryPressure.level === "watch"
                  ? T.amber
                  : T.green
            }
          />
          <StateRow label="Trend" value={String(memoryPressure.trend || "steady").toUpperCase()} />
          <StateRow label="Source" value={memoryPressure.browserSource || MISSING_VALUE} />
          <StateRow label="Browser estimate" value={Number.isFinite(memoryPressure.browserMemoryMb) ? formatBytes(memoryPressure.browserMemoryMb * 1024 * 1024) : MISSING_VALUE} />
        </div>

        <div style={{ display: "grid", gap: sp(6) }}>
          <div style={{ ...labelStyle(), gap: sp(6) }}>
            Animation
            <div style={{ display: "flex", gap: sp(6), flexWrap: "wrap" }}>
              {[
                ["on", true],
                ["off", false],
              ].map(([label, value]) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => updatePreferences({ animationEnabled: value })}
                  style={smallButton({ active: preferences.animationEnabled === value })}
                >
                  {String(label).toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          <div style={{ ...labelStyle(), gap: sp(6) }}>
            Compact label
            <div style={{ display: "flex", gap: sp(6), flexWrap: "wrap" }}>
              {[
                ["on", true],
                ["off", false],
              ].map(([label, value]) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => updatePreferences({ showCompactLabel: value })}
                  style={smallButton({ active: preferences.showCompactLabel === value })}
                >
                  {String(label).toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          <div style={{ ...labelStyle(), gap: sp(6) }}>
            Pulse threshold
            <div style={{ display: "flex", gap: sp(6), flexWrap: "wrap" }}>
              {thresholdOptions.map((level) => (
                <button
                  key={level}
                  type="button"
                  onClick={() => updatePreferences({ alertThreshold: level })}
                  style={smallButton({ active: preferences.alertThreshold === level })}
                >
                  {level.toUpperCase()}
                </button>
              ))}
            </div>
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
  isVisible = false,
} = {}) {
  const [settingsRootRef, settingsRootSize] = useElementSize();
  const { isPhone: settingsIsPhone, isNarrow: settingsIsNarrow } =
    responsiveFlags(settingsRootSize.width);
  const [activeTab, setActiveTab] = useState(SETTINGS_TABS[0].id);
  const [settingsSearch, setSettingsSearch] = useState("");
  const backend = useBackendSettings();
  const userPreferences = useUserPreferences();
  const ibkr = useIbkrLaneSettings();
  const runtimeControl = useRuntimeControlSnapshot({
    enabled: Boolean(isVisible && activeTab === "Data & Broker"),
    runtimeDiagnosticsEnabled: false,
    lineUsageEnabled: Boolean(isVisible && activeTab === "Data & Broker"),
    lineUsageStreamEnabled: true,
  });
  const { watchlists } = useWatchlists();
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
  const visibleTabs = useMemo(() => {
    const query = settingsSearch.trim().toLowerCase();
    if (!query) return SETTINGS_TABS;
    return SETTINGS_TABS.filter((tab) =>
      `${tab.label} ${tab.description} ${tab.keywords}`.toLowerCase().includes(query),
    );
  }, [settingsSearch]);

  const renderSettingGrid = (group) => (
    <div style={{ display: "grid", gridTemplateColumns: settingsIsPhone ? "minmax(0, 1fr)" : "repeat(auto-fit, minmax(min(100%, 270px), 1fr))", gap: sp(8), alignItems: "start" }}>
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
      data-layout={settingsIsPhone ? "phone" : settingsIsNarrow ? "tablet" : "desktop"}
      style={{
        height: "100%",
        width: "100%",
        overflow: "auto",
        background: T.bg0,
        color: T.text,
        padding: sp(settingsIsPhone ? 6 : 10),
        fontFamily: T.sans,
        minWidth: 0,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: sp(12),
          marginBottom: sp(14),
          flexDirection: settingsIsPhone ? "column" : "row",
        }}
      >
        <div>
          <div style={{ fontSize: fs(18), fontWeight: 900 }}>Settings</div>
          <div style={{ color: T.textDim, fontSize: fs(10), fontFamily: T.mono }}>
            Backend operational controls, guarded applies, restart-required runtime state
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: sp(8), flexWrap: "wrap", justifyContent: settingsIsPhone ? "flex-start" : "flex-end", width: settingsIsPhone ? "100%" : undefined }}>
          <span style={{ color: summary.pendingRestartCount > 0 ? T.amber : T.green, fontFamily: T.mono, fontSize: fs(10), fontWeight: 900 }}>
            {summary.pendingRestartCount || 0} pending restart
          </span>
          <button type="button" onClick={backend.reload} disabled={backend.loading} style={smallButton()}>
            Refresh
          </button>
          <button type="button" onClick={backend.discard} disabled={backend.dirtyCount === 0 || backend.saving} style={smallButton()}>
            Discard
          </button>
          <button
            type="button"
            onClick={backend.apply}
            disabled={backend.dirtyCount === 0 || backend.saving}
            style={{
              ...smallButton({ active: backend.dirtyCount > 0 }),
              opacity: backend.dirtyCount > 0 ? 1 : 0.55,
            }}
          >
            {backend.saving ? "Applying" : `Apply ${backend.dirtyCount || ""}`.trim()}
          </button>
        </div>
      </div>

      {backend.error && (
        <div style={{ color: T.amber, fontFamily: T.mono, fontSize: fs(9), marginBottom: sp(10) }}>
          {backend.error}
        </div>
      )}

      <SettingsStatusStrip summary={summary} dirtyCount={backend.dirtyCount} />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: settingsIsNarrow
            ? "minmax(0, 1fr)"
            : "minmax(190px, 230px) minmax(0, 1fr)",
          gap: sp(14),
          alignItems: "start",
          minWidth: 0,
        }}
      >
        <aside
          style={{
            border: `1px solid ${T.border}`,
            background: T.bg1,
            borderRadius: dim(6),
            padding: sp(10),
            display: "grid",
            gap: sp(8),
            position: settingsIsNarrow ? "relative" : "sticky",
            top: settingsIsNarrow ? undefined : sp(10),
            minWidth: 0,
          }}
        >
          <input
            data-testid="settings-search-input"
            type="search"
            value={settingsSearch}
            onChange={(event) => setSettingsSearch(event.target.value)}
            placeholder="Search settings"
            style={inputStyle()}
          />
          {visibleTabs.map((tab) => (
            <button
              key={tab.id}
              data-testid={`settings-tab-${tab.id.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              style={{
                border: `1px solid ${activeTab === tab.id ? T.green : T.border}`,
                background: activeTab === tab.id ? T.greenBg : T.bg2,
                color: activeTab === tab.id ? T.green : T.textSec,
                borderRadius: dim(4),
                padding: sp("8px 9px"),
                textAlign: "left",
                cursor: "pointer",
              }}
            >
              <div style={{ fontFamily: T.mono, fontSize: fs(9), fontWeight: 900 }}>
                {tab.label}
              </div>
              <div style={{ color: T.textDim, fontFamily: T.mono, fontSize: fs(8), marginTop: sp(2) }}>
                {tab.description}
              </div>
            </button>
          ))}
          {!visibleTabs.length && (
            <div style={{ color: T.textDim, fontFamily: T.mono, fontSize: fs(9), padding: sp(8) }}>
              No matching sections
            </div>
          )}
        </aside>

        <main style={{ display: "grid", gap: sp(14), minWidth: 0 }}>
          {activeTab === "Preferences" && (
            <>
              <AppPreferencesPanel
                theme={theme}
                onToggleTheme={onToggleTheme}
                sidebarCollapsed={sidebarCollapsed}
                onToggleSidebar={onToggleSidebar}
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
              <FlowScannerSettingsPanel />
            </>
          )}

          {activeTab === "Automation & Alerts" && (
            <>
              <SignalMonitorSettingsPanel watchlists={watchlists} />
              <NotificationPreferencePanel userPreferences={userPreferences} />
              <DiagnosticAlertPreferencesPanel />
            </>
          )}

          {activeTab === "Data & Broker" && (
            <>
              <ResearchProviderPanel backendSnapshot={backend.snapshot} />
              <Panel title="Runtime Settings">{renderSettingGrid("runtime")}</Panel>
              <IbkrBridgeOverridePanel
                active={Boolean(summary.bridgeOverrideActive)}
                onReload={backend.reload}
              />
              <IbkrLineUsagePanel
                runtimeControl={runtimeControl}
              />
              <IbkrLaneArchitecturePanel
                snapshot={ibkr.snapshot}
                drafts={ibkr.drafts}
                policyDrafts={ibkr.policyDrafts}
                saving={ibkr.saving}
                error={ibkr.error}
                bridgeReady={ibkr.bridgeReady}
                onChange={ibkr.onChange}
                onReset={ibkr.onReset}
                onPolicyChange={ibkr.onPolicyChange}
                onResetPolicy={ibkr.onResetPolicy}
                onApplyPreset={ibkr.onApplyPreset}
                onDiscard={ibkr.onDiscard}
                onSave={ibkr.onSave}
                onReload={ibkr.onReload}
              />
            </>
          )}

          {activeTab === "System" && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: sp(10) }}>
                <Panel title="Runtime">
                  <StateRow label="Trading mode" value={summary.tradingMode} tone={summary.tradingMode === "live" ? T.red : T.green} />
                  <StateRow label="Diagnostics" value={summary.diagnosticsStatus} />
                  <StateRow label="Severity" value={summary.diagnosticsSeverity} />
                </Panel>
                <Panel title="Providers">
                  <StateRow label="Polygon" value={providers.polygon ? "configured" : "missing"} tone={providers.polygon ? T.green : T.amber} />
                  <StateRow label="Research" value={providers.research ? "configured" : "missing"} tone={providers.research ? T.green : T.amber} />
                  <StateRow label="IBKR" value={providers.ibkr ? "configured" : "missing"} tone={providers.ibkr ? T.green : T.amber} />
                </Panel>
                <Panel title="Controls">
                  <StateRow label="Thresholds" value={summary.thresholdCount} />
                  <StateRow label="IBKR lanes" value={summary.ibkrLaneCount} />
                  <StateRow label="Bridge override" value={summary.bridgeOverrideActive ? "active" : "inactive"} />
                </Panel>
                <Panel title="Workspace">
                  <StateRow label="Watchlists" value={summary.watchlistCount} />
                  <StateRow label="Watchlist symbols" value={summary.watchlistSymbolCount} />
                  <StateRow label="Signal monitor" value={summary.signalMonitor?.enabled ? "enabled" : "paused"} tone={summary.signalMonitor?.enabled ? T.green : T.textDim} />
                </Panel>
                <Panel title="Automation / Charting">
                  <StateRow label="Algo deployments" value={summary.algoDeploymentCount} />
                  <StateRow label="Enabled deployments" value={summary.enabledAlgoDeploymentCount} tone={summary.enabledAlgoDeploymentCount > 0 ? T.amber : T.textSec} />
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
                <StateRow label="Live apply" value="no" tone={T.amber} />
                <StateRow label="Persistence" value="server override file" />
                <StateRow label="Header source" value="effective env at process start" />
              </Panel>
              <Panel title="Backend Settings Snapshot">
                <details>
                  <summary
                    style={{
                      color: T.textSec,
                      cursor: "pointer",
                      fontFamily: T.mono,
                      fontSize: fs(10),
                      fontWeight: 900,
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
