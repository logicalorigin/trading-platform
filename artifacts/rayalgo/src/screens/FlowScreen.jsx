import {
  useEffect,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Area,
  AreaChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Columns3,
  Copy,
  ExternalLink,
  PanelLeftClose,
  PanelLeftOpen,
  Pin,
  PinOff,
  Play,
  SlidersHorizontal,
} from "lucide-react";
import { useGetNews } from "@workspace/api-client-react";
import {
  BROAD_MARKET_FLOW_STORE_KEY,
  setFlowScannerControlState,
  useFlowScannerControlState,
  useMarketFlowSnapshot,
  useMarketFlowSnapshotForStoreKey,
} from "../features/platform/marketFlowStore";
import { ContractDetailInline } from "../features/flow/ContractDetailInline.jsx";
import { FlowScannerStatusPanel } from "../features/flow/FlowScannerStatusPanel.jsx";
import {
  buildDteBucketsFromEvents,
  buildFlowClockFromEvents,
  buildFlowTideFromEvents,
  buildMarketOrderFlowFromEvents,
  buildPutCallSummaryFromEvents,
  buildSectorFlowFromEvents,
  buildTickerFlowFromEvents,
} from "../features/flow/flowAnalytics";
import {
  OrderFlowDonut,
  SizeBucketRow,
} from "../features/flow/OrderFlowVisuals.jsx";
import { flowProviderColor } from "../features/flow/flowPresentation";
import {
  bridgeRuntimeMessage,
} from "../features/platform/bridgeRuntimeModel";
import { normalizeTickerSymbol } from "../features/platform/tickerIdentity";
import {
  Badge,
  Card,
  CardTitle,
  DataUnavailableState,
  Pill,
} from "../components/platform/primitives.jsx";
import { _initialState, persistState } from "../lib/workspaceState";
import {
  fmtCompactNumber,
  fmtM,
  formatExpirationLabel,
  formatRelativeTimeShort,
  isFiniteNumber,
  mapNewsSentimentToScore,
} from "../lib/formatters";
import {
  MISSING_VALUE,
  T,
  dim,
  fs,
  sp,
} from "../lib/uiTokens";
import { chartTooltipContentStyle } from "../lib/tooltipStyles";
import { formatAppTimeForPreferences, getAppTimeZoneLabel } from "../lib/timeZone";
import {
  joinMotionClasses,
  motionRowStyle,
  motionVars,
} from "../lib/motion";
import {
  DEFAULT_FLOW_SCANNER_CONFIG,
} from "../features/platform/marketFlowScannerConfig";
import { useUserPreferences } from "../features/preferences/useUserPreferences";
import {
  FLOW_BUILT_IN_PRESETS,
  FLOW_MIN_PREMIUM_OPTIONS,
  FLOW_TAPE_FILTER_OPTIONS,
  buildFlowTapePresetPatch,
  getFlowBuiltInPreset,
  setFlowTapeFilterState,
  useFlowTapeFilterState,
} from "../features/platform/flowFilterStore";
import { MarketIdentityInline } from "../features/platform/marketIdentity";
import {
  classifyFlowSentiment,
  compareFlowEvents,
  formatFlowTradeAge,
  getDefaultFlowSortDir,
  normalizeFlowSortBy,
  normalizeFlowSortDir,
  summarizeFlowSentiment,
} from "../features/platform/flowTapeModel";
import { AppTooltip } from "@/components/ui/tooltip";


const UNUSUAL_SORT_OPTIONS = [
  { id: "ratio", label: "Vol/OI", numeric: true },
  { id: "premium", label: "Premium", numeric: true },
  { id: "dte", label: "DTE", numeric: true },
  { id: "underlying", label: "Underlying", numeric: false },
];
const FLOW_ROWS_OPTIONS = [24, 40, 60, 100];
const FLOW_TAPE_OPTIONAL_COLUMNS = Object.freeze([
  { id: "side", label: "SIDE", toggleLabel: "Side", width: "56px" },
  { id: "execution", label: "EXEC", toggleLabel: "Exec", width: "56px" },
  { id: "type", label: "TYPE", toggleLabel: "Type", width: "70px" },
  { id: "fill", label: "FILL", toggleLabel: "Fill", width: "78px" },
  { id: "bidAsk", label: "BID/ASK", toggleLabel: "Bid/Ask", width: "118px" },
  { id: "bid", label: "BID", toggleLabel: "Bid", width: "58px", defaultVisible: false },
  { id: "ask", label: "ASK", toggleLabel: "Ask", width: "58px", defaultVisible: false },
  { id: "spread", label: "SPREAD", toggleLabel: "Spread", width: "78px", defaultVisible: false },
  { id: "premium", label: "PREMIUM", toggleLabel: "Prem", width: "76px" },
  { id: "size", label: "SIZE", toggleLabel: "Size", width: "50px" },
  { id: "oi", label: "OI", toggleLabel: "OI", width: "50px" },
  { id: "ratio", label: "V/OI", toggleLabel: "V/OI", width: "50px" },
  { id: "dte", label: "DTE", toggleLabel: "DTE", width: "42px" },
  { id: "iv", label: "IV", toggleLabel: "IV", width: "52px" },
  { id: "spot", label: "SPOT", toggleLabel: "Spot", width: "62px" },
  { id: "moneyness", label: "MNY", toggleLabel: "Mny", width: "54px", defaultVisible: false },
  { id: "distance", label: "DIST", toggleLabel: "Dist", width: "54px", defaultVisible: false },
  { id: "delta", label: "DELTA", toggleLabel: "Delta", width: "56px", defaultVisible: false },
  { id: "gamma", label: "GAMMA", toggleLabel: "Gamma", width: "56px", defaultVisible: false },
  { id: "theta", label: "THETA", toggleLabel: "Theta", width: "56px", defaultVisible: false },
  { id: "vega", label: "VEGA", toggleLabel: "Vega", width: "54px", defaultVisible: false },
  { id: "sourceBasis", label: "SOURCE", toggleLabel: "Source", width: "82px", defaultVisible: false },
  { id: "confidence", label: "CONF", toggleLabel: "Conf", width: "78px", defaultVisible: false },
  { id: "score", label: "SCORE", toggleLabel: "Score", width: "48px" },
]);
const DEFAULT_FLOW_VISIBLE_COLUMNS = FLOW_TAPE_OPTIONAL_COLUMNS.filter(
  (column) => column.defaultVisible !== false,
).map((column) => column.id);
const HAS_PERSISTED_FLOW_FILTERS_OPEN = Object.prototype.hasOwnProperty.call(
  _initialState,
  "flowFiltersOpen",
);
const FLOW_COLUMN_BY_ID = new Map(
  FLOW_TAPE_OPTIONAL_COLUMNS.map((column) => [column.id, column]),
);
const DEFAULT_FLOW_COLUMN_ORDER = FLOW_TAPE_OPTIONAL_COLUMNS.map(
  (column) => column.id,
);
const FLOW_FIXED_COLUMNS = Object.freeze([
  { id: "time", label: "AGE", width: "58px" },
  { id: "ticker", label: "TICK", width: "62px" },
  { id: "right", label: "C/P", width: "34px" },
  { id: "expiration", label: "EXP", width: "62px" },
  { id: "strike", label: "STRIKE", width: "64px" },
  { id: "otmPercent", label: "% OTM", width: "58px" },
  { id: "mark", label: "MARK", width: "62px" },
  { id: "actions", label: "ACTIONS", width: "76px" },
]);

const getMergedFlowEventKey = (event) =>
  event?.id ||
  [
    event?.ticker || event?.underlying || event?.symbol || "",
    event?.optionTicker || "",
    event?.strike ?? "",
    event?.cp || event?.right || "",
    event?.expirationDate || event?.exp || "",
    event?.occurredAt || event?.time || "",
    event?.premium ?? "",
  ].join("|");

const mergeFlowEventFeeds = (...feeds) => {
  const mergedByKey = new Map();
  feeds.flat().forEach((event) => {
    if (!event) return;
    const key = getMergedFlowEventKey(event);
    if (!mergedByKey.has(key)) {
      mergedByKey.set(key, event);
    }
  });
  return Array.from(mergedByKey.values());
};
const RIGHT_ALIGNED_FLOW_COLUMNS = new Set([
  "actions",
  "ask",
  "bid",
  "bidAsk",
  "delta",
  "distance",
  "dte",
  "fill",
  "gamma",
  "iv",
  "mark",
  "moneyness",
  "oi",
  "otmPercent",
  "premium",
  "ratio",
  "size",
  "spot",
  "spread",
  "strike",
  "theta",
  "vega",
]);
const CENTER_ALIGNED_FLOW_COLUMNS = new Set([
  "actions",
  "execution",
  "right",
  "score",
  "side",
  "sourceBasis",
  "type",
]);
const FLOW_SORTABLE_COLUMNS = new Set([
  "confidence",
  "delta",
  "distance",
  "dte",
  "expiration",
  "gamma",
  "iv",
  "mark",
  "moneyness",
  "oi",
  "otmPercent",
  "premium",
  "ratio",
  "right",
  "score",
  "size",
  "spot",
  "strike",
  "ticker",
  "time",
  "theta",
  "vega",
]);

const FLOW_COLUMN_ALIASES = Object.freeze({
  price: ["fill"],
});

const expandFlowColumnIds = (value, { replaceRawBidAsk = false } = {}) => {
  if (!Array.isArray(value)) return [];
  const expanded = [];
  let insertedBidAsk = false;
  value.forEach((columnId) => {
    if (
      replaceRawBidAsk &&
      ["bid", "ask", "spread"].includes(columnId)
    ) {
      if (!insertedBidAsk) {
        expanded.push("bidAsk");
        insertedBidAsk = true;
      }
      return;
    }
    if (FLOW_COLUMN_BY_ID.has(columnId)) {
      expanded.push(columnId);
      return;
    }
    expanded.push(...(FLOW_COLUMN_ALIASES[columnId] || []));
  });
  return expanded;
};

const normalizeFlowColumnOrder = (value) => {
  const seen = new Set();
  const ordered = expandFlowColumnIds(value, {
    replaceRawBidAsk: !Array.isArray(value) || !value.includes("bidAsk"),
  }).filter((columnId) => {
    if (!FLOW_COLUMN_BY_ID.has(columnId) || seen.has(columnId)) return false;
    seen.add(columnId);
    return true;
  });
  return [
    ...ordered,
    ...DEFAULT_FLOW_COLUMN_ORDER.filter((columnId) => !seen.has(columnId)),
  ];
};

const normalizeFlowVisibleColumns = (value) => {
  const columns = Array.isArray(value)
    ? expandFlowColumnIds(value, {
        replaceRawBidAsk: !value.includes("bidAsk"),
      }).filter((columnId) => FLOW_COLUMN_BY_ID.has(columnId))
    : DEFAULT_FLOW_VISIBLE_COLUMNS;
  const visible = columns.length
    ? Array.from(new Set(columns))
    : DEFAULT_FLOW_VISIBLE_COLUMNS;
  if (visible.includes("bidAsk")) return visible;
  const fillIndex = visible.indexOf("fill");
  if (fillIndex < 0) return ["bidAsk", ...visible];
  return [
    ...visible.slice(0, fillIndex + 1),
    "bidAsk",
    ...visible.slice(fillIndex + 1),
  ];
};

const getFlowContractLabel = (event) => {
  if (!event) return "";
  const expiration = formatExpirationLabel(event.expirationDate);
  return [
    event.optionTicker,
    `${event.ticker} ${expiration} ${event.strike}${event.cp}`,
  ]
    .filter(Boolean)
    .join(" | ");
};

const parseTickerTokens = (value) =>
  Array.from(
    new Set(
      String(value || "")
        .split(/[\s,]+/)
        .map((token) => normalizeTickerSymbol(token))
        .filter(Boolean),
    ),
  );

const FLOW_PRESET_COLORS = Object.freeze({
  "ask-calls": T.green,
  "bid-puts": T.red,
  "zero-dte": T.amber,
  "premium-50k": T.text,
  "premium-250k": T.amber,
  "vol-oi": T.cyan,
  sweeps: T.amber,
  blocks: T.accent,
  repeats: T.cyan,
  golden: T.amber,
});

const flowPresetMatches = (presetId, event, clusterFor) => {
  if (!presetId) return true;
  if (presetId === "ask-calls") {
    return event.cp === "C" && event.side === "BUY";
  }
  if (presetId === "bid-puts") {
    return event.cp === "P" && event.side === "SELL";
  }
  if (presetId === "zero-dte") {
    return Number.isFinite(event.dte) && event.dte <= 1;
  }
  if (presetId === "premium-50k") {
    return event.premium >= 50_000;
  }
  if (presetId === "premium-250k") {
    return event.premium >= 250_000;
  }
  if (presetId === "vol-oi") {
    return Boolean(event.isUnusual) || (event.unusualScore || 0) >= 1;
  }
  if (presetId === "sweeps") return event.type === "SWEEP";
  if (presetId === "blocks") return event.type === "BLOCK";
  if (presetId === "repeats") return clusterFor(event) !== null;
  if (presetId === "golden") return Boolean(event.golden);
  return true;
};

const getFlowSourceBasisMeta = (value) => {
  if (value === "confirmed_trade") {
    return { label: "TRADE", detail: "Confirmed trade", color: T.green };
  }
  if (value === "snapshot_activity") {
    return { label: "SNAP", detail: "Snapshot activity", color: T.accent };
  }
  if (value === "fallback_estimate") {
    return { label: "FALLBK", detail: "Fallback estimate", color: T.amber };
  }
  return { label: "N/A", detail: "Unavailable", color: T.textDim };
};

const formatOptionPrice = (value) =>
  isFiniteNumber(value) ? value.toFixed(value < 10 ? 2 : 1) : MISSING_VALUE;

const formatGreekValue = (value) =>
  isFiniteNumber(value) ? value.toFixed(2) : MISSING_VALUE;

const formatSignedPercent = (value, digits = 1) =>
  isFiniteNumber(value)
    ? `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`
    : MISSING_VALUE;

const resolveFlowMark = (event) => {
  if (isFiniteNumber(event?.mark)) return event.mark;
  if (isFiniteNumber(event?.bid) && isFiniteNumber(event?.ask) && event.ask > 0) {
    return (event.bid + event.ask) / 2;
  }
  return null;
};

const resolveFlowOtmPercent = (event) => {
  const spot = Number(event?.spot);
  const strike = Number(event?.strike);
  const right = String(event?.cp || "").toUpperCase();
  if (
    !Number.isFinite(spot) ||
    spot <= 0 ||
    !Number.isFinite(strike) ||
    strike <= 0
  ) {
    return null;
  }
  if (right === "C") {
    return Math.max(0, ((strike - spot) / spot) * 100);
  }
  if (right === "P") {
    return Math.max(0, ((spot - strike) / spot) * 100);
  }
  return null;
};

const resolveFlowFillSpreadMeta = (event) => {
  const fill = isFiniteNumber(event?.premiumPrice)
    ? event.premiumPrice
    : isFiniteNumber(event?.price)
      ? event.price
      : null;
  const bid = isFiniteNumber(event?.bid) ? event.bid : null;
  const ask = isFiniteNumber(event?.ask) ? event.ask : null;

  if (!isFiniteNumber(fill) || !isFiniteNumber(bid) || !isFiniteNumber(ask)) {
    return {
      fill,
      bid,
      ask,
      spread: null,
      spreadPct: null,
      label: "N/A",
      shortLabel: "N/A",
      color: T.textDim,
      crossed: false,
    };
  }

  if (ask < bid) {
    return {
      fill,
      bid,
      ask,
      spread: ask - bid,
      spreadPct: null,
      label: "Crossed market",
      shortLabel: "X",
      color: T.amber,
      crossed: true,
    };
  }

  const spread = ask - bid;
  const mid = (bid + ask) / 2;
  const spreadPct = mid > 0 ? (spread / mid) * 100 : null;
  if (spread <= 0) {
    return {
      fill,
      bid,
      ask,
      spread,
      spreadPct,
      label: "Locked market",
      shortLabel: "LOCK",
      color: T.textDim,
      crossed: false,
    };
  }

  const position = (fill - bid) / spread;
  if (position < 0) {
    return {
      fill,
      bid,
      ask,
      spread,
      spreadPct,
      label: "Below bid",
      shortLabel: "BID-",
      color: T.red,
      crossed: false,
    };
  }
  if (position <= 0.1) {
    return { fill, bid, ask, spread, spreadPct, label: "At bid", shortLabel: "BID", color: T.red, crossed: false };
  }
  if (position <= 0.4) {
    return { fill, bid, ask, spread, spreadPct, label: "Bid side", shortLabel: "BID", color: T.red, crossed: false };
  }
  if (position <= 0.6) {
    return { fill, bid, ask, spread, spreadPct, label: "Mid", shortLabel: "MID", color: T.textDim, crossed: false };
  }
  if (position <= 0.9) {
    return { fill, bid, ask, spread, spreadPct, label: "Ask side", shortLabel: "ASK", color: event?.cp === "P" ? T.red : T.green, crossed: false };
  }
  if (position <= 1) {
    return { fill, bid, ask, spread, spreadPct, label: "At ask", shortLabel: "ASK", color: event?.cp === "P" ? T.red : T.green, crossed: false };
  }
  return {
    fill,
    bid,
    ask,
    spread,
    spreadPct,
    label: "Above ask",
    shortLabel: "ASK+",
    color: event?.cp === "P" ? T.red : T.green,
    crossed: false,
  };
};

const resolveFlowQuality = ({
  flowStatus,
  hasLiveFlow,
  providerSummary,
  coverage,
  watchlistSymbols,
  newestScanAt,
  oldestScanAt,
  livePaused,
}) => {
  const totalSymbols = Math.max(
    0,
    coverage?.activeTargetSize ||
      coverage?.totalSymbols ||
      watchlistSymbols.length ||
      0,
  );
  const scannedSymbols = Math.max(
    0,
    coverage?.cycleScannedSymbols ?? coverage?.scannedSymbols ?? 0,
  );
  const coverageRatio = totalSymbols > 0 ? scannedSymbols / totalSymbols : 0;
  const newestAgeMs = newestScanAt ? Date.now() - newestScanAt : null;
  const oldestAgeMs = oldestScanAt ? Date.now() - oldestScanAt : null;
  const failures = providerSummary?.failures || [];
  const hasSourceError =
    flowStatus === "offline" ||
    Boolean(providerSummary?.erroredSource) ||
    failures.length > 0;
  const sourceLabel = providerSummary?.label || "Flow source";

  if (hasSourceError) {
    return {
      label: "Degraded",
      color: T.red,
      ratio: coverageRatio,
      detail:
        providerSummary?.erroredSource?.errorMessage ||
        failures[0]?.error ||
        "Flow provider returned an error.",
      newestAgeMs,
      oldestAgeMs,
    };
  }

  if (livePaused || (newestAgeMs !== null && newestAgeMs > 120_000)) {
    return {
      label: "Stale",
      color: T.amber,
      ratio: coverageRatio,
      detail: livePaused
        ? "Tape is paused on the last captured snapshot."
        : "Latest scan is older than the active freshness window.",
      newestAgeMs,
      oldestAgeMs,
    };
  }

  if (hasLiveFlow && (coverageRatio >= 0.95 || !totalSymbols)) {
    return {
      label: "Full",
      color: T.green,
      ratio: 1,
      detail: `${sourceLabel} covering the active watchlist.`,
      newestAgeMs,
      oldestAgeMs,
    };
  }

  if (hasLiveFlow && coverageRatio >= 0.5) {
    return {
      label: "Partial",
      color: T.accent,
      ratio: coverageRatio,
      detail: "Watchlist rotation is still filling in coverage.",
      newestAgeMs,
      oldestAgeMs,
    };
  }

  return {
    label: "Thin",
    color: flowStatus === "loading" ? T.accent : T.textDim,
    ratio: coverageRatio,
    detail:
      flowStatus === "loading"
        ? "Initial scan is still warming up."
        : "Provider returned limited current options activity.",
    newestAgeMs,
    oldestAgeMs,
  };
};

const getFlowExecutionMeta = (event) => {
  const normalizedSide = String(event?.side || "").toUpperCase();
  if (normalizedSide === "BUY") {
    return {
      label: event?.type === "SWEEP" ? "ASK+" : "ASK",
      color: event?.cp === "P" ? T.red : T.green,
    };
  }
  if (normalizedSide === "SELL") {
    return {
      label: event?.type === "BLOCK" ? "BID" : "BID-",
      color: T.red,
    };
  }
  return { label: "MID", color: T.textDim };
};

const FlowLoadingBlock = ({
  width = "100%",
  height = dim(10),
  style = {},
}) => (
  <div
    className="ra-skeleton"
    style={{
      width,
      height,
      borderRadius: dim(3),
      background: `${T.border}70`,
      opacity: 0.65,
      ...style,
    }}
  />
);

const FlowPlaceholderCard = ({
  title = "Loading",
  rows = 4,
  dense = false,
}) => (
  <Card
    className="ra-panel-enter"
    style={{
      padding: "8px 10px",
      display: "flex",
      flexDirection: "column",
      gap: sp(dense ? 4 : 6),
    }}
  >
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
      }}
    >
      <span
        style={{
          fontSize: fs(10),
          fontWeight: 700,
          fontFamily: T.display,
          color: T.textSec,
        }}
      >
        {title}
      </span>
      <FlowLoadingBlock width={dim(56)} height={dim(8)} />
    </div>
    {Array.from({ length: rows }).map((_, index) => (
      <FlowLoadingBlock
        key={`${title}_${index}`}
        width={index === rows - 1 ? "72%" : "100%"}
        height={dense ? dim(12) : dim(16)}
      />
    ))}
  </Card>
);

