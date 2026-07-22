export const ORDER_BLOTTER_CANCELLATION_AVAILABLE = false;
export const ORDER_BLOTTER_CANCELLATION_UNAVAILABLE_REASON =
  "This order list cannot verify that the broker order belongs to PYRUS's prepared lifecycle. Cancel an app-tracked order from its active order ticket.";
export const CLOSE_REVIEW_QUOTE_MAX_AGE_MS = 30_000;
export const CLOSE_REVIEW_QUOTE_FUTURE_TOLERANCE_MS = 5_000;

const quoteTimestampMs = (value) => {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return Math.abs(value) >= 1e11 ? value : value * 1_000;
  }
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const isCloseReviewQuoteTimestampCurrent = ({
  timestamp,
  now = Date.now(),
} = {}) => {
  const timestampMs = quoteTimestampMs(timestamp);
  const nowMs = Number(now);
  if (!Number.isFinite(timestampMs) || !Number.isFinite(nowMs)) return false;
  const ageMs = nowMs - timestampMs;
  return (
    ageMs >= -CLOSE_REVIEW_QUOTE_FUTURE_TOLERANCE_MS &&
    ageMs <= CLOSE_REVIEW_QUOTE_MAX_AGE_MS
  );
};

const unsupportedCloseReview = (reason) => ({ intent: null, reason });

const sourceSnapshotAt = (position) => {
  const value =
    position?.quote?.dataUpdatedAt ??
    position?.quote?.updatedAt ??
    position?.optionQuote?.dataUpdatedAt ??
    position?.optionQuote?.updatedAt ??
    position?.dataUpdatedAt ??
    position?.updatedAt ??
    null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  return value == null ? null : String(value);
};

const normalizeOptionRight = (value) => {
  const right = String(value ?? "").trim().toLowerCase();
  if (right === "call" || right === "c") return "call";
  if (right === "put" || right === "p") return "put";
  return null;
};

const closeReviewOptionContract = (position) => {
  const contract = position?.optionContract;
  if (!contract) return null;
  const ticker = String(contract.ticker ?? position?.symbol ?? "").trim();
  const underlying = String(
    contract.underlying ?? position?.marketDataSymbol ?? "",
  )
    .trim()
    .toUpperCase();
  const expirationDate = contract.expirationDate ?? contract.exp ?? contract.expiry;
  const strike = Number(contract.strike);
  const right = normalizeOptionRight(contract.right ?? contract.cp);
  const multiplier = Number(contract.multiplier);
  const sharesPerContract = Number(contract.sharesPerContract);
  const providerContractId = String(contract.providerContractId ?? "").trim();
  const brokerContractId = String(contract.brokerContractId ?? "").trim();
  if (
    !ticker ||
    !underlying ||
    !expirationDate ||
    !Number.isFinite(strike) ||
    strike <= 0 ||
    !right ||
    !Number.isInteger(multiplier) ||
    multiplier <= 0 ||
    !Number.isInteger(sharesPerContract) ||
    sharesPerContract <= 0 ||
    (!providerContractId && !brokerContractId)
  ) {
    return null;
  }
  return {
    ticker,
    underlying,
    expirationDate,
    strike,
    right,
    multiplier,
    sharesPerContract,
    ...(providerContractId
      ? { providerContractId }
      : {}),
    ...(brokerContractId
      ? { brokerContractId }
      : {}),
  };
};

const closeReviewContractsMatch = (left, right) => {
  const leftProvider = String(left?.providerContractId ?? "");
  const rightProvider = String(right?.providerContractId ?? "");
  const leftBroker = String(left?.brokerContractId ?? "");
  const rightBroker = String(right?.brokerContractId ?? "");
  return Boolean(
    left &&
      right &&
      String(left.underlying).toUpperCase() ===
        String(right.underlying).toUpperCase() &&
      String(left.expirationDate).slice(0, 10) ===
        String(right.expirationDate).slice(0, 10) &&
      Number(left.strike) === Number(right.strike) &&
      left.right === right.right &&
      Number(left.multiplier) === Number(right.multiplier) &&
      Number(left.sharesPerContract) === Number(right.sharesPerContract) &&
      (!leftProvider || leftProvider === rightProvider) &&
      (!leftBroker || leftBroker === rightBroker),
  );
};

