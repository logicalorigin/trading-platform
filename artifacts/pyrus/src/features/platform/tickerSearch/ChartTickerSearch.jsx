import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { normalizeTickerSymbol } from "../tickerIdentity";
import {
  isApiBackedTickerSearchRow,
  normalizePersistedTickerSearchRows,
  normalizeTickerSearchResultForStorage,
} from "../tickerUniverseRows";
import {
  CSS_COLOR,
  FONT_WEIGHTS,
  RADII,
  T,
  cssColorMix,
  dim,
  fs,
  sp,
  textSize,
} from "../../../lib/uiTokens.jsx";

const EMPTY_SEARCH_STATE = Object.freeze({
  results: [],
  isFetching: false,
  error: null,
});

const normalizeQuery = (value) =>
  String(value ?? "")
    .trim()
    .replace(/^[\s$^]+/, "")
    .toUpperCase();

const getRowKey = (row) =>
  [
    normalizeTickerSymbol(row?.ticker),
    row?.market || "",
    row?.normalizedExchangeMic || row?.primaryExchange || "",
  ].join("|");

const isMassiveBacked = (row) =>
  row?.provider === "massive" ||
  row?.dataProviderPreference === "massive" ||
  (Array.isArray(row?.providers) && row.providers.includes("massive"));

const getProviderLabel = (row) => {
  if (!isApiBackedTickerSearchRow(row)) return "Search";
  if (isMassiveBacked(row)) return "Massive";
  if (row?.provider || row?.dataProviderPreference) {
    return String(row.provider || row.dataProviderPreference).toUpperCase();
  }
  return "Data";
};

const getMarketLabel = (market) => {
  if (market === "etf") return "ETF";
  if (market === "fx") return "FX";
  if (market === "indices") return "Index";
  if (market === "futures") return "Futures";
  if (market === "crypto") return "Crypto";
  if (market === "otc") return "OTC";
  return "Stock";
};

const useDebouncedValue = (value, delayMs = 120) => {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timeoutId);
  }, [delayMs, value]);

  return debounced;
};

