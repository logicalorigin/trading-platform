import { useCallback, useEffect, useMemo, useState } from "react";
import {
  useGetFlowUniverse,
  useGetGexSnapshots,
  useGetQuoteSnapshots,
  useListAggregateFlowEvents,
} from "@workspace/api-client-react";
import { DenseVirtualTable } from "../../components/platform/DenseVirtualTable.jsx";
import {
  DataUnavailableState,
  MicroSparkline,
  ScoreBar,
  SegmentedControl,
  Skeleton,
  TextField,
  extractSparklineValues,
} from "../../components/platform/primitives.jsx";
import {
  notifyRuntimeTickerSnapshotSymbols,
  useRuntimeTickerSnapshot,
} from "../platform/runtimeTickerStore.js";
import {
  toneForDirectionalIntent,
  toneForFinancialDelta,
} from "../platform/semanticToneModel.js";
import {
  fmtCompactNumber,
  fmtM,
  formatQuotePrice,
  formatSignedPercent,
  isFiniteNumber,
} from "../../lib/formatters.js";
import { CSS_COLOR, FONT_WEIGHTS, RADII, T, cssColorMix, sp, textSize } from "../../lib/uiTokens.jsx";
import { useValueFlash } from "../../lib/motion.jsx";

// Hard cap on rows so the quote snapshot fan-out and the bulk GEX read stay
// bounded. The universe is returned flow-ranked, so the cap keeps the highest-flow
// names. Surfaced in the header count when truncation happens.
const MAX_ROWS = 60;

export const UNIVERSE_SORT_MODES = ["flow", "pct", "vol", "alpha"];

const SORT_MODE_TO_COLUMN = {
  flow: "flow",
  pct: "chg",
  vol: "vol",
  alpha: "sym",
};
const COLUMN_TO_SORT_MODE = {
  flow: "flow",
  chg: "pct",
  vol: "vol",
  sym: "alpha",
};

const isCallRight = (right) => String(right || "").toLowerCase().startsWith("c");

// Aggregate per-underlying call/put premium from the aggregate flow tape so each
// row can show a directional flow-heat bar without a per-symbol flow request.
const buildFlowBySymbol = (events) => {
  const map = new Map();
  for (const event of events) {
    const symbol = event?.underlying;
    if (!symbol) continue;
    const premium = Number(event.premium) || 0;
    const current = map.get(symbol) || { callPrem: 0, putPrem: 0 };
    if (isCallRight(event.right)) current.callPrem += premium;
    else current.putPrem += premium;
    map.set(symbol, current);
  }
  for (const value of map.values()) {
    const total = value.callPrem + value.putPrem;
    value.total = total;
    value.net = value.callPrem - value.putPrem;
    value.bullShare = total > 0 ? value.callPrem / total : 0.5;
  }
  return map;
};

const sortRows = (rows, sortMode) => {
  const next = [...rows];
  switch (sortMode) {
    case "pct":
      return next.sort(
        (a, b) => (b.changePercent ?? -Infinity) - (a.changePercent ?? -Infinity),
      );
    case "vol":
      return next.sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0));
    // "unusual" surfaces the names carrying the most gross options premium
    // (call + put), the closest per-row proxy the flow tape gives to unusual
    // options activity without a per-symbol volume/OI request.
    case "unusual":
      return next.sort((a, b) => (b.total ?? 0) - (a.total ?? 0));
    case "alpha":
      return next.sort((a, b) => a.symbol.localeCompare(b.symbol));
    case "flow":
    default:
      return next.sort(
        (a, b) => Math.abs(b.net ?? 0) - Math.abs(a.net ?? 0),
      );
  }
};

// Item 13, D4 — per-cell live tick flash (quick 150ms variant) for the numeric
// columns. The raw numeric drives the flash; formatted text renders inside.
const FlashCell = ({ value, color, children }) => {
  const flash = useValueFlash(value, { enabled: isFiniteNumber(value) });
  return (
    <span
      className={flash ? `${flash} ra-value-flash--quick` : undefined}
      style={{
        fontVariantNumeric: "tabular-nums",
        fontSize: textSize("metric"),
        ...(color ? { color } : null),
      }}
    >
      {children}
    </span>
  );
};

