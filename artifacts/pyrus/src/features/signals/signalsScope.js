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
// sides. When the universe is unavailable (empty/missing) rows pass through
// unchanged, so nothing is hidden during load.
export const boundSignalsRowsToUniverse = (rows, universeSymbols) => {
  if (!Array.isArray(rows)) return [];
  const allowed = normalizeUniverseSymbols(universeSymbols);
  if (allowed.length === 0) {
    return rows;
  }
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