const useMassiveTickerSearch = ({ enabled, query, limit = 8 }) => {
  const [state, setState] = useState(EMPTY_SEARCH_STATE);

  useEffect(() => {
    if (!enabled) {
      setState((current) =>
        current.results.length || current.isFetching || current.error
          ? EMPTY_SEARCH_STATE
          : current,
      );
      return undefined;
    }

    const controller = new AbortController();
    const params = new URLSearchParams({
      search: query,
      active: "true",
      limit: String(limit),
    });
    setState({ ...EMPTY_SEARCH_STATE, isFetching: true });

    fetch(`/api/universe/tickers?${params.toString()}`, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Ticker search failed with ${response.status}`);
        }
        return response.json();
      })
      .then((payload) => {
        if (controller.signal.aborted) return;
        setState({
          results: Array.isArray(payload?.results) ? payload.results : [],
          isFetching: false,
          error: null,
        });
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setState({ results: [], isFetching: false, error });
      });

    return () => controller.abort();
  }, [enabled, limit, query]);

  return state;
};

const ChartTickerSearchRow = ({ row, active, onSelect, onHover }) => {
  const ticker = normalizeTickerSymbol(row?.ticker);
  const disabled = !isApiBackedTickerSearchRow(row);
  const providerLabel = getProviderLabel(row);

  return (
    <button
      type="button"
      data-testid="ticker-search-row"
      disabled={disabled}
      onMouseEnter={onHover}
      onClick={() => !disabled && onSelect(row)}
      style={{
        width: "100%",
        minHeight: dim(44),
        border: "none",
        borderTop: `1px solid ${CSS_COLOR.borderLight}`,
        background: active ? cssColorMix(CSS_COLOR.accent, 9) : "transparent",
        color: disabled ? CSS_COLOR.textMuted : CSS_COLOR.text,
        display: "grid",
        gridTemplateColumns: `${dim(58)}px minmax(0, 1fr) auto`,
        alignItems: "center",
        gap: sp(8),
        padding: sp("7px 10px"),
        fontFamily: T.sans,
        textAlign: "left",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.72 : 1,
      }}
    >
      <span
        style={{
          fontFamily: T.mono,
          fontSize: fs(12),
          fontWeight: FONT_WEIGHTS.label,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {ticker}
      </span>
      <span style={{ minWidth: 0, display: "grid", gap: sp(2) }}>
        <span
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontSize: textSize("captionStrong"),
          }}
        >
          {row?.name || row?.contractDescription || ticker}
        </span>
        <span
          style={{
            color: CSS_COLOR.textMuted,
            fontSize: fs(9),
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {getMarketLabel(row?.market)}
        </span>
      </span>
      <span
        style={{
          border: `1px solid ${CSS_COLOR.border}`,
          borderRadius: dim(RADII.xs),
          color: disabled ? CSS_COLOR.textMuted : CSS_COLOR.textSec,
          fontSize: fs(9),
          padding: sp("2px 5px"),
          textTransform: "uppercase",
          whiteSpace: "nowrap",
        }}
      >
        {providerLabel}
      </span>
    </button>
  );
};

export const MarketChartTickerSearch = ({
  open,
  ticker,
  recentTickerRows = [],
  embedded = false,
  onClose,
  onSelectTicker,
}) => {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef(null);
  const debouncedQuery = useDebouncedValue(query);
  const normalizedQuery = normalizeQuery(debouncedQuery);
  const searchEnabled = open && normalizedQuery.length > 0;

  const searchQuery = useMassiveTickerSearch({
    enabled: searchEnabled,
    query: normalizedQuery,
    limit: 12,
  });

  const recentRows = useMemo(
    () => normalizePersistedTickerSearchRows(recentTickerRows, 10),
    [recentTickerRows],
  );

  const liveRows = useMemo(() => {
    const seen = new Set();
    return (searchQuery.results || [])
      .filter((row) => {
        const key = getRowKey(row);
        if (!normalizeTickerSymbol(row?.ticker) || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }, [searchQuery.results]);

  const rows = searchEnabled ? liveRows : recentRows;
  const activeRow = rows[activeIndex] || rows[0] || null;

  useEffect(() => {
    if (!open) return undefined;
    const frameId = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frameId);
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [normalizedQuery]);

  const selectRow = useCallback(
    (row) => {
      const normalized = normalizeTickerSearchResultForStorage(row);
      if (!normalized) return;
      onSelectTicker?.(normalized);
    },
    [onSelectTicker],
  );

  const handleKeyDown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose?.();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, Math.max(0, rows.length - 1)));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(0, index - 1));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      selectRow(activeRow);
    }
  };

  if (!open) return null;

  return (
    <div
      data-testid="ticker-search-popover"
      style={{
        width: embedded ? "100%" : dim(430),
        maxWidth: "calc(100vw - 24px)",
        border: `1px solid ${CSS_COLOR.border}`,
        borderRadius: dim(RADII.xs),
        background: CSS_COLOR.bg1,
        boxShadow: "0 18px 46px rgba(15, 23, 42, 0.18)",
        overflow: "hidden",
        fontFamily: T.sans,
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr auto",
          gap: sp(8),
          padding: sp(10),
          borderBottom: `1px solid ${CSS_COLOR.border}`,
          background: CSS_COLOR.bg2,
        }}
      >
        <input
          ref={inputRef}
          data-testid="ticker-search-input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={`Search ticker or company for ${normalizeTickerSymbol(ticker) || "chart"}...`}
          style={{
            minWidth: 0,
            height: dim(32),
            border: `1px solid ${CSS_COLOR.border}`,
            borderRadius: dim(RADII.xs),
            background: CSS_COLOR.bg0,
            color: CSS_COLOR.text,
            padding: sp("0 10px"),
            fontSize: textSize("body"),
            outline: "none",
          }}
        />
        <button
          type="button"
          onClick={onClose}
          style={{
            width: dim(32),
            height: dim(32),
            border: `1px solid ${CSS_COLOR.border}`,
            borderRadius: dim(RADII.xs),
            background: CSS_COLOR.bg1,
            color: CSS_COLOR.textMuted,
            cursor: "pointer",
            fontSize: fs(14),
          }}
          aria-label="Close ticker search"
        >
          x
        </button>
      </div>
      <div style={{ maxHeight: dim(340), overflowY: "auto" }}>
        {searchEnabled && searchQuery.isFetching ? (
          <div
            data-testid="ticker-search-loading"
            style={{
              padding: sp(12),
              color: CSS_COLOR.textMuted,
              fontSize: textSize("caption"),
            }}
          >
            Searching Massive...
          </div>
        ) : null}
        {searchEnabled && searchQuery.error ? (
          <div
            style={{
              padding: sp(12),
              color: CSS_COLOR.red,
              fontSize: textSize("caption"),
            }}
          >
            Search failed
          </div>
        ) : null}
        {rows.length ? (
          rows.map((row, index) => (
            <ChartTickerSearchRow
              key={`${getRowKey(row)}-${index}`}
              row={row}
              active={index === activeIndex}
              onHover={() => setActiveIndex(index)}
              onSelect={selectRow}
            />
          ))
        ) : searchEnabled && (searchQuery.isFetching || searchQuery.error) ? null : (
          <div
            style={{
              padding: sp(14),
              color: CSS_COLOR.textMuted,
              fontSize: textSize("caption"),
            }}
          >
            {searchEnabled ? "No Massive matches" : "Start typing to search Massive"}
          </div>
        )}
      </div>
    </div>
  );
};

export const MiniChartTickerSearch = MarketChartTickerSearch;
