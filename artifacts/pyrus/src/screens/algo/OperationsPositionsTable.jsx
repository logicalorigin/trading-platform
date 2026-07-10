import { useMemo } from "react";
import PositionsPanel from "../account/PositionsPanel";
import { setAlgoFocus } from "../../features/platform/algoFocusStore";
import {
  buildAlgoAccountPositionsResponse,
  filterAccountPositionRowsForDeployment,
} from "./algoAccountPositions";

export const OperationsPositionsTable = ({
  accountPositionsQuery = null,
  deploymentId = null,
  filterByDeployment = true,
  sourceLabel = "Shadow algo positions",
  algoIsPhone,
}) => {
  const accountRows = accountPositionsQuery?.data?.positions || [];
  const scopedAccountRows = useMemo(
    () =>
      filterByDeployment
        ? filterAccountPositionRowsForDeployment({
            rows: accountRows,
            deploymentId,
          })
        : accountRows,
    [accountRows, deploymentId, filterByDeployment],
  );
  const response = useMemo(
    () => buildAlgoAccountPositionsResponse(scopedAccountRows),
    [scopedAccountRows],
  );
  const query = useMemo(
    () => ({
      ...accountPositionsQuery,
      data: accountPositionsQuery?.data
        ? {
            ...accountPositionsQuery.data,
            totals: response.totals,
            positions: scopedAccountRows,
          }
        : accountPositionsQuery?.data,
      refetch: accountPositionsQuery?.refetch || (() => undefined),
    }),
    [accountPositionsQuery, response.totals, scopedAccountRows],
  );

  return (
    <div data-testid="algo-operations-positions-table">
      <PositionsPanel
        query={query}
        currency="USD"
        assetFilter="all"
        onAssetFilterChange={() => undefined}
        sourceFilter="all"
        onJumpToChart={(symbol) => setAlgoFocus(symbol, "position")}
        onPositionSelect={(row) => setAlgoFocus(row?.symbol, "position")}
        rightRail={sourceLabel}
        emptyBody="Open shadow algo positions will appear here once an entry signal fills."
        showFilters={false}
        isPhone={algoIsPhone}
        liveOptionQuotesEnabled={true}
        streamLiveOptionQuotes={!filterByDeployment}
        optionQuoteStreamOwner="algo-position-option-quotes"
        optionQuoteStreamIntent="automation-live"
        registerMarketDataSymbols={!filterByDeployment}
        surfaceId="algo"
      />
    </div>
  );
};

export default OperationsPositionsTable;