const SparkCell = ({ symbol }) => {
  const snapshot = useRuntimeTickerSnapshot(symbol, null);
  const data =
    (Array.isArray(snapshot?.sparkBars) && snapshot.sparkBars.length
      ? snapshot.sparkBars
      : snapshot?.spark) || [];
  if (!data.length) {
    return <span style={{ color: CSS_COLOR.textMuted, fontSize: textSize("bodyStrong") }}>—</span>;
  }
  return (
    <MicroSparkline
      data={data}
      width={56}
      height={18}
      ariaLabel={`${symbol} price trend`}
    />
  );
};

// Net γ cell. The value comes from one bulk `/api/gex-snapshots` query for the
// whole table (see `netGexBySymbol` below), so this cell is purely presentational
// — no per-row request.
const GexCell = ({ netGex, pending }) => {
  if (pending) {
    return <Skeleton width={38} height={11} />;
  }
  if (!isFiniteNumber(netGex)) {
    return (
      <span style={{ color: CSS_COLOR.textMuted, fontVariantNumeric: "tabular-nums", fontSize: textSize("metric") }}>
        —
      </span>
    );
  }
  const tone = toneForFinancialDelta(netGex);
  return (
    <span style={{ color: tone, fontVariantNumeric: "tabular-nums", fontSize: textSize("metric") }}>
      {netGex > 0 ? "+" : ""}
      {fmtCompactNumber(netGex)}
    </span>
  );
};

const FlowHeatCell = ({ row }) => {
  const hasFlow = isFiniteNumber(row.total) && row.total > 0;
  if (!hasFlow) {
    return <span style={{ color: CSS_COLOR.textMuted, fontSize: textSize("bodyStrong") }}>—</span>;
  }
  const tone = toneForDirectionalIntent(row.net >= 0 ? "bullish" : "bearish");
  const callPercent = Math.round(row.bullShare * 100);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: sp("8px"), minWidth: 0 }}>
      <ScoreBar
        value={(row.bullShare - 0.5) * 2}
        min={-1}
        max={1}
        width={64}
        height={12}
        showNumber={false}
        ariaLabel={`Options premium ${callPercent}% calls, ${100 - callPercent}% puts`}
      />
      <span style={{ color: tone, fontVariantNumeric: "tabular-nums", fontSize: textSize("metric") }}>
        {row.net >= 0 ? "▲" : "▼"} {fmtM(Math.abs(row.net))}
      </span>
    </div>
  );
};

/**
 * MarketUniverseTable — the hero of the Market redesign demo.
 *
 * Rows come from the flow-ranked universe (`/api/flow/universe`), hydrated with
 * live quotes, aggregate-flow heat, runtime sparklines, and per-row GEX. Clicking
 * a row asks the parent to load that symbol in the chart grid. Sort is controlled
 * by the parent so the hero band's segmented control and the column headers stay
 * in sync.
 */
