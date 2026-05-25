const toSessionMinutes = (value) => {
  const date = new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) return null;
  return date.getHours() * 60 + date.getMinutes();
};

const formatSessionBucketLabel = (minutes) => {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  const suffix = hours >= 12 ? "p" : "a";
  const hour12 = ((hours + 11) % 12) + 1;
  return `${hour12}${mins ? `:${String(mins).padStart(2, "0")}` : ""}${suffix}`;
};

export const buildMarketOrderFlowFromEvents = (events) => {
  const totals = {
    buyXL: 0,
    buyL: 0,
    buyM: 0,
    buyS: 0,
    sellXL: 0,
    sellL: 0,
    sellM: 0,
    sellS: 0,
  };

  (events || []).forEach((evt) => {
    const bucket =
      evt.premium >= 500000
        ? "XL"
        : evt.premium >= 250000
          ? "L"
          : evt.premium >= 100000
            ? "M"
            : "S";
    const amount = evt.premium / 1e6;

    if (evt.side === "BUY") {
      totals[`buy${bucket}`] += amount;
      return;
    }
    if (evt.side === "SELL") {
      totals[`sell${bucket}`] += amount;
      return;
    }

    totals[`buy${bucket}`] += amount / 2;
    totals[`sell${bucket}`] += amount / 2;
  });

  return Object.fromEntries(
    Object.entries(totals).map(([key, value]) => [key, +value.toFixed(1)]),
  );
};

export const buildFlowTideFromEvents = (events) => {
  const startMinutes = 9 * 60 + 30;
  const bucketMinutes = 30;
  const bucketCount = 14;
  const buckets = Array.from({ length: bucketCount }, (_, index) => ({
    time: formatSessionBucketLabel(startMinutes + index * bucketMinutes),
    calls: 0,
    puts: 0,
  }));

  (events || []).forEach((evt) => {
    const minutes = toSessionMinutes(evt.occurredAt);
    if (minutes == null) return;
    const clamped = Math.max(
      startMinutes,
      Math.min(startMinutes + bucketMinutes * (bucketCount - 1), minutes),
    );
    const bucketIndex = Math.min(
      bucketCount - 1,
      Math.floor((clamped - startMinutes) / bucketMinutes),
    );
    if (evt.cp === "C") buckets[bucketIndex].calls += evt.premium;
    else buckets[bucketIndex].puts += evt.premium;
  });

  let cumNet = 0;
  return buckets.map((bucket) => {
    const net = bucket.calls - bucket.puts;
    cumNet += net;
    return { ...bucket, net, cumNet };
  });
};

export const buildTickerFlowFromEvents = (
  events,
  resolveTickerInfo = () => null,
) => {
  const grouped = new Map();

  (events || []).forEach((evt) => {
    const entry = grouped.get(evt.ticker) || {
      sym: evt.ticker,
      calls: 0,
      puts: 0,
      contracts: 0,
      scoreTotal: 0,
      underlyingPrice: null,
    };

    if (evt.cp === "C") entry.calls += evt.premium;
    else entry.puts += evt.premium;
    entry.contracts += 1;
    entry.scoreTotal += evt.score;
    if (Number.isFinite(evt.underlyingPrice)) {
      entry.underlyingPrice = evt.underlyingPrice;
    }
    grouped.set(evt.ticker, entry);
  });

  return Array.from(grouped.values())
    .map((entry) => {
      const info = resolveTickerInfo(entry.sym, entry.sym) || {};
      return {
        sym: entry.sym,
        calls: entry.calls,
        puts: entry.puts,
        contracts: entry.contracts,
        score: entry.contracts
          ? Math.round(entry.scoreTotal / entry.contracts)
          : 0,
        px: Number.isFinite(info.price) ? info.price : entry.underlyingPrice,
        chg: Number.isFinite(info.pct) ? info.pct : null,
      };
    })
    .sort((left, right) => right.calls + right.puts - (left.calls + left.puts));
};

