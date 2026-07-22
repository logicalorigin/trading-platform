export const OPTION_ORDER_ACTIONS = [
  "buy_to_open",
  "buy_to_close",
  "sell_to_close",
  "sell_to_open",
];

const normalizeRight = (value) => {
  const right = String(value || "").trim().toLowerCase();
  if (right === "c") return "call";
  if (right === "p") return "put";
  return right === "call" || right === "put" ? right : null;
};

const ACTION_FIELDS = {
  buy_to_open: {
    abbreviation: "BTO",
    actionLabel: "BUY TO OPEN",
    side: "BUY",
    positionSide: "BUY",
    positionEffect: "open",
    strategyIntent: "long_option",
  },
  buy_to_close: {
    abbreviation: "BTC",
    actionLabel: "BUY TO CLOSE",
    side: "BUY",
    positionSide: "SELL",
    positionEffect: "close",
    strategyIntent: undefined,
  },
  sell_to_close: {
    abbreviation: "STC",
    actionLabel: "SELL TO CLOSE",
    side: "SELL",
    positionSide: "BUY",
    positionEffect: "close",
    strategyIntent: "sell_to_close",
  },
  sell_to_open: {
    abbreviation: "STO",
    actionLabel: "SELL TO OPEN",
    side: "SELL",
    positionSide: "SELL",
    positionEffect: "open",
  },
};

export const resolveOptionOrderIntent = ({ action, right } = {}) => {
  const actionFields = ACTION_FIELDS[action];
  const normalizedRight = normalizeRight(right);
  if (!actionFields || !normalizedRight) return null;

  const contractLabel = normalizedRight.toUpperCase();
  if (action === "sell_to_open") {
    const call = normalizedRight === "call";
    return {
      action,
      ...actionFields,
      strategyIntent: call ? "covered_call" : "cash_secured_put",
      intentLabel: call ? "COVERED CALL" : "CASH-SECURED PUT",
      detail: call
        ? "Open a covered call. Shares and working-order reservations are rechecked before routing."
        : "Open a cash-secured put. Cash and working-order reservations are rechecked before routing.",
    };
  }

  const labels = {
    buy_to_open: `LONG ${contractLabel}`,
    buy_to_close: `CLOSE SHORT ${contractLabel}`,
    sell_to_close: `CLOSE LONG ${contractLabel}`,
  };
  const details = {
    buy_to_open: `Open a long ${normalizedRight}. Maximum loss is the premium and fees paid.`,
    buy_to_close: `Close an existing short ${normalizedRight}; the order cannot open a long position.`,
    sell_to_close: `Close an existing long ${normalizedRight}; quantity cannot exceed the held contracts.`,
  };
  return {
    action,
    ...actionFields,
    intentLabel: labels[action],
    detail: details[action],
  };
};

export const resolveOptionActionAvailability = ({
  action,
  executionMode,
  broker,
  positionContextReady = false,
  matchingLongQuantity = 0,
  quantity = 0,
} = {}) => {
  if (!ACTION_FIELDS[action]) {
    return { enabled: false, reason: "Choose a valid option action." };
  }

  if (executionMode !== "shadow") {
    if (broker === "ibkr" || action === "buy_to_open") {
      return { enabled: true, reason: "" };
    }
    return {
      enabled: false,
      reason:
        "This broker action stays blocked until the ticket has account-scoped position and working-order context.",
    };
  }

  if (action === "buy_to_open") {
    return { enabled: true, reason: "" };
  }
  if (action !== "sell_to_close") {
    return {
      enabled: false,
      reason: "Shadow supports long option opens and exact-contract long closes only.",
    };
  }
  if (!positionContextReady) {
    return {
      enabled: false,
      reason: "Shadow option positions are still loading.",
    };
  }

  const available = Math.max(0, Number(matchingLongQuantity) || 0);
  const requested = Math.max(0, Number(quantity) || 0);
  if (available < requested || available <= 0) {
    return {
      enabled: false,
      reason: `Shadow holds only ${available} matching long contract${available === 1 ? "" : "s"}.`,
    };
  }
  return { enabled: true, reason: "" };
};
