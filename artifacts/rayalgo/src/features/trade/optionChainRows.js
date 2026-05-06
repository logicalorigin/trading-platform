import { isFiniteNumber } from "../../lib/formatters";

const getOptionMark = (bid, ask, last) => {
  if (isFiniteNumber(bid) && bid > 0 && isFiniteNumber(ask) && ask > 0) {
    return +((bid + ask) / 2).toFixed(2);
  }
  return isFiniteNumber(last) ? +last.toFixed(2) : null;
};

export const patchOptionChainRowSideWithQuote = (row, side, quote) => {
  if (!row || !quote) {
    return row;
  }

  const prefix = side === "C" ? "c" : "p";
  const bid = isFiniteNumber(quote.bid)
    ? +quote.bid.toFixed(2)
    : row[`${prefix}Bid`];
  const ask = isFiniteNumber(quote.ask)
    ? +quote.ask.toFixed(2)
    : row[`${prefix}Ask`];
  const last = isFiniteNumber(quote.price)
    ? +quote.price.toFixed(2)
    : row[`${prefix}Prem`];

  return {
    ...row,
    [`${prefix}Prem`]: getOptionMark(bid, ask, last) ?? row[`${prefix}Prem`],
    [`${prefix}Bid`]: bid,
    [`${prefix}Ask`]: ask,
    [`${prefix}Vol`]: quote.volume ?? row[`${prefix}Vol`],
    [`${prefix}Oi`]: quote.openInterest ?? row[`${prefix}Oi`],
    [`${prefix}Iv`]: quote.impliedVolatility ?? row[`${prefix}Iv`],
    [`${prefix}Delta`]: quote.delta ?? row[`${prefix}Delta`],
    [`${prefix}Gamma`]: quote.gamma ?? row[`${prefix}Gamma`],
    [`${prefix}Theta`]: quote.theta ?? row[`${prefix}Theta`],
    [`${prefix}Vega`]: quote.vega ?? row[`${prefix}Vega`],
    [`${prefix}Freshness`]: quote.freshness ?? row[`${prefix}Freshness`],
    [`${prefix}MarketDataMode`]:
      quote.marketDataMode ?? row[`${prefix}MarketDataMode`],
    [`${prefix}QuoteUpdatedAt`]:
      quote.dataUpdatedAt ?? quote.updatedAt ?? row[`${prefix}QuoteUpdatedAt`],
  };
};

export const patchOptionChainRowWithQuoteGetter = (row, getQuoteSnapshot) => {
  if (!row || typeof getQuoteSnapshot !== "function") {
    return row;
  }

  const callQuote = getQuoteSnapshot(row.cContract?.providerContractId);
  const putQuote = getQuoteSnapshot(row.pContract?.providerContractId);
  return patchOptionChainRowSideWithQuote(
    patchOptionChainRowSideWithQuote(row, "C", callQuote),
    "P",
    putQuote,
  );
};

