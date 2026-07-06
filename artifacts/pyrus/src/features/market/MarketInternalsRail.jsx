import { useMemo } from "react";
import { useGetFlowUniverse, useGetQuoteSnapshots } from "@workspace/api-client-react";
import {
  BROAD_MARKET_FLOW_STORE_KEY,
  useMarketFlowSnapshotForStoreKey,
} from "../platform/marketFlowStore";
import {
  DataUnavailableState,
  SurfacePanel,
} from "../../components/platform/primitives.jsx";
import {
  toneForDirectionalIntent,
  toneForFinancialDelta,
} from "../platform/semanticToneModel.js";
import { fmtM, formatSignedPercent, isFiniteNumber } from "../../lib/formatters.js";
import { CSS_COLOR, FONT_WEIGHTS, RADII, T, cssColorMix, sp, textSize } from "../../lib/uiTokens.jsx";

// Matches MarketUniverseTable's cap so the universe + quotes queries share keys
// (react-query dedupe → no extra network for the movers columns).
const MAX_UNIVERSE = 60;
const SECTOR_LIMIT = 8;
const MOVERS_LIMIT = 5;

const SectorFlowList = ({ sectorFlow }) => {
  const rows = useMemo(() => {
    return [...sectorFlow]
      .map((sector) => ({ ...sector, net: (sector.calls || 0) - (sector.puts || 0) }))
      .sort((a, b) => Math.abs(b.net) - Math.abs(a.net))
      .slice(0, SECTOR_LIMIT);
  }, [sectorFlow]);
  const absMax = useMemo(
    () => Math.max(1, ...rows.map((sector) => Math.abs(sector.net))),
    [rows],
  );

  if (!rows.length) {
    return (
      <DataUnavailableState
        variant="neutral"
        title="No live sector flow"
        detail="Sector rotation appears once a live options-flow provider returns data."
      />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: sp("4px") }}>
      {rows.map((sector) => {
        const widthPct = (Math.abs(sector.net) / absMax) * 50;
        const tone = toneForDirectionalIntent(sector.net >= 0 ? "bullish" : "bearish");
        return (
          <div
            key={sector.sector}
            style={{
              display: "grid",
              gridTemplateColumns: "80px minmax(0, 1fr) 56px",
              gap: sp("6px"),
              alignItems: "center",
            }}
          >
            <span
              style={{
                color: CSS_COLOR.textSec,
                fontFamily: T.sans,
                fontSize: textSize("bodyStrong"),
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {sector.sector}
            </span>
            <span
              style={{
                position: "relative",
                height: 8,
                background: cssColorMix(CSS_COLOR.textMuted, 12),
                borderRadius: RADII.pill,
              }}
            >
              <span
                style={{
                  position: "absolute",
                  top: 0,
                  bottom: 0,
                  left: "50%",
                  width: 1,
                  background: CSS_COLOR.borderLight,
                }}
              />
              <span
                style={{
                  position: "absolute",
                  top: 0,
                  bottom: 0,
                  left: sector.net >= 0 ? "50%" : undefined,
                  right: sector.net < 0 ? "50%" : undefined,
                  width: `${widthPct}%`,
                  background: tone,
                  borderRadius: RADII.pill,
                }}
              />
            </span>
            <span
              style={{
                color: tone,
                fontFamily: T.sans,
                fontSize: textSize("bodyStrong"),
                textAlign: "right",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {sector.net >= 0 ? "+" : "-"}
              {fmtM(Math.abs(sector.net))}
            </span>
          </div>
        );
      })}
    </div>
  );
};

const MoversColumn = ({ title, rows, onSelectSymbol }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: sp("3px"), minWidth: 0 }}>
    <div style={{ color: CSS_COLOR.textDim, fontSize: textSize("body"), fontFamily: T.sans }}>
      {title}
    </div>
    {rows.length ? (
      rows.map((row) => (
        <button
          key={row.symbol}
          type="button"
          className="ra-interactive"
          onClick={() => onSelectSymbol?.(row.symbol)}
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            gap: sp("8px"),
            background: "transparent",
            border: "none",
            padding: sp("2px 0"),
            cursor: "pointer",
            fontFamily: T.sans,
          }}
        >
          <span style={{ color: CSS_COLOR.text, fontSize: textSize("bodyStrong"), fontWeight: FONT_WEIGHTS.label }}>
            {row.symbol}
          </span>
          <span
            style={{
              color: toneForFinancialDelta(row.changePercent),
              fontSize: textSize("bodyStrong"),
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {formatSignedPercent(row.changePercent)}
          </span>
        </button>
      ))
    ) : (
      <span style={{ color: CSS_COLOR.textMuted, fontSize: textSize("body") }}>—</span>
    )}
  </div>
);

/**
 * MarketInternalsRail — compact supporting tier for the Market demo: live sector
 * rotation (broad-market flow store) plus leaders/laggards derived from the
 * flow-ranked universe by % change. Clicking a mover loads it into the chart grid.
 */
export default function MarketInternalsRail({ isVisible = false, onSelectSymbol }) {
  const snapshot = useMarketFlowSnapshotForStoreKey(BROAD_MARKET_FLOW_STORE_KEY);
  const sectorFlow = snapshot?.sectorFlow ?? [];

  const universeQuery = useGetFlowUniverse({
    query: { enabled: isVisible, refetchInterval: 60_000 },
  });
  const symbols = useMemo(
    () => (universeQuery.data?.symbols ?? []).slice(0, MAX_UNIVERSE),
    [universeQuery.data],
  );
  const quotesQuery = useGetQuoteSnapshots(
    { symbols: symbols.join(",") },
    { query: { enabled: isVisible && symbols.length > 0, refetchInterval: 15_000 } },
  );

  const movers = useMemo(() => {
    const rows = (quotesQuery.data?.quotes ?? [])
      .filter((quote) => isFiniteNumber(quote.changePercent))
      .map((quote) => ({ symbol: quote.symbol, changePercent: quote.changePercent }));
    const sorted = [...rows].sort((a, b) => b.changePercent - a.changePercent);
    return {
      leaders: sorted.slice(0, MOVERS_LIMIT),
      laggards: sorted.slice(-MOVERS_LIMIT).reverse(),
    };
  }, [quotesQuery.data]);

  return (
    <SurfacePanel title="Market internals" compact>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: sp("16px"),
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: sp("6px"), minWidth: 0 }}>
          <div style={{ color: CSS_COLOR.textDim, fontSize: textSize("body"), fontFamily: T.sans }}>
            Sector flow
          </div>
          <SectorFlowList sectorFlow={sectorFlow} />
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: sp("16px"),
            minWidth: 0,
          }}
        >
          <MoversColumn title="Leaders" rows={movers.leaders} onSelectSymbol={onSelectSymbol} />
          <MoversColumn title="Laggards" rows={movers.laggards} onSelectSymbol={onSelectSymbol} />
        </div>
      </div>
    </SurfacePanel>
  );
}
