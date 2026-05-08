const MS_PER_DAY = 24 * 60 * 60 * 1000;

export const GEX_DEFAULT_EXPIRATION_LIMIT = 10;
export const GEX_CHAIN_QUERY_DEFAULTS = Object.freeze({
  staleTime: 5 * 60_000,
  refetchInterval: false,
  refetchOnMount: false,
  refetchOnReconnect: false,
  refetchOnWindowFocus: false,
  retry: 1,
  gcTime: 5 * 60_000,
});

export const isFiniteNumber = (value) =>
  typeof value === "number" && Number.isFinite(value);

const finiteOrNull = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const finiteOrZero = (value) => finiteOrNull(value) ?? 0;

export const normalizeGexTicker = (value, fallback = "SPY") => {
  const normalized = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
  return normalized || fallback;
};

const normalizeRight = (value) => {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === "C" || normalized === "CALL") return "C";
  if (normalized === "P" || normalized === "PUT") return "P";
  return "";
};

const parseExpirationDateParts = (value) => {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
};

export const getGexOptionContractKey = (quote) => {
  const contract = quote?.contract || {};
  return (
    contract.ticker ||
    [
      contract.underlying,
      contract.expirationDate,
      contract.strike,
      contract.right,
    ]
      .filter((part) => part !== undefined && part !== null && part !== "")
      .join(":")
  );
};

export const dedupeOptionChainContracts = (contracts = []) => {
  const byKey = new Map();
  contracts.forEach((quote) => {
    const key = getGexOptionContractKey(quote);
    if (!key) return;
    byKey.set(key, quote);
  });
  return Array.from(byKey.values());
};

export const normalizeGexOptionChain = (contracts = []) => {
  const rows = [];
  const coverage = {
    total: 0,
    usable: 0,
    calls: 0,
    puts: 0,
    withGamma: 0,
    withOpenInterest: 0,
    withImpliedVolatility: 0,
  };

  dedupeOptionChainContracts(contracts).forEach((quote) => {
    coverage.total += 1;
    const contract = quote?.contract || {};
    const cp = normalizeRight(contract.right);
    const expirationParts = parseExpirationDateParts(contract.expirationDate);
    const strike = finiteOrNull(contract.strike);
    if (!cp || !expirationParts || !isFiniteNumber(strike)) return;

    const gamma = finiteOrNull(quote.gamma);
    const openInterest = finiteOrNull(quote.openInterest);
    const impliedVolatility = finiteOrNull(quote.impliedVolatility);
    const multiplier =
      finiteOrNull(contract.multiplier) ??
      finiteOrNull(contract.sharesPerContract) ??
      100;

    coverage.usable += 1;
    coverage.calls += cp === "C" ? 1 : 0;
    coverage.puts += cp === "P" ? 1 : 0;
    coverage.withGamma += gamma != null ? 1 : 0;
    coverage.withOpenInterest += openInterest != null ? 1 : 0;
    coverage.withImpliedVolatility += impliedVolatility != null ? 1 : 0;

    rows.push({
      ticker: contract.ticker || null,
      underlying: contract.underlying || null,
      expirationDate: contract.expirationDate,
      expireYear: expirationParts.year,
      expireMonth: expirationParts.month,
      expireDay: expirationParts.day,
      strike,
      cp,
      gamma: gamma ?? 0,
      delta: finiteOrNull(quote.delta),
      openInterest: Math.max(0, openInterest ?? 0),
      impliedVol: impliedVolatility ?? 0,
      bid: finiteOrNull(quote.bid),
      ask: finiteOrNull(quote.ask),
      mark: finiteOrNull(quote.mark),
      last: finiteOrNull(quote.last),
      volume: finiteOrNull(quote.volume),
      multiplier: multiplier > 0 ? multiplier : 100,
      updatedAt: quote.updatedAt || quote.dataUpdatedAt || null,
      quoteFreshness: quote.quoteFreshness || null,
      marketDataMode: quote.marketDataMode || null,
    });
  });

  return { rows, coverage };
};

