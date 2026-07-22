import { marketDayDistanceFromExpirationKey } from "./gexDate.js";

export const isFiniteNumber = (value) =>
  typeof value === "number" && Number.isFinite(value);

const finiteOrNull = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const finiteOrZero = (value) => finiteOrNull(value) ?? 0;

const resolveContractMultiplier = (option) => {
  const multiplier = finiteOrNull(option?.multiplier);
  if (multiplier != null && multiplier > 0) return multiplier;
  const sharesPerContract = finiteOrNull(option?.sharesPerContract);
  return sharesPerContract != null && sharesPerContract > 0
    ? sharesPerContract
    : 100;
};

export const isGexHalfDollarStrike = (value) => {
  const strike = finiteOrNull(value);
  if (strike == null || strike <= 0) return false;
  const halfDollarSteps = Math.round(strike * 2);
  return Math.abs(strike * 2 - halfDollarSteps) < 1e-6;
};

export const formatGexStrikePrice = (value) => {
  const strike = finiteOrNull(value);
  return strike != null ? `$${strike.toFixed(2)}` : "—";
};

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

const validateExpirationDateParts = (year, month, day) => {
  const timestamp = Date.UTC(year, month - 1, day);
  const date = new Date(timestamp);
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? { year, month, day }
    : null;
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
    const multiplier = resolveContractMultiplier(option);
    const sharesPerContract = finiteOrNull(option?.sharesPerContract);

    if (
      !cp ||
      strike == null ||
      !isGexHalfDollarStrike(strike) ||
      expireYear == null ||
      expireMonth == null ||
      expireDay == null ||
      !validateExpirationDateParts(expireYear, expireMonth, expireDay)
    ) {
      return;
    }

    coverage.usable += 1;
    coverage.calls += cp === "C" ? 1 : 0;
    coverage.puts += cp === "P" ? 1 : 0;
    coverage.withGamma += gamma != null ? 1 : 0;
    coverage.withOpenInterest += openInterest != null ? 1 : 0;
    coverage.withImpliedVolatility += impliedVolatility != null ? 1 : 0;

    const expirationDate = `${String(expireYear).padStart(4, "0")}-${String(
      expireMonth,
    ).padStart(2, "0")}-${String(expireDay).padStart(2, "0")}`;

    rows.push({
      ticker: option?.ticker || null,
      underlying: option?.underlying || null,
      expirationDate,
      providerContractId: option?.providerContractId || null,
      expireYear,
      expireMonth,
      expireDay,
      strike,
      cp,
      gamma: gamma ?? 0,
      delta: finiteOrNull(option?.delta),
      theta: finiteOrNull(option?.theta),
      vega: finiteOrNull(option?.vega),
      openInterest: Math.max(0, openInterest ?? 0),
      impliedVol: impliedVolatility ?? 0,
      bid: finiteOrNull(option?.bid),
      ask: finiteOrNull(option?.ask),
      mark: finiteOrNull(option?.mark),
      multiplier,
      sharesPerContract:
        sharesPerContract != null && sharesPerContract > 0
          ? sharesPerContract
          : multiplier,
      volume: finiteOrNull(option?.volume),
      updatedAt: option?.updatedAt || null,
      quoteFreshness: option?.quoteFreshness || null,
      marketDataMode: option?.marketDataMode || null,
    });
  });

  return { rows, coverage };
};

