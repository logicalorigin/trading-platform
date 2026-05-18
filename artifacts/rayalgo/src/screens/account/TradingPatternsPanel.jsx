import { useMemo, useState } from "react";
import { RADII, T, dim, sp } from "../../lib/uiTokens.jsx";
import { formatAppDateTime } from "../../lib/timeZone";
import {
  EmptyState,
  Panel,
  SectionHeader,
  ToggleGroup,
  formatNumber,
  secondaryButtonStyle,
  useCollapsibleSections,
} from "./accountUtils";
import { arrayValue, finiteNumber, startOfIsoWeek } from "./tradingPatterns/patternsCommon";
import { PatternsExitReasons } from "./tradingPatterns/PatternsExitReasons";
import { PatternsHoldProfile } from "./tradingPatterns/PatternsHoldProfile";
import { PatternsSummaryStrip } from "./tradingPatterns/PatternsSummaryStrip";
import { PatternsWaterfall } from "./tradingPatterns/PatternsWaterfall";
import { PatternsInsights } from "./tradingPatterns/PatternsInsights";
import { PatternsByTime } from "./tradingPatterns/PatternsByTime";
import { PatternsBySymbol } from "./tradingPatterns/PatternsBySymbol";
import { PatternsByBucket } from "./tradingPatterns/PatternsByBucket";
import { PatternsByOutcomeDriver } from "./tradingPatterns/PatternsByOutcomeDriver";
import { PatternsOutcomeDistribution } from "./tradingPatterns/PatternsOutcomeDistribution";
export { startOfIsoWeek };

const SORT_OPTIONS = [
  { value: "realizedPnl", label: "P&L" },
  { value: "expectancy", label: "Exp" },
  { value: "winRatePercent", label: "Win" },
  { value: "closedTrades", label: "Trades" },
];

