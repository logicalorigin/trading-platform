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
import {
  MACRO_TICKERS,
  RATES_PROXIES,
  buildRatesProxySummary,
  buildTrackedBreadthSummary,
} from "./marketReferenceData.js";
import { MarketIdentityInline } from "../platform/marketIdentity";
import { fmtM, formatSignedPercent, isFiniteNumber } from "../../lib/formatters.js";
import { CSS_COLOR, FONT_WEIGHTS, MISSING_VALUE, RADII, T, cssColorMix, sp, textSize } from "../../lib/uiTokens.jsx";

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

// Rates term-structure proxies (static reference tickers), ported from the classic
// Market screen. Each row: term, ticker chip, signed-magnitude bar, % change.
const RatesList = () => (
  <div style={{ display: "flex", flexDirection: "column", gap: sp("4px") }}>
    {RATES_PROXIES.map((item) => {
      const pos = isFiniteNumber(item.pct) ? item.pct >= 0 : null;
      const width = isFiniteNumber(item.pct)
        ? Math.max(6, Math.min(100, Math.abs(item.pct) * 48))
        : 0;
      const tone =
        pos == null ? CSS_COLOR.textMuted : pos ? CSS_COLOR.green : CSS_COLOR.red;
      return (
        <div
          key={item.sym}
          style={{
            display: "grid",
            gridTemplateColumns: "40px 60px minmax(0, 1fr) 44px",
            gap: sp("5px"),
            alignItems: "center",
            fontFamily: T.sans,
            fontSize: textSize("bodyStrong"),
          }}
        >
          <span style={{ color: CSS_COLOR.textDim }}>{item.term}</span>
          <MarketIdentityInline ticker={item.sym} size={12} showChips={false} />
          <span
            style={{
              position: "relative",
              height: 6,
              background: cssColorMix(CSS_COLOR.textMuted, 12),
              borderRadius: RADII.pill,
            }}
          >
            <span
              style={{
                position: "absolute",
                top: 0,
                bottom: 0,
                left: 0,
                width: `${width}%`,
                background: tone,
                borderRadius: RADII.pill,
                opacity: 0.85,
              }}
            />
          </span>
          <span
            style={{
              color: pos == null ? CSS_COLOR.textDim : tone,
              textAlign: "right",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {formatSignedPercent(item.pct)}
          </span>
        </div>
      );
    })}
  </div>
);

// Advance/decline split bar + the 5D+/Sectors+/Lead/Lag mini-stats from the
// tracked-breadth summary.
const BreadthSummary = ({ breadth, upPct, downPct, stats }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: sp("6px") }}>
    <div style={{ display: "flex", alignItems: "center", gap: sp("6px") }}>
      <span style={{ color: CSS_COLOR.green, fontFamily: T.sans, fontSize: textSize("bodyStrong") }}>
        {breadth.total ? breadth.advancers : MISSING_VALUE}
      </span>
      <span
        style={{
          flex: 1,
          display: "flex",
          height: 8,
          background: CSS_COLOR.bg1,
          overflow: "hidden",
          borderRadius: RADII.pill,
        }}
      >
        <span style={{ width: `${upPct}%`, background: CSS_COLOR.green }} />
        <span style={{ width: `${downPct}%`, background: CSS_COLOR.red }} />
      </span>
      <span style={{ color: CSS_COLOR.red, fontFamily: T.sans, fontSize: textSize("bodyStrong") }}>
        {breadth.total ? breadth.decliners : MISSING_VALUE}
      </span>
    </div>
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: sp("3px"),
        fontFamily: T.sans,
        fontSize: textSize("body"),
      }}
    >
      {stats.map(([label, value]) => (
        <div
          key={label}
          style={{
            display: "flex",
            justifyContent: "space-between",
            background: cssColorMix(CSS_COLOR.bg3, 33),
            padding: sp("3px 5px"),
          }}
        >
          <span style={{ color: CSS_COLOR.textDim }}>{label}</span>
          <span style={{ color: CSS_COLOR.textSec }}>{value}</span>
        </div>
      ))}
    </div>
  </div>
);

// Regime narrative bullets (breadth / put-call / vol-rates), tone-coded.
const MarketReadList = ({ items }) => (
  <div
    role="list"
    style={{
      display: "grid",
      gap: sp("4px"),
      fontFamily: T.sans,
      fontSize: textSize("body"),
      color: CSS_COLOR.textSec,
      lineHeight: 1.45,
    }}
  >
    {items.map((item, index) => (
      <div
        key={index}
        role="listitem"
        style={{
          display: "grid",
          gridTemplateColumns: "10px minmax(0, 1fr)",
          gap: sp("4px"),
          alignItems: "start",
          minWidth: 0,
        }}
      >
        <span aria-hidden="true" style={{ color: item.tone }}>
          ▸
        </span>
        <span style={{ minWidth: 0 }}>{item.text}</span>
      </div>
    ))}
  </div>
);

