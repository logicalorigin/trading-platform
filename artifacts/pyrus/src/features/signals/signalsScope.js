import { normalizeSignalsTicker } from "./signalsRowModel.js";

// Signals data-scope helpers.
//
// The Signals page renders rows for one "scope": an execution environment +
// the authoritative universe of symbols the backend is monitoring. When that
// scope changes (environment switch, or the applied universe changes), stale
// matrix/event symbols, hydration counts, and the current selection must not
// linger from the previous scope. These pure helpers make that logic testable
// and keep SignalsScreen wiring small. (Epicurus Signals audit.)
//
// Symbols are normalized (trimmed/upper-cased) and de-duplicated before use so
// casing/duplicate differences can't create false scope changes or let stale
// rows slip through the universe bound.

const normalizeUniverseSymbols = (symbols) => {
  if (!Array.isArray(symbols)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of symbols) {
    const symbol = normalizeSignalsTicker(raw);
    if (symbol && !seen.has(symbol)) {
      seen.add(symbol);
      out.push(symbol);
    }
  }
  return out;
};

// A stable key identifying the current Signals scope. Changes whenever the
// environment or the normalized authoritative universe set changes
// (order-insensitive, case-insensitive, duplicate-insensitive).
export const buildSignalsSourceScopeKey = ({ environment, universeSymbols } = {}) => {
  const env = typeof environment === "string" ? environment : "";
  return `${env}::${normalizeUniverseSymbols(universeSymbols).sort().join(",")}`;
};

// Drop rows whose symbol is outside the authoritative universe so symbols from a
// previous source/universe don't linger. The comparison is normalized on both
// sides. Only a nullish universe is unavailable; an authoritative empty array
// means the source is tracking no symbols and must clear every row.
export const boundSignalsRowsToUniverse = (rows, universeSymbols) => {
  if (!Array.isArray(rows)) return [];
  if (universeSymbols == null) return rows;
  const allowed = normalizeUniverseSymbols(universeSymbols);
  if (allowed.length === 0) return [];
  const allowedSet = new Set(allowed);
  return rows.filter((row) => allowedSet.has(normalizeSignalsTicker(row?.symbol)));
};

// Whether any search/status/direction filter is currently narrowing the table.
// When true, overview metrics derive from the filtered rows so the overview
// matches the visible table (option A). "all" is the no-filter sentinel for the
// status/direction selectors.
export const signalsFiltersActive = ({
  query,
  statusFilter,
  directionFilter,
} = {}) =>
  Boolean(typeof query === "string" && query.trim()) ||
  (statusFilter != null && statusFilter !== "all") ||
  (directionFilter != null && directionFilter !== "all");

export const resolveSignalsEmptyState = ({
  filtersActive = false,
  monitorEnabled = false,
} = {}) => {
  if (filtersActive) {
    return {
      kind: "filtered-empty",
      title: "No matching signals",
      detail: "No tracked ticker matches the current filters.",
      actionLabel: "Clear filters",
    };
  }
  if (!monitorEnabled) {
    return {
      kind: "monitor-off",
      title: "Signal monitor is off",
      detail: "Turn on the monitor when you want the signal universe to scan.",
      actionLabel: "Turn monitor on",
    };
  }
  return {
    kind: "empty",
    title: "No signals yet",
    detail: "Run a scan or check the selected universe for tracked tickers.",
    actionLabel: "Run scan",
  };
};
