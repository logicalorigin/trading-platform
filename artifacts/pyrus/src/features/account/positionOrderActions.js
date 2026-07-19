// Order-request builders for managing an open account position directly from
// the positions table (Close + protective-stop edit). These mirror the proven
// request shapes in src/features/trade/TradePositionsPanel.jsx so the account
// surface routes through the exact same broker contract; keep them in sync.

export const ORDER_BLOTTER_CANCELLATION_AVAILABLE = false;
export const ORDER_BLOTTER_CANCELLATION_UNAVAILABLE_REASON =
  "This order list cannot verify that the broker order belongs to PYRUS's prepared lifecycle. Cancel an app-tracked order from its active order ticket.";

export const buildOptionContractPayload = (optionContract) =>
  optionContract
    ? {
        ticker: optionContract.ticker,
        underlying: optionContract.underlying,
        expirationDate: optionContract.expirationDate,
        strike: optionContract.strike,
        right: optionContract.right,
        multiplier: optionContract.multiplier,
        sharesPerContract: optionContract.sharesPerContract,
        providerContractId: optionContract.providerContractId,
      }
    : null;

// Exit side is the opposite of the position: long (qty >= 0) sells to close,
// short buys to close. Used by both the flatten and protective-stop requests.
export const positionExitSide = (position) => (position.quantity >= 0 ? "sell" : "buy");

export const buildCloseOrderRequest = ({ accountId, environment, position }) => ({
  accountId,
  mode: environment,
  symbol: position.symbol,
  assetClass: position.assetClass,
  side: positionExitSide(position),
  type: "market",
  quantity: Math.abs(position.quantity),
  timeInForce: "day",
  optionContract: buildOptionContractPayload(position.optionContract),
});

export const buildStopOrderRequest = ({ accountId, environment, position, stopPrice }) => ({
  accountId,
  mode: environment,
  symbol: position.symbol,
  assetClass: position.assetClass,
  side: positionExitSide(position),
  type: "stop",
  quantity: Math.abs(position.quantity),
  stopPrice,
  timeInForce: "gtc",
  optionContract: buildOptionContractPayload(position.optionContract),
});
