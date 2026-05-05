const finitePositive = (value) =>
  typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;

const level = ({ id, label, price, tone }) => {
  const resolvedPrice = finitePositive(price);
  return {
    id,
    label,
    price: resolvedPrice,
    tone,
    disabled: resolvedPrice === null,
  };
};

export const buildTradePreviewLaneLevels = ({
  ticketIsShares = false,
  equityPrice = null,
  bid = null,
  mid = null,
  ask = null,
} = {}) => {
  if (ticketIsShares) {
    return [
      level({
        id: "last",
        label: "LAST",
        price: equityPrice,
        tone: "neutral",
      }),
    ];
  }

  return [
    level({ id: "bid", label: "BID", price: bid, tone: "sell" }),
    level({ id: "mid", label: "MID", price: mid, tone: "neutral" }),
    level({ id: "ask", label: "ASK", price: ask, tone: "buy" }),
  ];
};

export const formatPreviewLanePrice = (price) => {
  const resolvedPrice = finitePositive(price);
  return resolvedPrice === null ? "--" : resolvedPrice.toFixed(2);
};