/**
 * MarketInternalsRail — compact supporting tier for the Market overview: live
 * sector rotation + leaders/laggards from the flow-ranked universe, plus the
 * breadth, rates-proxy, and market-read context ported from the classic Market
 * screen. Clicking a mover loads it into the chart grid.
 */
export default function MarketInternalsRail({ isVisible = false, onSelectSymbol }) {
  const snapshot = useMarketFlowSnapshotForStoreKey(BROAD_MARKET_FLOW_STORE_KEY);
  const sectorFlow = snapshot?.sectorFlow ?? [];
  const putCall = snapshot?.putCall ?? {};

  // Breadth + rates context (pure builders over the tracked reference universe;
  // same helpers the classic Market screen uses — no extra queries).
  const breadth = buildTrackedBreadthSummary();
  const ratesSummary = buildRatesProxySummary();
  const volatilityProxy =
    MACRO_TICKERS.find((item) => item.sym === "VIXY") || MACRO_TICKERS[0];
  const upPct = isFiniteNumber(breadth.advancePct) ? breadth.advancePct : 0;
  const downPct = breadth.total ? 100 - upPct : 0;
  const putCallBullish = isFiniteNumber(putCall.total) ? putCall.total <= 1 : null;
  const breadthTone = isFiniteNumber(breadth.advancePct)
    ? breadth.advancePct >= 55
      ? CSS_COLOR.green
      : breadth.advancePct <= 45
        ? CSS_COLOR.red
        : CSS_COLOR.amber
    : CSS_COLOR.textDim;
  const putCallTone =
    putCallBullish == null
      ? CSS_COLOR.textDim
      : toneForDirectionalIntent(putCallBullish ? "bullish" : "bearish");
  const volTone = !isFiniteNumber(volatilityProxy?.pct)
    ? CSS_COLOR.textDim
    : volatilityProxy.pct <= 0
      ? CSS_COLOR.green
      : CSS_COLOR.amber;
  const breadthStats = [
    ["5D+", isFiniteNumber(breadth.positive5dPct) ? `${breadth.positive5dPct.toFixed(0)}%` : MISSING_VALUE],
    ["Sectors+", breadth.sectorCoverage ? `${breadth.positiveSectors}/${breadth.sectorCoverage}` : MISSING_VALUE],
    ["Lead", breadth.leader?.sym || MISSING_VALUE],
    ["Lag", breadth.laggard?.sym || MISSING_VALUE],
  ];
  const marketReadItems = [
    {
      tone: breadthTone,
      text: `Breadth is ${breadth.total ? `${breadth.advancers}/${breadth.total}` : "unavailable"} with ${isFiniteNumber(breadth.positive5dPct) ? `${breadth.positive5dPct.toFixed(0)}%` : MISSING_VALUE} positive over five sessions.`,
    },
    {
      tone: putCallTone,
      text: `Put/call is ${isFiniteNumber(putCall.total) ? putCall.total.toFixed(2) : MISSING_VALUE}; ${putCallBullish == null ? "skew unavailable" : putCallBullish ? "risk appetite is firmer" : "protection demand is elevated"}.`,
    },
    {
      tone: volTone,
      text: `Vol/rates proxies: ${volatilityProxy?.sym || MISSING_VALUE} ${formatSignedPercent(volatilityProxy?.pct)}, rates led by ${ratesSummary.leader?.sym || MISSING_VALUE}.`,
    },
  ];

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
        <div style={{ display: "flex", flexDirection: "column", gap: sp("6px"), minWidth: 0 }}>
          <div style={{ color: CSS_COLOR.textDim, fontSize: textSize("body"), fontFamily: T.sans }}>
            Breadth
          </div>
          <BreadthSummary breadth={breadth} upPct={upPct} downPct={downPct} stats={breadthStats} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: sp("6px"), minWidth: 0 }}>
          <div style={{ color: CSS_COLOR.textDim, fontSize: textSize("body"), fontFamily: T.sans }}>
            Rates
          </div>
          <RatesList />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: sp("6px"), minWidth: 0 }}>
          <div style={{ color: CSS_COLOR.textDim, fontSize: textSize("body"), fontFamily: T.sans }}>
            Market read
          </div>
          <MarketReadList items={marketReadItems} />
        </div>
      </div>
    </SurfacePanel>
  );
}
