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
    () => Array.from(new Set(collectAlgoRuntimeProviderContractIds(positions, symbolIndex))),
    [positions, symbolIndex],
  );
  const quoteVersion = useStoredOptionQuoteSnapshotVersion(providerContractIds);
  const runtimeRows = useMemo(() => {
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
    positions,
    providerContractIds,
    quoteVersion,
    symbolIndex,
  ]);
  const rows = useMemo(
    () =>
      hasAccountPositionsQuery
        ? scopedAccountRows
        : runtimeRows,
    [hasAccountPositionsQuery, runtimeRows, scopedAccountRows],
  );
  const response = useMemo(
    () => buildAlgoAccountPositionsResponse(rows),
    [rows],
  );
  const query = useMemo(
    () =>
      hasAccountPositionsQuery
        ? {
            data: {
              ...(accountPositionsQuery.data ||
                buildAlgoAccountPositionsResponse([])),
              totals: response.totals,
              positions: rows,
            },
            isLoading: accountPositionsQuery.isLoading,
            error: accountPositionsQuery.error,
            refetch: accountPositionsQuery.refetch,
          }
        : {
            data: response,
            isLoading: Boolean(accountPositionsQuery?.isLoading),
            error: accountPositionsQuery?.error || null,
            refetch: accountPositionsQuery?.refetch || (() => undefined),
          },
    [
      accountPositionsQuery,
      hasAccountPositionsQuery,
      response,
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
            ? "Shadow account positions + live option quotes"
            : "Runtime positions + live option quotes"
        }
        emptyBody="Open shadow option positions will appear here once an entry signal fills."
        showFilters={false}
        isPhone={algoIsPhone}
        liveOptionQuotesEnabled={true}
        streamLiveOptionQuotes={true}
        surfaceId="algo"
      />
    </div>
  );
};

export default OperationsPositionsTable;