export const normalizeGexResponseOptions = (options = []) => {
  const rows = [];
  const coverage = {
    total: 0,
    usable: 0,
    calls: 0,
    puts: 0,
    withGamma: 0,
    withOpenInterest: 0,
    withImpliedVolatility: 0,
  };

  options.forEach((option) => {
    coverage.total += 1;
    const cp = normalizeRight(option?.cp);
    const strike = finiteOrNull(option?.strike);
    const expireYear = finiteOrNull(option?.expireYear);
    const expireMonth = finiteOrNull(option?.expireMonth);
    const expireDay = finiteOrNull(option?.expireDay);
    const gamma = finiteOrNull(option?.gamma);
    const openInterest = finiteOrNull(option?.openInterest);
    const impliedVolatility = finiteOrNull(option?.impliedVol);

    if (gamma != null) coverage.withGamma += 1;
    if (openInterest != null) coverage.withOpenInterest += 1;
    if (impliedVolatility != null) coverage.withImpliedVolatility += 1;

    if (
      !cp ||
      strike == null ||
      expireYear == null ||
      expireMonth == null ||
      expireDay == null
    ) {
      return;
    }

    coverage.usable += 1;
    coverage.calls += cp === "C" ? 1 : 0;
    coverage.puts += cp === "P" ? 1 : 0;

    const expirationDate = `${String(expireYear).padStart(4, "0")}-${String(
      expireMonth,
    ).padStart(2, "0")}-${String(expireDay).padStart(2, "0")}`;

    rows.push({
      ticker: option?.ticker || null,
      underlying: option?.underlying || null,
      expirationDate,
      expireYear,
      expireMonth,
      expireDay,
      strike,
      cp,
      gamma: gamma ?? 0,
      delta: finiteOrNull(option?.delta),
      openInterest: Math.max(0, openInterest ?? 0),
      impliedVol: impliedVolatility ?? 0,
      bid: finiteOrNull(option?.bid),
      ask: finiteOrNull(option?.ask),
      multiplier: finiteOrNull(option?.multiplier) ?? 100,
    });
  });

  return { rows, coverage };
};

export const contractGex = (option, spot) => {
  const price = finiteOrNull(spot);
  if (!price || price <= 0) return 0;
  const sign = option?.cp === "P" ? -1 : 1;
  const multiplier = finiteOrNull(option?.multiplier) ?? 100;
  return (
    sign *
    finiteOrZero(option?.gamma) *
    Math.max(0, finiteOrZero(option?.openInterest)) *
    multiplier *
    price *
    price *
    0.01
  );
};

export const aggregateProfile = (rows = [], spot) => {
  const map = new Map();
  rows.forEach((option) => {
    const strike = finiteOrNull(option.strike);
    if (!isFiniteNumber(strike)) return;
    const current =
      map.get(strike) || {
        strike,
        callGex: 0,
        putGex: 0,
        netGex: 0,
        callOi: 0,
        putOi: 0,
      };
    const gex = contractGex(option, spot);
    if (option.cp === "C") {
      current.callGex += gex;
      current.callOi += Math.max(0, finiteOrZero(option.openInterest));
    } else {
      current.putGex += gex;
      current.putOi += Math.max(0, finiteOrZero(option.openInterest));
    }
    current.netGex = current.callGex + current.putGex;
    map.set(strike, current);
  });
  return Array.from(map.values()).sort((left, right) => left.strike - right.strike);
};

const findZeroGamma = (profile) => {
  if (!profile.length) return null;
  let previousStrike = profile[0].strike;
  let previousCum = profile[0].netGex;
  if (previousCum === 0) return previousStrike;

  for (let index = 1; index < profile.length; index += 1) {
    const row = profile[index];
    const nextCum = previousCum + row.netGex;
    if (
      (previousCum < 0 && nextCum >= 0) ||
      (previousCum > 0 && nextCum <= 0) ||
      nextCum === 0
    ) {
      const denominator = Math.abs(previousCum) + Math.abs(nextCum);
      const t = denominator > 0 ? Math.abs(previousCum) / denominator : 0;
      return previousStrike + t * (row.strike - previousStrike);
    }
    previousStrike = row.strike;
    previousCum = nextCum;
  }

  return null;
};

