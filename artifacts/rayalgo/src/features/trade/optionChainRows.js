import { isFiniteNumber } from "../../lib/formatters";

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
    const hasAnyQuoteData =
      isFiniteNumber(quote.bid) ||
      isFiniteNumber(quote.ask) ||
      isFiniteNumber(quote.last) ||
      isFiniteNumber(quote.mark) ||
      isFiniteNumber(quote.volume) ||
      isFiniteNumber(quote.openInterest) ||
      isFiniteNumber(quote.impliedVolatility) ||
      isFiniteNumber(quote.delta) ||
      isFiniteNumber(quote.gamma) ||
      isFiniteNumber(quote.theta) ||
      isFiniteNumber(quote.vega);
    const quoteCanCarryMarketData =
      quoteFreshness !== "metadata" &&
      quoteFreshness !== "pending" &&
      quoteFreshness !== "unavailable";
    const hasHydratedQuoteData =
      quoteCanCarryMarketData && (Boolean(quoteUpdatedAt) || hasAnyQuoteData);
    const quoteNumber = (value) =>
      hasHydratedQuoteData && isFiniteNumber(value) ? value : null;

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
    const bid = quoteNumber(quote.bid);
    const ask = quoteNumber(quote.ask);
    const last = quoteNumber(quote.last);
    const markValue = quoteNumber(quote.mark);
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
