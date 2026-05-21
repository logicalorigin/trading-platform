import { useMemo } from "react";
import PositionsPanel from "../account/PositionsPanel";
import { setAlgoFocus } from "../../features/platform/algoFocusStore";
import {
  getStoredOptionQuoteSnapshot,
  useStoredOptionQuoteSnapshotVersion,
} from "../../features/platform/live-streams";
import {
  buildAlgoAccountPositionRows,
  buildAlgoAccountPositionsResponse,
  collectAlgoRuntimeProviderContractIds,
  filterAccountPositionRowsForDeployment,
} from "./algoAccountPositions";

export const OperationsPositionsTable = ({
  positions = [],
  accountPositionsQuery = null,
  symbolIndex = {},
  deploymentId = null,
  algoIsPhone,
}) => {
  const accountRows = accountPositionsQuery?.data?.positions || [];
  const hasAccountPositionsQuery = Boolean(accountPositionsQuery);
  const scopedAccountRows = useMemo(
    () =>
      filterAccountPositionRowsForDeployment({
        rows: accountRows,
        deploymentId,
      }),
    [accountRows, deploymentId],
  );
  const providerContractIds = useMemo(
    () => {
      const contractIds = hasAccountPositionsQuery
        ? []
        : collectAlgoRuntimeProviderContractIds(positions, symbolIndex);
      return Array.from(new Set(contractIds));
    },
    [hasAccountPositionsQuery, positions, symbolIndex],
  );
  const quoteVersion = useStoredOptionQuoteSnapshotVersion(providerContractIds);
  const rows = useMemo(() => {
    if (hasAccountPositionsQuery) {
      return scopedAccountRows;
    }
    const liveQuoteByContractId = Object.fromEntries(
      providerContractIds.map((providerContractId) => [
        providerContractId,
        getStoredOptionQuoteSnapshot(providerContractId),
      ]),
    );
    return buildAlgoAccountPositionRows({
      positions,
      symbolIndex,
      liveQuoteByContractId,
    });
  }, [
    hasAccountPositionsQuery,
    positions,
    providerContractIds,
    quoteVersion,
    scopedAccountRows,
    symbolIndex,
  ]);
  const query = useMemo(
    () =>
      hasAccountPositionsQuery
        ? {
            data: {
              ...(accountPositionsQuery.data ||
                buildAlgoAccountPositionsResponse([])),
              positions: rows,
            },
            isLoading: accountPositionsQuery.isLoading,
            error: accountPositionsQuery.error,
            refetch: accountPositionsQuery.refetch,
          }
        : {
            data: buildAlgoAccountPositionsResponse(rows),
            isLoading: Boolean(accountPositionsQuery?.isLoading),
            error: accountPositionsQuery?.error || null,
            refetch: accountPositionsQuery?.refetch || (() => undefined),
          },
    [
      accountPositionsQuery,
      hasAccountPositionsQuery,
      rows,
    ],
  );

  return (
    <div data-testid="algo-operations-positions-table">
      <PositionsPanel
        query={query}
        currency="USD"
        assetFilter="Options"
        onAssetFilterChange={() => undefined}
        sourceFilter="all"
        onJumpToChart={(symbol) => setAlgoFocus(symbol, "position")}
        onPositionSelect={(row) => setAlgoFocus(row?.symbol, "position")}
        rightRail={
          hasAccountPositionsQuery
            ? "Focused shadow ledger"
            : "Runtime positions + live option quotes"
        }
        emptyBody="Open shadow option positions will appear here once an entry signal fills."
        showFilters={false}
        isPhone={algoIsPhone}
        liveOptionQuotesEnabled={!hasAccountPositionsQuery}
        streamLiveOptionQuotes={!hasAccountPositionsQuery}
      />
    </div>
  );
};

export default OperationsPositionsTable;