export const aggregateMetrics = (rows = [], spot) => {
  const profile = aggregateProfile(rows, spot);
  const callGex = profile.reduce((sum, row) => sum + row.callGex, 0);
  const putGex = profile.reduce((sum, row) => sum + row.putGex, 0);
  const netGex = callGex + putGex;
  const totalGex = Math.abs(callGex) + Math.abs(putGex);
  const ratio = Math.abs(putGex) === 0 ? Infinity : callGex / Math.abs(putGex);
  const callWallRow = profile.reduce(
    (best, row) => (row.callGex > (best?.callGex ?? -Infinity) ? row : best),
    null,
  );
  const putWallRow = profile.reduce(
    (best, row) => (row.putGex < (best?.putGex ?? Infinity) ? row : best),
    null,
  );
  const peakGexRow = profile.reduce((best, row) => {
    const current = Math.abs(row.callGex) + Math.abs(row.putGex);
    const previous = best ? Math.abs(best.callGex) + Math.abs(best.putGex) : -1;
    return current > previous ? row : best;
  }, null);

  return {
    profile,
    callGex,
    putGex,
    netGex,
    totalGex,
    ratio,
    callWall: callWallRow?.strike ?? null,
    putWall: putWallRow?.strike ?? null,
    zeroGamma: findZeroGamma(profile),
    callOi: profile.reduce((sum, row) => sum + row.callOi, 0),
    putOi: profile.reduce((sum, row) => sum + row.putOi, 0),
    peakGexStrike: peakGexRow?.strike ?? null,
  };
};

const expirationDayDistance = (option, now = new Date()) => {
  const todayUtc = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  const expirationUtc = Date.UTC(
    option.expireYear,
    option.expireMonth - 1,
    option.expireDay,
  );
  return Math.round((expirationUtc - todayUtc) / MS_PER_DAY);
};

export const expConcentration = (rows = [], spot, now = new Date()) => {
  let total = 0;
  let zeroDte = 0;
  let weekly = 0;
  let monthly = 0;
  rows.forEach((option) => {
    const days = expirationDayDistance(option, now);
    const value = Math.abs(contractGex(option, spot));
    total += value;
    if (days === 0) zeroDte += value;
    if (days >= 0 && days <= 7) weekly += value;
    if (days >= 0 && days <= 30) monthly += value;
  });
  if (!total) return { zeroDTE: 0, weekly: 0, monthly: 0 };
  return {
    zeroDTE: zeroDte / total,
    weekly: weekly / total,
    monthly: monthly / total,
  };
};

export const gexByExpiry = (rows = [], spot, now = new Date()) => {
  const map = new Map();
  rows.forEach((option) => {
    const key = option.expirationDate;
    if (!key) return;
    const days = expirationDayDistance(option, now);
    const expDate = new Date(Date.UTC(option.expireYear, option.expireMonth - 1, option.expireDay));
    const current =
      map.get(key) || {
        key,
        days,
        label:
          days === 0
            ? "0DTE"
            : expDate.toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                timeZone: "UTC",
              }),
        sublabel: days === 0 ? "today" : `${days}d`,
        callGex: 0,
        putGex: 0,
        netGex: 0,
      };
    const gex = contractGex(option, spot);
    if (option.cp === "C") current.callGex += gex;
    else current.putGex += gex;
    current.netGex = current.callGex + current.putGex;
    map.set(key, current);
  });
  return Array.from(map.values()).sort((left, right) => left.days - right.days);
};

