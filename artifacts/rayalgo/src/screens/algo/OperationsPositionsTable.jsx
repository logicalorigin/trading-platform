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

const rowIdentity = (row) => {
  const providerContractId = String(row?.optionContract?.providerContractId || "").trim();
  if (providerContractId) return `contract:${providerContractId}`;
  const id = String(row?.id || "").trim();
  if (id) return `id:${id}`;
  const symbol = String(row?.symbol || "").trim().toUpperCase();
  return symbol ? `symbol:${symbol}` : "";
};

const mergeLedgerAndRuntimeRows = (ledgerRows, runtimeRows) => {
  if (!ledgerRows.length) return runtimeRows;
  if (!runtimeRows.length) return ledgerRows;
  const ledgerIdentities = new Set(ledgerRows.map(rowIdentity).filter(Boolean));
  const missingRuntimeRows = runtimeRows.filter((row) => {
    const identity = rowIdentity(row);
    return identity && !ledgerIdentities.has(identity);
  });
  return missingRuntimeRows.length ? [...ledgerRows, ...missingRuntimeRows] : ledgerRows;
};

export const OperationsPositionsTable = ({
  positions = [],
  accountPositionsQuery = null,
  symbolIndex = {},
  deploymentId = null,
  algoIsPhone,
}) => {
  const accountRows = accountPositionsQuery?.data?.positions || [];
  const hasAccountPositionsQuery = Boolean(accountPositionsQuery);
  const accountQueryHasRows = accountRows.length > 0;
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
    () => mergeLedgerAndRuntimeRows(scopedAccountRows, runtimeRows),
    [runtimeRows, scopedAccountRows],
  );
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
          accountQueryHasRows
            ? "Focused shadow ledger"
            : "Runtime positions + live option quotes"
        }
        emptyBody="Open shadow option positions will appear here once an entry signal fills."
        showFilters={false}
        isPhone={algoIsPhone}
        liveOptionQuotesEnabled={!accountQueryHasRows}
        streamLiveOptionQuotes={!accountQueryHasRows}
      />
    </div>
  );
};

export default OperationsPositionsTable;
