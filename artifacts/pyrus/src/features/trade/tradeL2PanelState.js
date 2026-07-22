export const resolveTradeL2QuoteState = ({ row = null, cp = "C" } = {}) => {
  if (!row) {
    return { kind: "unavailable", spread: null };
  }

  const prefix = cp === "P" ? "p" : "c";
  const bid = row[`${prefix}Bid`];
  const ask = row[`${prefix}Ask`];
  if (
    !Number.isFinite(bid) ||
    !Number.isFinite(ask) ||
    bid < 0 ||
    ask < bid
  ) {
    return { kind: "partial", spread: null };
  }

  return {
    kind: "ready",
    spread: Number((ask - bid).toFixed(6)),
  };
};

export const resolveTradeL2TapeState = ({
  hasContractRow = false,
  brokerConfigured = false,
  brokerAuthenticated = false,
  accountId = null,
  providerContractId = null,
  queryEnabled = true,
  isPending = false,
  isError = false,
  isFetching = false,
  executions = [],
} = {}) => {
  const hasRows = Array.isArray(executions) && executions.length > 0;

  if (!hasContractRow) {
    return {
      kind: "locked",
      showRows: false,
      title: "No live contract fills",
      detail:
        "This panel unlocks once the selected contract resolves to a live chain row.",
    };
  }
  if (!brokerConfigured) {
    return {
      kind: "unavailable",
      showRows: false,
      title: "IBKR fills unavailable",
      detail:
        "The tape tab shows broker executions for this contract once the bridge is configured.",
    };
  }
  if (!brokerAuthenticated) {
    return {
      kind: "auth",
      showRows: false,
      title: "IBKR login required",
      detail: "Connect IBKR Client Portal to load broker executions.",
    };
  }
  if (!accountId) {
    return {
      kind: "account",
      showRows: false,
      title: "No broker account selected",
      detail: "Select an IBKR account to load this contract's execution history.",
    };
  }
  if (!providerContractId) {
    return {
      kind: "loading",
      showRows: false,
      title: "Contract still loading",
      detail:
        "Wait for the selected option contract to resolve to a broker contract id.",
    };
  }
  if (!queryEnabled) {
    return {
      kind: "waiting",
      showRows: false,
      title: "Broker fills waiting",
      detail:
        "Execution history loads after Trade analysis and the primary chart are active.",
    };
  }
  if (hasRows && isError) {
    return {
      kind: "stale",
      showRows: true,
      notice: "Showing last broker fills · refresh failed",
    };
  }
  if (hasRows && isFetching) {
    return {
      kind: "refreshing",
      showRows: true,
      notice: "Refreshing broker fills",
    };
  }
  if (hasRows) {
    return {
      kind: "ready",
      showRows: true,
      notice: null,
    };
  }
  if (isError) {
    return {
      kind: "error",
      showRows: false,
      title: "IBKR fills unavailable",
      detail:
        "The broker execution request failed. Retry without leaving this contract.",
    };
  }
  if (isPending) {
    return {
      kind: "loading",
      showRows: false,
      title: "Loading IBKR fills",
      detail: "Requesting broker executions for the selected option contract.",
    };
  }
  return {
    kind: "empty",
    showRows: false,
    title: "No broker fills yet",
    detail:
      "This tab shows IBKR executions for the selected contract. It is not a public market-wide tape.",
  };
};