export const oiByStrike = (rows = []) => {
  const map = new Map();
  rows.forEach((option) => {
    const strike = finiteOrNull(option.strike);
    if (!isFiniteNumber(strike)) return;
    const current =
      map.get(strike) || { strike, callOi: 0, putOi: 0, totalOi: 0 };
    if (option.cp === "C") current.callOi += Math.max(0, finiteOrZero(option.openInterest));
    else current.putOi += Math.max(0, finiteOrZero(option.openInterest));
    current.totalOi = current.callOi + current.putOi;
    map.set(strike, current);
  });
  return Array.from(map.values()).sort((left, right) => left.strike - right.strike);
};

export const maxPainStrike = (rows = []) => {
  const strikes = Array.from(new Set(rows.map((row) => row.strike)))
    .filter(isFiniteNumber)
    .sort((left, right) => left - right);
  let bestStrike = null;
  let minCost = Infinity;
  strikes.forEach((candidate) => {
    let cost = 0;
    rows.forEach((option) => {
      const oi = Math.max(0, finiteOrZero(option.openInterest));
      if (option.cp === "C" && candidate > option.strike) {
        cost += oi * (candidate - option.strike);
      } else if (option.cp === "P" && candidate < option.strike) {
        cost += oi * (option.strike - candidate);
      }
    });
    if (cost < minCost) {
      minCost = cost;
      bestStrike = candidate;
    }
  });
  return bestStrike;
};

export const gammaPriceProfile = (rows = [], spot, now = new Date()) => {
  const price = finiteOrNull(spot);
  if (!price || price <= 0) return [];
  const minPrice = price * 0.95;
  const maxPrice = price * 1.05;
  const steps = 60;
  const baked = rows
    .map((option) => {
      const days = Math.max(0.5, expirationDayDistance(option, now));
      const tenor = days / 365;
      const sigma = Math.max(0.05, finiteOrZero(option.impliedVol));
      const sigmaK = option.strike * sigma * Math.sqrt(tenor);
      return {
        strike: option.strike,
        sign: option.cp === "P" ? -1 : 1,
        oi: Math.max(0, finiteOrZero(option.openInterest)),
        multiplier: finiteOrNull(option.multiplier) ?? 100,
        sigmaK,
        oneOverScale: 1 / (sigma * Math.sqrt(tenor) * Math.sqrt(2 * Math.PI)),
      };
    })
    .filter((option) => option.oi > 0 && option.sigmaK > 0);

  return Array.from({ length: steps + 1 }, (_, index) => {
    const projectedSpot = minPrice + ((maxPrice - minPrice) * index) / steps;
    const netGex = baked.reduce((sum, option) => {
      const z = (projectedSpot - option.strike) / option.sigmaK;
      const kernel = (Math.exp(-(z * z) / 2) * option.oneOverScale) / projectedSpot;
      return (
        sum +
        option.sign *
          option.oi *
          option.multiplier *
          projectedSpot *
          projectedSpot *
          0.01 *
          kernel
      );
    }, 0);
    return { price: projectedSpot, netGex };
  });
};