export default function MarketUniverseTable({
  isVisible = false,
  activeSym = null,
  includeGex = true,
  sortMode = "flow",
  filterText = "",
  onSortModeChange,
  onSelectSymbol,
}) {
  const universeQuery = useGetFlowUniverse({
    query: { enabled: isVisible, refetchInterval: 60_000 },
  });
  const rowSymbols = useMemo(() => {
    const symbols = universeQuery.data?.symbols ?? [];
    const needle = filterText.trim().toUpperCase();
    const filtered = needle
      ? symbols.filter((symbol) => symbol.toUpperCase().includes(needle))
      : symbols;
    return filtered.slice(0, MAX_ROWS);
  }, [universeQuery.data, filterText]);
  const totalUniverse = universeQuery.data?.symbols?.length ?? 0;
  const symbolsParam = rowSymbols.join(",");

  const quotesQuery = useGetQuoteSnapshots(
    { symbols: symbolsParam },
    {
      query: {
        enabled: isVisible && rowSymbols.length > 0,
        refetchInterval: 15_000,
      },
    },
  );
  const quoteBySymbol = useMemo(() => {
    const map = new Map();
    for (const quote of quotesQuery.data?.quotes ?? []) {
      map.set(quote.symbol, quote);
    }
    return map;
  }, [quotesQuery.data]);

  const flowQuery = useListAggregateFlowEvents(
    { limit: 1000, scope: "all" },
    { query: { enabled: isVisible, refetchInterval: 15_000 } },
  );
  const flowBySymbol = useMemo(
    () => buildFlowBySymbol(flowQuery.data?.events ?? []),
    [flowQuery.data],
  );

  // One bulk GEX read for the whole table replaces the old per-row dashboard
  // fetches: latest net γ per symbol in a single request, cached 60s, no polling.
  const gexEnabled = isVisible && includeGex && rowSymbols.length > 0;
  const gexQuery = useGetGexSnapshots(
    { symbols: symbolsParam },
    {
      query: {
        enabled: gexEnabled,
        staleTime: 60_000,
        refetchInterval: false,
      },
    },
  );
  const netGexBySymbol = useMemo(() => {
    const map = new Map();
    for (const snapshot of gexQuery.data?.snapshots ?? []) {
      map.set(snapshot.symbol, snapshot.netGex);
    }
    return map;
  }, [gexQuery.data]);
  const gexPending = gexEnabled && gexQuery.isPending;

  // Ask the runtime store to track these symbols so their sparklines hydrate.
  useEffect(() => {
    if (isVisible && rowSymbols.length) {
      notifyRuntimeTickerSnapshotSymbols(rowSymbols);
    }
  }, [isVisible, rowSymbols]);

  const rows = useMemo(() => {
    return rowSymbols.map((symbol) => {
      const quote = quoteBySymbol.get(symbol) || null;
      const flow = flowBySymbol.get(symbol) || null;
      return {
        id: symbol,
        symbol,
        price: quote?.price ?? null,
        changePercent: isFiniteNumber(quote?.changePercent)
          ? quote.changePercent
          : null,
        volume: isFiniteNumber(quote?.volume) ? quote.volume : null,
        net: flow?.net ?? 0,
        total: flow?.total ?? 0,
        bullShare: flow?.bullShare ?? 0.5,
      };
    });
  }, [rowSymbols, quoteBySymbol, flowBySymbol]);

  const sortedRows = useMemo(() => sortRows(rows, sortMode), [rows, sortMode]);

  const columns = useMemo(() => {
    const defs = [
      {
        id: "sym",
        header: "Symbol",
        width: "minmax(0, 64px)",
        align: "left",
        sortable: true,
        cell: ({ row }) => (
          <span
            style={{
              fontWeight: FONT_WEIGHTS.emphasis,
              fontSize: textSize("metric"),
              color:
                row.original.symbol === activeSym
                  ? CSS_COLOR.accent
                  : CSS_COLOR.text,
            }}
          >
            {row.original.symbol}
          </span>
        ),
      },
      {
        id: "price",
        header: "Price",
        width: "minmax(0, 76px)",
        align: "right",
        cell: ({ row }) => (
          <FlashCell value={row.original.price}>
            {isFiniteNumber(row.original.price)
              ? formatQuotePrice(row.original.price)
              : "—"}
          </FlashCell>
        ),
      },
      {
        id: "chg",
        header: "Chg%",
        width: "minmax(0, 72px)",
        align: "right",
        sortable: true,
        cell: ({ row }) => (
          <FlashCell
            value={row.original.changePercent}
            color={toneForFinancialDelta(row.original.changePercent)}
          >
            {isFiniteNumber(row.original.changePercent)
              ? formatSignedPercent(row.original.changePercent)
              : "—"}
          </FlashCell>
        ),
      },
      {
        id: "vol",
        header: "Vol",
        width: "minmax(0, 72px)",
        align: "right",
        sortable: true,
        cell: ({ row }) => (
          <span style={{ fontVariantNumeric: "tabular-nums", fontSize: textSize("metric") }}>
            {isFiniteNumber(row.original.volume)
              ? fmtCompactNumber(row.original.volume)
              : "—"}
          </span>
        ),
      },
      {
        id: "flow",
        header: "Flow heat",
        width: "minmax(0, 1.4fr)",
        align: "left",
        sortable: true,
        cell: ({ row }) => <FlowHeatCell row={row.original} />,
      },
      {
        id: "spark",
        header: "Trend",
        width: "minmax(0, 64px)",
        align: "left",
        cell: ({ row }) => <SparkCell symbol={row.original.symbol} />,
      },
    ];
    if (includeGex) {
      defs.push({
        id: "gex",
        header: "Net γ",
        width: "minmax(0, 76px)",
        align: "right",
        cell: ({ row }) => (
          <GexCell
            netGex={netGexBySymbol.get(row.original.symbol)}
            pending={gexPending}
          />
        ),
      });
    }
    return defs.map((def) => ({
      id: def.id,
      header: def.header,
      cell: def.cell,
      meta: {
        align: def.align,
        width: def.width,
        label: def.header,
        sortable: Boolean(def.sortable),
        sortKey: def.id,
        sortTitle: def.sortable ? `Sort by ${def.header}` : undefined,
        reorderLocked: true,
      },
    }));
  }, [activeSym, includeGex, netGexBySymbol, gexPending]);

  const columnOrder = useMemo(() => columns.map((column) => column.id), [columns]);

  const handleSortChange = useCallback(
    (_sortKey, columnId) => {
      const nextMode = COLUMN_TO_SORT_MODE[columnId];
      if (nextMode) {
        onSortModeChange?.(nextMode);
      }
    },
    [onSortModeChange],
  );

  const getRowProps = useCallback(
    (rowData) => {
      const selected = rowData.symbol === activeSym;
      const select = () => onSelectSymbol?.(rowData.symbol);
      return {
        className: "ra-interactive ra-hover-accent-bg",
        role: "button",
        tabIndex: 0,
        "aria-label": `Load ${rowData.symbol} chart`,
        "aria-pressed": selected,
        onClick: select,
        onKeyDown: (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            select();
          }
        },
        style: {
          cursor: "pointer",
          padding: sp("5px 10px"),
          background: selected ? cssColorMix(CSS_COLOR.accent, 8) : "transparent",
        },
      };
    },
    [activeSym, onSelectSymbol],
  );

  if (universeQuery.isPending) {
    return (
      <div style={{ display: "flex", flexDirection: "column" }}>
        {Array.from({ length: 8 }).map((_, index) => (
          <Skeleton key={index} width="100%" height={34} />
        ))}
      </div>
    );
  }

  if (!rowSymbols.length) {
    return (
      <DataUnavailableState
        variant="info"
        title="No universe symbols"
        detail="The flow universe returned no symbols. It hydrates during market hours."
      />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0, gap: sp("4px") }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          color: CSS_COLOR.textDim,
          fontSize: textSize("bodyStrong"),
          fontFamily: T.sans,
        }}
      >
        <span>Universe</span>
        <span>
          {rowSymbols.length}
          {totalUniverse > rowSymbols.length ? ` of ${totalUniverse}` : ""} symbols
        </span>
      </div>
      <DenseVirtualTable
        columns={columns}
        columnOrder={columnOrder}
        data={sortedRows}
        getRowId={(rowData) => rowData.id}
        getRowProps={getRowProps}
        onSortChange={handleSortChange}
        sortState={{
          id: SORT_MODE_TO_COLUMN[sortMode] || "flow",
          direction: sortMode === "alpha" ? "asc" : "desc",
        }}
        rowHeight={34}
        overscan={14}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Compact scanner variant — the left-column "what to chart" list of the Market