const FlowOverviewPanel = ({
  onJumpToTrade,
  session,
  symbols = [],
  isVisible = false,
}) => {
  const { preferences: userPreferences } = useUserPreferences();
  const appTimeZoneLabel = getAppTimeZoneLabel(userPreferences);
  const formatFlowAppTime = useCallback(
    (value) => formatAppTimeForPreferences(value, userPreferences),
    [userPreferences],
  );
  const [savedScans, setSavedScans] = useState(
    _initialState.flowSavedScans || [],
  );
  const [activeScanId, setActiveScanId] = useState(
    _initialState.flowActiveScanId || null,
  );
  const flowTapeFilters = useFlowTapeFilterState();
  const {
    activeFlowPresetId,
    filter,
    minPrem,
    includeQuery,
    excludeQuery,
  } = flowTapeFilters;
  const [sortBy, setSortBy] = useState(() =>
    normalizeFlowSortBy(_initialState.flowSortBy),
  );
  const [sortDir, setSortDir] = useState(() =>
    normalizeFlowSortDir(
      _initialState.flowSortDir,
      normalizeFlowSortBy(_initialState.flowSortBy),
    ),
  );
  const [selectedEvt, setSelectedEvt] = useState(null);
  const [density, setDensity] = useState(
    _initialState.flowDensity || "compact",
  );
  const [rowsPerPage, setRowsPerPage] = useState(
    Number.isFinite(_initialState.flowRowsPerPage)
      ? _initialState.flowRowsPerPage
      : 40,
  );
  const [livePaused, setLivePaused] = useState(
    Boolean(_initialState.flowLivePaused),
  );
  const [showUnusualScanner, setShowUnusualScanner] = useState(
    _initialState.flowShowUnusualScanner !== false,
  );
  const [filtersOpen, setFiltersOpen] = useState(
    _initialState.flowFiltersOpen !== false,
  );
  const [columnsOpen, setColumnsOpen] = useState(
    Boolean(_initialState.flowColumnsOpen),
  );
  const [pinnedEventId, setPinnedEventId] = useState(
    _initialState.flowPinnedEventId || null,
  );
  const [copiedEventId, setCopiedEventId] = useState(null);
  const [flowNowMs, setFlowNowMs] = useState(() => Date.now());
  const [showDeferredPanels, setShowDeferredPanels] = useState(false);
  const [activateNews, setActivateNews] = useState(false);
  const [pausedSnapshot, setPausedSnapshot] = useState(null);
  const flowContentRef = useRef(null);
  const copyStatusTimerRef = useRef(null);
  const [flowContentWidth, setFlowContentWidth] = useState(0);
  const [columnOrder, setColumnOrder] = useState(() =>
    normalizeFlowColumnOrder(_initialState.flowColumnOrder),
  );
  const [visibleColumns, setVisibleColumns] = useState(() =>
    normalizeFlowVisibleColumns(_initialState.flowVisibleColumns),
  );

  useEffect(() => {
    const handleWorkspaceSettings = (event) => {
      const state = event?.detail || {};
      if (state.flowDensity === "compact" || state.flowDensity === "comfortable") {
        setDensity(state.flowDensity);
      }
      if (FLOW_ROWS_OPTIONS.includes(Number(state.flowRowsPerPage))) {
        setRowsPerPage(Number(state.flowRowsPerPage));
      }
    };
    window.addEventListener("rayalgo:workspace-settings-updated", handleWorkspaceSettings);
    return () =>
      window.removeEventListener(
        "rayalgo:workspace-settings-updated",
        handleWorkspaceSettings,
      );
  }, []);

  useEffect(() => {
    persistState({ flowSavedScans: savedScans });
  }, [savedScans]);

  useEffect(() => {
    persistState({
      flowActiveScanId: activeScanId,
      flowSortBy: sortBy,
      flowSortDir: sortDir,
      flowDensity: density,
      flowFiltersOpen: filtersOpen,
      flowColumnsOpen: columnsOpen,
      flowRowsPerPage: rowsPerPage,
      flowLivePaused: livePaused,
      flowShowUnusualScanner: showUnusualScanner,
      flowColumnOrder: columnOrder,
      flowVisibleColumns: visibleColumns,
      flowPinnedEventId: pinnedEventId,
    });
  }, [
    activeScanId,
    columnOrder,
    columnsOpen,
    density,
    filtersOpen,
    livePaused,
    pinnedEventId,
    rowsPerPage,
    showUnusualScanner,
    sortBy,
    sortDir,
    visibleColumns,
  ]);

  useEffect(
    () => () => {
      if (copyStatusTimerRef.current) {
        clearTimeout(copyStatusTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (!activeScanId) return;
    if (!savedScans.some((scan) => scan.id === activeScanId)) {
      setActiveScanId(null);
    }
  }, [activeScanId, savedScans]);

  useEffect(() => {
    if (!activeScanId) return;
    const activeScan = savedScans.find((scan) => scan.id === activeScanId);
    if (!activeScan) return;
    const scanMatchesFilters =
      (activeScan.activeFlowPresetId || null) === (activeFlowPresetId || null) &&
      (activeScan.filter || "all") === filter &&
      (Number.isFinite(activeScan.minPrem) ? activeScan.minPrem : 0) === minPrem &&
      (activeScan.includeQuery || "") === includeQuery &&
      (activeScan.excludeQuery || "") === excludeQuery;
    if (!scanMatchesFilters) {
      setActiveScanId(null);
    }
  }, [
    activeFlowPresetId,
    activeScanId,
    excludeQuery,
    filter,
    includeQuery,
    minPrem,
    savedScans,
  ]);

  useEffect(() => {
    setColumnOrder((current) => normalizeFlowColumnOrder(current));
    setVisibleColumns((current) => normalizeFlowVisibleColumns(current));
  }, []);

  useEffect(() => {
    if (!isVisible || showDeferredPanels) return undefined;
    let frameId = null;
    if (typeof requestAnimationFrame === "function") {
      frameId = requestAnimationFrame(() => setShowDeferredPanels(true));
      return () => cancelAnimationFrame(frameId);
    }
    const timeoutId = setTimeout(() => setShowDeferredPanels(true), 16);
    return () => clearTimeout(timeoutId);
  }, [isVisible, showDeferredPanels]);

  useEffect(() => {
    const element = flowContentRef.current;
    if (!element || !isVisible) {
      return undefined;
    }

    let frameId = 0;
    const measure = (width) => {
      const nextWidth = Math.round(
        Number.isFinite(width) ? width : element.clientWidth || 0,
      );
      setFlowContentWidth((current) =>
        current === nextWidth ? current : nextWidth,
      );
    };

    measure();

    if (typeof ResizeObserver === "undefined") {
      const handleResize = () => measure();
      window.addEventListener("resize", handleResize);
      return () => {
        window.removeEventListener("resize", handleResize);
      };
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(() => {
        measure(entry?.contentRect?.width);
      });
    });

    observer.observe(element);

    return () => {
      cancelAnimationFrame(frameId);
      observer.disconnect();
    };
  }, [isVisible]);

  useEffect(() => {
    if (!isVisible || activateNews) return undefined;
    const timeoutId = setTimeout(() => setActivateNews(true), 450);
    return () => clearTimeout(timeoutId);
  }, [activateNews, isVisible]);

  const sharedFlowSnapshot = useMarketFlowSnapshot(symbols, {
    subscribe: isVisible && !livePaused,
  });
  const flowScannerControl = useFlowScannerControlState({
    subscribe: isVisible,
  });
  const flowScannerEnabled = Boolean(flowScannerControl.enabled);
  const flowScannerPanelVisible = showUnusualScanner || flowScannerEnabled;
  const flowScannerOwnerActive = Boolean(flowScannerControl.ownerActive);
  const broadScanSnapshotActive = flowScannerEnabled && flowScannerOwnerActive;
  const broadFlowSnapshot = useMarketFlowSnapshotForStoreKey(
    BROAD_MARKET_FLOW_STORE_KEY,
    { subscribe: isVisible && !livePaused && broadScanSnapshotActive },
  );
  const liveFlowSnapshot = useMemo(() => {
    if (!broadScanSnapshotActive) {
      return sharedFlowSnapshot;
    }
    const flowEvents = mergeFlowEventFeeds(
      broadFlowSnapshot.flowEvents || [],
      sharedFlowSnapshot.flowEvents || [],
    );
    const providerSummary =
      broadFlowSnapshot.providerSummary || sharedFlowSnapshot.providerSummary;
    const flowStatus = flowEvents.length
      ? "live"
      : broadFlowSnapshot.flowStatus || sharedFlowSnapshot.flowStatus;

    return {
      ...sharedFlowSnapshot,
      hasLiveFlow: flowEvents.length > 0,
      flowStatus,
      providerSummary,
      flowEvents,
      flowTide: buildFlowTideFromEvents(flowEvents),
      tickerFlow: buildTickerFlowFromEvents(flowEvents),
      flowClock: buildFlowClockFromEvents(flowEvents),
      sectorFlow: buildSectorFlowFromEvents(flowEvents),
      dteBuckets: buildDteBucketsFromEvents(flowEvents),
      marketOrderFlow: buildMarketOrderFlowFromEvents(flowEvents),
      putCall: buildPutCallSummaryFromEvents(flowEvents),
    };
  }, [
    broadFlowSnapshot.flowEvents,
    broadFlowSnapshot.flowStatus,
    broadFlowSnapshot.providerSummary,
    broadScanSnapshotActive,
    sharedFlowSnapshot,
  ]);
  const flowScannerTone = flowScannerEnabled
    ? flowScannerOwnerActive
      ? T.green
      : T.amber
    : T.accent;
  const toggleFlowScanner = useCallback(() => {
    const nextEnabled = !flowScannerEnabled;
    setShowUnusualScanner(nextEnabled);
    setFlowScannerControlState({ enabled: nextEnabled });
  }, [flowScannerEnabled]);
  const flowSnapshot =
    livePaused && pausedSnapshot ? pausedSnapshot : liveFlowSnapshot;
  const {
    hasLiveFlow,
    flowStatus,
    providerSummary,
    flowEvents: rawFlowEvents = [],
    flowTide,
    tickerFlow,
    flowClock,
    sectorFlow,
    dteBuckets,
    marketOrderFlow,
  } = flowSnapshot;

  const flowEvents = useMemo(
    () =>
      rawFlowEvents.map((event) => ({
        ...event,
        mark: resolveFlowMark(event),
        otmPercent: resolveFlowOtmPercent(event),
      })),
    [rawFlowEvents],
  );

  useEffect(() => {
    if (!isVisible || !flowEvents.length) return undefined;
    const intervalId = setInterval(() => setFlowNowMs(Date.now()), 1000);
    return () => clearInterval(intervalId);
  }, [flowEvents.length, isVisible]);

  const watchlistSymbols = useMemo(
    () =>
      Array.from(
        new Set((symbols || []).map((symbol) => normalizeTickerSymbol(symbol))),
      ).filter(Boolean),
    [symbols],
  );

  const coverage = providerSummary.coverage || {
    totalSymbols: watchlistSymbols.length,
    scannedSymbols: 0,
    cycleScannedSymbols: 0,
    batchSize: watchlistSymbols.length,
    currentBatch: [],
    cycle: 0,
    isFetching: false,
    lastScannedAt: {},
    isRotating: false,
  };
  const totalCoverageSymbols =
    coverage.activeTargetSize ||
    coverage.totalSymbols ||
    watchlistSymbols.length ||
    0;
  const intendedCoverageSymbols =
    coverage.targetSize || totalCoverageSymbols;
  const selectedCoverageSymbols =
    coverage.selectedSymbols || totalCoverageSymbols;
  const scannedCoverageSymbols =
    coverage.cycleScannedSymbols ?? coverage.scannedSymbols ?? 0;
  const coverageModeLabel =
    coverage.mode === "market" || coverage.mode === "hybrid"
      ? "market-wide"
      : "watchlist";
  const oldestScanAt = useMemo(() => {
    const timestamps = Object.values(coverage.lastScannedAt || {});
    return timestamps.length ? Math.min(...timestamps) : null;
  }, [coverage.lastScannedAt]);
  const newestScanAt = useMemo(() => {
    const timestamps = Object.values(coverage.lastScannedAt || {});
    return timestamps.length ? Math.max(...timestamps) : null;
  }, [coverage.lastScannedAt]);
  const flowQuality = useMemo(
    () =>
      resolveFlowQuality({
        flowStatus,
        hasLiveFlow,
        providerSummary,
        coverage,
        watchlistSymbols,
        newestScanAt,
        oldestScanAt,
        livePaused,
      }),
    [
      coverage,
      flowStatus,
      hasLiveFlow,
      livePaused,
      newestScanAt,
      oldestScanAt,
      providerSummary,
      watchlistSymbols,
    ],
  );

  const newsQuery = useGetNews(
    { limit: 12 },
    {
      query: {
        enabled: isVisible && activateNews,
        staleTime: 60_000,
        refetchInterval:
          isVisible && activateNews && !livePaused ? 60_000 : false,
        retry: false,
      },
    },
  );
  const newsItems = useMemo(() => {
    const articles = newsQuery.data?.articles || [];
    return articles.map((article) => ({
      id: article.id,
      title: article.title,
      time: formatRelativeTimeShort(article.publishedAt),
      tag:
        article.tickers?.[0] ||
        article.publisher?.name?.slice(0, 8)?.toUpperCase() ||
        "NEWS",
      sentimentScore: mapNewsSentimentToScore(article.sentiment),
      articleUrl: article.articleUrl,
      publisher: article.publisher?.name || null,
      tickers: Array.isArray(article.tickers)
        ? article.tickers.map((ticker) => normalizeTickerSymbol(ticker))
        : [],
    }));
  }, [newsQuery.data]);

  const includeTokens = useMemo(() => parseTickerTokens(includeQuery), [
    includeQuery,
  ]);
  const excludeTokens = useMemo(() => parseTickerTokens(excludeQuery), [
    excludeQuery,
  ]);
  const activeBuiltInPreset = getFlowBuiltInPreset(activeFlowPresetId);

  const clusters = useMemo(() => {
    const map = {};
    for (const event of flowEvents) {
      const key =
        event.optionTicker ||
        `${event.ticker}_${event.strike}_${event.cp}_${formatExpirationLabel(
          event.expirationDate,
        )}`;
      if (!map[key]) {
        map[key] = {
          count: 0,
          totalPrem: 0,
          ids: [],
          firstTime: event.time,
          lastTime: event.time,
        };
      }
      map[key].count += 1;
      map[key].totalPrem += event.premium;
      map[key].ids.push(event.id);
      if (event.time < map[key].firstTime) map[key].firstTime = event.time;
      if (event.time > map[key].lastTime) map[key].lastTime = event.time;
    }
    return map;
  }, [flowEvents]);

  const clusterFor = (event) => {
    const key =
      event.optionTicker ||
      `${event.ticker}_${event.strike}_${event.cp}_${formatExpirationLabel(
        event.expirationDate,
      )}`;
    const cluster = clusters[key];
    return cluster && cluster.count >= 2 ? cluster : null;
  };

  const topContractsByTicker = useMemo(() => {
    if (!showDeferredPanels) return {};
    const groupedByTicker = {};
    for (const event of flowEvents) {
      if (!groupedByTicker[event.ticker]) groupedByTicker[event.ticker] = {};
      const key =
        event.optionTicker ||
        `${event.strike}_${event.cp}_${formatExpirationLabel(
          event.expirationDate,
        )}`;
      if (!groupedByTicker[event.ticker][key]) {
        groupedByTicker[event.ticker][key] = {
          key,
          strike: event.strike,
          cp: event.cp,
          dte: event.dte,
          vol: 0,
          premium: 0,
          count: 0,
          biggestEvt: event,
        };
      }
      const entry = groupedByTicker[event.ticker][key];
      entry.vol += event.vol;
      entry.premium += event.premium;
      entry.count += 1;
      if (event.premium > entry.biggestEvt.premium) entry.biggestEvt = event;
    }

    return Object.fromEntries(
      Object.entries(groupedByTicker).map(([ticker, contracts]) => [
        ticker,
        Object.values(contracts)
          .sort((left, right) => right.vol - left.vol)
          .slice(0, 3),
      ]),
    );
  }, [flowEvents, showDeferredPanels]);

  const filtered = useMemo(() => {
    let events = flowEvents
      .filter((event) => {
        const ticker = normalizeTickerSymbol(event.ticker);
        if (includeTokens.length && !includeTokens.includes(ticker)) return false;
        if (excludeTokens.includes(ticker)) return false;
        if (filter === "calls") return event.cp === "C";
        if (filter === "puts") return event.cp === "P";
        if (filter === "unusual") return event.isUnusual;
        if (filter === "golden") return event.golden;
        if (filter === "sweep") return event.type === "SWEEP";
        if (filter === "block") return event.type === "BLOCK";
        if (filter === "cluster") return clusterFor(event) !== null;
        return true;
      })
      .filter((event) =>
        flowPresetMatches(activeFlowPresetId, event, clusterFor),
      )
      .filter((event) => event.premium >= minPrem);

    events = [...events].sort((left, right) =>
      compareFlowEvents(left, right, sortBy, sortDir),
    );

    return events;
  }, [
    activeFlowPresetId,
    clusterFor,
    excludeTokens,
    filter,
    flowEvents,
    includeTokens,
    minPrem,
    sortBy,
    sortDir,
  ]);

  const visibleFlowRows = filtered.slice(0, rowsPerPage);
  const denseRows = density === "compact";
  const orderedOptionalColumns = columnOrder
    .map((columnId) => FLOW_COLUMN_BY_ID.get(columnId))
    .filter((column) => column && visibleColumns.includes(column.id));
  const tapeColumns = [...FLOW_FIXED_COLUMNS, ...orderedOptionalColumns];
  const tapeGridTemplate = tapeColumns.map((column) => column.width).join(" ");
  const tapeTableMinWidth = dim(
    472 +
      orderedOptionalColumns.reduce((sum, column) => {
        const width = Number.parseInt(column.width, 10);
        return sum + (Number.isFinite(width) ? width : 72);
      }, 0),
  );
  const isMobileFlowLayout = flowContentWidth > 0 && flowContentWidth < 760;
  const isNarrowFlowLayout = flowContentWidth > 0 && flowContentWidth < 980;
  const showInlineFilterPanel = filtersOpen && !isNarrowFlowLayout;
  const showOverlayFilterPanel = filtersOpen && isNarrowFlowLayout;
  const showContextRail = flowContentWidth >= 1280;
  const flowMainGridTemplate = [
    showInlineFilterPanel ? "minmax(238px, 260px)" : null,
    "minmax(0, 1fr)",
    showContextRail ? "minmax(318px, 0.44fr)" : null,
  ]
    .filter(Boolean)
    .join(" ");
  const summaryGridTemplate = isMobileFlowLayout
    ? "repeat(2, minmax(0, 1fr))"
    : flowContentWidth < 1120
      ? "repeat(3, minmax(0, 1fr))"
      : "repeat(6, minmax(0, 1fr))";
  const insightGridTemplate = isNarrowFlowLayout
    ? "minmax(0, 1fr)"
    : "minmax(0, 1.6fr) minmax(300px, 1fr)";
  const metricGridTemplate = isNarrowFlowLayout
    ? "minmax(0, 1fr)"
    : "repeat(3, minmax(0, 1fr))";
  const pinnedEvent = useMemo(
    () =>
      flowEvents.find((event) => event.id === pinnedEventId) ||
      filtered.find((event) => event.id === pinnedEventId) ||
      null,
    [filtered, flowEvents, pinnedEventId],
  );
  const flowSentimentSummary = useMemo(
    () => summarizeFlowSentiment(filtered),
    [filtered],
  );

  useEffect(() => {
    if (isNarrowFlowLayout && !HAS_PERSISTED_FLOW_FILTERS_OPEN) {
      setFiltersOpen(false);
    }
  }, [isNarrowFlowLayout]);

  const totalCallPrem = flowEvents
    .filter((event) => event.cp === "C")
    .reduce((sum, event) => sum + event.premium, 0);
  const totalPutPrem = flowEvents
    .filter((event) => event.cp === "P")
    .reduce((sum, event) => sum + event.premium, 0);
  const netPrem = totalCallPrem - totalPutPrem;
  const goldenCount = flowEvents.filter((event) => event.golden).length;
  const blockCount = flowEvents.filter((event) => event.type === "BLOCK").length;
  const sweepCount = flowEvents.filter((event) => event.type === "SWEEP").length;
  const zeroDteCount = flowEvents.filter((event) => event.dte <= 1).length;
  const zeroDtePrem = flowEvents
    .filter((event) => event.dte <= 1)
    .reduce((sum, event) => sum + event.premium, 0);
  const cpRatio = totalCallPrem ? totalPutPrem / totalCallPrem : 0;
  const mostActive =
    [...tickerFlow].sort(
      (left, right) => right.calls + right.puts - (left.calls + left.puts),
    )[0] || { sym: MISSING_VALUE, calls: 0, puts: 0 };

  const xlTrades = flowEvents.filter((event) => event.premium >= 250000);
  const xlCallPrem =
    xlTrades
      .filter((event) => event.cp === "C" && event.side === "BUY")
      .reduce((sum, event) => sum + event.premium, 0) -
    xlTrades
      .filter((event) => event.cp === "C" && event.side === "SELL")
      .reduce((sum, event) => sum + event.premium, 0);
  const xlPutPrem =
    xlTrades
      .filter((event) => event.cp === "P" && event.side === "BUY")
      .reduce((sum, event) => sum + event.premium, 0) -
    xlTrades
      .filter((event) => event.cp === "P" && event.side === "SELL")
      .reduce((sum, event) => sum + event.premium, 0);
  const xlNet = xlCallPrem - xlPutPrem;
  const xlTotalAbs = Math.abs(xlCallPrem) + Math.abs(xlPutPrem) || 1;
  const compassScore = Math.round((xlNet / xlTotalAbs) * 100);
  const compassVerdict =
    compassScore >= 50
      ? "BULLISH"
      : compassScore >= 20
        ? "LEAN BULL"
        : compassScore >= -20
          ? "NEUTRAL"
          : compassScore >= -50
            ? "LEAN BEAR"
            : "BEARISH";
  const compassColor =
    compassScore >= 20 ? T.green : compassScore >= -20 ? T.amber : T.red;

  const maxTickerPrem = Math.max(
    1,
    ...tickerFlow.map((ticker) => ticker.calls + ticker.puts),
  );
  const flowClockActiveBuckets = flowClock.filter((bucket) => bucket.count > 0);
  const flowClockPeak =
    flowClockActiveBuckets.reduce(
      (best, bucket) =>
        !best || bucket.count > best.count || bucket.prem > best.prem
          ? bucket
          : best,
      null,
    )?.time || MISSING_VALUE;
  const flowClockAverage = Math.round(
    flowEvents.length / Math.max(1, flowClock.length),
  );

  const ibkrLoginRequired =
    Boolean(session?.configured?.ibkr) &&
    !session?.ibkrBridge?.authenticated &&
    !providerSummary.providers.includes("polygon");
  const flowDisplayLabel =
    !hasLiveFlow && ibkrLoginRequired
      ? "IBKR login required"
      : providerSummary.label === "IBKR snapshot live" &&
          session?.ibkrBridge?.liveMarketDataAvailable === false
        ? "IBKR delayed"
        : providerSummary.label;
  const flowDisplayColor =
    !hasLiveFlow && ibkrLoginRequired
      ? T.amber
      : flowDisplayLabel === "IBKR delayed"
        ? T.amber
        : providerSummary.color;
  const feedStateLabel = livePaused
    ? "Paused"
    : hasLiveFlow
      ? "Live"
      : flowStatus === "loading"
        ? "Loading"
        : "Degraded";
  const feedStateColor = livePaused
    ? T.amber
    : hasLiveFlow
      ? T.green
      : flowStatus === "loading"
        ? T.accent
        : T.red;
  const emptyFlowDetail =
    flowStatus === "loading"
      ? "Waiting on current options activity snapshots for the tracked symbols."
      : ibkrLoginRequired
        ? bridgeRuntimeMessage(session)
        : providerSummary.erroredSource?.errorMessage
          ? providerSummary.erroredSource.errorMessage
          : providerSummary.failures[0]?.error
            ? providerSummary.failures[0].error
            : providerSummary.fallbackUsed
              ? "IBKR returned no active snapshot flow and the Polygon trade fallback was empty."
              : "IBKR returned no active snapshot flow for the tracked symbols.";

  const activeTicker = normalizeTickerSymbol(
    selectedEvt?.ticker ||
      filtered[0]?.ticker ||
      tickerFlow[0]?.sym ||
      flowEvents[0]?.ticker ||
      watchlistSymbols[0] ||
      "",
  );
  const selectedTickerEvents = useMemo(
    () =>
      flowEvents.filter(
        (event) => normalizeTickerSymbol(event.ticker) === activeTicker,
      ),
    [activeTicker, flowEvents],
  );
  const selectedCallPremium = selectedTickerEvents.reduce(
    (sum, event) => sum + (event.cp === "C" ? event.premium : 0),
    0,
  );
  const selectedPutPremium = selectedTickerEvents.reduce(
    (sum, event) => sum + (event.cp === "P" ? event.premium : 0),
    0,
  );
  const selectedTickerSummary = {
    totalPremium: selectedTickerEvents.reduce(
      (sum, event) => sum + event.premium,
      0,
    ),
    unusualCount: selectedTickerEvents.filter((event) => event.isUnusual).length,
    zeroDteCount: selectedTickerEvents.filter((event) => event.dte <= 1).length,
    latestEvent: selectedTickerEvents[0] || null,
  };

  const executionScope = selectedTickerEvents.length
    ? selectedTickerEvents
    : visibleFlowRows.length
      ? visibleFlowRows
      : filtered;
  const executionStats = useMemo(() => {
    if (!showDeferredPanels) {
      return {
        askCount: 0,
        askPrem: 0,
        bidCount: 0,
        bidPrem: 0,
        midCount: 0,
        midPrem: 0,
        sweepCount: 0,
        sweepPrem: 0,
        blockCount: 0,
        blockPrem: 0,
        snapshotCount: 0,
        tradeCount: 0,
        avgSize: null,
        topExpiration: MISSING_VALUE,
      };
    }
    const stats = {
      askCount: 0,
      askPrem: 0,
      bidCount: 0,
      bidPrem: 0,
      midCount: 0,
      midPrem: 0,
      sweepCount: 0,
      sweepPrem: 0,
      blockCount: 0,
      blockPrem: 0,
      snapshotCount: 0,
      tradeCount: 0,
      avgSize: null,
      topExpiration: MISSING_VALUE,
    };
    const expirationPremium = new Map();
    let totalSize = 0;
    let sizeCount = 0;

    for (const event of executionScope) {
      if (event.side === "BUY") {
        stats.askCount += 1;
        stats.askPrem += event.premium;
      } else if (event.side === "SELL") {
        stats.bidCount += 1;
        stats.bidPrem += event.premium;
      } else {
        stats.midCount += 1;
        stats.midPrem += event.premium;
      }

      if (event.type === "SWEEP") {
        stats.sweepCount += 1;
        stats.sweepPrem += event.premium;
      } else if (event.type === "BLOCK") {
        stats.blockCount += 1;
        stats.blockPrem += event.premium;
      }

      if (event.basis === "snapshot") stats.snapshotCount += 1;
      else stats.tradeCount += 1;

      if (isFiniteNumber(event.vol)) {
        totalSize += event.vol;
        sizeCount += 1;
      }

      const expirationLabel = formatExpirationLabel(event.expirationDate);
      expirationPremium.set(
        expirationLabel,
        (expirationPremium.get(expirationLabel) || 0) + event.premium,
      );
    }

    stats.avgSize = sizeCount ? totalSize / sizeCount : null;
    stats.topExpiration =
      [...expirationPremium.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ||
      MISSING_VALUE;
    return stats;
  }, [executionScope, showDeferredPanels]);

  const strikeConcentration = useMemo(() => {
    if (!showDeferredPanels) return [];
    const grouped = new Map();
    selectedTickerEvents.forEach((event) => {
      const key = `${event.cp}${event.strike}`;
      const entry = grouped.get(key) || {
        key,
        label: `${event.cp}${event.strike}`,
        premium: 0,
        count: 0,
        event,
      };
      entry.premium += event.premium;
      entry.count += 1;
      if (event.premium > entry.event.premium) entry.event = event;
      grouped.set(key, entry);
    });
    return Array.from(grouped.values())
      .sort((left, right) => right.premium - left.premium)
      .slice(0, 5);
  }, [selectedTickerEvents, showDeferredPanels]);

  const expiryConcentration = useMemo(() => {
    if (!showDeferredPanels) return [];
    const grouped = new Map();
    selectedTickerEvents.forEach((event) => {
      const label = formatExpirationLabel(event.expirationDate);
      const entry = grouped.get(label) || {
        label,
        premium: 0,
        count: 0,
        calls: 0,
        puts: 0,
        dte: event.dte,
      };
      entry.premium += event.premium;
      entry.count += 1;
      if (event.cp === "C") entry.calls += event.premium;
      if (event.cp === "P") entry.puts += event.premium;
      entry.dte = Math.min(entry.dte, event.dte);
      grouped.set(label, entry);
    });
    return Array.from(grouped.values())
      .sort((left, right) => right.premium - left.premium)
      .slice(0, 4);
  }, [selectedTickerEvents, showDeferredPanels]);

  const selectedTickerSideSplit = useMemo(() => {
    const stats = {
      askPremium: 0,
      bidPremium: 0,
      midPremium: 0,
      askCount: 0,
      bidCount: 0,
      midCount: 0,
    };
    selectedTickerEvents.forEach((event) => {
      if (event.side === "BUY") {
        stats.askPremium += event.premium;
        stats.askCount += 1;
      } else if (event.side === "SELL") {
        stats.bidPremium += event.premium;
        stats.bidCount += 1;
      } else {
        stats.midPremium += event.premium;
        stats.midCount += 1;
      }
    });
    return stats;
  }, [selectedTickerEvents]);

  const repeatPrints = useMemo(
    () =>
      selectedTickerEvents
        .map((event) => ({ event, cluster: clusterFor(event) }))
        .filter((entry) => entry.cluster)
        .slice(0, 4),
    [clusterFor, selectedTickerEvents],
  );

  const signalQueue = useMemo(
    () =>
      !showDeferredPanels
        ? []
        : flowEvents
        .map((event) => {
          const cluster = clusterFor(event);
          const actionScore =
            (event.golden ? 30 : 0) +
            (event.isUnusual ? 18 : 0) +
            (cluster ? Math.min(18, cluster.count * 4) : 0) +
            (event.type === "SWEEP" ? 12 : event.type === "BLOCK" ? 10 : 4) +
            (event.dte <= 1 ? 8 : event.dte <= 7 ? 4 : 0) +
            Math.min(24, event.premium / 100000) +
            Math.min(10, (event.unusualScore || 0) * 2);
          return { event, actionScore, cluster };
        })
        .sort(
          (left, right) =>
            right.actionScore - left.actionScore ||
            right.event.premium - left.event.premium,
        )
        .slice(0, 6),
    [flowEvents, clusters, showDeferredPanels],
  );

  const selectedNewsItems = useMemo(() => {
    if (!activateNews) return [];
    if (!newsItems.length) return [];
    const tickerMatches = activeTicker
      ? newsItems.filter((item) => item.tickers.includes(activeTicker))
      : [];
    return (tickerMatches.length ? tickerMatches : newsItems).slice(0, 5);
  }, [activateNews, activeTicker, newsItems]);

  const summaryCards = [
    {
      label: "Total Premium",
      value: fmtM(totalCallPrem + totalPutPrem),
      sub: `${flowEvents.length} prints`,
      color: T.text,
    },
    {
      label: "Net Premium",
      value: `${netPrem >= 0 ? "+" : "-"}${fmtM(Math.abs(netPrem))}`,
      sub: netPrem >= 0 ? "Bullish balance" : "Bearish balance",
      color: netPrem >= 0 ? T.green : T.red,
    },
    {
      label: "0DTE",
      value: zeroDteCount,
      sub: fmtM(zeroDtePrem),
      color: T.amber,
    },
    {
      label: "Golden",
      value: goldenCount,
      sub: `${sweepCount} sweeps · ${blockCount} blocks`,
      color: T.cyan,
    },
    {
      label: "Leader",
      value: mostActive.sym,
      sub: fmtM(mostActive.calls + mostActive.puts),
      color: T.purple,
    },
    {
      label: "Smart Money",
      value: compassVerdict,
      sub: `${compassScore >= 0 ? "+" : ""}${compassScore} bias`,
      color: compassColor,
    },
  ];

  const handleToggleLivePaused = () => {
    if (livePaused) {
      setLivePaused(false);
      setPausedSnapshot(null);
      return;
    }
    setPausedSnapshot(liveFlowSnapshot);
    setLivePaused(true);
  };

  const handleCopyContract = async (event, contractEvent) => {
    event.stopPropagation();
    const contractLabel = getFlowContractLabel(contractEvent);
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(contractLabel);
      }
      setCopiedEventId(contractEvent.id);
      if (copyStatusTimerRef.current) {
        clearTimeout(copyStatusTimerRef.current);
      }
      copyStatusTimerRef.current = setTimeout(() => {
        setCopiedEventId(null);
      }, 1400);
    } catch (_error) {
      setCopiedEventId(contractEvent.id);
    }
  };

  const handleTogglePinned = (event, contractEvent) => {
    event.stopPropagation();
    setPinnedEventId((current) =>
      current === contractEvent.id ? null : contractEvent.id,
    );
  };

  const updateFlowTapeFilters = useCallback((patch, { clearPreset = true } = {}) => {
    setActiveScanId(null);
    setFlowTapeFilterState({
      ...patch,
      ...(clearPreset ? { activeFlowPresetId: null } : {}),
    });
  }, []);

  const markScannerEdited = () => {
    setActiveScanId(null);
    setFlowTapeFilterState({ activeFlowPresetId: null });
  };

  const applyFlowSort = (columnId) => {
    if (!FLOW_SORTABLE_COLUMNS.has(columnId)) return;
    const nextSortBy = normalizeFlowSortBy(columnId);
    if (sortBy === nextSortBy) {
      setSortDir((current) => (current === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(nextSortBy);
      setSortDir(getDefaultFlowSortDir(nextSortBy));
    }
    markScannerEdited();
  };

  const applyBuiltInPreset = (preset) => {
    if (!preset) return;
    setActiveScanId(null);
    setFlowTapeFilterState(buildFlowTapePresetPatch(preset.id, flowTapeFilters));
    if (preset.sortBy) {
      const nextSortBy = normalizeFlowSortBy(preset.sortBy);
      setSortBy(nextSortBy);
      setSortDir(getDefaultFlowSortDir(nextSortBy));
    }
  };

  const toggleColumn = (columnId) => {
    setVisibleColumns((current) => {
      if (current.includes(columnId)) {
        return current.length > 1
          ? current.filter((id) => id !== columnId)
          : current;
      }
      return columnOrder.filter((id) => current.includes(id) || id === columnId);
    });
    setActiveScanId(null);
  };

  const moveColumn = (columnId, direction) => {
    setColumnOrder((current) => {
      const next = normalizeFlowColumnOrder(current);
      const index = next.indexOf(columnId);
      const swapIndex = index + direction;
      if (index < 0 || swapIndex < 0 || swapIndex >= next.length) {
        return next;
      }
      [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
      return next;
    });
    setActiveScanId(null);
  };

  const resetColumns = () => {
    setColumnOrder(DEFAULT_FLOW_COLUMN_ORDER);
    setVisibleColumns(DEFAULT_FLOW_VISIBLE_COLUMNS);
    setActiveScanId(null);
  };

  const saveCurrentScan = () => {
    const name = prompt(
      "Name this scan:",
      filter === "golden"
        ? "Golden sweeps"
        : filter === "unusual"
          ? "Unusual flow"
          : includeTokens.length
            ? `${includeTokens.join(", ")} flow`
            : `${filter} ≥${Math.round(minPrem / 1000)}K`,
    );
    if (!name) return;
    const newScan = {
      id: Date.now(),
      name,
      activeFlowPresetId,
      filter,
      minPrem,
      sortBy,
      sortDir,
      includeQuery,
      excludeQuery,
      density,
      rowsPerPage,
      columnOrder,
      visibleColumns,
    };
    setSavedScans((current) => [...current, newScan].slice(-8));
    setActiveScanId(newScan.id);
  };

  const loadScan = (scan) => {
    setFlowTapeFilterState({
      activeFlowPresetId: scan.activeFlowPresetId || null,
      filter: scan.filter || "all",
      minPrem: Number.isFinite(scan.minPrem) ? scan.minPrem : 0,
      includeQuery: scan.includeQuery || "",
      excludeQuery: scan.excludeQuery || "",
    });
    const nextSortBy = normalizeFlowSortBy(scan.sortBy);
    setSortBy(nextSortBy);
    setSortDir(normalizeFlowSortDir(scan.sortDir, nextSortBy));
    setDensity(scan.density || "compact");
    setRowsPerPage(
      Number.isFinite(scan.rowsPerPage) ? scan.rowsPerPage : rowsPerPage,
    );
    setColumnOrder(normalizeFlowColumnOrder(scan.columnOrder));
    setVisibleColumns(normalizeFlowVisibleColumns(scan.visibleColumns));
    setActiveScanId(scan.id);
  };

  const deleteScan = (id) => {
    setSavedScans((current) => current.filter((scan) => scan.id !== id));
    if (activeScanId === id) setActiveScanId(null);
  };

  const renderTapeCell = (columnId, event) => {
    const sideColor =
      event.side === "BUY" ? T.green : event.side === "SELL" ? T.red : T.textDim;
    const cpColor = event.cp === "C" ? T.green : T.red;
    const scoreColor =
      event.score >= 80 ? T.amber : event.score >= 60 ? T.green : T.textDim;
    const typeColor =
      event.type === "SWEEP"
        ? T.amber
        : event.type === "BLOCK"
          ? T.accent
          : T.purple;
    const executionMeta = getFlowExecutionMeta(event);
    const cluster = clusterFor(event);
    const volToOi =
      isFiniteNumber(event.vol) && isFiniteNumber(event.oi) && event.oi > 0
        ? event.vol / event.oi
        : null;
    const premiumLabel =
      event.premium >= 1e6
        ? `$${(event.premium / 1e6).toFixed(2)}M`
        : `$${(event.premium / 1e3).toFixed(0)}K`;
    const sourceBasisMeta = getFlowSourceBasisMeta(event.sourceBasis);
    const fillSpreadMeta = resolveFlowFillSpreadMeta(event);

    if (columnId === "time") {
      const ageLabel = formatFlowTradeAge(event.occurredAt, flowNowMs);
      const occurredAt = event.occurredAt ? formatFlowAppTime(event.occurredAt) : event.time;
      const ageMs = Math.max(0, flowNowMs - (Date.parse(event.occurredAt || "") || flowNowMs));
      const ageColor = ageMs < 60_000 ? T.green : ageMs < 300_000 ? T.textSec : T.textDim;
      return (
        <AppTooltip content={occurredAt ? `${occurredAt} ${appTimeZoneLabel}` : undefined}><span
          style={{ color: ageColor, fontWeight: ageMs < 60_000 ? 700 : 500 }}
        >
          {ageLabel}
        </span></AppTooltip>
      );
    }
    if (columnId === "ticker") {
      return (
        <span style={{ display: "inline-flex", alignItems: "center", gap: sp(4) }}>
          {event.golden ? <span style={{ color: T.amber }}>★</span> : null}
          <MarketIdentityInline
            ticker={event.ticker}
            size={14}
            showChips={false}
          />
        </span>
      );
    }
    if (columnId === "expiration") {
      return (
        <AppTooltip content={event.expirationDate || undefined}><span style={{ color: T.textDim }}>
          {formatExpirationLabel(event.expirationDate)}
        </span></AppTooltip>
      );
    }
    if (columnId === "right") {
      return (
        <Badge color={cpColor}>{event.cp || MISSING_VALUE}</Badge>
      );
    }
    if (columnId === "strike") {
      return (
        <div
          style={{
            minWidth: 0,
            display: "flex",
            alignItems: "center",
            gap: sp(4),
            justifyContent: "flex-end",
            flexWrap: "nowrap",
          }}
        >
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              minWidth: 0,
              color: T.textSec,
              fontWeight: 700,
            }}
          >
            {event.strike}
          </span>
          {cluster ? (
            <AppTooltip content={`${cluster.count} prints · ${fmtM(cluster.totalPrem)} total premium`}><span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: sp(2),
                padding: sp("0px 4px"),
                borderRadius: dim(2),
                border: `1px solid ${T.cyan}40`,
                background: `${T.cyan}14`,
                color: T.cyan,
                fontSize: fs(8),
                fontWeight: 700,
              }}
            >
              R{cluster.count}
            </span></AppTooltip>
          ) : null}
        </div>
      );
    }
    if (columnId === "side") {
      return <Badge color={sideColor}>{event.side}</Badge>;
    }
    if (columnId === "execution") {
      return <Badge color={executionMeta.color}>{executionMeta.label}</Badge>;
    }
    if (columnId === "type") {
      return <Badge color={typeColor}>{event.type}</Badge>;
    }
    if (columnId === "premium") {
      return (
        <span
          style={{
            textAlign: "right",
            color:
              event.premium > 250000
                ? T.amber
                : event.premium > 100000
                  ? T.text
                  : T.textSec,
            fontWeight: 700,
          }}
        >
          {premiumLabel}
        </span>
      );
    }
    if (columnId === "fill") {
      return (
        <AppTooltip content={fillSpreadMeta.label}><span
          style={{ textAlign: "right", color: fillSpreadMeta.color }}
        >
          {isFiniteNumber(fillSpreadMeta.fill)
            ? `${formatOptionPrice(fillSpreadMeta.fill)} ${fillSpreadMeta.shortLabel}`
            : MISSING_VALUE}
        </span></AppTooltip>
      );
    }
    if (columnId === "mark") {
      return (
        <AppTooltip content={
            isFiniteNumber(event.mark)
              ? "Option mark"
              : "Option mark unavailable"
          }><span
          style={{ textAlign: "right", color: T.textSec, fontWeight: 650 }}
        >
          {formatOptionPrice(event.mark)}
        </span></AppTooltip>
      );
    }
    if (columnId === "bidAsk") {
      const bid = fillSpreadMeta.bid;
      const ask = fillSpreadMeta.ask;
      const fill = fillSpreadMeta.fill;
      const hasRange =
        isFiniteNumber(bid) &&
        isFiniteNumber(ask) &&
        ask > bid &&
        isFiniteNumber(fill);
      const fillPosition = hasRange
        ? Math.max(0, Math.min(100, ((fill - bid) / (ask - bid)) * 100))
        : null;
      return (
        <AppTooltip content={
            fillSpreadMeta.crossed
              ? "Crossed NBBO"
              : hasRange
                ? `${formatOptionPrice(bid)} bid · ${formatOptionPrice(fill)} fill · ${formatOptionPrice(ask)} ask`
                : "Bid/ask unavailable"
          }><div
          style={{
            width: "100%",
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            gap: sp(2),
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: sp(4),
              fontSize: fs(8),
              lineHeight: 1,
            }}
          >
            <span style={{ color: T.red, fontWeight: 700 }}>
              B {formatOptionPrice(bid)}
            </span>
            <span style={{ color: event.cp === "P" ? T.red : T.green, fontWeight: 700 }}>
              A {formatOptionPrice(ask)}
            </span>
          </div>
          <div
            style={{
              position: "relative",
              height: dim(7),
              borderRadius: dim(2),
              overflow: "hidden",
              border: `1px solid ${T.border}`,
              background: T.bg1,
            }}
          >
            <span
              style={{
                position: "absolute",
                inset: 0,
                background: `linear-gradient(90deg, ${T.red}55 0%, ${T.textDim}45 50%, ${event.cp === "P" ? T.red : T.green}66 100%)`,
              }}
            />
            {fillPosition !== null ? (
              <span
                style={{
                  position: "absolute",
                  top: dim(-1),
                  left: `${fillPosition}%`,
                  width: dim(4),
                  height: dim(9),
                  transform: "translateX(-50%)",
                  borderRadius: dim(1),
                  background: fillSpreadMeta.color,
                  boxShadow: `0 0 0 1px ${T.bg0}`,
                }}
              />
            ) : null}
          </div>
        </div></AppTooltip>
      );
    }
    if (columnId === "bid") {
      return (
        <span style={{ textAlign: "right", color: T.textDim }}>
          {formatOptionPrice(event.bid)}
        </span>
      );
    }
    if (columnId === "ask") {
      return (
        <span style={{ textAlign: "right", color: T.textDim }}>
          {formatOptionPrice(event.ask)}
        </span>
      );
    }
    if (columnId === "spread") {
      return (
        <AppTooltip content={
            fillSpreadMeta.crossed
              ? "Crossed market"
              : isFiniteNumber(fillSpreadMeta.spreadPct)
                ? `${fillSpreadMeta.spreadPct.toFixed(1)}% of midpoint`
                : undefined
          }><span
          style={{
            textAlign: "right",
            color:
              fillSpreadMeta.crossed ||
              (isFiniteNumber(fillSpreadMeta.spreadPct) &&
                fillSpreadMeta.spreadPct > 10)
                ? T.amber
                : T.textDim,
          }}
        >
          {fillSpreadMeta.crossed
            ? "CROSSED"
            : isFiniteNumber(fillSpreadMeta.spread) &&
                isFiniteNumber(fillSpreadMeta.spreadPct)
              ? `${fillSpreadMeta.spread.toFixed(2)}/${fillSpreadMeta.spreadPct.toFixed(1)}%`
              : MISSING_VALUE}
        </span></AppTooltip>
      );
    }
    if (columnId === "size") {
      return (
        <span style={{ textAlign: "right", color: T.textSec }}>
          {fmtCompactNumber(event.vol)}
        </span>
      );
    }
    if (columnId === "oi") {
      return (
        <span style={{ textAlign: "right", color: T.textDim }}>
          {fmtCompactNumber(event.oi)}
        </span>
      );
    }
    if (columnId === "ratio") {
      return (
        <span
          style={{
            textAlign: "right",
            color: isFiniteNumber(volToOi) && volToOi > 1 ? T.amber : T.textDim,
            fontWeight: isFiniteNumber(volToOi) && volToOi > 1 ? 700 : 400,
          }}
        >
          {isFiniteNumber(volToOi) ? volToOi.toFixed(2) : MISSING_VALUE}
        </span>
      );
    }
    if (columnId === "dte") {
      return (
        <span style={{ textAlign: "right", color: T.textDim }}>
          {Number.isFinite(event.dte) ? `${event.dte}d` : MISSING_VALUE}
        </span>
      );
    }
    if (columnId === "iv") {
      return (
        <span style={{ textAlign: "right", color: T.textDim }}>
          {isFiniteNumber(event.iv)
            ? `${(event.iv * 100).toFixed(1)}%`
            : MISSING_VALUE}
        </span>
      );
    }
    if (columnId === "spot") {
      return (
        <span style={{ textAlign: "right", color: T.textDim }}>
          {isFiniteNumber(event.spot) ? event.spot.toFixed(2) : MISSING_VALUE}
        </span>
      );
    }
    if (columnId === "otmPercent") {
      const isAtOrInTheMoney =
        isFiniteNumber(event.otmPercent) && event.otmPercent === 0;
      return (
        <AppTooltip content={
            isFiniteNumber(event.otmPercent)
              ? isAtOrInTheMoney
                ? "At or in the money"
                : `${event.otmPercent.toFixed(2)}% out of the money`
              : "Moneyness unavailable"
          }><span
          style={{
            textAlign: "right",
            color: isAtOrInTheMoney ? T.green : T.amber,
            fontWeight: 700,
          }}
        >
          {isFiniteNumber(event.otmPercent)
            ? `${event.otmPercent.toFixed(1)}%`
            : MISSING_VALUE}
        </span></AppTooltip>
      );
    }
    if (columnId === "moneyness") {
      const color =
        event.moneyness === "ITM"
          ? T.green
          : event.moneyness === "ATM"
            ? T.amber
            : event.moneyness === "OTM"
              ? T.textSec
              : T.textDim;
      return (
        <span style={{ textAlign: "right", color, fontWeight: 700 }}>
          {event.moneyness && event.moneyness !== "UNKNOWN"
            ? event.moneyness
            : MISSING_VALUE}
        </span>
      );
    }
    if (columnId === "distance") {
      return (
        <span style={{ textAlign: "right", color: T.textDim }}>
          {formatSignedPercent(event.distancePercent)}
        </span>
      );
    }
    if (columnId === "delta") {
      return (
        <span style={{ textAlign: "right", color: T.textDim }}>
          {formatGreekValue(event.delta)}
        </span>
      );
    }
    if (columnId === "gamma") {
      return (
        <span style={{ textAlign: "right", color: T.textDim }}>
          {formatGreekValue(event.gamma)}
        </span>
      );
    }
    if (columnId === "theta") {
      return (
        <span style={{ textAlign: "right", color: T.textDim }}>
          {formatGreekValue(event.theta)}
        </span>
      );
    }
    if (columnId === "vega") {
      return (
        <span style={{ textAlign: "right", color: T.textDim }}>
          {formatGreekValue(event.vega)}
        </span>
      );
    }
    if (columnId === "sourceBasis") {
      return (
        <Badge color={sourceBasisMeta.color}>{sourceBasisMeta.label}</Badge>
      );
    }
    if (columnId === "confidence") {
      const confidenceMeta = getFlowSourceBasisMeta(event.confidence);
      return (
        <Badge color={confidenceMeta.color}>{confidenceMeta.label}</Badge>
      );
    }
    if (columnId === "score") {
      return (
        <span style={{ textAlign: "center" }}>
          <Badge color={scoreColor}>{event.score}</Badge>
        </span>
      );
    }
    if (columnId === "actions") {
      const isPinned = pinnedEventId === event.id;
      const copied = copiedEventId === event.id;
      return (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: sp(2),
          }}
        >
          <AppTooltip content={isPinned ? "Unpin row" : "Pin row"}><button
            type="button"
            aria-label={isPinned ? "Unpin flow row" : "Pin flow row"}
            onClick={(clickEvent) => handleTogglePinned(clickEvent, event)}
            style={{
              width: dim(22),
              height: dim(22),
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              border: `1px solid ${isPinned ? T.amber : T.border}`,
              background: isPinned ? `${T.amber}18` : T.bg2,
              color: isPinned ? T.amber : T.textDim,
              cursor: "pointer",
              padding: 0,
            }}
          >
            {isPinned ? <PinOff size={12} /> : <Pin size={12} />}
          </button></AppTooltip>
          <AppTooltip content={copied ? "Copied" : "Copy contract"}><button
            type="button"
            aria-label="Copy flow contract"
            onClick={(clickEvent) => handleCopyContract(clickEvent, event)}
            style={{
              width: dim(22),
              height: dim(22),
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              border: `1px solid ${copied ? T.green : T.border}`,
              background: copied ? `${T.green}18` : T.bg2,
              color: copied ? T.green : T.textDim,
              cursor: "pointer",
              padding: 0,
            }}
          >
            <Copy size={12} />
          </button></AppTooltip>
          <AppTooltip content="Open in Trade"><button
            type="button"
            aria-label="Open flow row in Trade"
            onClick={(clickEvent) => {
              clickEvent.stopPropagation();
              onJumpToTrade?.(event);
            }}
            style={{
              width: dim(22),
              height: dim(22),
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              border: `1px solid ${T.border}`,
              background: T.bg2,
              color: T.textDim,
              cursor: "pointer",
              padding: 0,
            }}
          >
            <ExternalLink size={12} />
          </button></AppTooltip>
        </div>
      );
    }
    return null;
  };

  const toolbarChipStyle = (active, accent = T.accent) => ({
    padding: sp("3px 7px"),
    fontSize: fs(8),
    fontFamily: T.mono,
    border: `1px solid ${active ? accent : T.border}`,
    background: active ? `${accent}18` : T.bg2,
    color: active ? accent : T.textDim,
    cursor: "pointer",
    borderRadius: dim(3),
  });

  const panelLabelStyle = {
    fontSize: fs(8),
    color: T.textDim,
    fontFamily: T.mono,
    fontWeight: 700,
    letterSpacing: "0.05em",
  };

  const toolButtonStyle = (active, accent = T.accent) => ({
    ...toolbarChipStyle(active, accent),
    minHeight: dim(28),
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: sp(5),
    padding: sp("4px 8px"),
  });

  const getTapeCellAlignment = (columnId) => {
    if (RIGHT_ALIGNED_FLOW_COLUMNS.has(columnId)) return "right";
    if (CENTER_ALIGNED_FLOW_COLUMNS.has(columnId)) return "center";
    return "left";
  };

  const getTapeCellStyle = (columnId) => {
    const alignment = getTapeCellAlignment(columnId);
    return {
      minWidth: 0,
      display: "flex",
      alignItems: "center",
      justifyContent:
        alignment === "right"
          ? "flex-end"
          : alignment === "center"
            ? "center"
            : "flex-start",
      overflow: "hidden",
      whiteSpace: "nowrap",
      textAlign: alignment,
    };
  };

  const getTapeHeaderCellStyle = (column) => {
    const active = normalizeFlowSortBy(column.id) === sortBy;
    const sortable = FLOW_SORTABLE_COLUMNS.has(column.id);
    return {
      ...getTapeCellStyle(column.id),
      gap: sp(3),
      padding: 0,
      border: "none",
      background: "transparent",
      color: active ? T.text : T.textMuted,
      cursor: sortable ? "pointer" : "default",
      font: "inherit",
      fontWeight: active ? 800 : 700,
      letterSpacing: "0.08em",
    };
  };

  const filterPanel = (
    <Card
      data-testid="flow-filter-panel"
      className="ra-panel-enter"
      style={{
        padding: "8px 10px",
        display: "flex",
        flexDirection: "column",
        gap: sp(8),
        height: showInlineFilterPanel ? "fit-content" : "auto",
        maxHeight: showOverlayFilterPanel ? "calc(100vh - 132px)" : undefined,
        overflowY: showOverlayFilterPanel ? "auto" : "visible",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: sp(6),
        }}
      >
        <span style={{ fontSize: fs(11), fontWeight: 800, color: T.text }}>
          Filters
        </span>
        <AppTooltip content="Collapse filters"><button
          type="button"
          onClick={() => setFiltersOpen(false)}
          style={toolButtonStyle(false, T.textDim)}
          aria-label="Collapse Flow filters"
        >
          <PanelLeftClose size={13} />
        </button></AppTooltip>
      </div>

      <label
        style={{
          display: "flex",
          flexDirection: "column",
          gap: sp(3),
          fontSize: fs(8),
          color: T.textDim,
          fontFamily: T.mono,
        }}
      >
        Include tickers
        <input
          data-testid="flow-include-input"
          value={includeQuery}
          onChange={(event) => {
            updateFlowTapeFilters({ includeQuery: event.target.value });
          }}
          placeholder="SPY, QQQ, NVDA"
          style={{
            width: "100%",
            padding: sp("6px 8px"),
            background: T.bg1,
            border: `1px solid ${T.border}`,
            color: T.text,
            fontFamily: T.mono,
            fontSize: fs(10),
          }}
        />
      </label>

      <label
        style={{
          display: "flex",
          flexDirection: "column",
          gap: sp(3),
          fontSize: fs(8),
          color: T.textDim,
          fontFamily: T.mono,
        }}
      >
        Exclude tickers
        <input
          data-testid="flow-exclude-input"
          value={excludeQuery}
          onChange={(event) => {
            updateFlowTapeFilters({ excludeQuery: event.target.value });
          }}
          placeholder="AAPL, TSLA"
          style={{
            width: "100%",
            padding: sp("6px 8px"),
            background: T.bg1,
            border: `1px solid ${T.border}`,
            color: T.text,
            fontFamily: T.mono,
            fontSize: fs(10),
          }}
        />
      </label>

      <div style={{ display: "flex", flexDirection: "column", gap: sp(5) }}>
        <span style={panelLabelStyle}>FLOW</span>
        <div style={{ display: "flex", flexWrap: "wrap", gap: sp(4) }}>
          {FLOW_TAPE_FILTER_OPTIONS.map(({ id: key, label }) => (
            <Pill
              key={key}
              active={filter === key}
              onClick={() => {
                updateFlowTapeFilters({ filter: key });
              }}
              color={
                key === "golden" ? T.amber : key === "cluster" ? T.cyan : undefined
              }
            >
              {label}
            </Pill>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: sp(5) }}>
        <span style={panelLabelStyle}>MIN PREMIUM</span>
        <div style={{ display: "flex", flexWrap: "wrap", gap: sp(4) }}>
          {FLOW_MIN_PREMIUM_OPTIONS.map(({ value, label }) => (
            <Pill
              key={value}
              active={minPrem === value}
              onClick={() => {
                updateFlowTapeFilters({ minPrem: value });
              }}
            >
              {label}
            </Pill>
          ))}
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: sp(8),
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: sp(5) }}>
          <span style={panelLabelStyle}>DENSITY</span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: sp(4) }}>
            {[
              ["compact", "Compact"],
              ["comfortable", "Comfort"],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  setDensity(value);
                  markScannerEdited();
                }}
                style={toolbarChipStyle(density === value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: sp(5) }}>
          <span style={panelLabelStyle}>ROWS</span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: sp(4) }}>
            {FLOW_ROWS_OPTIONS.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  setRowsPerPage(value);
                  markScannerEdited();
                }}
                style={toolbarChipStyle(rowsPerPage === value)}
              >
                {value}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: sp(5), flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={saveCurrentScan}
          style={{
            ...toolButtonStyle(false),
            color: T.accent,
            borderColor: T.accent,
          }}
        >
          Save preset
        </button>
        <button
          type="button"
          onClick={handleToggleLivePaused}
          style={toolButtonStyle(livePaused, livePaused ? T.amber : T.green)}
        >
          {livePaused ? <Play size={13} /> : null}
          {livePaused ? "Resume" : "Pause"}
        </button>
      </div>

      {savedScans.length ? (
        <div style={{ display: "flex", flexDirection: "column", gap: sp(5) }}>
          <span style={panelLabelStyle}>PRESETS</span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: sp(4) }}>
            {savedScans.map((scan) => (
              <AppTooltip key={scan.id} content={`${scan.name} · ${scan.filter} · ${normalizeFlowSortBy(scan.sortBy)} ${normalizeFlowSortDir(scan.sortDir, scan.sortBy)}`}><div
                key={scan.id}
                onClick={() => loadScan(scan)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: sp(3),
                  padding: sp("3px 7px"),
                  borderRadius: dim(3),
                  border: `1px solid ${
                    activeScanId === scan.id ? T.accent : T.border
                  }`,
                  background:
                    activeScanId === scan.id ? `${T.accent}18` : T.bg1,
                  cursor: "pointer",
                  fontSize: fs(8),
                  fontFamily: T.mono,
                  color: activeScanId === scan.id ? T.accent : T.textSec,
                }}
              >
                <span>{scan.name}</span>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    deleteScan(scan.id);
                  }}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: T.textMuted,
                    cursor: "pointer",
                    fontSize: fs(10),
                    padding: 0,
                    lineHeight: 1,
                  }}
                >
                  x
                </button>
              </div></AppTooltip>
            ))}
          </div>
        </div>
      ) : null}
    </Card>
  );

  const columnDrawer = columnsOpen ? (
    <Card
      data-testid="flow-column-drawer"
      className="ra-popover-enter"
      style={{
        position: "absolute",
        top: dim(62),
        right: dim(8),
        width: isMobileFlowLayout ? "calc(100% - 16px)" : dim(310),
        zIndex: 20,
        padding: "8px 10px",
        display: "flex",
        flexDirection: "column",
        gap: sp(7),
        boxShadow: `0 18px 48px ${T.bg0}cc`,
        maxHeight: "calc(100vh - 128px)",
        overflowY: "auto",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: sp(6),
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: sp(1) }}>
          <span style={{ fontSize: fs(11), fontWeight: 800, color: T.text }}>
            Columns
          </span>
          <span style={{ fontSize: fs(8), color: T.textDim, fontFamily: T.mono }}>
            Show, hide, and order the tape fields.
          </span>
        </div>
        <AppTooltip content="Close columns"><button
          type="button"
          onClick={() => setColumnsOpen(false)}
          style={toolButtonStyle(false, T.textDim)}
          aria-label="Close Flow column drawer"
        >
          x
        </button></AppTooltip>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: sp(4) }}>
        {columnOrder.map((columnId, index) => {
          const column = FLOW_COLUMN_BY_ID.get(columnId);
          if (!column) return null;
          const checked = visibleColumns.includes(columnId);
          return (
            <div
              key={columnId}
              data-testid={`flow-column-row-${columnId}`}
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 1fr) auto auto",
                gap: sp(4),
                alignItems: "center",
                padding: sp("5px 6px"),
                border: `1px solid ${checked ? T.borderLight : T.border}`,
                background: checked ? T.bg1 : T.bg0,
              }}
            >
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: sp(6),
                  minWidth: 0,
                  fontSize: fs(9),
                  color: checked ? T.text : T.textDim,
                  fontFamily: T.mono,
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleColumn(columnId)}
                />
                <span
                  style={{
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {column.toggleLabel}
                </span>
              </label>
              <button
                type="button"
                disabled={index === 0}
                onClick={() => moveColumn(columnId, -1)}
                style={{
                  ...toolbarChipStyle(false, T.textDim),
                  opacity: index === 0 ? 0.45 : 1,
                }}
              >
                Up
              </button>
              <button
                type="button"
                disabled={index === columnOrder.length - 1}
                onClick={() => moveColumn(columnId, 1)}
                style={{
                  ...toolbarChipStyle(false, T.textDim),
                  opacity: index === columnOrder.length - 1 ? 0.45 : 1,
                }}
              >
                Down
              </button>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={resetColumns}
        style={{
          ...toolButtonStyle(false, T.textDim),
          alignSelf: "flex-start",
        }}
      >
        Reset columns
      </button>
    </Card>
  ) : null;

  const renderFlowMobileCard = (event, index = 0) => {
    const selected = selectedEvt?.id === event.id;
    const pinned = pinnedEventId === event.id;
    const executionMeta = getFlowExecutionMeta(event);
    const premiumLabel =
      event.premium >= 1e6
        ? `$${(event.premium / 1e6).toFixed(2)}M`
        : `$${(event.premium / 1e3).toFixed(0)}K`;
    const fillSpreadMeta = resolveFlowFillSpreadMeta(event);
    const sentiment = classifyFlowSentiment(event);
    const ageLabel = formatFlowTradeAge(event.occurredAt, flowNowMs);
    const occurredAt = event.occurredAt ? formatFlowAppTime(event.occurredAt) : event.time;
    const sentimentColor =
      sentiment === "bull" ? T.green : sentiment === "bear" ? T.red : T.textDim;
    return (
      <div
        key={event.id}
        data-testid="flow-row-card"
        role="button"
        tabIndex={0}
        onClick={() =>
          setSelectedEvt((previous) =>
            previous?.id === event.id ? null : event,
          )
        }
        onDoubleClick={() => onJumpToTrade?.(event)}
        onKeyDown={(keyEvent) => {
          if (keyEvent.key === "Enter") {
            setSelectedEvt((previous) =>
              previous?.id === event.id ? null : event,
            );
          }
        }}
        className={joinMotionClasses(
          "ra-row-enter",
          "ra-interactive",
          (selected || pinned) && "ra-focus-rail",
        )}
        style={{
          ...motionRowStyle(index, 10, 140),
          ...motionVars({
            accent: selected
              ? T.accent
              : pinned || event.golden
                ? T.amber
                : executionMeta.color,
          }),
          padding: sp("8px 9px"),
          borderBottom: `1px solid ${T.border}55`,
          borderLeft: selected
            ? `2px solid ${T.accent}`
            : pinned
              ? `2px solid ${T.amber}`
              : event.golden
                ? `2px solid ${T.amber}`
                : "2px solid transparent",
          background: selected
            ? `${T.accent}12`
            : pinned
              ? `${T.amber}10`
              : event.golden
                ? `${T.amber}0f`
                : "transparent",
          display: "flex",
          flexDirection: "column",
          gap: sp(6),
          cursor: "pointer",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: sp(8),
          }}
        >
          <div style={{ minWidth: 0, display: "flex", flexDirection: "column" }}>
            <span
              style={{
                fontSize: fs(12),
                fontWeight: 800,
                color: T.text,
                fontFamily: T.mono,
              }}
            >
              {event.ticker}{" "}
              <span style={{ color: event.cp === "C" ? T.green : T.red }}>
                {event.cp}
                {event.strike}
              </span>
            </span>
            <span
              style={{
                fontSize: fs(9),
                color: T.textDim,
                fontFamily: T.mono,
              }}
            >
              {formatExpirationLabel(event.expirationDate)} · {ageLabel} · {occurredAt} {appTimeZoneLabel}
            </span>
          </div>
          <span
            style={{
              fontSize: fs(12),
              color: event.premium >= 250000 ? T.amber : T.text,
              fontFamily: T.mono,
              fontWeight: 800,
              whiteSpace: "nowrap",
            }}
          >
            {premiumLabel}
          </span>
        </div>
        <div style={{ display: "flex", gap: sp(4), flexWrap: "wrap" }}>
          <Badge color={executionMeta.color}>{executionMeta.label}</Badge>
          <Badge color={event.type === "SWEEP" ? T.amber : T.accent}>
            {event.type}
          </Badge>
          <Badge color={flowProviderColor(event.provider)}>
            {event.sourceLabel}
          </Badge>
          <Badge color={sentimentColor}>
            {sentiment === "bull"
              ? "BULL"
              : sentiment === "bear"
                ? "BEAR"
                : "NEUTRAL"}
          </Badge>
          {event.isUnusual ? <Badge color={T.cyan}>VOL/OI</Badge> : null}
          {pinned ? <Badge color={T.amber}>PINNED</Badge> : null}
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
            gap: sp(5),
            fontSize: fs(8),
            color: T.textDim,
            fontFamily: T.mono,
          }}
        >
          <span>Size {fmtCompactNumber(event.vol)}</span>
          <span>OI {fmtCompactNumber(event.oi)}</span>
          <span>DTE {Number.isFinite(event.dte) ? `${event.dte}d` : MISSING_VALUE}</span>
          <span>Score {event.score}</span>
        </div>
        <div
          data-testid="flow-mobile-fill-spread"
          style={{
            fontSize: fs(8),
            color: T.textDim,
            fontFamily: T.mono,
          }}
        >
          Fill{" "}
          <span style={{ color: fillSpreadMeta.color, fontWeight: 700 }}>
            {formatOptionPrice(fillSpreadMeta.fill)} {fillSpreadMeta.shortLabel}
          </span>{" "}
          · Bid/Ask {formatOptionPrice(fillSpreadMeta.bid)}/
          {formatOptionPrice(fillSpreadMeta.ask)} · Sprd{" "}
          {fillSpreadMeta.crossed
            ? "CROSSED"
            : isFiniteNumber(fillSpreadMeta.spreadPct)
              ? `${fillSpreadMeta.spreadPct.toFixed(1)}%`
              : MISSING_VALUE}
        </div>
        {renderTapeCell("actions", event)}
      </div>
    );
  };

  const flowScannerStatusPanel = (
    <FlowScannerStatusPanel
      enabled={flowScannerEnabled}
      ownerActive={flowScannerOwnerActive}
      flowDisplayLabel={flowDisplayLabel}
      flowDisplayColor={flowDisplayColor}
      flowQuality={flowQuality}
      coverage={coverage}
      coverageModeLabel={coverageModeLabel}
      scannedCoverageSymbols={scannedCoverageSymbols}
      totalCoverageSymbols={totalCoverageSymbols}
      intendedCoverageSymbols={intendedCoverageSymbols}
      selectedCoverageSymbols={selectedCoverageSymbols}
      newestScanAt={newestScanAt}
      oldestScanAt={oldestScanAt}
      scannerConfig={flowScannerControl.config}
      onToggle={toggleFlowScanner}
      toggleTone={flowScannerTone}
      formatAppTime={formatFlowAppTime}
    />
  );

  const flowPresetBar = (
    <div
      data-testid="flow-preset-bar"
      style={{
        display: "flex",
        alignItems: "center",
        gap: sp(5),
        flexWrap: "wrap",
        padding: sp("0 2px"),
      }}
    >
      <span
        style={{
          fontSize: fs(8),
          color: T.textDim,
          fontFamily: T.mono,
          fontWeight: 800,
        }}
      >
        PRESET SCANS
      </span>
      {FLOW_BUILT_IN_PRESETS.map((preset) => {
        const active = activeFlowPresetId === preset.id;
        const presetColor = FLOW_PRESET_COLORS[preset.id] || T.accent;
        return (
          <button
            key={preset.id}
            type="button"
            data-testid={`flow-built-in-preset-${preset.id}`}
            onClick={() => applyBuiltInPreset(preset)}
            style={{
              padding: sp("4px 8px"),
              border: `1px solid ${active ? presetColor : T.border}`,
              background: active ? `${presetColor}18` : T.bg2,
              color: active ? presetColor : T.textSec,
              fontSize: fs(8),
              fontFamily: T.mono,
              fontWeight: active ? 800 : 600,
              cursor: "pointer",
            }}
          >
            {preset.label}
          </button>
        );
      })}
      {activeFlowPresetId ? (
        <button
          type="button"
          onClick={() => updateFlowTapeFilters({ activeFlowPresetId: null }, { clearPreset: false })}
          style={{
            padding: sp("4px 8px"),
            border: `1px solid ${T.border}`,
            background: T.bg1,
            color: T.textDim,
            fontSize: fs(8),
            fontFamily: T.mono,
            cursor: "pointer",
          }}
        >
          Clear
        </button>
      ) : null}
    </div>
  );
  const isFlowLoadingShell = flowStatus === "loading" && !flowEvents.length;
  const shouldRenderDeferredPanels = showDeferredPanels && !isFlowLoadingShell;

  if (!isVisible) {
    return (
      <div
        data-testid="flow-screen-suspended"
        style={{ display: "none" }}
      />
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
        position: "relative",
      }}
    >
      <div
        ref={flowContentRef}
        style={{
          flex: 1,
          overflowY: "auto",
          padding: sp(8),
          display: "grid",
          gridAutoRows: "max-content",
          alignContent: "start",
          gap: 6,
          minWidth: 0,
        }}
      >
        {flowScannerStatusPanel}

        <Card
          data-testid="flow-top-toolbar"
          style={{
            padding: "8px 10px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: sp(10),
            flexWrap: "wrap",
            position: "sticky",
            top: 0,
            zIndex: 30,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: sp(10),
              minWidth: 0,
              flex: "1 1 360px",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: sp(2) }}>
              <span
                style={{
                  fontSize: fs(12),
                  fontWeight: 800,
                  fontFamily: T.display,
                  color: T.text,
                }}
              >
                Flow Scanner
              </span>
              <span
                style={{
                  fontSize: fs(8),
                  color: T.textDim,
                  fontFamily: T.mono,
                }}
              >
                {filtered.length} / {flowEvents.length} shown ·{" "}
                {visibleColumns.length} columns · {density}
                {activeBuiltInPreset ? ` · ${activeBuiltInPreset.label}` : ""}
              </span>
            </div>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: sp(4),
                padding: sp("2px 6px"),
                borderRadius: dim(3),
                border: `1px solid ${feedStateColor}30`,
                background: `${feedStateColor}12`,
                color: feedStateColor,
                fontSize: fs(8),
                fontFamily: T.mono,
                fontWeight: 700,
                whiteSpace: "nowrap",
              }}
            >
              {feedStateLabel}
            </span>
            {pinnedEvent ? (
              <AppTooltip content={getFlowContractLabel(pinnedEvent)}><button
                type="button"
                data-testid="flow-pinned-row"
                onClick={() => setSelectedEvt(pinnedEvent)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: sp(5),
                  minWidth: 0,
                  maxWidth: isMobileFlowLayout ? "100%" : dim(260),
                  padding: sp("3px 7px"),
                  border: `1px solid ${T.amber}35`,
                  background: `${T.amber}12`,
                  color: T.amber,
                  fontSize: fs(8),
                  fontFamily: T.mono,
                  cursor: "pointer",
                }}
              >
                <Pin size={12} />
                <span
                  style={{
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {pinnedEvent.ticker} {pinnedEvent.cp}
                  {pinnedEvent.strike} · {fmtM(pinnedEvent.premium)}
                </span>
              </button></AppTooltip>
            ) : null}
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: sp(5),
              flexWrap: "wrap",
              justifyContent: "flex-end",
            }}
          >
            <AppTooltip content={filtersOpen ? "Hide filters" : "Show filters"}><button
              type="button"
              data-testid="flow-filter-toggle"
              onClick={() => setFiltersOpen((current) => !current)}
              style={toolButtonStyle(filtersOpen)}
              aria-label={filtersOpen ? "Hide Flow filters" : "Show Flow filters"}
            >
              {filtersOpen ? <PanelLeftClose size={14} /> : <PanelLeftOpen size={14} />}
              Filters
            </button></AppTooltip>
            <AppTooltip content="Configure columns"><button
              type="button"
              data-testid="flow-column-toggle"
              onClick={() => setColumnsOpen((current) => !current)}
              style={toolButtonStyle(columnsOpen)}
              aria-label="Configure Flow columns"
            >
              <Columns3 size={14} />
              Columns
            </button></AppTooltip>
            <button
              type="button"
              onClick={handleToggleLivePaused}
              style={toolButtonStyle(livePaused, livePaused ? T.amber : T.green)}
            >
              {livePaused ? <Play size={14} /> : <SlidersHorizontal size={14} />}
              {livePaused ? "Resume" : "Pause"}
            </button>
          </div>
        </Card>

        {showOverlayFilterPanel ? (
          <div
            style={{
              position: "absolute",
              top: dim(62),
              left: dim(8),
              right: dim(8),
              zIndex: 18,
              boxShadow: `0 18px 48px ${T.bg0}cc`,
            }}
          >
            {filterPanel}
          </div>
        ) : null}
        {columnDrawer}

        <Card style={{ display: "none" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              gap: sp(10),
              flexWrap: "wrap",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: sp(2) }}>
              <span
                style={{
                  fontSize: fs(12),
                  fontWeight: 800,
                  fontFamily: T.display,
                  color: T.text,
                }}
              >
                Flow Scanner
              </span>
              <span
                style={{
                  fontSize: fs(8),
                  color: T.textDim,
                  fontFamily: T.mono,
                }}
              >
                Tape-first live options flow with inline context and saved presets.
              </span>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: sp(6),
                flexWrap: "wrap",
                justifyContent: "flex-end",
              }}
            >
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: sp(4),
                  padding: sp("2px 6px"),
                  borderRadius: dim(3),
                  border: `1px solid ${feedStateColor}30`,
                  background: `${feedStateColor}12`,
                  color: feedStateColor,
                  fontSize: fs(8),
                  fontFamily: T.mono,
                  fontWeight: 700,
                }}
              >
                {feedStateLabel}
              </span>
              <span style={{ fontSize: fs(8), color: T.textDim, fontFamily: T.mono }}>
                {filtered.length} / {flowEvents.length} shown
              </span>
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(220px, 1fr) minmax(220px, 1fr) auto",
              gap: sp(6),
              alignItems: "center",
            }}
          >
            <label
              style={{
                display: "flex",
                flexDirection: "column",
                gap: sp(3),
                fontSize: fs(8),
                color: T.textDim,
                fontFamily: T.mono,
              }}
            >
              Include tickers
              <input
                value={includeQuery}
                onChange={(event) => {
                  updateFlowTapeFilters({ includeQuery: event.target.value });
                }}
                placeholder="SPY, QQQ, NVDA"
                style={{
                  width: "100%",
                  padding: sp("6px 8px"),
                  background: T.bg1,
                  border: `1px solid ${T.border}`,
                  color: T.text,
                  fontFamily: T.mono,
                  fontSize: fs(10),
                }}
              />
            </label>
            <label
              style={{
                display: "flex",
                flexDirection: "column",
                gap: sp(3),
                fontSize: fs(8),
                color: T.textDim,
                fontFamily: T.mono,
              }}
            >
              Exclude tickers
              <input
                value={excludeQuery}
                onChange={(event) => {
                  updateFlowTapeFilters({ excludeQuery: event.target.value });
                }}
                placeholder="AAPL, TSLA"
                style={{
                  width: "100%",
                  padding: sp("6px 8px"),
                  background: T.bg1,
                  border: `1px solid ${T.border}`,
                  color: T.text,
                  fontFamily: T.mono,
                  fontSize: fs(10),
                }}
              />
            </label>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: sp(3),
                alignItems: "flex-end",
              }}
            >
              <button
                onClick={handleToggleLivePaused}
                style={{
                  ...toolbarChipStyle(livePaused, livePaused ? T.amber : T.green),
                  minWidth: dim(104),
                }}
              >
                {livePaused ? "Resume live" : "Pause tape"}
              </button>
              <button
                onClick={saveCurrentScan}
                style={{
                  ...toolbarChipStyle(false),
                  color: T.accent,
                  borderColor: T.accent,
                  minWidth: dim(104),
                }}
              >
                Save preset
              </button>
            </div>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: sp(4), alignItems: "center" }}>
            <span style={{ fontSize: fs(8), color: T.textDim, fontFamily: T.mono }}>
              FLOW
            </span>
            {FLOW_TAPE_FILTER_OPTIONS.map(({ id: key, label }) => (
              <Pill
                key={key}
                active={filter === key}
                onClick={() => {
                  updateFlowTapeFilters({ filter: key });
                }}
                color={key === "golden" ? T.amber : key === "cluster" ? T.cyan : undefined}
              >
                {label}
              </Pill>
            ))}
            <span style={{ marginLeft: sp(8), fontSize: fs(8), color: T.textDim, fontFamily: T.mono }}>
              MIN
            </span>
            {FLOW_MIN_PREMIUM_OPTIONS.map(({ value, label }) => (
              <Pill
                key={value}
                active={minPrem === value}
                onClick={() => {
                  updateFlowTapeFilters({ minPrem: value });
                }}
              >
                {label}
              </Pill>
            ))}
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: sp(4), alignItems: "center" }}>
            <span style={{ fontSize: fs(8), color: T.textDim, fontFamily: T.mono }}>
              DENSITY
            </span>
            {[
              ["compact", "Compact"],
              ["comfortable", "Comfort"],
            ].map(([value, label]) => (
              <button
                key={value}
                onClick={() => {
                  setDensity(value);
                  setActiveScanId(null);
                }}
                style={toolbarChipStyle(density === value)}
              >
                {label}
              </button>
            ))}
            <span style={{ marginLeft: sp(8), fontSize: fs(8), color: T.textDim, fontFamily: T.mono }}>
              ROWS
            </span>
            {FLOW_ROWS_OPTIONS.map((value) => (
              <button
                key={value}
                onClick={() => {
                  setRowsPerPage(value);
                  setActiveScanId(null);
                }}
                style={toolbarChipStyle(rowsPerPage === value)}
              >
                {value}
              </button>
            ))}
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: sp(4), alignItems: "center" }}>
            <span style={{ fontSize: fs(8), color: T.textDim, fontFamily: T.mono }}>
              COLUMNS
            </span>
            {FLOW_TAPE_OPTIONAL_COLUMNS.map((column) => (
              <button
                key={column.id}
                onClick={() => toggleColumn(column.id)}
                style={toolbarChipStyle(
                  visibleColumns.includes(column.id),
                  visibleColumns.includes(column.id) ? T.text : T.border,
                )}
              >
                {column.toggleLabel}
              </button>
            ))}
          </div>

          {savedScans.length ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: sp(4), alignItems: "center" }}>
              <span style={{ fontSize: fs(8), color: T.textDim, fontFamily: T.mono }}>
                PRESETS
              </span>
              {savedScans.map((scan) => (
                <AppTooltip key={scan.id} content={`${scan.name} · ${scan.filter} · ${normalizeFlowSortBy(scan.sortBy)} ${normalizeFlowSortDir(scan.sortDir, scan.sortBy)}`}><div
                  key={scan.id}
                  onClick={() => loadScan(scan)}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: sp(3),
                    padding: sp("3px 7px"),
                    borderRadius: dim(3),
                    border: `1px solid ${activeScanId === scan.id ? T.accent : T.border}`,
                    background: activeScanId === scan.id ? `${T.accent}18` : T.bg1,
                    cursor: "pointer",
                    fontSize: fs(8),
                    fontFamily: T.mono,
                    color: activeScanId === scan.id ? T.accent : T.textSec,
                  }}
                >
                  <span>{scan.name}</span>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      deleteScan(scan.id);
                    }}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: T.textMuted,
                      cursor: "pointer",
                      fontSize: fs(10),
                      padding: 0,
                      lineHeight: 1,
                    }}
                  >
                    ×
                  </button>
                </div></AppTooltip>
              ))}
            </div>
          ) : null}
        </Card>

        {flowPresetBar}

        <div
          data-testid="flow-main-layout"
          style={{
            display: "grid",
            gridTemplateColumns: flowMainGridTemplate,
            gap: 6,
            alignItems: "start",
            position: "relative",
          }}
        >
          {showInlineFilterPanel ? filterPanel : null}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 6,
              minWidth: 0,
              gridColumn: showContextRail ? "auto" : "1 / -1",
            }}
          >
            {selectedEvt ? (
              <ContractDetailInline
                evt={selectedEvt}
                onBack={() => setSelectedEvt(null)}
                onJumpToTrade={(event) => {
                  setSelectedEvt(null);
                  onJumpToTrade?.(event);
                }}
              />
            ) : null}

            <Card
              noPad
              style={{
                minHeight: filtered.length ? dim(320) : undefined,
                display: "flex",
                flexDirection: "column",
              }}
            >
              <div
                style={{
                  padding: sp("8px 10px 6px"),
                  borderBottom: `1px solid ${T.border}`,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  gap: sp(10),
                  flexWrap: "wrap",
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: sp(2) }}>
                  <span
                    style={{
                      fontSize: fs(11),
                      fontWeight: 700,
                      fontFamily: T.display,
                      color: T.text,
                    }}
                  >
                    Live Flow Tape
                  </span>
                  <span
                    style={{
                      fontSize: fs(8),
                      color: T.textDim,
                      fontFamily: T.mono,
                    }}
                  >
                    {isFlowLoadingShell
                      ? "warming flow feed"
                      : `${activeTicker || "Market-wide"} · ${visibleFlowRows.length} visible rows${filtered.length > rowsPerPage ? ` · capped at ${rowsPerPage}` : ""}`}
                  </span>
                </div>
                <div
                  style={{
                    display: "flex",
                    gap: sp(8),
                    flexWrap: "wrap",
                    fontSize: fs(8),
                    fontFamily: T.mono,
                    color: T.textDim,
                  }}
                >
                  <span>
                    Bull{" "}
                    <span style={{ color: T.green, fontWeight: 700 }}>
                      {fmtM(flowSentimentSummary.bullPremium)}
                    </span>
                  </span>
                  <span>
                    Bear{" "}
                    <span style={{ color: T.red, fontWeight: 700 }}>
                      {fmtM(flowSentimentSummary.bearPremium)}
                    </span>
                  </span>
                  <span>
                    Net{" "}
                    <span
                      style={{
                        color:
                          flowSentimentSummary.netPremium > 0
                            ? T.green
                            : flowSentimentSummary.netPremium < 0
                              ? T.red
                              : T.textDim,
                        fontWeight: 700,
                      }}
                    >
                      {fmtM(flowSentimentSummary.netPremium)}
                    </span>
                  </span>
                </div>
                <div
                  data-testid="flow-sentiment-bar"
                  style={{
                    flexBasis: "100%",
                    display: "grid",
                    gridTemplateColumns: isMobileFlowLayout
                      ? "minmax(0, 1fr)"
                      : "minmax(180px, 0.45fr) minmax(0, 1fr)",
                    gap: sp(8),
                    alignItems: "center",
                  }}
                >
                  <AppTooltip content={`${flowSentimentSummary.bullCount} bull · ${flowSentimentSummary.bearCount} bear · ${flowSentimentSummary.neutralCount} neutral`}><div
                    style={{
                      height: dim(8),
                      display: "flex",
                      overflow: "hidden",
                      borderRadius: dim(2),
                      border: `1px solid ${T.border}`,
                      background: T.bg1,
                    }}
                  >
                    <span
                      style={{
                        width: `${Math.round(flowSentimentSummary.bullShare * 100)}%`,
                        minWidth:
                          flowSentimentSummary.bullPremium > 0 ? dim(3) : 0,
                        background: T.green,
                      }}
                    />
                    <span
                      style={{
                        width: `${Math.round(flowSentimentSummary.neutralShare * 100)}%`,
                        minWidth:
                          flowSentimentSummary.neutralPremium > 0 ? dim(3) : 0,
                        background: `${T.textDim}80`,
                      }}
                    />
                    <span
                      style={{
                        width: `${Math.round(flowSentimentSummary.bearShare * 100)}%`,
                        minWidth:
                          flowSentimentSummary.bearPremium > 0 ? dim(3) : 0,
                        background: T.red,
                      }}
                    />
                  </div></AppTooltip>
                  {isMobileFlowLayout ? (
                    <div
                      data-testid="flow-mobile-sort-controls"
                      style={{
                        display: "flex",
                        gap: sp(4),
                        flexWrap: "wrap",
                        alignItems: "center",
                      }}
                    >
                      {[
                        ["time", "Age"],
                        ["premium", "Prem"],
                        ["ticker", "Tick"],
                        ["expiration", "Exp"],
                        ["strike", "Strike"],
                      ].map(([key, label]) => (
                        <button
                          key={key}
                          type="button"
                          onClick={() => applyFlowSort(key)}
                          style={toolbarChipStyle(sortBy === key)}
                        >
                          {label}
                          {sortBy === key ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div
                      style={{
                        display: "flex",
                        gap: sp(8),
                        flexWrap: "wrap",
                        justifyContent: "flex-end",
                        fontSize: fs(8),
                        fontFamily: T.mono,
                        color: T.textDim,
                      }}
                    >
                      <span>Neutral {fmtM(flowSentimentSummary.neutralPremium)}</span>
                      <span>{filtered.length} filtered prints</span>
                    </div>
                  )}
                </div>
              </div>

              <div
                style={{
                  flex: 1,
                  minHeight: 0,
                  overflowX: isMobileFlowLayout ? "hidden" : "auto",
                  overflowY: "hidden",
                }}
              >
                <div
                  style={{
                    minWidth: isMobileFlowLayout ? 0 : tapeTableMinWidth,
                    height: "100%",
                    display: "flex",
                    flexDirection: "column",
                  }}
                >
                  {isMobileFlowLayout ? (
                    isFlowLoadingShell ? (
                      <div style={{ flex: 1, overflowY: "auto", padding: sp(8) }}>
                        {Array.from({ length: Math.min(rowsPerPage, 12) }).map(
                          (_, rowIndex) => (
                            <FlowPlaceholderCard
                              key={`flow_mobile_placeholder_${rowIndex}`}
                              title="Loading print"
                              rows={3}
                              dense
                            />
                          ),
                        )}
                      </div>
                    ) : filtered.length ? (
                      <>
                        <div
                          data-testid="flow-mobile-card-list"
                          style={{ flex: 1, overflowY: "auto" }}
                        >
                          {visibleFlowRows.map((event, index) =>
                            renderFlowMobileCard(event, index),
                          )}
                        </div>
                        {filtered.length > rowsPerPage ? (
                          <div
                            style={{
                              padding: sp("6px 10px"),
                              borderTop: `1px solid ${T.border}`,
                              fontSize: fs(8),
                              color: T.textDim,
                              fontFamily: T.mono,
                            }}
                          >
                            Showing the first {rowsPerPage} matching prints.
                          </div>
                        ) : null}
                      </>
                    ) : (
                      <div style={{ padding: sp(12) }}>
                        <DataUnavailableState
                          title={
                            flowEvents.length
                              ? "No prints match this scanner"
                              : "No live options activity"
                          }
                          detail={
                            flowEvents.length
                              ? "Adjust include/exclude tickers, minimum premium, or flow-type filters to widen the tape."
                              : emptyFlowDetail
                          }
                        />
                      </div>
                    )
                  ) : (
                    <>
                      <div
                        data-testid="flow-tape-header"
                        style={{
                          display: "grid",
                          gridTemplateColumns: tapeGridTemplate,
                          padding: sp("6px 10px"),
                          fontSize: fs(8),
                          fontWeight: 700,
                          color: T.textMuted,
                          letterSpacing: "0.08em",
                          borderBottom: `1px solid ${T.border}`,
                          columnGap: sp(2),
                          flexShrink: 0,
                          fontFamily: T.mono,
                        }}
                      >
                        {tapeColumns.map((column) => {
                          const sortable = FLOW_SORTABLE_COLUMNS.has(column.id);
                          const activeSort = normalizeFlowSortBy(column.id) === sortBy;
                          return (
                            <button
                              key={column.id}
                              type="button"
                              data-testid={`flow-tape-header-${column.id}`}
                              disabled={!sortable}
                              aria-sort={
                                activeSort
                                  ? sortDir === "asc"
                                    ? "ascending"
                                    : "descending"
                                  : "none"
                              }
                              onClick={() => applyFlowSort(column.id)}
                              style={getTapeHeaderCellStyle(column)}
                            >
                              <span>{column.label}</span>
                              {activeSort ? (
                                <span aria-hidden="true">
                                  {sortDir === "asc" ? "▲" : "▼"}
                                </span>
                              ) : null}
                            </button>
                          );
                        })}
                      </div>

                      {isFlowLoadingShell ? (
                        <div style={{ flex: 1, overflowY: "auto" }}>
                          {Array.from({ length: rowsPerPage }).map((_, rowIndex) => (
                            <div
                              key={`tape_placeholder_${rowIndex}`}
                              style={{
                                display: "grid",
                                gridTemplateColumns: tapeGridTemplate,
                                padding: denseRows ? sp("4px 10px") : sp("7px 10px"),
                                columnGap: sp(2),
                                alignItems: "center",
                                borderBottom: `1px solid ${T.border}15`,
                              }}
                            >
                              {tapeColumns.map((column, columnIndex) => (
                                <FlowLoadingBlock
                                  key={`${column.id}_${rowIndex}`}
                                  width={
                                    column.id === "strike"
                                      ? columnIndex % 2 === 0
                                        ? "92%"
                                        : "78%"
                                      : "70%"
                                  }
                                  height={denseRows ? dim(11) : dim(14)}
                                  style={{
                                    justifySelf:
                                      getTapeCellAlignment(column.id) === "right"
                                        ? "end"
                                        : getTapeCellAlignment(column.id) === "center"
                                          ? "center"
                                          : "start",
                                  }}
                                />
                              ))}
                            </div>
                          ))}
                        </div>
                      ) : filtered.length ? (
                        <>
                          <div style={{ flex: 1, overflowY: "auto" }}>
                            {visibleFlowRows.map((event, index) => {
                              const selected = selectedEvt?.id === event.id;
                              const pinned = pinnedEventId === event.id;
                              const executionMeta = getFlowExecutionMeta(event);
                              return (
                                <div
                                  key={event.id}
                                  data-testid="flow-tape-row"
                                  className={joinMotionClasses(
                                    "ra-row-enter",
                                    "ra-interactive",
                                    (selected || pinned) && "ra-focus-rail",
                                  )}
                                  onClick={() =>
                                    setSelectedEvt((previous) =>
                                      previous?.id === event.id ? null : event,
                                    )
                                  }
                                  onDoubleClick={() => onJumpToTrade?.(event)}
                                  style={{
                                    ...motionRowStyle(index, 7, 120),
                                    ...motionVars({
                                      accent: selected
                                        ? T.accent
                                        : pinned || event.golden
                                          ? T.amber
                                          : executionMeta.color,
                                    }),
                                    display: "grid",
                                    gridTemplateColumns: tapeGridTemplate,
                                    padding: denseRows ? sp("4px 10px") : sp("7px 10px"),
                                    fontSize: denseRows ? fs(9) : fs(10),
                                    fontFamily: T.mono,
                                    columnGap: sp(2),
                                    alignItems: "center",
                                    borderBottom: `1px solid ${T.border}15`,
                                    background: selected
                                      ? `${T.accent}12`
                                      : pinned
                                        ? `${T.amber}10`
                                        : event.golden
                                          ? `${T.amber}0f`
                                          : "transparent",
                                    borderLeft: selected
                                      ? `2px solid ${T.accent}`
                                      : pinned
                                        ? `2px solid ${T.amber}`
                                        : event.golden
                                          ? `2px solid ${T.amber}`
                                          : "2px solid transparent",
                                    cursor: "pointer",
                                  }}
                                  onMouseEnter={(entry) => {
                                    if (!selected) {
                                      entry.currentTarget.style.background = pinned
                                        ? `${T.amber}18`
                                        : event.golden
                                          ? `${T.amber}18`
                                          : T.bg2;
                                    }
                                  }}
                                  onMouseLeave={(entry) => {
                                    entry.currentTarget.style.background = selected
                                      ? `${T.accent}12`
                                      : pinned
                                        ? `${T.amber}10`
                                        : event.golden
                                          ? `${T.amber}0f`
                                          : "transparent";
                                  }}
                                >
                                  {tapeColumns.map((column) => (
                                    <div
                                      key={`${event.id}_${column.id}`}
                                      style={getTapeCellStyle(column.id)}
                                    >
                                      {renderTapeCell(column.id, event)}
                                    </div>
                                  ))}
                                </div>
                              );
                            })}
                          </div>

                          {filtered.length > rowsPerPage ? (
                            <div
                              style={{
                                padding: sp("6px 10px"),
                                borderTop: `1px solid ${T.border}`,
                                fontSize: fs(8),
                                color: T.textDim,
                                fontFamily: T.mono,
                              }}
                            >
                              Showing the first {rowsPerPage} matching prints. Narrow the scanner
                              or increase row count to inspect more.
                            </div>
                          ) : null}
                        </>
                      ) : (
                        <div style={{ padding: sp(12) }}>
                          <DataUnavailableState
                            title={
                              flowEvents.length
                                ? "No prints match this scanner"
                                : "No live options activity"
                            }
                            detail={
                              flowEvents.length
                                ? "Adjust include/exclude tickers, minimum premium, or flow-type filters to widen the tape."
                                : emptyFlowDetail
                            }
                          />
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            </Card>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
            {shouldRenderDeferredPanels ? (
              <>
                <Card style={{ padding: "6px 8px", display: "flex", flexDirection: "column", gap: sp(5) }}>
              <CardTitle
                right={
                  activeTicker ? (
                    <MarketIdentityInline
                      ticker={activeTicker}
                      size={14}
                      showChips={false}
                      style={{ fontSize: fs(8) }}
                    />
                  ) : (
                    <span
                      style={{
                        fontSize: fs(8),
                        color: T.textDim,
                        fontFamily: T.mono,
                      }}
                    >
                      No ticker
                    </span>
                  )
                }
              >
                Signal Context
              </CardTitle>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                  gap: sp(6),
                }}
              >
                {[
                  {
                    label: "Total premium",
                    value: fmtM(selectedTickerSummary.totalPremium),
                    color: T.text,
                  },
                  {
                    label: "Call / put",
                    value: `${fmtM(selectedCallPremium)} / ${fmtM(selectedPutPremium)}`,
                    color: selectedCallPremium >= selectedPutPremium ? T.green : T.red,
                  },
                  {
                    label: "Unusual",
                    value: selectedTickerSummary.unusualCount,
                    color: T.amber,
                  },
                  {
                    label: "0DTE",
                    value: selectedTickerSummary.zeroDteCount,
                    color: T.cyan,
                  },
                ].map((metric) => (
                  <div
                    key={metric.label}
                    style={{
                      border: `1px solid ${T.border}`,
                      background: T.bg1,
                      padding: sp("6px 8px"),
                    }}
                  >
                    <div
                      style={{
                        fontSize: fs(7),
                        fontFamily: T.mono,
                        color: T.textDim,
                        marginBottom: sp(2),
                      }}
                    >
                      {metric.label.toUpperCase()}
                    </div>
                    <div
                      style={{
                        fontSize: fs(11),
                        fontWeight: 800,
                        color: metric.color,
                        fontFamily: T.mono,
                      }}
                    >
                      {metric.value}
                    </div>
                  </div>
                ))}
              </div>
                  {selectedEvt ? (
                    <div
                      style={{
                        padding: sp("8px 9px"),
                        border: `1px solid ${T.border}`,
                        background: T.bg1,
                        display: "flex",
                        flexDirection: "column",
                        gap: sp(4),
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          gap: sp(6),
                        }}
                      >
                        <span
                          style={{
                            fontSize: fs(11),
                            fontWeight: 700,
                            fontFamily: T.mono,
                            color: T.text,
                          }}
                        >
                          {selectedEvt.ticker} {selectedEvt.cp}
                          {selectedEvt.strike}
                        </span>
                        <Badge color={getFlowExecutionMeta(selectedEvt).color}>
                          {getFlowExecutionMeta(selectedEvt).label}
                        </Badge>
                      </div>
                      <div
                        style={{
                          display: "flex",
                          gap: sp(4),
                          flexWrap: "wrap",
                        }}
                      >
                        <Badge color={selectedEvt.cp === "C" ? T.green : T.red}>
                          {selectedEvt.side}
                        </Badge>
                        <Badge color={flowProviderColor(selectedEvt.provider)}>
                          {selectedEvt.sourceLabel}
                        </Badge>
                        <Badge color={selectedEvt.type === "SWEEP" ? T.amber : T.accent}>
                          {selectedEvt.type}
                        </Badge>
                        <Badge
                          color={
                            selectedEvt.score >= 80
                              ? T.amber
                              : selectedEvt.score >= 60
                                ? T.green
                                : T.textDim
                          }
                        >
                          {selectedEvt.score}
                        </Badge>
                      </div>
                      <button
                        type="button"
                        onClick={() => onJumpToTrade?.(selectedEvt)}
                        style={{
                          ...toolbarChipStyle(false, T.accent),
                          alignSelf: "flex-start",
                          color: T.accent,
                        }}
                      >
                        Open in Trade
                      </button>
                    </div>
                  ) : null}
                </Card>

                <Card
                  data-testid="flow-ticker-lens"
                  style={{
                    padding: "6px 8px",
                    display: "flex",
                    flexDirection: "column",
                    gap: sp(5),
                  }}
                >
                  <CardTitle
                    right={
                      <span style={{ fontSize: fs(8), color: T.textDim, fontFamily: T.mono }}>
                        {selectedTickerEvents.length} rows
                      </span>
                    }
                  >
                    Ticker Flow Lens
                  </CardTitle>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                      gap: sp(6),
                    }}
                  >
                    {[
                      {
                        label: "Ask premium",
                        value: fmtM(selectedTickerSideSplit.askPremium),
                        sub: `${selectedTickerSideSplit.askCount} prints`,
                        color: T.green,
                      },
                      {
                        label: "Bid premium",
                        value: fmtM(selectedTickerSideSplit.bidPremium),
                        sub: `${selectedTickerSideSplit.bidCount} prints`,
                        color: T.red,
                      },
                      {
                        label: "Call premium",
                        value: fmtM(selectedCallPremium),
                        sub: `${selectedTickerEvents.filter((event) => event.cp === "C").length} calls`,
                        color: T.green,
                      },
                      {
                        label: "Put premium",
                        value: fmtM(selectedPutPremium),
                        sub: `${selectedTickerEvents.filter((event) => event.cp === "P").length} puts`,
                        color: T.red,
                      },
                    ].map((metric) => (
                      <div
                        key={metric.label}
                        style={{
                          padding: sp("6px 7px"),
                          background: T.bg1,
                          border: `1px solid ${T.border}`,
                        }}
                      >
                        <div style={{ fontSize: fs(7), color: T.textDim, fontFamily: T.mono }}>
                          {metric.label.toUpperCase()}
                        </div>
                        <div
                          style={{
                            fontSize: fs(11),
                            fontWeight: 800,
                            fontFamily: T.mono,
                            color: metric.color,
                            marginTop: sp(1),
                          }}
                        >
                          {metric.value}
                        </div>
                        <div style={{ fontSize: fs(8), color: T.textDim, fontFamily: T.mono }}>
                          {metric.sub}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: sp(4) }}>
                    {expiryConcentration.length ? (
                      expiryConcentration.map((expiry) => {
                        const total = expiry.calls + expiry.puts || 1;
                        const callPct = (expiry.calls / total) * 100;
                        return (
                          <button
                            key={`lens_exp_${expiry.label}`}
                            type="button"
                            onClick={() => {
                              const match = selectedTickerEvents.find(
                                (event) =>
                                  formatExpirationLabel(event.expirationDate) ===
                                  expiry.label,
                              );
                              if (match) setSelectedEvt(match);
                            }}
                            style={{
                              display: "grid",
                              gridTemplateColumns: "54px minmax(0, 1fr) auto",
                              gap: sp(6),
                              alignItems: "center",
                              background: T.bg1,
                              border: `1px solid ${T.border}`,
                              padding: sp("5px 6px"),
                              cursor: "pointer",
                            }}
                          >
                            <span style={{ color: T.textSec, fontFamily: T.mono, fontSize: fs(8), fontWeight: 800 }}>
                              {expiry.label}
                            </span>
                            <span style={{ display: "flex", height: dim(6), background: T.bg3, overflow: "hidden" }}>
                              <span style={{ width: `${callPct}%`, background: T.green }} />
                              <span style={{ flex: 1, background: T.red }} />
                            </span>
                            <span style={{ color: T.textDim, fontFamily: T.mono, fontSize: fs(8) }}>
                              {fmtM(expiry.premium)}
                            </span>
                          </button>
                        );
                      })
                    ) : (
                      <span style={{ color: T.textDim, fontFamily: T.mono, fontSize: fs(8) }}>
                        No expiry ladder for the selected ticker yet.
                      </span>
                    )}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: sp(5) }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: sp(3) }}>
                      <span style={panelLabelStyle}>TOP STRIKES</span>
                      {strikeConcentration.slice(0, 3).map((strike) => (
                        <button
                          key={`lens_strike_${strike.key}`}
                          type="button"
                          onClick={() => setSelectedEvt(strike.event)}
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            gap: sp(4),
                            background: T.bg1,
                            border: `1px solid ${T.border}`,
                            color: T.textDim,
                            fontFamily: T.mono,
                            fontSize: fs(8),
                            padding: sp("4px 5px"),
                            cursor: "pointer",
                          }}
                        >
                          <span style={{ color: strike.event.cp === "C" ? T.green : T.red }}>
                            {strike.label}
                          </span>
                          <span>{fmtM(strike.premium)}</span>
                        </button>
                      ))}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: sp(3) }}>
                      <span style={panelLabelStyle}>TOP CONTRACTS</span>
                      {(topContractsByTicker[activeTicker] || []).slice(0, 3).map((contract) => (
                        <button
                          key={`lens_contract_${activeTicker}_${contract.key}`}
                          type="button"
                          onClick={() => setSelectedEvt(contract.biggestEvt)}
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            gap: sp(4),
                            background: T.bg1,
                            border: `1px solid ${T.border}`,
                            color: T.textDim,
                            fontFamily: T.mono,
                            fontSize: fs(8),
                            padding: sp("4px 5px"),
                            cursor: "pointer",
                          }}
                        >
                          <span style={{ color: contract.cp === "C" ? T.green : T.red }}>
                            {contract.cp}
                            {contract.strike}
                          </span>
                          <span>{contract.count}x</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </Card>

                <Card style={{ padding: "6px 8px", display: "flex", flexDirection: "column", gap: sp(5) }}>
              <CardTitle>Execution Stats</CardTitle>
              <div style={{ display: "grid", gridTemplateColumns: metricGridTemplate, gap: sp(6) }}>
                {[
                  { label: "Ask / buy", value: executionStats.askCount, sub: fmtM(executionStats.askPrem), color: T.green },
                  { label: "Bid / sell", value: executionStats.bidCount, sub: fmtM(executionStats.bidPrem), color: T.red },
                  { label: "Mid / other", value: executionStats.midCount, sub: fmtM(executionStats.midPrem), color: T.textDim },
                ].map((metric) => (
                  <div key={metric.label} style={{ padding: sp("6px 7px"), background: T.bg1, border: `1px solid ${T.border}` }}>
                    <div style={{ fontSize: fs(7), color: T.textDim, fontFamily: T.mono }}>{metric.label.toUpperCase()}</div>
                    <div style={{ fontSize: fs(12), fontWeight: 800, fontFamily: T.mono, color: metric.color, marginTop: sp(1) }}>{metric.value}</div>
                    <div style={{ fontSize: fs(8), color: T.textDim, fontFamily: T.mono }}>{metric.sub}</div>
                  </div>
                ))}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: sp(6) }}>
                <div style={{ padding: sp("6px 7px"), background: T.bg1, border: `1px solid ${T.border}` }}>
                  <div style={{ fontSize: fs(7), color: T.textDim, fontFamily: T.mono }}>SWEEP / BLOCK</div>
                  <div style={{ fontSize: fs(10), fontWeight: 700, fontFamily: T.mono, color: T.text }}>
                    {executionStats.sweepCount} / {executionStats.blockCount}
                  </div>
                  <div style={{ fontSize: fs(8), color: T.textDim, fontFamily: T.mono }}>
                    {fmtM(executionStats.sweepPrem)} / {fmtM(executionStats.blockPrem)}
                  </div>
                </div>
                <div style={{ padding: sp("6px 7px"), background: T.bg1, border: `1px solid ${T.border}` }}>
                  <div style={{ fontSize: fs(7), color: T.textDim, fontFamily: T.mono }}>AVG SIZE / TOP EXP</div>
                  <div style={{ fontSize: fs(10), fontWeight: 700, fontFamily: T.mono, color: T.text }}>
                    {isFiniteNumber(executionStats.avgSize)
                      ? fmtCompactNumber(executionStats.avgSize)
                      : MISSING_VALUE}
                  </div>
                  <div style={{ fontSize: fs(8), color: T.textDim, fontFamily: T.mono }}>
                    {executionStats.topExpiration}
                  </div>
                </div>
              </div>
              <div style={{ fontSize: fs(8), color: T.textDim, fontFamily: T.mono }}>
                Basis mix · trade {executionStats.tradeCount} · snapshot {executionStats.snapshotCount}
              </div>
                </Card>

                <Card style={{ padding: "6px 8px", display: "flex", flexDirection: "column", gap: sp(4) }}>
              <CardTitle
                right={
                  <span style={{ fontSize: fs(8), color: T.textDim, fontFamily: T.mono }}>
                    ranked
                  </span>
                }
              >
                Why It Matters
              </CardTitle>
                  {signalQueue.map(({ event, actionScore, cluster }) => (
                    <button
                      key={event.id}
                      type="button"
                      onClick={() => setSelectedEvt(event)}
                      style={{
                        width: "100%",
                        textAlign: "left",
                        background: T.bg1,
                        border: `1px solid ${selectedEvt?.id === event.id ? T.accent : T.border}`,
                        padding: sp("7px 8px"),
                        cursor: "pointer",
                        display: "flex",
                        flexDirection: "column",
                        gap: sp(3),
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", gap: sp(6) }}>
                        <span style={{ fontSize: fs(10), fontWeight: 800, fontFamily: T.mono, color: T.text }}>
                          {event.ticker} {event.cp}
                          {event.strike}
                        </span>
                        <span style={{ fontSize: fs(8), fontFamily: T.mono, color: T.amber, fontWeight: 700 }}>
                          {actionScore.toFixed(0)}
                        </span>
                      </div>
                      <div style={{ display: "flex", gap: sp(4), flexWrap: "wrap" }}>
                        <Badge color={getFlowExecutionMeta(event).color}>
                          {getFlowExecutionMeta(event).label}
                        </Badge>
                        <Badge color={event.type === "SWEEP" ? T.amber : T.accent}>
                          {event.type}
                        </Badge>
                        {event.isUnusual ? <Badge color={T.cyan}>VOL/OI</Badge> : null}
                        {cluster ? <Badge color={T.cyan}>Repeat {cluster.count}×</Badge> : null}
                      </div>
                      <div style={{ fontSize: fs(8), color: T.textDim, fontFamily: T.mono }}>
                        {fmtM(event.premium)} · {event.time} ET · {event.dte}d
                      </div>
                    </button>
                  ))}
                </Card>

                <Card style={{ padding: "6px 8px", display: "flex", flexDirection: "column", gap: sp(5) }}>
              <CardTitle
                right={
                  <span style={{ fontSize: fs(8), color: T.textDim, fontFamily: T.mono }}>
                    {activeTicker || "market"}
                  </span>
                }
              >
                Catalyst Context
              </CardTitle>
                  {activateNews ? (
                    selectedNewsItems.length ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: sp(5) }}>
                        {selectedNewsItems.map((item) => (
                          <a
                            key={item.id}
                            href={item.articleUrl}
                            target="_blank"
                            rel="noreferrer"
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              gap: sp(2),
                              padding: sp("6px 7px"),
                              textDecoration: "none",
                              color: T.text,
                              background: T.bg1,
                              border: `1px solid ${T.border}`,
                            }}
                          >
                            <div style={{ display: "flex", justifyContent: "space-between", gap: sp(6) }}>
                              <span style={{ fontSize: fs(8), fontFamily: T.mono, color: T.textDim }}>
                                {item.tag}
                              </span>
                              <span
                                style={{
                                  fontSize: fs(8),
                                  fontFamily: T.mono,
                                  color:
                                    item.sentimentScore > 0
                                      ? T.green
                                      : item.sentimentScore < 0
                                        ? T.red
                                        : T.textDim,
                                }}
                              >
                                {item.time}
                              </span>
                            </div>
                            <span style={{ fontSize: fs(10), lineHeight: 1.35 }}>{item.title}</span>
                            {item.publisher ? (
                              <span style={{ fontSize: fs(8), color: T.textDim, fontFamily: T.mono }}>
                                {item.publisher}
                              </span>
                            ) : null}
                          </a>
                        ))}
                      </div>
                    ) : (
                      <DataUnavailableState
                        title="No recent catalysts"
                        detail="Recent market news will appear here and anchor to the selected ticker when a symbol match exists."
                      />
                    )
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: sp(5) }}>
                      <FlowLoadingBlock width="40%" />
                      <FlowLoadingBlock height={dim(14)} />
                      <FlowLoadingBlock height={dim(14)} width="88%" />
                      <FlowLoadingBlock height={dim(14)} width="76%" />
                    </div>
                  )}
              <div style={{ display: "flex", gap: sp(4), flexWrap: "wrap" }}>
                {[
                  { label: "News", value: "Live", color: T.green },
                  { label: "Dark pool", value: "Not wired", color: T.textDim },
                  { label: "Insider", value: "Not wired", color: T.textDim },
                ].map((item) => (
                  <span
                    key={item.label}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: sp(3),
                      padding: sp("2px 6px"),
                      borderRadius: dim(3),
                      background: `${item.color}12`,
                      border: `1px solid ${item.color}25`,
                      color: item.color,
                      fontSize: fs(8),
                      fontFamily: T.mono,
                    }}
                  >
                    {item.label} · {item.value}
                  </span>
                ))}
              </div>
                </Card>

                <Card style={{ padding: "6px 8px", display: "flex", flexDirection: "column", gap: sp(5) }}>
              <CardTitle>Strike + Sector Map</CardTitle>
              <div style={{ display: "flex", flexDirection: "column", gap: sp(4) }}>
                {strikeConcentration.length ? (
                  strikeConcentration.map((strike) => (
                    <div
                      key={strike.key}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: sp(6),
                        padding: sp("5px 6px"),
                        background: T.bg1,
                        border: `1px solid ${T.border}`,
                      }}
                    >
                      <span
                        style={{
                          fontSize: fs(9),
                          fontWeight: 700,
                          fontFamily: T.mono,
                          color: strike.event.cp === "C" ? T.green : T.red,
                        }}
                      >
                        {strike.label}
                      </span>
                      <span style={{ fontSize: fs(8), color: T.textDim, fontFamily: T.mono }}>
                        {strike.count} prints · {fmtM(strike.premium)}
                      </span>
                    </div>
                  ))
                ) : (
                  <div style={{ fontSize: fs(8), color: T.textDim, fontFamily: T.mono }}>
                    No strike concentration yet for the selected ticker.
                  </div>
                )}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: sp(4) }}>
                {sectorFlow.slice(0, 4).map((sector) => {
                  const total = sector.calls + sector.puts;
                  const bullish = sector.calls - sector.puts;
                  const callPct = total ? (sector.calls / total) * 100 : 50;
                  return (
                    <div key={sector.sector} style={{ display: "flex", flexDirection: "column", gap: sp(2) }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: fs(8), fontFamily: T.mono }}>
                        <span style={{ color: T.text }}>{sector.sector}</span>
                        <span style={{ color: bullish >= 0 ? T.green : T.red }}>
                          {bullish >= 0 ? "+" : "-"}
                          {fmtM(Math.abs(bullish))}
                        </span>
                      </div>
                      <div style={{ display: "flex", height: dim(6), overflow: "hidden", background: T.bg3 }}>
                        <div style={{ width: `${callPct}%`, background: T.green }} />
                        <div style={{ flex: 1, background: T.red }} />
                      </div>
                    </div>
                  );
                })}
              </div>
                </Card>
              </>
            ) : (
              <>
                <FlowPlaceholderCard title="Signal Context" rows={4} />
                <FlowPlaceholderCard title="Execution Stats" rows={4} />
                <FlowPlaceholderCard title="Why It Matters" rows={4} />
                <FlowPlaceholderCard title="Catalyst Context" rows={4} />
                <FlowPlaceholderCard title="Strike + Sector Map" rows={5} />
              </>
            )}
          </div>
        </div>

        {shouldRenderDeferredPanels ? (
          <>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: summaryGridTemplate,
                gap: 6,
              }}
            >
              {summaryCards.map((card) => (
                <Card key={card.label} style={{ padding: "6px 9px" }}>
                  <div
                    style={{
                      fontSize: fs(7),
                      fontWeight: 600,
                      color: T.textDim,
                      letterSpacing: "0.06em",
                      fontVariant: "all-small-caps",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {card.label}
                  </div>
                  <div
                    style={{
                      fontSize: fs(16),
                      fontWeight: 800,
                      fontFamily: T.mono,
                      color: card.color,
                      marginTop: sp(2),
                    }}
                  >
                    {card.value}
                  </div>
                  <div
                    style={{
                      fontSize: fs(8),
                      color: T.textDim,
                      fontFamily: T.sans,
                      marginTop: sp(1),
                    }}
                  >
                    {card.sub}
                  </div>
                </Card>
              ))}
            </div>
            <div
              style={{ display: "grid", gridTemplateColumns: insightGridTemplate, gap: 6 }}
            >
              <div
                style={{
                  background: T.bg2,
                  border: `1px solid ${T.border}`,
                  borderRadius: dim(6),
                  padding: sp("8px 10px"),
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 6,
                  }}
                >
                  <span
                    style={{
                      fontSize: fs(10),
                      fontWeight: 700,
                      fontFamily: T.display,
                      color: T.textSec,
                    }}
                  >
                    Premium Tide
                  </span>
                  <div
                    style={{
                      display: "flex",
                      gap: sp(8),
                      fontSize: fs(9),
                      fontFamily: T.mono,
                    }}
                  >
                    <span style={{ color: T.green }}>■ Calls {fmtM(totalCallPrem)}</span>
                    <span style={{ color: T.red }}>■ Puts {fmtM(totalPutPrem)}</span>
                    <span style={{ color: T.accent, fontWeight: 700 }}>
                      Net {netPrem >= 0 ? "+" : ""}
                      {fmtM(Math.abs(netPrem))}
                    </span>
                  </div>
                </div>
                <div style={{ height: dim(200), width: "100%" }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={flowTide}>
                      <XAxis
                        dataKey="time"
                        tick={{ fontSize: fs(9), fill: T.textMuted }}
                      />
                      <YAxis
                        tick={{ fontSize: fs(9), fill: T.textMuted }}
                        tickFormatter={(value) => `${(value / 1e6).toFixed(1)}M`}
                      />
                      <Tooltip
                        contentStyle={chartTooltipContentStyle}
                        formatter={(value) =>
                          `${value >= 0 ? "+" : ""}$${(value / 1e6).toFixed(2)}M`
                        }
                      />
                      <ReferenceLine
                        y={0}
                        stroke={T.textMuted}
                        strokeDasharray="2 2"
                      />
                      <Area
                        type="monotone"
                        dataKey="cumNet"
                        stroke={T.accent}
                        strokeWidth={2}
                        fill={T.accent}
                        fillOpacity={0.4}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <Card style={{ padding: "8px 10px" }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 6,
                  }}
                >
                  <span
                    style={{
                      fontSize: fs(10),
                      fontWeight: 700,
                      fontFamily: T.display,
                      color: T.textSec,
                    }}
                  >
                    Ticker Leaders
                  </span>
                  <span
                    style={{
                      fontSize: fs(8),
                      color: T.textDim,
                      fontFamily: T.mono,
                    }}
                  >
                    top contracts inline
                  </span>
                </div>
                {tickerFlow.map((ticker) => {
                  const total = ticker.calls + ticker.puts;
                  const net = ticker.calls - ticker.puts;
                  const callPct = total ? (ticker.calls / total) * 100 : 50;
                  const barWidth = (total / maxTickerPrem) * 100;
                  const topContracts = topContractsByTicker[ticker.sym] || [];
                  return (
                    <div
                      key={ticker.sym}
                      style={{
                        marginBottom: sp(6),
                        paddingBottom: sp(4),
                        borderBottom: `1px solid ${T.border}30`,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          fontSize: fs(9),
                          fontFamily: T.mono,
                          marginBottom: sp(1),
                        }}
                      >
                        <MarketIdentityInline
                          ticker={ticker.sym}
                          size={14}
                          showChips={false}
                        />
                        <span
                          style={{
                            color: net >= 0 ? T.green : T.red,
                            fontWeight: 600,
                          }}
                        >
                          {net >= 0 ? "+" : "-"}
                          {fmtM(Math.abs(net))}
                        </span>
                      </div>
                      <div
                        style={{
                          display: "flex",
                          height: dim(8),
                          borderRadius: dim(2),
                          overflow: "hidden",
                          background: T.bg3,
                          width: `${barWidth}%`,
                          marginBottom: sp(3),
                        }}
                      >
                        <div
                          style={{
                            width: `${callPct}%`,
                            background: T.green,
                            height: "100%",
                          }}
                        />
                        <div style={{ flex: 1, background: T.red, height: "100%" }} />
                      </div>
                      {topContracts.length ? (
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: isMobileFlowLayout
                              ? "minmax(0, 1fr)"
                              : "repeat(3, 1fr)",
                            gap: sp(3),
                          }}
                        >
                          {topContracts.map((contract) => {
                            const cpColor = contract.cp === "C" ? T.green : T.red;
                            const volLabel =
                              contract.vol >= 1000
                                ? `${(contract.vol / 1000).toFixed(1)}K`
                                : `${contract.vol}`;
                            return (
                              <AppTooltip key={`${ticker.sym}_${contract.key}`} content={`${ticker.sym} ${contract.strike}${contract.cp} · ${fmtM(contract.premium)}`}><div
                                key={`${ticker.sym}_${contract.key}`}
                                onClick={() => setSelectedEvt(contract.biggestEvt)}
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: sp(4),
                                  padding: sp("4px 6px"),
                                  background: `${cpColor}08`,
                                  border: `1px solid ${cpColor}30`,
                                  borderLeft: `2px solid ${cpColor}`,
                                  cursor: "pointer",
                                }}
                              >
                                <span
                                  style={{
                                    fontSize: fs(10),
                                    fontWeight: 800,
                                    fontFamily: T.mono,
                                    color: cpColor,
                                  }}
                                >
                                  {contract.cp}
                                  {contract.strike}
                                </span>
                                <div
                                  style={{
                                    flex: 1,
                                    display: "flex",
                                    justifyContent: "space-between",
                                    fontSize: fs(8),
                                    fontFamily: T.mono,
                                    color: T.textDim,
                                  }}
                                >
                                  <span>{volLabel}</span>
                                  <span>{contract.dte}d</span>
                                </div>
                              </div></AppTooltip>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </Card>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: metricGridTemplate,
                gap: 6,
              }}
            >
              <div
                style={{
                  background: T.bg2,
                  border: `1px solid ${T.border}`,
                  borderRadius: dim(6),
                  padding: "6px 10px",
                }}
              >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 4,
              }}
            >
              <span
                style={{
                  fontSize: fs(10),
                  fontWeight: 700,
                  fontFamily: T.display,
                  color: T.textSec,
                }}
              >
                Flow Clock
              </span>
              <span
                style={{
                  fontSize: fs(8),
                  color: T.textDim,
                  fontFamily: T.mono,
                }}
              >
                activity by time
              </span>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "flex-end",
                gap: sp(2),
                height: dim(72),
                padding: "0 2px",
              }}
            >
              {flowClock.map((bucket, index) => {
                const maxCount = Math.max(...flowClock.map((item) => item.count), 1);
                const heightPct = (bucket.count / maxCount) * 100;
                const color =
                  bucket.prem > 1500000
                    ? T.amber
                    : bucket.prem > 1000000
                      ? T.accent
                      : T.textDim;
                return (
                  <div
                    key={index}
                    style={{
                      flex: 1,
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "flex-end",
                      height: "100%",
                    }}
                  >
                    <div
                      style={{
                        height: `${heightPct}%`,
                        background: color,
                        borderRadius: "2px 2px 0 0",
                        minHeight: 2,
                        opacity: 0.85,
                      }}
                    />
                  </div>
                );
              })}
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: fs(7),
                color: T.textMuted,
                fontFamily: T.mono,
                marginTop: sp(2),
                padding: "0 2px",
              }}
            >
              <span>9:30</span>
              <span>12:00</span>
              <span>16:00</span>
            </div>
            <div
              style={{
                marginTop: sp(2),
                padding: sp("3px 6px"),
                background: T.bg3,
                borderRadius: dim(3),
                fontSize: fs(8),
                fontFamily: T.mono,
                color: T.textDim,
                display: "flex",
                justifyContent: "space-between",
              }}
            >
              <span>
                Peak{" "}
                <span style={{ color: T.amber, fontWeight: 600 }}>
                  {flowClockPeak}
                </span>
              </span>
              <span>
                Avg{" "}
                <span style={{ color: T.textSec, fontWeight: 600 }}>
                  {flowClockAverage}/30m
                </span>
              </span>
            </div>
          </div>

          <div
            style={{
              background: T.bg2,
              border: `1px solid ${T.border}`,
              borderRadius: dim(6),
              padding: "6px 10px",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 4,
              }}
            >
              <span
                style={{
                  fontSize: fs(10),
                  fontWeight: 700,
                  fontFamily: T.display,
                  color: T.textSec,
                }}
              >
                Order Flow
              </span>
              <span
                style={{
                  fontSize: fs(8),
                  color: T.textDim,
                  fontFamily: T.mono,
                }}
              >
                by trade size
              </span>
            </div>
            {(() => {
              const buy =
                marketOrderFlow.buyXL +
                marketOrderFlow.buyL +
                marketOrderFlow.buyM +
                marketOrderFlow.buyS;
              const sell =
                marketOrderFlow.sellXL +
                marketOrderFlow.sellL +
                marketOrderFlow.sellM +
                marketOrderFlow.sellS;
              const buyPct = buy + sell ? (buy / (buy + sell)) * 100 : 50;
              const maxValue = Math.max(
                marketOrderFlow.buyXL,
                marketOrderFlow.buyL,
                marketOrderFlow.buyM,
                marketOrderFlow.buyS,
                marketOrderFlow.sellXL,
                marketOrderFlow.sellL,
                marketOrderFlow.sellM,
                marketOrderFlow.sellS,
                1,
              );
              return (
                <>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: sp(8),
                      marginBottom: sp(2),
                    }}
                  >
                    <OrderFlowDonut
                      flow={marketOrderFlow}
                      size={dim(64)}
                      thickness={dim(10)}
                    />
                    <div
                      style={{
                        flex: 1,
                        display: "flex",
                        flexDirection: "column",
                        gap: sp(2),
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          fontFamily: T.mono,
                          fontSize: fs(10),
                        }}
                      >
                        <span style={{ color: T.green, fontWeight: 700 }}>
                          ${buy.toFixed(0)}M
                        </span>
                        <span style={{ color: T.red, fontWeight: 700 }}>
                          ${sell.toFixed(0)}M
                        </span>
                      </div>
                      <div
                        style={{
                          display: "flex",
                          height: dim(4),
                          borderRadius: dim(2),
                          overflow: "hidden",
                          background: T.bg3,
                        }}
                      >
                        <div
                          style={{
                            width: `${buyPct}%`,
                            background: T.green,
                            opacity: 0.85,
                          }}
                        />
                        <div
                          style={{
                            width: `${100 - buyPct}%`,
                            background: T.red,
                            opacity: 0.85,
                          }}
                        />
                      </div>
                      <div
                        style={{
                          fontSize: fs(8),
                          color: T.textDim,
                          fontFamily: T.mono,
                        }}
                      >
                        {buyPct.toFixed(1)}% buy ·{" "}
                        <span
                          style={{
                            color: buy >= sell ? T.green : T.red,
                            fontWeight: 600,
                          }}
                        >
                          {buy >= sell ? "BULLISH" : "BEARISH"}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div
                    style={{
                      borderTop: `1px solid ${T.border}`,
                      paddingTop: sp(2),
                    }}
                  >
                    <SizeBucketRow
                      label="XL"
                      buy={marketOrderFlow.buyXL}
                      sell={marketOrderFlow.sellXL}
                      maxValue={maxValue}
                    />
                    <SizeBucketRow
                      label="L"
                      buy={marketOrderFlow.buyL}
                      sell={marketOrderFlow.sellL}
                      maxValue={maxValue}
                    />
                    <SizeBucketRow
                      label="M"
                      buy={marketOrderFlow.buyM}
                      sell={marketOrderFlow.sellM}
                      maxValue={maxValue}
                    />
                    <SizeBucketRow
                      label="S"
                      buy={marketOrderFlow.buyS}
                      sell={marketOrderFlow.sellS}
                      maxValue={maxValue}
                    />
                  </div>
                </>
              );
            })()}
          </div>

          <div
            style={{
              background: T.bg2,
              border: `1px solid ${T.border}`,
              borderRadius: dim(6),
              padding: "6px 10px",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 4,
              }}
            >
              <span
                style={{
                  fontSize: fs(10),
                  fontWeight: 700,
                  fontFamily: T.display,
                  color: T.textSec,
                }}
              >
                Expiration Buckets
              </span>
              <span
                style={{
                  fontSize: fs(8),
                  color: T.textDim,
                  fontFamily: T.mono,
                }}
              >
                calls vs puts
              </span>
            </div>
            <div>
              {dteBuckets.map((bucket) => {
                const total = bucket.calls + bucket.puts;
                const callPct = total ? (bucket.calls / total) * 100 : 50;
                const maxTotal = Math.max(
                  1,
                  ...dteBuckets.map((item) => item.calls + item.puts),
                );
                const barWidth = (total / maxTotal) * 100;
                return (
                  <div key={bucket.bucket} style={{ marginBottom: 2 }}>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        fontSize: fs(8),
                        fontFamily: T.mono,
                        marginBottom: 1,
                      }}
                    >
                      <span style={{ color: T.textSec, fontWeight: 600 }}>
                        {bucket.bucket === "0DTE" ? (
                          <span style={{ color: T.amber, marginRight: 3 }}>⚡</span>
                        ) : null}
                        {bucket.bucket}
                      </span>
                      <span style={{ color: T.textDim }}>
                        {bucket.count} prints · {fmtM(total)}
                      </span>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        height: dim(7),
                        borderRadius: dim(2),
                        overflow: "hidden",
                        background: T.bg3,
                        width: `${barWidth}%`,
                      }}
                    >
                      <div
                        style={{
                          width: `${callPct}%`,
                          background: T.green,
                          opacity: 0.85,
                        }}
                      />
                      <div style={{ flex: 1, background: T.red, opacity: 0.85 }} />
                    </div>
                  </div>
                );
              })}
            </div>
              </div>
            </div>
          </>
        ) : (
          <>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: summaryGridTemplate,
                gap: 6,
              }}
            >
              {Array.from({ length: 6 }).map((_, index) => (
                <FlowPlaceholderCard key={`summary_${index}`} title="Loading" rows={2} dense />
              ))}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: insightGridTemplate, gap: 6 }}>
              <FlowPlaceholderCard title="Premium Tide" rows={6} />
              <FlowPlaceholderCard title="Ticker Leaders" rows={6} />
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: metricGridTemplate,
                gap: 6,
              }}
            >
              <FlowPlaceholderCard title="Flow Clock" rows={5} />
              <FlowPlaceholderCard title="Order Flow" rows={5} />
              <FlowPlaceholderCard title="Expiration Buckets" rows={5} />
            </div>
          </>
        )}

        {flowScannerPanelVisible ? (
          <UnusualScannerSection
            formatFlowAppTime={formatFlowAppTime}
            onJumpToTrade={onJumpToTrade}
            session={session}
            symbols={symbols}
            scannerConfig={flowScannerControl.config}
          />
        ) : null}
      </div>
    </div>
  );
};