export const TradingPatternsPanel = ({
  query,
  snapshotMutation,
  accountId,
  range,
  currency,
  maskValues = false,
  onSymbolSelect,
  selectedLens,
  onLensChange,
  analysis,
  onTradeSelect,
  lensFilteredTrades = null,
  isPhone = false,
}) => {
  const sectionDefaults = isPhone
    ? { insights: true, waterfall: true, byTime: true, holdProfile: true, bySymbol: true, exitReasons: true, byBucket: false, byOutcomeDriver: false, outcomeDistribution: false }
    : { insights: true, waterfall: true, byTime: true, holdProfile: true, bySymbol: true, exitReasons: true, byBucket: true, byOutcomeDriver: true, outcomeDistribution: true };
  const { isOpen, toggle } = useCollapsibleSections("patterns.openSections", sectionDefaults);
  const [sortKey, setSortKey] = useState("realizedPnl");
  const [tickerOrder, setTickerOrder] = useState("top");
  const packet = query.data || {};
  const summary = packet.summary || {};
  const snapshot = packet.snapshot || {};
  const tickerRows = useMemo(() => {
    const rows = arrayValue(packet.tickerStats);
    const sortedDesc = [...rows].sort((left, right) => {
      const delta = (finiteNumber(right?.[sortKey]) ?? 0) - (finiteNumber(left?.[sortKey]) ?? 0);
      return delta || String(left?.symbol || "").localeCompare(String(right?.symbol || ""));
    });
    return tickerOrder === "bottom" ? [...sortedDesc].reverse() : sortedDesc;
  }, [packet.tickerStats, sortKey, tickerOrder]);

  const loading = query.isLoading || query.isPending;
  const refreshing = snapshotMutation?.isPending;
  const selectedSymbol = selectedLens?.symbol || "";
  const lensActive = Boolean(selectedLens && selectedLens.kind && selectedLens.kind !== "none");
  const trades = arrayValue(lensFilteredTrades);

  const selectSymbol = (symbol) => {
    onSymbolSelect?.(symbol);
    onLensChange?.("symbol", { symbol });
  };

  const panelEmptyBody = snapshotMutation
    ? "Persist or refresh a Shadow analysis snapshot after trades or a watchlist backtest."
    : "Closed trades will populate account trading analysis once Flex or broker history is available.";

  return (
    <Panel
      title="Trading Analysis"
      rightRail={
        loading
          ? "Loading analysis packet"
          : snapshot.persisted
          ? `Snapshot ${formatAppDateTime(snapshot.createdAt)}`
          : `Live packet · ${formatNumber(summary.closedTrades || summary.count || 0, 0)} closed trades`
      }
      loading={loading}
      error={query.error || snapshotMutation?.error}
      onRetry={query.refetch}
      minHeight={270}
      action={
        <div style={{ display: "flex", gap: sp(4), flexWrap: "wrap", alignItems: "center" }}>
          <ToggleGroup options={SORT_OPTIONS} value={sortKey} onChange={setSortKey} />
          <ToggleGroup
            options={[
              { value: "top", label: "Top" },
              { value: "bottom", label: "Bottom" },
            ]}
            value={tickerOrder}
            onChange={setTickerOrder}
          />
          <button
            type="button"
            className="ra-interactive"
            onClick={() => onLensChange?.("pnl", { pnlSign: "winners" })}
            style={{
              ...secondaryButtonStyle,
              color: selectedLens?.pnlSign === "winners" ? T.green : T.textSec,
              borderColor: selectedLens?.pnlSign === "winners" ? T.green : T.border,
            }}
          >
            Winners
          </button>
          <button
            type="button"
            className="ra-interactive"
            onClick={() => onLensChange?.("pnl", { pnlSign: "losers" })}
            style={{
              ...secondaryButtonStyle,
              color: selectedLens?.pnlSign === "losers" ? T.red : T.textSec,
              borderColor: selectedLens?.pnlSign === "losers" ? T.red : T.border,
            }}
          >
            Losers
          </button>
          {snapshotMutation ? (
            <button
              type="button"
              className="ra-interactive"
              disabled={refreshing}
              onClick={() =>
                snapshotMutation.mutate({
                  accountId,
                  data: { range },
                })
              }
              style={{
                ...secondaryButtonStyle,
                color: refreshing ? T.textMuted : T.pink,
                borderColor: refreshing ? T.border : T.pink,
                cursor: refreshing ? "wait" : "pointer",
              }}
            >
              {refreshing ? "Refreshing" : "Snapshot"}
            </button>
          ) : null}
        </div>
      }
    >
      <div style={{ display: "grid", gap: sp(8) }}>
        <PatternsSummaryStrip
          summary={summary}
          riskMetrics={analysis?.riskMetrics}
          currency={currency}
          maskValues={maskValues}
        />

        <div style={{ display: "grid", gap: sp(5) }}>
          <SectionHeader
            title="Insights"
            onToggle={() => toggle("insights")}
            expanded={isOpen("insights")}
          />
          {isOpen("insights") ? (
            <PatternsInsights
              analysis={analysis}
              currency={currency}
              maskValues={maskValues}
              onLensChange={onLensChange}
              onTradeSelect={onTradeSelect}
            />
          ) : null}
        </div>

        <div style={{ display: "grid", gap: sp(5) }}>
          <SectionHeader
            title="Trade Waterfall"
            onToggle={() => toggle("waterfall")}
            expanded={isOpen("waterfall")}
          />
          {isOpen("waterfall") ? (
            <PatternsWaterfall
              waterfall={analysis?.waterfall}
              currency={currency}
              maskValues={maskValues}
              onTradeSelect={onTradeSelect}
            />
          ) : null}
        </div>

        <div style={{ display: "grid", gap: sp(5) }}>
          <SectionHeader
            title="By Time"
            onToggle={() => toggle("byTime")}
            expanded={isOpen("byTime")}
          />
          {isOpen("byTime") ? (
            <PatternsByTime
              trades={trades}
              timeStats={packet.timeStats}
              currency={currency}
              maskValues={maskValues}
              selectedLens={selectedLens}
              onLensChange={onLensChange}
            />
          ) : null}
        </div>

        <div style={{ display: "grid", gap: sp(5) }}>
          <SectionHeader
            title="Hold Profile"
            onToggle={() => toggle("holdProfile")}
            expanded={isOpen("holdProfile")}
          />
          {isOpen("holdProfile") ? (
            <PatternsHoldProfile
              bucketGroups={analysis?.bucketGroups}
              currency={currency}
              maskValues={maskValues}
              selectedLens={selectedLens}
              onLensChange={onLensChange}
            />
          ) : null}
        </div>

        <div style={{ display: "grid", gap: sp(5) }}>
          <SectionHeader
            title="Exit Reasons"
            onToggle={() => toggle("exitReasons")}
            expanded={isOpen("exitReasons")}
          />
          {isOpen("exitReasons") ? (
            <PatternsExitReasons
              bucketGroups={analysis?.bucketGroups}
              currency={currency}
              maskValues={maskValues}
            />
          ) : null}
        </div>

        <div style={{ display: "grid", gap: sp(5) }}>
          <SectionHeader
            title="By Bucket"
            onToggle={() => toggle("byBucket")}
            expanded={isOpen("byBucket")}
          />
          {isOpen("byBucket") ? (
            <PatternsByBucket
              bucketGroups={analysis?.bucketGroups}
              currency={currency}
              maskValues={maskValues}
              selectedLens={selectedLens}
              onLensChange={onLensChange}
            />
          ) : null}
        </div>

        <div style={{ display: "grid", gap: sp(5) }}>
          <SectionHeader
            title="By Outcome Driver"
            onToggle={() => toggle("byOutcomeDriver")}
            expanded={isOpen("byOutcomeDriver")}
          />
          {isOpen("byOutcomeDriver") ? (
            <PatternsByOutcomeDriver
              contractBreakdowns={analysis?.contractBreakdowns}
              bucketGroups={analysis?.bucketGroups}
              stopScenarios={analysis?.stopScenarios}
              currency={currency}
              maskValues={maskValues}
            />
          ) : null}
        </div>

        {!tickerRows.length ? (
          <div
            style={{
              border: `1px dashed ${T.border}`,
              borderRadius: dim(RADII.sm),
              background: T.bg0,
              padding: sp(10),
            }}
          >
            <EmptyState title="No trading analysis yet" body={panelEmptyBody} />
          </div>
        ) : (
          <>
            <div style={{ display: "grid", gap: sp(5) }}>
              <SectionHeader
                title="By Symbol"
                onToggle={() => toggle("bySymbol")}
                expanded={isOpen("bySymbol")}
              />
              {isOpen("bySymbol") ? (
                <PatternsBySymbol
                  tickerRows={tickerRows}
                  sourceRows={packet.sourceStats}
                  symbolsTraded={summary.symbolsTraded}
                  tickerOrder={tickerOrder}
                  currency={currency}
                  maskValues={maskValues}
                  selectedSymbol={selectedSymbol}
                  onSymbolSelect={selectSymbol}
                />
              ) : null}
            </div>

            <div style={{ display: "grid", gap: sp(5) }}>
              <SectionHeader
                title="Outcome Distribution"
                onToggle={() => toggle("outcomeDistribution")}
                expanded={isOpen("outcomeDistribution")}
              />
              {isOpen("outcomeDistribution") ? (
                <PatternsOutcomeDistribution
                  trades={trades}
                  currency={currency}
                  maskValues={maskValues}
                  lensActive={lensActive}
                />
              ) : null}
            </div>
          </>
        )}
      </div>
    </Panel>
  );
};

export default TradingPatternsPanel;