// dashboard. Same data spine as MarketUniverseTable (flow universe + quotes +
// aggregate-flow heat + runtime sparklines) but a four-lane, chart-free row so
// it fits a ~272px rail. The full table above is retained for other callers.
// ---------------------------------------------------------------------------

const SCANNER_SORT_OPTIONS = [
  { value: "flow", label: "Flow" },
  { value: "pct", label: "%Chg" },
  { value: "vol", label: "Vol" },
  { value: "unusual", label: "Unusual" },
];

// Trend lane: a fixed 44×18 slot that always reads as a trend cell — a live
// sparkline when runtime bars exist, else a low-contrast baseline plus an amber
// freshness dot. Identical dimensions in both states so the row never jumps and
// the lane never flickers between chart and dash. Price trend is a financial
// return, so the sparkline keeps MicroSparkline's green/red inference.
const ScannerTrendCell = ({ symbol }) => {
  const snapshot = useRuntimeTickerSnapshot(symbol, null);
  const bars =
    (Array.isArray(snapshot?.sparkBars) && snapshot.sparkBars.length
      ? snapshot.sparkBars
      : snapshot?.spark) || [];
  if (extractSparklineValues(bars).length >= 2) {
    return <MicroSparkline data={bars} width={44} height={18} ariaHidden />;
  }
  return (
    <svg width={44} height={18} viewBox="0 0 44 18" aria-hidden="true" style={{ display: "block" }}>
      <line x1="0" y1="9" x2="44" y2="9" stroke={CSS_COLOR.borderLight} strokeWidth="1" />
      <circle cx="41" cy="9" r="1.8" fill={CSS_COLOR.amber} />
    </svg>
  );
};