const UnusualScannerSection = ({
  formatFlowAppTime: formatFlowAppTimeProp,
  onJumpToTrade,
  session,
  symbols = [],
  scannerConfig = DEFAULT_FLOW_SCANNER_CONFIG,
}) => {
  const { preferences: scannerUserPreferences } = useUserPreferences();
  const formatScannerAppTime = useCallback(
    (value) =>
      typeof formatFlowAppTimeProp === "function"
        ? formatFlowAppTimeProp(value)
        : formatAppTimeForPreferences(value, scannerUserPreferences),
    [formatFlowAppTimeProp, scannerUserPreferences],
  );
  const [sortBy, setSortBy] = useState(
    () =>
      _initialState.flowUnusualSortBy || _initialState.unusualSortBy || "ratio",
  );
  const [sortDir, setSortDir] = useState(
    () =>
      _initialState.flowUnusualSortDir || _initialState.unusualSortDir || "desc",
  );
  const [sideFilter, setSideFilter] = useState(
    () =>
      _initialState.flowUnusualSideFilter ||
      _initialState.unusualSideFilter ||
      "all",
  );

  useEffect(() => {
    persistState({
      flowUnusualSortBy: sortBy,
      flowUnusualSortDir: sortDir,
      flowUnusualSideFilter: sideFilter,
    });
  }, [sideFilter, sortBy, sortDir]);

  const liveFlowSnapshot = useMarketFlowSnapshotForStoreKey(
    BROAD_MARKET_FLOW_STORE_KEY,
  );
  const {
    hasLiveFlow,
    flowStatus,
    providerSummary,
    flowEvents,
  } = liveFlowSnapshot;

  const watchlistSymbols = useMemo(
    () =>
      [
        ...new Set(
          (symbols || [])
            .map((symbol) => symbol?.toUpperCase())
            .filter(Boolean),
        ),
      ],
    [symbols],
  );
  const totalWatchlistSymbols = watchlistSymbols.length;
  const coverage = providerSummary.coverage || {
    totalSymbols: totalWatchlistSymbols,
    scannedSymbols: 0,
    cycleScannedSymbols: 0,
    batchSize: scannerConfig.batchSize,
    currentBatch: [],
    cycle: 0,
    isFetching: false,
    lastScannedAt: {},
    isRotating: totalWatchlistSymbols > scannerConfig.batchSize,
  };
  const totalCoverageSymbols =
    coverage.activeTargetSize ||
    coverage.totalSymbols ||
    totalWatchlistSymbols ||
    0;
  const intendedCoverageSymbols =
    coverage.targetSize || totalCoverageSymbols;
  const selectedCoverageSymbols =
    coverage.selectedSymbols || totalCoverageSymbols;
  const scannedCoverageSymbols =
    coverage.cycleScannedSymbols ?? coverage.scannedSymbols ?? 0;
  const coverageModeLabel =
    coverage.mode === "market" || coverage.mode === "hybrid"
      ? "market-wide"
      : "watchlist";
  const oldestScanAt = useMemo(() => {
    const stamps = Object.values(coverage.lastScannedAt || {});
    if (!stamps.length) return null;
    return Math.min(...stamps);
  }, [coverage.lastScannedAt]);
  const newestScanAt = useMemo(() => {
    const stamps = Object.values(coverage.lastScannedAt || {});
    if (!stamps.length) return null;
    return Math.max(...stamps);
  }, [coverage.lastScannedAt]);

  const unusualEvents = useMemo(
    () => flowEvents.filter((event) => event.isUnusual),
    [flowEvents],
  );

  const filteredEvents = useMemo(() => {
    if (sideFilter === "calls") {
      return unusualEvents.filter((event) => event.cp === "C");
    }
    if (sideFilter === "puts") {
      return unusualEvents.filter((event) => event.cp === "P");
    }
    return unusualEvents;
  }, [sideFilter, unusualEvents]);

  const sortedEvents = useMemo(() => {
    const direction = sortDir === "asc" ? 1 : -1;
    const events = [...filteredEvents];
    events.sort((left, right) => {
      let cmp = 0;
      if (sortBy === "ratio") {
        cmp = (left.unusualScore || 0) - (right.unusualScore || 0);
      } else if (sortBy === "premium") {
        cmp = (left.premium || 0) - (right.premium || 0);
      } else if (sortBy === "dte") {
        const leftDte = Number.isFinite(left.dte) ? left.dte : Infinity;
        const rightDte = Number.isFinite(right.dte) ? right.dte : Infinity;
        cmp = leftDte - rightDte;
      } else if (sortBy === "underlying") {
        cmp = String(left.ticker || "").localeCompare(String(right.ticker || ""));
      }
      if (cmp === 0) {
        cmp = (left.premium || 0) - (right.premium || 0);
      }
      return cmp * direction;
    });
    return events;
  }, [filteredEvents, sortBy, sortDir]);

  const totalPremium = unusualEvents.reduce(
    (sum, event) => sum + (event.premium || 0),
    0,
  );
  const callPremium = unusualEvents.reduce(
    (sum, event) => sum + (event.cp === "C" ? event.premium || 0 : 0),
    0,
  );
  const putPremium = unusualEvents.reduce(
    (sum, event) => sum + (event.cp === "P" ? event.premium || 0 : 0),
    0,
  );
  const uniqueUnderlyings = useMemo(
    () => new Set(unusualEvents.map((event) => event.ticker)).size,
    [unusualEvents],
  );
  const peakRatio = unusualEvents.reduce(
    (best, event) => Math.max(best, event.unusualScore || 0),
    0,
  );

  const ibkrLoginRequired =
    Boolean(session?.configured?.ibkr) &&
    !session?.ibkrBridge?.authenticated &&
    !providerSummary.providers.includes("polygon");
  const flowDisplayLabel =
    !hasLiveFlow && ibkrLoginRequired
      ? "IBKR login required"
      : providerSummary.label === "IBKR snapshot live" &&
          session?.ibkrBridge?.liveMarketDataAvailable === false
        ? "IBKR delayed"
        : providerSummary.label;
  const flowDisplayColor =
    !hasLiveFlow && ibkrLoginRequired
      ? T.amber
      : flowDisplayLabel === "IBKR delayed"
        ? T.amber
        : providerSummary.color;

  const handleSort = (id) => {
    if (sortBy === id) {
      setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
      return;
    }
    setSortBy(id);
    const option = UNUSUAL_SORT_OPTIONS.find((candidate) => candidate.id === id);
    setSortDir(option && !option.numeric ? "asc" : "desc");
  };

  const sortIndicator = (id) =>
    sortBy === id ? (sortDir === "asc" ? " ▲" : " ▼") : "";

  const emptyDetail =
    flowStatus === "loading"
      ? "Scanning the configured Flow universe for contracts where today's volume already exceeds open interest."
      : ibkrLoginRequired
        ? bridgeRuntimeMessage(session)
        : providerSummary.failures[0]?.error
          ? providerSummary.failures[0].error
          : !flowEvents.length
            ? "No live options flow returned for the configured Flow universe yet."
            : "No contracts in the configured Flow universe have volume above open interest right now.";

  const scannerFlowQuality = resolveFlowQuality({
    flowStatus,
    hasLiveFlow,
    providerSummary,
    coverage,
    watchlistSymbols,
    newestScanAt,
    oldestScanAt,
    livePaused: false,
  });

  const scannerStatusPanel = (
    <FlowScannerStatusPanel
      enabled
      ownerActive={coverage.isFetching || flowStatus === "loading"}
      flowDisplayLabel={flowDisplayLabel}
      flowDisplayColor={flowDisplayColor}
      flowQuality={scannerFlowQuality}
      coverage={coverage}
      coverageModeLabel={coverageModeLabel}
      scannedCoverageSymbols={scannedCoverageSymbols}
      totalCoverageSymbols={totalCoverageSymbols}
      intendedCoverageSymbols={intendedCoverageSymbols}
      selectedCoverageSymbols={selectedCoverageSymbols}
      newestScanAt={newestScanAt}
      oldestScanAt={oldestScanAt}
      scannerConfig={scannerConfig}
      toggleTone={flowDisplayColor || T.accent}
      formatAppTime={formatScannerAppTime}
      showToggle={false}
      testId="flow-unusual-scanner-status-panel"
    />
  );

  const kpiCards = [
    {
      label: "UNUSUAL CONTRACTS",
      value: unusualEvents.length,
      sub: `${uniqueUnderlyings} underlying${uniqueUnderlyings === 1 ? "" : "s"}`,
      color: T.amber,
    },
    {
      label: "TOTAL PREMIUM",
      value: fmtM(totalPremium),
      sub: `${fmtM(callPremium)} C · ${fmtM(putPremium)} P`,
      color: T.text,
    },
    {
      label: "PEAK VOL/OI",
      value: peakRatio ? `${peakRatio.toFixed(peakRatio >= 10 ? 0 : 1)}×` : MISSING_VALUE,
      sub: "Highest ratio in scan",
      color: T.cyan,
    },
    {
      label: "CALL / PUT MIX",
      value: `${unusualEvents.filter((event) => event.cp === "C").length} / ${unusualEvents.filter((event) => event.cp === "P").length}`,
      sub: "Calls vs puts",
      color: T.purple,
    },
  ];

  return (
    <>
      {scannerStatusPanel}

      {watchlistSymbols.length > 0 ? (
        <Card style={{ padding: "6px 9px" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              gap: sp(8),
              marginBottom: sp(4),
            }}
          >
            <span
              style={{
                fontSize: fs(8),
                color: T.textDim,
                fontFamily: T.mono,
                letterSpacing: "0.06em",
                fontVariant: "all-small-caps",
                fontWeight: 700,
              }}
            >
              Symbol Coverage
            </span>
            <span style={{ fontSize: fs(8), color: T.textMuted, fontFamily: T.mono }}>
              {scannedCoverageSymbols}/{totalCoverageSymbols || watchlistSymbols.length} cycle
              {coverage.cycle ? ` · cycle ${coverage.cycle}` : ""}
            </span>
          </div>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: sp(4),
              maxHeight: dim(96),
              overflowY: "auto",
            }}
          >
            {watchlistSymbols.map((symbol) => {
              const scannedAt = coverage.lastScannedAt?.[symbol] || null;
              const inFlight = coverage.currentBatch?.includes(symbol);
              const stale =
                scannedAt &&
                oldestScanAt &&
                newestScanAt &&
                newestScanAt - scannedAt > 60_000;
              const tone = inFlight
                ? T.accent
                : !scannedAt
                  ? T.textMuted
                  : stale
                    ? T.amber
                    : T.text;
              const labelText = scannedAt
                ? formatRelativeTimeShort(new Date(scannedAt).toISOString())
                : "pending";
              const tooltip = scannedAt
                ? `${symbol} · last scanned ${formatScannerAppTime(scannedAt)}`
                : `${symbol} · not yet scanned`;
              return (
                <AppTooltip key={symbol} content={tooltip}><span
                  key={symbol}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: sp(3),
                    fontSize: fs(8),
                    fontFamily: T.mono,
                    padding: sp("1px 5px"),
                    border: `1px solid ${tone}30`,
                    background: `${tone}12`,
                    color: tone,
                    borderRadius: dim(2),
                  }}
                >
                  <span style={{ fontWeight: 700 }}>{symbol}</span>
                  <span style={{ color: T.textMuted }}>·</span>
                  <span>{inFlight ? "scanning…" : labelText}</span>
                </span></AppTooltip>
              );
            })}
          </div>
        </Card>
      ) : null}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 6,
        }}
      >
        {kpiCards.map((card) => (
          <Card key={card.label} style={{ padding: "5px 9px" }}>
            <div
              style={{
                fontSize: fs(7),
                fontWeight: 600,
                color: T.textDim,
                letterSpacing: "0.06em",
                fontVariant: "all-small-caps",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                lineHeight: 1,
              }}
            >
              {card.label}
            </div>
            <div
              style={{
                fontSize: fs(18),
                fontWeight: 800,
                fontFamily: T.mono,
                color: card.color,
                marginTop: sp(2),
                lineHeight: 1,
              }}
            >
              {card.value}
            </div>
            <div
              style={{
                fontSize: fs(8),
                color: T.textDim,
                fontFamily: T.sans,
                marginTop: sp(1),
                lineHeight: 1,
              }}
            >
              {card.sub}
            </div>
          </Card>
        ))}
      </div>

      <Card style={{ padding: "8px 10px", display: "flex", flexDirection: "column", gap: sp(6) }}>
        <CardTitle
          right={
            <span
              style={{
                fontSize: fs(8),
                color: T.textDim,
                fontFamily: T.mono,
              }}
            >
              {sortedEvents.length} of {unusualEvents.length} shown
            </span>
          }
        >
          Flow Scanner
        </CardTitle>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: sp(4),
            alignItems: "center",
          }}
        >
          <span
            style={{
              fontSize: fs(8),
              color: T.textDim,
              fontFamily: T.mono,
              marginRight: sp(4),
            }}
          >
            SIDE
          </span>
          {[
            { id: "all", label: "All" },
            { id: "calls", label: "Calls" },
            { id: "puts", label: "Puts" },
          ].map((option) => (
            <Pill
              key={option.id}
              active={sideFilter === option.id}
              onClick={() => setSideFilter(option.id)}
            >
              {option.label}
            </Pill>
          ))}
          <span
            style={{
              fontSize: fs(8),
              color: T.textDim,
              fontFamily: T.mono,
              marginLeft: sp(8),
              marginRight: sp(4),
            }}
          >
            SORT
          </span>
          {UNUSUAL_SORT_OPTIONS.map((option) => (
            <Pill
              key={option.id}
              active={sortBy === option.id}
              onClick={() => handleSort(option.id)}
            >
              {option.label}
              {sortIndicator(option.id)}
            </Pill>
          ))}
        </div>

        {sortedEvents.length ? (
          <div
            style={{
              border: `1px solid ${T.border}`,
              background: T.bg0,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns:
                  "60px minmax(0, 1.6fr) 60px 70px 70px 80px 90px 60px 70px",
                gap: sp(6),
                padding: sp("6px 8px"),
                background: T.bg2,
                borderBottom: `1px solid ${T.border}`,
                fontSize: fs(8),
                fontWeight: 700,
                color: T.textDim,
                fontFamily: T.mono,
                letterSpacing: "0.05em",
              }}
            >
              <span
                onClick={() => handleSort("underlying")}
                style={{ cursor: "pointer" }}
              >
                TICKER{sortIndicator("underlying")}
              </span>
              <span>CONTRACT</span>
              <span
                onClick={() => handleSort("dte")}
                style={{ cursor: "pointer", textAlign: "right" }}
              >
                DTE{sortIndicator("dte")}
              </span>
              <span style={{ textAlign: "right" }}>VOL</span>
              <span style={{ textAlign: "right" }}>OI</span>
              <span
                onClick={() => handleSort("ratio")}
                style={{ cursor: "pointer", textAlign: "right" }}
              >
                VOL/OI{sortIndicator("ratio")}
              </span>
              <span
                onClick={() => handleSort("premium")}
                style={{ cursor: "pointer", textAlign: "right" }}
              >
                PREMIUM{sortIndicator("premium")}
              </span>
              <span style={{ textAlign: "right" }}>SIDE</span>
              <span style={{ textAlign: "right" }}>TIME</span>
            </div>
            <div style={{ maxHeight: dim(520), overflowY: "auto" }}>
              {sortedEvents.map((event) => {
                const ratio = event.unusualScore || 0;
                const sideColor =
                  event.side === "BUY"
                    ? event.cp === "C"
                      ? T.green
                      : T.red
                    : event.side === "SELL"
                      ? T.textSec
                      : T.textDim;
                return (
                  <AppTooltip key={event.id} content="Open underlying chart and option chain"><button
                    key={event.id}
                    type="button"
                    onClick={() => onJumpToTrade?.(event)}
                    style={{
                      width: "100%",
                      display: "grid",
                      gridTemplateColumns:
                        "60px minmax(0, 1.6fr) 60px 70px 70px 80px 90px 60px 70px",
                      gap: sp(6),
                      padding: sp("6px 8px"),
                      background: T.bg0,
                      border: "none",
                      borderBottom: `1px solid ${T.border}55`,
                      cursor: "pointer",
                      textAlign: "left",
                      fontFamily: T.mono,
                      fontSize: fs(10),
                      color: T.text,
                    }}
                    onMouseEnter={(entry) => {
                      entry.currentTarget.style.background = T.bg2;
                    }}
                    onMouseLeave={(entry) => {
                      entry.currentTarget.style.background = T.bg0;
                    }}
                  >
                    <MarketIdentityInline
                      ticker={event.ticker}
                      size={14}
                      showChips={false}
                    />
                    <span
                      style={{
                        minWidth: 0,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        color: T.textSec,
                      }}
                    >
                      <span style={{ color: event.cp === "C" ? T.green : T.red, fontWeight: 700 }}>
                        {event.cp}
                      </span>{" "}
                      {event.strike}{" "}
                      <span style={{ color: T.textDim }}>
                        {formatExpirationLabel(event.expirationDate)}
                      </span>
                    </span>
                    <span style={{ textAlign: "right", color: T.textSec }}>
                      {Number.isFinite(event.dte) ? event.dte : MISSING_VALUE}
                    </span>
                    <span style={{ textAlign: "right" }}>
                      {Number.isFinite(event.vol) ? event.vol.toLocaleString() : MISSING_VALUE}
                    </span>
                    <span style={{ textAlign: "right", color: T.textSec }}>
                      {Number.isFinite(event.oi) ? event.oi.toLocaleString() : MISSING_VALUE}
                    </span>
                    <span
                      style={{
                        textAlign: "right",
                        color: T.amber,
                        fontWeight: 800,
                      }}
                    >
                      {ratio ? `${ratio.toFixed(ratio >= 10 ? 0 : 1)}×` : MISSING_VALUE}
                    </span>
                    <span
                      style={{
                        textAlign: "right",
                        color: T.text,
                        fontWeight: 700,
                      }}
                    >
                      {fmtM(event.premium)}
                    </span>
                    <span
                      style={{
                        textAlign: "right",
                        color: sideColor,
                        fontWeight: 700,
                      }}
                    >
                      {event.side}
                    </span>
                    <span style={{ textAlign: "right", color: T.textDim }}>
                      {event.time}
                    </span>
                  </button></AppTooltip>
                );
              })}
            </div>
          </div>
        ) : (
          <DataUnavailableState
            title="No unusual options activity"
            detail={emptyDetail}
          />
        )}
      </Card>
    </>
  );
};

export const FlowScreen = ({
  onJumpToTrade,
  session,
  symbols = [],
  isVisible = false,
}) => (
  <FlowOverviewPanel
    onJumpToTrade={onJumpToTrade}
    session={session}
    symbols={symbols}
    isVisible={isVisible}
  />
);

export default FlowScreen;