export const getIbkrCloseReviewIntentIssue = (intent) => {
  const accountId = String(intent?.accountId ?? "").trim();
  const quantity = Number(intent?.quantity);
  const commonIsValid =
    intent?.kind === "ibkr_position_close_review" &&
    intent?.provider === "ibkr" &&
    intent?.executionMode === "live" &&
    accountId &&
    !["all", "combined", "shadow"].includes(accountId.toLowerCase()) &&
    ["equity", "option"].includes(intent?.assetClass) &&
    String(intent?.symbol ?? "").trim() &&
    String(intent?.positionId ?? "").trim() &&
    Number.isInteger(quantity) &&
    quantity > 0 &&
    Number(intent?.observedQuantity) === quantity &&
    intent?.side === "SELL" &&
    intent?.orderType === "LMT" &&
    intent?.timeInForce === "DAY";
  if (!commonIsValid) {
    return "The close-review request is invalid or incomplete. Return to Positions and try again.";
  }
  if (intent.assetClass === "equity") {
    return intent.optionContract == null
      ? null
      : "The close-review request is invalid or incomplete. Return to Positions and try again.";
  }
  if (
    intent.optionAction !== "sell_to_close" ||
    intent.positionEffect !== "close" ||
    intent.strategyIntent !== "sell_to_close" ||
    !closeReviewOptionContract({
      symbol: intent.optionContract?.ticker,
      marketDataSymbol: intent.symbol,
      optionContract: intent.optionContract,
    })
  ) {
    return "The close-review request is missing the exact option contract or sell-to-close semantics.";
  }
  return null;
};

export const getIbkrCloseReviewPositionIssue = ({
  intent,
  positions = [],
  contextReady = false,
} = {}) => {
  if (!intent) return null;
  if (!contextReady) {
    return "Wait for fresh live position inventory before previewing this close.";
  }
  const position = positions.find(
    (candidate) => String(candidate?.id ?? "") === String(intent.positionId),
  );
  if (!position || Number(position.quantity) <= 0) {
    return "The source position is no longer open. Return to Positions and start again.";
  }
  if (Number(position.quantity) !== Number(intent.observedQuantity)) {
    return "The source position quantity changed. Return to Positions and start a fresh close review.";
  }
  if (intent.assetClass === "option") {
    const currentContract = closeReviewOptionContract(position);
    if (!closeReviewContractsMatch(intent.optionContract, currentContract)) {
      return "The source option contract changed or could not be verified. Return to Positions and start again.";
    }
  } else if (
    position.optionContract ||
    String(position.marketDataSymbol ?? position.symbol ?? "")
      .trim()
      .toUpperCase() !== intent.symbol
  ) {
    return "The source equity position changed or could not be verified. Return to Positions and start again.";
  }
  return null;
};

export const buildIbkrCloseReviewIntent = ({ accountId, provider, position }) => {
  if (String(provider ?? "").trim().toLowerCase() !== "ibkr") {
    return unsupportedCloseReview(
      "Review close is available only for a specific direct IBKR account.",
    );
  }
  const normalizedAccountId = String(accountId ?? "").trim();
  if (
    !normalizedAccountId ||
    ["all", "combined", "shadow"].includes(normalizedAccountId.toLowerCase())
  ) {
    return unsupportedCloseReview("Select one specific IBKR account to review a close.");
  }
  const quantity = Number(position?.quantity);
  if (!Number.isFinite(quantity) || quantity === 0 || !Number.isInteger(quantity)) {
    return unsupportedCloseReview(
      "Review close currently supports whole-share or whole-contract positions only.",
    );
  }
  const isOption = Boolean(position?.optionContract) ||
    ["option", "options"].includes(
      String(position?.positionType ?? position?.assetClass ?? "").toLowerCase(),
    );
  if (quantity < 0) {
    return unsupportedCloseReview(
      isOption
        ? "Short-option close is disabled until buy-to-close tax uncertainty is covered."
        : "Short-equity close is disabled because a BUY cannot yet be bounded to the short position.",
    );
  }

  const optionContract = isOption ? closeReviewOptionContract(position) : null;
  if (isOption && !optionContract) {
    return unsupportedCloseReview(
      "This option is missing the exact contract identity required for a safe close review.",
    );
  }
  const positionId = String(position?.id ?? "").trim();
  if (!positionId) {
    return unsupportedCloseReview(
      "This position is missing the exact source position identity required for a safe close review.",
    );
  }
  const symbol = String(
    optionContract?.underlying ?? position?.marketDataSymbol ?? position?.symbol ?? "",
  )
    .trim()
    .toUpperCase();
  if (!symbol) {
    return unsupportedCloseReview("This position is missing the symbol required for review.");
  }

  return {
    intent: {
      kind: "ibkr_position_close_review",
      provider: "ibkr",
      accountId: normalizedAccountId,
      executionMode: "live",
      positionId,
      symbol,
      assetClass: isOption ? "option" : "equity",
      observedQuantity: quantity,
      quantity,
      side: "SELL",
      orderType: "LMT",
      timeInForce: "DAY",
      ...(isOption
        ? {
            optionAction: "sell_to_close",
            positionEffect: "close",
            strategyIntent: "sell_to_close",
          }
        : {}),
      optionContract,
      sourceSnapshotAt: sourceSnapshotAt(position),
    },
    reason: null,
  };
};