export const computeSignals = (metrics, spot) => {
  const signals = [];
  if (!metrics || !isFiniteNumber(spot)) return signals;
  if (metrics.netGex > 0) {
    signals.push({
      kind: "Volatility",
      severity: "STRONG",
      level: spot,
      delta: 0,
      description: "Price movements likely to be dampened, good for selling volatility.",
    });
  }
  if (metrics.peakGexStrike != null) {
    const delta = (metrics.peakGexStrike - spot) / spot;
    if (Math.abs(delta) < 0.02) {
      signals.push({
        kind: "Magnet",
        severity: Math.abs(delta) < 0.0025 ? "STRONG" : "MODERATE",
        level: metrics.peakGexStrike,
        delta,
        description: "Price likely to gravitate toward this level.",
      });
    }
  }
  if (metrics.zeroGamma != null && metrics.zeroGamma < spot) {
    const delta = (metrics.zeroGamma - spot) / spot;
    signals.push({
      kind: "Support",
      severity: Math.abs(delta) < 0.005 ? "STRONG" : "MODERATE",
      level: metrics.zeroGamma,
      delta,
      description: "Market dynamics change significantly if breached.",
    });
  }
  if (metrics.putWall != null && metrics.putWall < spot * 0.97) {
    signals.push({
      kind: "Volatility",
      severity: "STRONG",
      level: metrics.putWall,
      delta: (metrics.putWall - spot) / spot,
      description: "Expect increased volatility if price falls below this level.",
    });
  }
  return signals;
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export const computeDirectionalSqueeze = (metrics, spot, flow, direction) => {
  const apiBullishShare = finiteOrNull(flow?.bullishShare);
  const usableFlow = flow && !flow.pending && apiBullishShare != null;
  const isBullish = direction === "bullish";
  const wallStrike = isBullish ? metrics.callWall : metrics.putWall;
  const bullishShare = apiBullishShare != null ? clamp(apiBullishShare, 0, 1) : 0;
  const flowShare = isBullish ? bullishShare : 1 - bullishShare;
  const deltaShare = isBullish
    ? finiteOrZero(flow?.netDelta) / Math.max(1, finiteOrZero(flow?.refDelta))
    : -finiteOrZero(flow?.netDelta) / Math.max(1, finiteOrZero(flow?.refDelta));
  const gammaRegime = metrics.netGex < 0 ? 25 : 0;
  const wallProximity =
    wallStrike == null
      ? 0
      : clamp(25 * (1 - Math.abs(wallStrike - spot) / spot / 0.02), 0, 25);
  const flowAlignment = usableFlow ? clamp(flowShare * 25, 0, 25) : 0;
  const volumeConfirm =
    usableFlow && flow.volumeBaselineReady !== false && flow.todayVol > flow.avg30dVol
      ? 25
      : usableFlow
        ? 5
        : 0;
  const dexBias = usableFlow ? clamp(25 * deltaShare, 0, 25) : 0;
  const factors = {
    gammaRegime,
    wallProximity,
    flowAlignment,
    volumeConfirm,
    dexBias,
  };
  const score = Math.round(
    gammaRegime + wallProximity + flowAlignment + volumeConfirm + dexBias,
  );
  const verdict =
    score < 25
      ? "Unlikely"
      : score < 50
        ? "Possible"
        : score < 75
          ? "Likely"
          : "Imminent";
  return { direction, score, verdict, factors, wallStrike };
};

export const computeSqueeze = (metrics, spot, flow) => {
  const bullish = computeDirectionalSqueeze(metrics, spot, flow, "bullish");
  const bearish = computeDirectionalSqueeze(metrics, spot, flow, "bearish");
  const primary = bullish.score >= bearish.score ? bullish : bearish;
  const alternate = bullish.score >= bearish.score ? bearish : bullish;
  return {
    ...primary,
    bias: primary.direction === "bullish" ? "BULLISH" : "BEARISH",
    alternate,
    flowPending: Boolean(!flow || flow.pending),
    flowEventCount: flow?.eventCount || 0,
  };
};

export const selectGexExpirations = (
  expirations = [],
  selectedExpiration = "all",
  limit = GEX_DEFAULT_EXPIRATION_LIMIT,
) => {
  const dates = expirations
    .map((expiration) =>
      typeof expiration === "string"
        ? expiration
        : expiration?.expirationDate || expiration?.isoDate || "",
    )
    .filter(Boolean)
    .sort();
  if (selectedExpiration && selectedExpiration !== "all") {
    return dates.includes(selectedExpiration) ? [selectedExpiration] : [];
  }
  return dates.slice(0, Math.max(1, limit));
};

export const chunkGexExpirations = (values = [], chunkSize = 2) => {
  const chunks = [];
  for (let index = 0; index < values.length; index += chunkSize) {
    chunks.push(values.slice(index, index + chunkSize));
  }
  return chunks;
};
