import { useMemo } from "react";
import { MarketIdentityInline } from "../../features/platform/marketIdentity";
import { T, dim, sp, textSize } from "../../lib/uiTokens.jsx";
import {
  EmptyState,
  InlineError,
  Panel,
  SectionHeader,
  SkeletonRows,
  formatAccountMoney,
  formatAccountPercent,
  toneForValue,
} from "./accountUtils";
import { buildAccountRiskDisplayModel } from "../../features/account/accountPositionRows.js";
import { AllocationCompactContent } from "./AllocationPanel";
import { RiskCompactContent } from "./RiskDashboardPanel";

const TopConcentrationFooter = ({ rows, currency, maskValues }) => {
  const trimmed = (rows || []).slice(0, 3);
  return (
    <div style={{ display: "grid", gap: sp(4) }}>
      <SectionHeader title="Top Concentration" />
      {trimmed.length ? (
        trimmed.map((row) => (
          <div
            key={`exposure-conc:${row.symbol || row.sector}`}
            style={{
              display: "grid",
              gridTemplateColumns: "1fr auto auto",
              gap: sp(5),
              alignItems: "center",
              padding: sp("1px 0"),
              borderBottom: `1px solid ${T.border}`,
              fontSize: textSize("caption"),
              fontFamily: T.sans,
            }}
          >
            <span style={{ color: T.text, minWidth: 0 }}>
              {row.symbol ? (
                <MarketIdentityInline
                  item={{ ticker: row.symbol, market: "stocks" }}
                  size={14}
                  showMark={false}
                  showChips
                  style={{ maxWidth: dim(120) }}
                />
              ) : (
                row.sector
              )}
            </span>
            <span style={{ color: toneForValue(row.marketValue) }}>
              {formatAccountMoney(row.marketValue, currency, true, maskValues)}
            </span>
            <span style={{ color: T.textDim }}>
              {row.weightPercent == null
                ? "—"
                : formatAccountPercent(row.weightPercent, 1, maskValues)}
            </span>
          </div>
        ))
      ) : (
        <div style={{ color: T.textMuted, fontSize: textSize("body") }}>No concentration</div>
      )}
    </div>
  );
};

export const PortfolioExposurePanel = ({
  allocationQuery,
  riskQuery,
  positionsResponse,
  currency,
  maskValues = false,
  subtitle,
  rightRail,
}) => {
  const riskModel = useMemo(
    () => buildAccountRiskDisplayModel(riskQuery.data, positionsResponse),
    [riskQuery.data, positionsResponse],
  );

  const resolvedSubtitle = subtitle ?? "Holdings, risk, and concentration";
  const resolvedRightRail = rightRail ?? undefined;

  const renderHoldings = () => {
    if (allocationQuery.isLoading) return <SkeletonRows rows={3} />;
    if (allocationQuery.error)
      return <InlineError error={allocationQuery.error} onRetry={allocationQuery.refetch} />;
    return (
      <AllocationCompactContent
        data={allocationQuery.data}
        currency={currency}
        maskValues={maskValues}
      />
    );
  };

  const renderRisk = () => {
    if (riskQuery.isLoading) return <SkeletonRows rows={3} />;
    if (riskQuery.error)
      return <InlineError error={riskQuery.error} onRetry={riskQuery.refetch} />;
    return <RiskCompactContent data={riskModel} currency={currency} maskValues={maskValues} />;
  };

  const allBlank =
    !allocationQuery.isLoading &&
    !allocationQuery.error &&
    !(allocationQuery.data?.assetClass?.length) &&
    !riskQuery.isLoading &&
    !riskQuery.error &&
    !riskModel;

  return (
    <Panel
      title="Portfolio Exposure"
      subtitle={resolvedSubtitle}
      rightRail={resolvedRightRail}
    >
      {allBlank ? (
        <EmptyState
          title="No exposure yet"
          body="Open positions, cash balances, and IBKR risk metrics will populate this panel."
        />
      ) : (
        <div style={{ display: "grid", gap: sp(6) }}>
          <div style={{ display: "grid", gap: sp(4) }}>
            <SectionHeader title="Holdings" />
            {renderHoldings()}
          </div>

          <div style={{ display: "grid", gap: sp(4) }}>
            <SectionHeader title="Risk" />
            {renderRisk()}
          </div>

          <TopConcentrationFooter
            rows={riskModel?.concentration?.topPositions}
            currency={currency}
            maskValues={maskValues}
          />
        </div>
      )}
    </Panel>
  );
};

export default PortfolioExposurePanel;