export const contractGex = (option, spot) => {
  const price = finiteOrNull(spot);
  if (!price || price <= 0) return 0;
  const sign = option?.cp === "P" ? -1 : 1;
  const multiplier = resolveContractMultiplier(option);
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

const chooseNearestTie = (candidate, best, spot) => {
  if (!best) return candidate;
  const price = finiteOrNull(spot);
  if (price == null) return best;
  const candidateDistance = Math.abs(candidate.strike - price);
  const bestDistance = Math.abs(best.strike - price);
  return candidateDistance < bestDistance ? candidate : best;
};

const selectNetWallRow = (profile, spot, direction) => {
  const price = finiteOrNull(spot);
  const isCallWall = direction === "call";
  const isNetCandidate = (row) =>
    isCallWall ? row.netGex > 0 : row.netGex < 0;
  const isSideCandidate = (row) =>
    price == null
      ? true
      : isCallWall
        ? row.strike >= price
        : row.strike <= price;
  const valueForRow = (row) => (isCallWall ? row.netGex : -row.netGex);

  const findBest = (rows) =>
    rows.reduce((best, row) => {
      const currentValue = valueForRow(row);
      const bestValue = best ? valueForRow(best) : -Infinity;
      if (currentValue > bestValue) return row;
      if (currentValue === bestValue) return chooseNearestTie(row, best, spot);
      return best;
    }, null);

  return (
    findBest(profile.filter((row) => isNetCandidate(row) && isSideCandidate(row))) ||
    findBest(profile.filter(isNetCandidate)) ||
    null
  );
};

export const aggregateMetrics = (rows = [], spot) => {
  const profile = aggregateProfile(rows, spot);
  const callGex = profile.reduce((sum, row) => sum + row.callGex, 0);
  const putGex = profile.reduce((sum, row) => sum + row.putGex, 0);
  const netGex = callGex + putGex;
  const totalGex = Math.abs(callGex) + Math.abs(putGex);
  const ratio = Math.abs(putGex) === 0 ? Infinity : callGex / Math.abs(putGex);
  const rawCallWallRow = profile.reduce(
    (best, row) => (row.callGex > (best?.callGex ?? -Infinity) ? row : best),
    null,
  );
  const rawPutWallRow = profile.reduce(
    (best, row) => (row.putGex < (best?.putGex ?? Infinity) ? row : best),
    null,
  );
  const callWallRow = selectNetWallRow(profile, spot, "call") || rawCallWallRow;
  const putWallRow = selectNetWallRow(profile, spot, "put") || rawPutWallRow;
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

export const resolveHeadlineZeroGamma = (metrics, zeroGammaData) => {
  const serverZeroGamma = finiteOrNull(zeroGammaData?.zeroGamma);
  if (serverZeroGamma != null) return serverZeroGamma;
  return finiteOrNull(metrics?.zeroGamma);
};

const expirationDayDistance = (option, now = new Date()) => {
  const expirationKey =
    option.expirationDate ||
    `${String(option.expireYear).padStart(4, "0")}-${String(
      option.expireMonth,
    ).padStart(2, "0")}-${String(option.expireDay).padStart(2, "0")}`;
  return marketDayDistanceFromExpirationKey(expirationKey, now) ?? 0;
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

// --- Delta Exposure (DEX) -------------------------------------------------
// Massive supplies per-contract delta; the page historically discarded it.
// DEX is the directional analog of GEX: dollar delta per 1-point move,
// weighted by open interest. Delta carries its natural sign (calls positive,
// puts negative), so netDex reads as net market delta positioning. (We do NOT
// apply a dealer-short flip here — that convention is provider-specific; the
// axis is labeled "net delta exposure" so the reading is unambiguous.)
export const contractDex = (option, spot) => {
  const price = finiteOrNull(spot);
  const delta = finiteOrNull(option?.delta);
  if (!price || price <= 0 || delta == null) return 0;
  const multiplier = resolveContractMultiplier(option);
  return delta * Math.max(0, finiteOrZero(option?.openInterest)) * multiplier * price;
};

export const aggregateDexProfile = (rows = [], spot) => {
  const map = new Map();
  rows.forEach((option) => {
    const strike = finiteOrNull(option.strike);
    if (!isFiniteNumber(strike) || finiteOrNull(option.delta) == null) return;
    const current =
      map.get(strike) || { strike, callDex: 0, putDex: 0, netDex: 0 };
    const dex = contractDex(option, spot);
    if (option.cp === "C") current.callDex += dex;
    else current.putDex += dex;
    current.netDex = current.callDex + current.putDex;
    map.set(strike, current);
  });
  return Array.from(map.values()).sort((left, right) => left.strike - right.strike);
};

// Zero-DEX: interpolated strike where cumulative net delta exposure flips sign.
export const findZeroDex = (profile = []) => {
  if (!profile.length) return null;
  let previousStrike = profile[0].strike;
  let previousCum = profile[0].netDex;
  if (previousCum === 0) return previousStrike;
  for (let index = 1; index < profile.length; index += 1) {
    const row = profile[index];
    const nextCum = previousCum + row.netDex;
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

export const aggregateDexMetrics = (rows = [], spot) => {
  const profile = aggregateDexProfile(rows, spot);
  const callDex = profile.reduce((sum, row) => sum + row.callDex, 0);
  const putDex = profile.reduce((sum, row) => sum + row.putDex, 0);
  return {
    profile,
    callDex,
    putDex,
    netDex: callDex + putDex,
    zeroDex: findZeroDex(profile),
  };
};

// --- Implied volatility (skew + term structure) ---------------------------
// impliedVol defaults to 0 during normalization, so treat <= 0 as missing.
const usableIv = (value) => {
  const iv = finiteOrNull(value);
  return iv != null && iv > 0 ? iv : null;
};

// Per-strike call/put IV for a single expiration (the vol smile / skew).
export const ivSkewByStrike = (rows = [], expirationDate = null) => {
  const map = new Map();
  rows.forEach((option) => {
    if (expirationDate && option.expirationDate !== expirationDate) return;
    const strike = finiteOrNull(option.strike);
    const iv = usableIv(option.impliedVol);
    if (!isFiniteNumber(strike) || iv == null) return;
    const current = map.get(strike) || { strike, callIv: null, putIv: null };
    if (option.cp === "C") current.callIv = iv;
    else current.putIv = iv;
    map.set(strike, current);
  });
  return Array.from(map.values()).sort((left, right) => left.strike - right.strike);
};

// ATM implied vol per expiration across the chain (the vol term structure).
export const ivTermStructure = (rows = [], spot, now = new Date()) => {
  const price = finiteOrNull(spot);
  const byExpiry = new Map();
  rows.forEach((option) => {
    const iv = usableIv(option.impliedVol);
    const strike = finiteOrNull(option.strike);
    if (iv == null || !isFiniteNumber(strike) || !option.expirationDate) return;
    const key = option.expirationDate;
    const group =
      byExpiry.get(key) || {
        key,
        days: expirationDayDistance(option, now),
        contracts: [],
      };
    group.contracts.push({ strike, iv });
    byExpiry.set(key, group);
  });
  return Array.from(byExpiry.values())
    .map((group) => {
      const anchor = price && price > 0 ? price : group.contracts[0]?.strike;
      const atm = group.contracts.reduce(
        (best, row) =>
          best == null ||
          Math.abs(row.strike - anchor) < Math.abs(best.strike - anchor)
            ? row
            : best,
        null,
      );
      return {
        key: group.key,
        days: group.days,
        label: group.days === 0 ? "0DTE" : `${group.days}d`,
        atmIv: atm?.iv ?? null,
        atmStrike: atm?.strike ?? null,
      };
    })
    .filter((row) => row.atmIv != null)
    .sort((left, right) => left.days - right.days);
};

// --- Volume profile (today's traded volume vs resting OI) -----------------
// NOTE: massive `volume` is daily/cumulative traded volume, NOT a buy/sell
// flow split — do not present it as directional flow.
export const volumeByStrike = (rows = []) => {
  const map = new Map();
  rows.forEach((option) => {
    const strike = finiteOrNull(option.strike);
    const volume = finiteOrNull(option.volume);
    if (!isFiniteNumber(strike) || volume == null) return;
    const current =
      map.get(strike) || { strike, callVol: 0, putVol: 0, totalVol: 0 };
    if (option.cp === "C") current.callVol += Math.max(0, volume);
    else current.putVol += Math.max(0, volume);
    current.totalVol = current.callVol + current.putVol;
    map.set(strike, current);
  });
  return Array.from(map.values()).sort((left, right) => left.strike - right.strike);
};

// --- Vega Exposure (VEX) ---------------------------------------------------
// Dealer vega exposure: $ sensitivity per 1 vol-point move, weighted by OI.
// Vega is always >= 0, so VEX is a concentration measure (where vol-of-vol risk
// sits) shown as call/put magnitude by strike — no dealer-sign assumption.
export const contractVex = (option) => {
  const vega = finiteOrNull(option?.vega);
  if (vega == null) return 0;
  const multiplier = resolveContractMultiplier(option);
  return (
    Math.max(0, vega) * Math.max(0, finiteOrZero(option?.openInterest)) * multiplier
  );
};

export const vexByStrike = (rows = []) => {
  const map = new Map();
  rows.forEach((option) => {
    const strike = finiteOrNull(option.strike);
    if (!isFiniteNumber(strike) || finiteOrNull(option.vega) == null) return;
    const current =
      map.get(strike) || { strike, callVex: 0, putVex: 0, totalVex: 0 };
    const vex = contractVex(option);
    if (option.cp === "C") current.callVex += vex;
    else current.putVex += vex;
    current.totalVex = current.callVex + current.putVex;
    map.set(strike, current);
  });
  return Array.from(map.values()).sort((left, right) => left.strike - right.strike);
};

// --- Theta decay -----------------------------------------------------------
// Daily $ time decay by expiration: theta * OI * multiplier. Theta is negative,
// so values are negative (decay pressure); near expirations dominate.
export const contractTheta = (option) => {
  const theta = finiteOrNull(option?.theta);
  if (theta == null) return 0;
  const multiplier = resolveContractMultiplier(option);
  return theta * Math.max(0, finiteOrZero(option?.openInterest)) * multiplier;
};

export const thetaDecayByExpiry = (rows = [], now = new Date()) => {
  const map = new Map();
  rows.forEach((option) => {
    const key = option.expirationDate;
    if (!key || finiteOrNull(option.theta) == null) return;
    const days = expirationDayDistance(option, now);
    const expDate = new Date(
      Date.UTC(option.expireYear, option.expireMonth - 1, option.expireDay),
    );
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
        callTheta: 0,
        putTheta: 0,
        netTheta: 0,
      };
    const decay = contractTheta(option);
    if (option.cp === "C") current.callTheta += decay;
    else current.putTheta += decay;
    current.netTheta = current.callTheta + current.putTheta;
    map.set(key, current);
  });
  return Array.from(map.values()).sort((left, right) => left.days - right.days);
};

const formatPriceForNarrative = (value) => {
  if (!isFiniteNumber(value)) return "?";
  return `$${value.toFixed(value >= 100 ? 2 : 3)}`;
};

const formatPercentForNarrative = (value) => {
  if (!isFiniteNumber(value)) return "0%";
  const pct = Math.abs(value * 100);
  return `${pct.toFixed(pct >= 10 ? 0 : 1)}%`;
};

export const resolveSignalDescription = (
  kind,
  { level, spot, source = "default" } = {},
) => {
  if (kind === "Volatility" && source === "positive-gex") {
    return "Long-gamma regime: dealer hedging dampens moves and favors selling volatility into spikes.";
  }
  if (kind === "Magnet" && isFiniteNumber(level)) {
    return `Peak gamma at ${formatPriceForNarrative(level)} — price tends to gravitate toward this strike when option flow concentrates here.`;
  }
  if (kind === "Support" && isFiniteNumber(level) && isFiniteNumber(spot)) {
    const delta = (level - spot) / spot;
    return `Zero-gamma at ${formatPriceForNarrative(level)} sits ${formatPercentForNarrative(delta)} below spot — crossing it flips dealers from dampening to amplifying moves.`;
  }
  if (kind === "Volatility" && source === "put-wall" && isFiniteNumber(level)) {
    return `Put wall at ${formatPriceForNarrative(level)} — a break below it removes a dealer-supported floor and expands realized volatility.`;
  }
  return "";
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
      description: resolveSignalDescription("Volatility", {
        level: spot,
        spot,
        source: "positive-gex",
      }),
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
        description: resolveSignalDescription("Magnet", {
          level: metrics.peakGexStrike,
          spot,
        }),
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
      description: resolveSignalDescription("Support", {
        level: metrics.zeroGamma,
        spot,
      }),
    });
  }
  if (metrics.putWall != null && metrics.putWall < spot * 0.97) {
    signals.push({
      kind: "Volatility",
      severity: "STRONG",
      level: metrics.putWall,
      delta: (metrics.putWall - spot) / spot,
      description: resolveSignalDescription("Volatility", {
        level: metrics.putWall,
        spot,
        source: "put-wall",
      }),
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
  const score = clamp(
    Math.round(
      (gammaRegime + wallProximity + flowAlignment + volumeConfirm + dexBias) *
        0.8,
    ),
    0,
    100,
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

const SQUEEZE_FACTOR_BULLETS = {
  gammaRegime:
    "Wait for the broader regime to flip net-negative — short-gamma is the structural condition for a squeeze.",
  wallProximity:
    "Wait for spot to push closer to the wall — proximity within ~2% is what triggers the dealer-flow cascade.",
  flowAlignment:
    "Wait for confirming option flow — directional premium should outweigh the opposing side.",
  volumeConfirm:
    "Wait for above-average underlying volume — squeezes need participation, not just options activity.",
  dexBias:
    "Wait for stronger directional delta build — net dealer hedge demand should lean the same way.",
};

const buildSqueezeImplication = ({ direction, verdict, gammaRegime, wallStrike }) => {
  const directionLabel = direction === "bullish" ? "upside" : "downside";
  const wallPart = isFiniteNumber(wallStrike)
    ? ` near ${formatPriceForNarrative(wallStrike)}`
    : "";

  if (verdict === "Imminent") {
    return `Short-gamma regime + aligned flow leaves dealers chasing hedges${wallPart}; expect accelerated ${directionLabel} on confirming volume.`;
  }
  if (verdict === "Likely") {
    return `Conditions are tilted for a ${directionLabel} squeeze${wallPart}; ride continuation as long as flow stays aligned.`;
  }
  if (verdict === "Possible") {
    if (gammaRegime === 0) {
      return `Long-gamma environment dampens the squeeze${wallPart}; favor mean-reversion until the regime flips.`;
    }
    return `Setup is forming${wallPart} but missing confirmation — keep size light until more factors clear.`;
  }
  return `No actionable squeeze${wallPart} — dealer hedging neutralizes price action; trade the chop, not the breakout.`;
};

const toEpochMillis = (value) => {
  if (value == null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const buildIntradaySnapshots = (
  snapshots = [],
  { recentWindowMinutes = 30, sparseFallbackPoints = 5 } = {},
) => {
  const series = (snapshots || [])
    .map((point) => ({
      ts: toEpochMillis(point?.ts),
      netGex: finiteOrNull(point?.netGex),
    }))
    .filter((point) => point.ts != null && point.netGex != null)
    .sort((left, right) => left.ts - right.ts);

  if (series.length === 0) {
    return {
      series: [],
      deltaSession: null,
      deltaRecent: null,
      isSparse: true,
      recentAnchorTs: null,
      sessionAnchorTs: null,
    };
  }

  const first = series[0];
  const last = series[series.length - 1];
  const deltaSession = series.length >= 2 ? last.netGex - first.netGex : 0;
  const recentWindowMs = recentWindowMinutes * 60_000;
  const recentCutoff = last.ts - recentWindowMs;

  let recentAnchor = null;
  for (let index = series.length - 1; index >= 0; index -= 1) {
    if (series[index].ts <= recentCutoff) {
      recentAnchor = series[index];
      break;
    }
  }

  let isSparse = false;
  if (!recentAnchor) {
    isSparse = true;
    if (series.length > sparseFallbackPoints) {
      recentAnchor = series[series.length - sparseFallbackPoints - 1];
    } else if (series.length >= 2) {
      recentAnchor = first;
    }
  }

  const deltaRecent = recentAnchor ? last.netGex - recentAnchor.netGex : 0;

  return {
    series,
    deltaSession,
    deltaRecent,
    isSparse,
    recentAnchorTs: recentAnchor?.ts ?? null,
    sessionAnchorTs: first.ts,
  };
};

export const resolveSqueezeNarrative = (
  squeeze,
  { lowFactorThreshold = 10 } = {},
) => {
  if (!squeeze) {
    return { stronger: [], implication: "" };
  }

  const factors = squeeze.factors || {};
  const stronger = Object.entries(SQUEEZE_FACTOR_BULLETS)
    .filter(([key]) => (factors[key] ?? 0) < lowFactorThreshold)
    .map(([, copy]) => copy);

  const implication = buildSqueezeImplication({
    direction: squeeze.direction,
    verdict: squeeze.verdict,
    gammaRegime: factors.gammaRegime ?? 0,
    wallStrike: squeeze.wallStrike,
  });

  return { stronger, implication };
};