// Chg% is a price return → financial green/red. A fixed-width Skeleton holds the
// lane until the shared quotes query resolves, so hydration never shows a bare
// em-dash and never resizes the row.
const ScannerChgCell = ({ value, ready }) => {
  if (!ready) return <Skeleton width={34} height={8} radius={2} />;
  if (!isFiniteNumber(value)) {
    return (
      <span style={{ color: CSS_COLOR.textMuted, fontSize: textSize("metric"), fontVariantNumeric: "tabular-nums" }}>
        —
      </span>
    );
  }
  return (
    <span style={{ color: toneForFinancialDelta(value), fontSize: textSize("metric"), fontVariantNumeric: "tabular-nums" }}>
      {formatSignedPercent(value)}
    </span>
  );
};

// Flow-heat spine: directional (blue call-side / red put-side) width bar scaled
// to the loudest name in view. A Skeleton holds the lane until the flow tape
// resolves; symbols with no flow keep a quiet empty track (never an em-dash).
const ScannerFlowSpine = ({ row, maxAbsNet, ready }) => {
  if (!ready) return <Skeleton width="100%" height={7} radius={2} />;
  const hasFlow = isFiniteNumber(row.total) && row.total > 0 && isFiniteNumber(row.net);
  if (!hasFlow) {
    return (
      <span
        aria-hidden="true"
        style={{ display: "block", width: "100%", height: 7, borderRadius: 2, background: cssColorMix(CSS_COLOR.textMuted, 10) }}
      />
    );
  }
  const tone = toneForDirectionalIntent(row.net >= 0 ? "bullish" : "bearish");
  const widthPct = maxAbsNet > 0 ? Math.max(6, Math.min(100, (Math.abs(row.net) / maxAbsNet) * 100)) : 6;
  return (
    <span
      title={`${row.net >= 0 ? "Call" : "Put"}-side net ${fmtM(Math.abs(row.net))}`}
      aria-hidden="true"
      style={{ display: "block", width: "100%", height: 7, borderRadius: 2, background: cssColorMix(CSS_COLOR.textMuted, 8), overflow: "hidden" }}
    >
      <span
        style={{ display: "block", height: "100%", width: `${widthPct}%`, borderRadius: 2, background: `linear-gradient(90deg, ${cssColorMix(tone, 55)}, ${tone})` }}
      />
    </span>
  );
};

