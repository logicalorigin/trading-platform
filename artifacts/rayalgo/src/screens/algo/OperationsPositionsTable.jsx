import { useMemo } from "react";
import PositionsPanel from "../account/PositionsPanel";
import { setAlgoFocus } from "../../features/platform/algoFocusStore";
import {
  getStoredOptionQuoteSnapshot,
  useStoredOptionQuoteSnapshotVersion,
} from "../../features/platform/live-streams";
import {
  asRecord,
  mergeOptionQuoteSnapshot,
  optionProviderContractId,
} from "./algoHelpers";
import {
  buildAlgoAccountPositionRows,
  buildAlgoAccountPositionsResponse,
} from "./algoAccountPositions";

const collectRuntimeProviderContractIds = (positions, symbolIndex) =>
  Array.from(
    new Set(
      (positions || [])
        .map((position) => {
          const symbol = String(position?.symbol || "").toUpperCase();
          const candidate = asRecord(symbolIndex[symbol]?.candidate);
          const positionContract = asRecord(position?.selectedContract);
          const selectedContract = Object.keys(positionContract).length
            ? positionContract
            : asRecord(candidate.selectedContract);
          return optionProviderContractId(selectedContract);
        })
        .filter(Boolean),
    ),
  );

const collectAccountProviderContractIds = (positions) =>
  (positions || [])
    .map((position) => optionProviderContractId(position?.optionContract))
    .filter(Boolean);

const withLiveOptionQuotes = (rows, liveQuoteByContractId) =>
  (rows || []).map((row) => {
    const providerContractId = optionProviderContractId(row?.optionContract);
    const liveQuote = providerContractId
      ? liveQuoteByContractId[providerContractId]
      : null;
    if (!liveQuote) return row;
    return {
      ...row,
      optionQuote: mergeOptionQuoteSnapshot(row.optionQuote, liveQuote),
    };
  });

export const OperationsPositionsTable = ({
  positions = [],
  accountPositionsQuery = null,
  symbolIndex = {},
  algoIsPhone,
}) => {
  const accountRows = accountPositionsQuery?.data?.positions || [];
  const hasAccountPositionsResponse = Boolean(accountPositionsQuery?.data);
  const providerContractIds = useMemo(
    () =>
      Array.from(
        new Set([
          ...collectRuntimeProviderContractIds(positions, symbolIndex),
          ...collectAccountProviderContractIds(accountRows),
        ]),
      ),
    [accountRows, positions, symbolIndex],
  );
  const quoteVersion = useStoredOptionQuoteSnapshotVersion(providerContractIds);
  const rows = useMemo(() => {
    const liveQuoteByContractId = Object.fromEntries(
      providerContractIds.map((providerContractId) => [
        providerContractId,
        getStoredOptionQuoteSnapshot(providerContractId),
      ]),
    );
    if (hasAccountPositionsResponse) {
      return withLiveOptionQuotes(accountRows, liveQuoteByContractId);
    }
    return buildAlgoAccountPositionRows({
      positions,
      symbolIndex,
      liveQuoteByContractId,
    });
  }, [
    accountRows,
    hasAccountPositionsResponse,
    positions,
    providerContractIds,
    quoteVersion,
    symbolIndex,
  ]);
  const query = useMemo(
    () =>
      hasAccountPositionsResponse
        ? {
            data: {
              ...accountPositionsQuery.data,
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
      hasAccountPositionsResponse,
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
          hasAccountPositionsResponse
            ? "Shadow account ledger + live option quotes"
            : "Runtime positions + live option quotes"
        }
        emptyBody="Open shadow option positions will appear here once an entry signal fills."
        showFilters={false}
        isPhone={algoIsPhone}
      />
    </div>
  );
};

export default OperationsPositionsTable;
