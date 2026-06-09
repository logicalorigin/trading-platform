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
  const scopedAccountRows = useMemo(
    () =>
      filterAccountPositionRowsForDeployment({
        rows: accountRows,
        deploymentId,
      }),
    [accountRows, deploymentId],
  );
  const providerContractIds = useMemo(
    () =>
      Array.from(
        new Set(collectAlgoRuntimeProviderContractIds(positions, symbolIndex)),
      ),
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
  }, [positions, providerContractIds, quoteVersion, symbolIndex]);
  const accountPositionsSettled = Boolean(
    accountPositionsQuery?.data ||
      accountPositionsQuery?.isFetched ||
      accountPositionsQuery?.isSuccess ||
      accountPositionsQuery?.isError,
  );
  const useAccountPositionRows = Boolean(
    scopedAccountRows.length ||
      (accountPositionsSettled && runtimeRows.length === 0),
  );
  const rows = useMemo(
    () => (useAccountPositionRows ? scopedAccountRows : runtimeRows),
    [runtimeRows, scopedAccountRows, useAccountPositionRows],
  );
  const response = useMemo(
    () => buildAlgoAccountPositionsResponse(rows),
    [rows],
  );
  const query = useMemo(
    () => ({
      data: useAccountPositionRows
        ? {
            ...(accountPositionsQuery?.data ||
              buildAlgoAccountPositionsResponse([])),
            totals: response.totals,
            positions: rows,
          }
        : response,
      isLoading: Boolean(
        useAccountPositionRows && accountPositionsQuery?.isLoading && !rows.length,
      ),
      isPending: Boolean(
        useAccountPositionRows && accountPositionsQuery?.isPending && !rows.length,
      ),
      error: useAccountPositionRows ? accountPositionsQuery?.error : null,
      refetch: accountPositionsQuery?.refetch || (() => undefined),
    }),
    [accountPositionsQuery, response, rows, useAccountPositionRows],
  );
  const positionsSourceLabel = useAccountPositionRows
    ? "Shadow algo positions"
    : "Runtime algo positions";

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
        rightRail={positionsSourceLabel}
        emptyBody="Open shadow algo positions will appear here once an entry signal fills."
        showFilters={false}
        isPhone={algoIsPhone}
        liveOptionQuotesEnabled={true}
        streamLiveOptionQuotes={true}
        optionQuoteStreamOwner="algo-position-option-quotes"
        optionQuoteStreamIntent="automation-live"
        registerMarketDataSymbols={false}
        surfaceId="algo"
      />
    </div>
  );
};

export default OperationsPositionsTable;