export const buildFlowClockFromEvents = (events) => {
  const startMinutes = 9 * 60 + 30;
  const bucketMinutes = 30;
  const bucketCount = 14;
  const buckets = Array.from({ length: bucketCount }, (_, index) => ({
    time: formatSessionBucketLabel(startMinutes + index * bucketMinutes),
    count: 0,
    prem: 0,
  }));

  (events || []).forEach((evt) => {
    const minutes = toSessionMinutes(evt.occurredAt);
    if (minutes == null) return;
    const clamped = Math.max(
      startMinutes,
      Math.min(startMinutes + bucketMinutes * (bucketCount - 1), minutes),
    );
    const bucketIndex = Math.min(
      bucketCount - 1,
      Math.floor((clamped - startMinutes) / bucketMinutes),
    );
    buckets[bucketIndex].count += 1;
    buckets[bucketIndex].prem += evt.premium;
  });

  return buckets;
};

const FLOW_SECTOR_BY_SYMBOL = {
  AAPL: "Technology",
  AMZN: "Cons Disc",
  META: "Comm Svcs",
  MSFT: "Technology",
  NVDA: "Technology",
  QQQ: "Index",
  SPY: "Index",
  TSLA: "Cons Disc",
  IWM: "Index",
};

export const buildSectorFlowFromEvents = (events) => {
  const grouped = new Map();

  (events || []).forEach((evt) => {
    const sector = FLOW_SECTOR_BY_SYMBOL[evt.ticker] || "Other";
    const entry = grouped.get(sector) || { sector, calls: 0, puts: 0 };
    if (evt.cp === "C") entry.calls += evt.premium;
    else entry.puts += evt.premium;
    grouped.set(sector, entry);
  });

  return Array.from(grouped.values()).sort(
    (left, right) =>
      Math.abs(right.calls - right.puts) - Math.abs(left.calls - left.puts),
  );
};

export const buildDteBucketsFromEvents = (events) => {
  const buckets = [
    { bucket: "0DTE", calls: 0, puts: 0, count: 0, match: (dte) => dte <= 0 },
    {
      bucket: "1-7d",
      calls: 0,
      puts: 0,
      count: 0,
      match: (dte) => dte >= 1 && dte <= 7,
    },
    {
      bucket: "8-30d",
      calls: 0,
      puts: 0,
      count: 0,
      match: (dte) => dte >= 8 && dte <= 30,
    },
    {
      bucket: "31-90d",
      calls: 0,
      puts: 0,
      count: 0,
      match: (dte) => dte >= 31 && dte <= 90,
    },
    { bucket: "90d+", calls: 0, puts: 0, count: 0, match: (dte) => dte > 90 },
  ];

  (events || []).forEach((evt) => {
    const bucket =
      buckets.find((entry) => entry.match(evt.dte)) ||
      buckets[buckets.length - 1];
    if (evt.cp === "C") bucket.calls += evt.premium;
    else bucket.puts += evt.premium;
    bucket.count += 1;
  });

  return buckets.map(({ match, ...bucket }) => bucket);
};

const FLOW_INDEX_SYMBOLS = new Set(["SPY", "QQQ", "IWM", "DIA"]);

export const buildPutCallSummaryFromEvents = (events) => {
  const totals = {
    equities: { calls: 0, puts: 0 },
    indices: { calls: 0, puts: 0 },
  };

  (events || []).forEach((evt) => {
    const bucket = FLOW_INDEX_SYMBOLS.has(evt.ticker)
      ? totals.indices
      : totals.equities;
    if (evt.cp === "C") bucket.calls += evt.premium;
    else bucket.puts += evt.premium;
  });

  const toRatio = ({ calls, puts }) =>
    calls > 0 ? puts / calls : calls === 0 && puts === 0 ? null : null;
  const equities = toRatio(totals.equities);
  const indices = toRatio(totals.indices);
  const calls = totals.equities.calls + totals.indices.calls;
  const puts = totals.equities.puts + totals.indices.puts;
  const total = calls > 0 ? puts / calls : calls === 0 && puts === 0 ? null : null;

  return {
    total,
    equities,
    indices,
    calls,
    puts,
  };
};