export const buildOptionChainRowsFromApi = (contracts, spotPrice) => {
  const rowsByStrike = new Map();

  (contracts || []).forEach((quote) => {
    const strike = quote?.contract?.strike;
    const right = quote?.contract?.right;
    if (typeof strike !== "number" || !right) return;
    const quoteFreshness = quote.quoteFreshness || quote.freshness || "metadata";
    const quoteUpdatedAt =
      quote.quoteUpdatedAt ||
      quote.dataUpdatedAt ||
      (quoteFreshness !== "metadata" ? quote.updatedAt : null) ||
      null;
    const hasPositivePrice =
      (isFiniteNumber(quote.bid) && quote.bid > 0) ||
      (isFiniteNumber(quote.ask) && quote.ask > 0) ||
      (isFiniteNumber(quote.last) && quote.last > 0) ||
      (isFiniteNumber(quote.mark) && quote.mark > 0);
    const hasNonPriceMarketData =
      isFiniteNumber(quote.volume) ||
      isFiniteNumber(quote.openInterest) ||
      isFiniteNumber(quote.impliedVolatility) ||
      isFiniteNumber(quote.delta) ||
      isFiniteNumber(quote.gamma) ||
      isFiniteNumber(quote.theta) ||
      isFiniteNumber(quote.vega);
    const quoteCanCarryMarketData =
      quoteFreshness !== "unavailable";
    const hasHydratedQuoteData =
      quoteCanCarryMarketData && (hasPositivePrice || hasNonPriceMarketData);
    const quoteNumber = (value) =>
      hasHydratedQuoteData && isFiniteNumber(value) ? value : null;
    const quotePrice = (value) =>
      hasHydratedQuoteData && isFiniteNumber(value) && value > 0 ? value : null;

    const row = rowsByStrike.get(strike) || {
      k: strike,
      cContract: null,
      cPrem: null,
      cBid: null,
      cAsk: null,
      cVol: null,
      cOi: null,
      cIv: null,
      cDelta: null,
      cGamma: null,
      cTheta: null,
      cVega: null,
      cFreshness: "metadata",
      cMarketDataMode: null,
      cQuoteUpdatedAt: null,
      pContract: null,
      pPrem: null,
      pBid: null,
      pAsk: null,
      pVol: null,
      pOi: null,
      pIv: null,
      pDelta: null,
      pGamma: null,
      pTheta: null,
      pVega: null,
      pFreshness: "metadata",
      pMarketDataMode: null,
      pQuoteUpdatedAt: null,
      isAtm: false,
    };
    const bid = quotePrice(quote.bid);
    const ask = quotePrice(quote.ask);
    const last = quotePrice(quote.last);
    const markValue = quotePrice(quote.mark);
    const mark =
      markValue != null && markValue > 0
        ? markValue
        : bid != null && ask != null && bid > 0 && ask > 0
          ? (bid + ask) / 2
          : last;

    if (right === "call") {
      row.cContract = quote.contract || null;
      row.cPrem = isFiniteNumber(mark) ? +mark.toFixed(2) : null;
      row.cBid = isFiniteNumber(bid) ? +bid.toFixed(2) : null;
      row.cAsk = isFiniteNumber(ask) ? +ask.toFixed(2) : null;
      row.cVol = quoteNumber(quote.volume);
      row.cOi = quoteNumber(quote.openInterest);
      row.cIv = quoteNumber(quote.impliedVolatility);
      row.cDelta = quoteNumber(quote.delta);
      row.cGamma = quoteNumber(quote.gamma);
      row.cTheta = quoteNumber(quote.theta);
      row.cVega = quoteNumber(quote.vega);
      row.cFreshness = quoteFreshness;
      row.cMarketDataMode = quote.marketDataMode || null;
      row.cQuoteUpdatedAt = quoteUpdatedAt;
    } else {
      row.pContract = quote.contract || null;
      row.pPrem = isFiniteNumber(mark) ? +mark.toFixed(2) : null;
      row.pBid = isFiniteNumber(bid) ? +bid.toFixed(2) : null;
      row.pAsk = isFiniteNumber(ask) ? +ask.toFixed(2) : null;
      row.pVol = quoteNumber(quote.volume);
      row.pOi = quoteNumber(quote.openInterest);
      row.pIv = quoteNumber(quote.impliedVolatility);
      row.pDelta = quoteNumber(quote.delta);
      row.pGamma = quoteNumber(quote.gamma);
      row.pTheta = quoteNumber(quote.theta);
      row.pVega = quoteNumber(quote.vega);
      row.pFreshness = quoteFreshness;
      row.pMarketDataMode = quote.marketDataMode || null;
      row.pQuoteUpdatedAt = quoteUpdatedAt;
    }

    rowsByStrike.set(strike, row);
  });

  const rows = Array.from(rowsByStrike.values()).sort(
    (left, right) => left.k - right.k,
  );
  if (!rows.length) return [];

  const fallbackAtmStrike = rows[Math.floor(rows.length / 2)]?.k ?? rows[0].k;
  const atmStrike = isFiniteNumber(spotPrice)
    ? rows.reduce(
        (closest, row) =>
          Math.abs(row.k - spotPrice) < Math.abs(closest - spotPrice)
            ? row.k
            : closest,
        rows[0].k,
      )
    : fallbackAtmStrike;

  return rows.map((row) => ({ ...row, isAtm: row.k === atmStrike }));
};