/**
 * MarketUniverseScanner — compact, flow-ranked "what to chart" rail. Owns its
 * own sort + filter; a row click / Enter / Space asks the parent to load that
 * symbol into the chart grid. Rows are shells from the known universe symbols,
 * so each cell hydrates independently behind a fixed-dimension Skeleton.
 */
export function MarketUniverseScanner({
  isVisible = false,
  activeSym = null,
  onSelectSymbol,
}) {
  const [sortMode, setSortMode] = useState("flow");
  const [filterText, setFilterText] = useState("");

  const universeQuery = useGetFlowUniverse({
    query: { enabled: isVisible, refetchInterval: 60_000 },
  });
  const rowSymbols = useMemo(() => {
    const symbols = universeQuery.data?.symbols ?? [];
    const needle = filterText.trim().toUpperCase();
    const filtered = needle
      ? symbols.filter((symbol) => symbol.toUpperCase().includes(needle))
      : symbols;
    return filtered.slice(0, MAX_ROWS);
  }, [universeQuery.data, filterText]);
  const totalUniverse = universeQuery.data?.symbols?.length ?? 0;
  const symbolsParam = rowSymbols.join(",");

  const quotesQuery = useGetQuoteSnapshots(
    { symbols: symbolsParam },
    { query: { enabled: isVisible && rowSymbols.length > 0, refetchInterval: 15_000 } },
  );
  const quoteBySymbol = useMemo(() => {
    const map = new Map();
    for (const quote of quotesQuery.data?.quotes ?? []) {
      map.set(quote.symbol, quote);
    }
    return map;
  }, [quotesQuery.data]);

  const flowQuery = useListAggregateFlowEvents(
    { limit: 1000, scope: "all" },
    { query: { enabled: isVisible, refetchInterval: 15_000 } },
  );
  const flowBySymbol = useMemo(
    () => buildFlowBySymbol(flowQuery.data?.events ?? []),
    [flowQuery.data],
  );

  useEffect(() => {
    if (isVisible && rowSymbols.length) {
      notifyRuntimeTickerSnapshotSymbols(rowSymbols);
    }
  }, [isVisible, rowSymbols]);

  const quotesReady = quotesQuery.data != null;
  const flowReady = flowQuery.data != null;

  const rows = useMemo(
    () =>
      rowSymbols.map((symbol) => {
        const quote = quoteBySymbol.get(symbol) || null;
        const flow = flowBySymbol.get(symbol) || null;
        return {
          id: symbol,
          symbol,
          changePercent: isFiniteNumber(quote?.changePercent) ? quote.changePercent : null,
          volume: isFiniteNumber(quote?.volume) ? quote.volume : null,
          net: flow?.net ?? 0,
          total: flow?.total ?? 0,
          bullShare: flow?.bullShare ?? 0.5,
        };
      }),
    [rowSymbols, quoteBySymbol, flowBySymbol],
  );
  const sortedRows = useMemo(() => sortRows(rows, sortMode), [rows, sortMode]);
  const maxAbsNet = useMemo(
    () => sortedRows.reduce((max, row) => Math.max(max, Math.abs(row.net || 0)), 0),
    [sortedRows],
  );

  const columns = useMemo(
    () => [
      {
        id: "sym",
        header: "Symbol",
        meta: { width: "56px", align: "left", label: "Symbol" },
        cell: ({ row }) => (
          <span
            style={{
              fontFamily: T.sans,
              fontWeight: FONT_WEIGHTS.label,
              fontSize: textSize("metric"),
              color: row.original.symbol === activeSym ? CSS_COLOR.accent : CSS_COLOR.text,
            }}
          >
            {row.original.symbol}
          </span>
        ),
      },
      {
        id: "chg",
        header: "Chg%",
        meta: { width: "52px", align: "right", label: "Chg%" },
        cell: ({ row }) => <ScannerChgCell value={row.original.changePercent} ready={quotesReady} />,
      },
      {
        id: "flow",
        header: "Flow",
        meta: { width: "minmax(0, 1fr)", align: "left", label: "Flow heat" },
        cell: ({ row }) => (
          <ScannerFlowSpine row={row.original} maxAbsNet={maxAbsNet} ready={flowReady} />
        ),
      },
      {
        id: "spark",
        header: "Trend",
        meta: { width: "44px", align: "right", label: "Trend" },
        cell: ({ row }) => <ScannerTrendCell symbol={row.original.symbol} />,
      },
    ],
    [activeSym, quotesReady, flowReady, maxAbsNet],
  );

  const getRowProps = useCallback(
    (rowData) => {
      const selected = rowData.symbol === activeSym;
      const select = () => onSelectSymbol?.(rowData.symbol);
      return {
        className: "ra-interactive ra-hover-accent-bg",
        role: "button",
        tabIndex: 0,
        "aria-label": `Load ${rowData.symbol} chart`,
        "aria-pressed": selected,
        onClick: select,
        onKeyDown: (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            select();
          }
        },
        style: {
          cursor: "pointer",
          alignItems: "center",
          columnGap: sp(8),
          padding: sp("0 10px"),
          background: selected ? cssColorMix(CSS_COLOR.accent, 8) : "transparent",
          boxShadow: selected ? `inset 2px 0 0 ${CSS_COLOR.accent}` : undefined,
        },
      };
    },
    [activeSym, onSelectSymbol],
  );

  const header = (
    <div style={{ display: "flex", flexDirection: "column", gap: sp(6), flexShrink: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: sp(6) }}>
        <span
          style={{
            flex: 1,
            minWidth: 0,
            color: CSS_COLOR.text,
            fontFamily: T.sans,
            fontSize: textSize("bodyStrong"),
            fontWeight: FONT_WEIGHTS.label,
          }}
        >
          Scanner
        </span>
        <span style={{ color: CSS_COLOR.textDim, fontFamily: T.data, fontSize: textSize("caption"), fontVariantNumeric: "tabular-nums" }}>
          {rowSymbols.length}
          {totalUniverse > rowSymbols.length ? ` / ${totalUniverse}` : ""}
        </span>
        <span
          aria-hidden="true"
          style={{
            width: 6,
            height: 6,
            borderRadius: RADII.pill,
            background: quotesReady ? CSS_COLOR.green : CSS_COLOR.amber,
            flex: "0 0 auto",
          }}
        />
      </div>
      <SegmentedControl
        options={SCANNER_SORT_OPTIONS}
        value={sortMode}
        onChange={setSortMode}
        ariaLabel="Scanner sort"
        radioGroup
      />
      <TextField
        value={filterText}
        onChange={(event) => setFilterText(event.target.value)}
        placeholder="Filter symbol…"
        size="sm"
        style={{ width: "100%", minWidth: 0 }}
        inputProps={{ "aria-label": "Filter scanner by symbol" }}
      />
    </div>
  );

  let body;
  if (universeQuery.isPending) {
    body = (
      <div style={{ display: "flex", flexDirection: "column", gap: sp(2), paddingTop: sp(4) }}>
        {Array.from({ length: 10 }).map((_, index) => (
          <Skeleton key={index} width="100%" height={26} radius={2} />
        ))}
      </div>
    );
  } else if (!rowSymbols.length) {
    body = (
      <DataUnavailableState
        variant="neutral"
        title="No universe symbols"
        detail="The flow universe hydrates during market hours; adjust the filter to widen the list."
      />
    );
  } else {
    body = (
      <div style={{ flex: 1, minHeight: 0 }}>
        <DenseVirtualTable
          columns={columns}
          columnOrder={columns.map((column) => column.id)}
          data={sortedRows}
          getRowId={(rowData) => rowData.id}
          getRowProps={getRowProps}
          headerStyle={{ display: "none" }}
          rowHeight={34}
          overscan={14}
        />
      </div>
    );
  }

  return (
    <div style={{ height: "100%", minHeight: 0, display: "flex", flexDirection: "column", gap: sp(6) }}>
      {header}
      {body}
    </div>
  );
}
