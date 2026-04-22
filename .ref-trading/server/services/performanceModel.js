const CONFIDENCE = {
  EXACT: "exact",
  DERIVED: "derived",
  UNAVAILABLE: "unavailable",
};

const PERIOD_ORDER = ["today", "wtd", "mtd", "ytd", "all_time"];

export function buildAccountPerformancePayload({
  requestedAccountId = "all",
  accounts = [],
  summariesByAccount = {},
  pointsByAccount = {},
  nativeClosedTradesByAccount = {},
  nativeCashLedgerByAccount = {},
  benchmark = null,
  now = Date.now(),
  chartModeDefault = "layered",
  maxRows = 5000,
}) {
  const safeAccounts = Array.isArray(accounts) ? accounts : [];
  const accountIds = safeAccounts.map((account) => account.accountId);
  const accountRows = safeAccounts.map((account) =>
    buildAccountPerformanceRow(account, summariesByAccount?.[account.accountId], pointsByAccount?.[account.accountId]),
  );

  const layered = buildLayeredEquitySeries(pointsByAccount, accountIds, {
    limit: maxRows,
  });

  const selectedSeries = requestedAccountId === "all"
    ? layered.total
    : toSortedSeries(pointsByAccount?.[requestedAccountId] || [], maxRows);

  const selectedPointsByAccount = requestedAccountId === "all"
    ? Object.fromEntries(
      accountIds.map((accountId) => [accountId, toSortedSeries(pointsByAccount?.[accountId] || [], maxRows)]),
    )
    : {
      [requestedAccountId]: toSortedSeries(pointsByAccount?.[requestedAccountId] || [], maxRows),
    };

  const periods = buildPeriodsPayload({
    requestedAccountId,
    accountIds,
    seriesByAccount: selectedPointsByAccount,
    aggregateSeries: selectedSeries,
    now,
  });

  const cashByAccount = Object.fromEntries(
    accountRows.map((row) => [row.accountId, row.cash]),
  );
  const cash = requestedAccountId === "all"
    ? combineCashBreakdowns(cashByAccount, accountIds)
    : (cashByAccount[requestedAccountId] || emptyCashBreakdown());

  const activeAccountIds = requestedAccountId === "all" ? accountIds : [requestedAccountId];
  const nativeCashLedger = flattenNativeRows(nativeCashLedgerByAccount, activeAccountIds);
  const cashLedger = nativeCashLedger.length
    ? normalizeNativeCashLedger(nativeCashLedger, 400)
    : [];

  const nativeClosedTrades = flattenNativeRows(nativeClosedTradesByAccount, activeAccountIds);
  const closedTrades = nativeClosedTrades.length
    ? normalizeNativeClosedTrades(nativeClosedTrades, 250)
    : [];
  const performanceStats = buildPerformanceStats({
    periods,
    aggregateSeries: selectedSeries,
    closedTrades,
  });

  const confidence = summarizeConfidence([
    ...Object.values(cash || {}),
    ...Object.values(periods || {}),
    ...closedTrades.map((row) => ({ confidence: row.confidence })),
    ...cashLedger.map((row) => ({ confidence: row.confidence })),
  ]);

  return {
    accountId: requestedAccountId,
    asOf: new Date(Number.isFinite(Number(now)) ? Number(now) : Date.now()).toISOString(),
    chart: {
      defaultMode: chartModeDefault === "single" ? "single" : "layered",
      single: selectedSeries,
      layered: {
        total: layered.total,
        accounts: layered.accounts,
      },
      benchmark: normalizeBenchmarkPayload(benchmark, selectedSeries),
    },
    periods,
    cash,
    accounts: accountRows,
    ledgers: {
      closedTrades,
      cash: cashLedger,
    },
    stats: performanceStats,
    confidence,
    definitions: {
      confidence: {
        exact: "Broker field reported directly",
        derived: "Calculated from account/trade/equity data",
        unavailable: "Field missing from broker payload and derivation",
      },
      realizedNet: "Equity change minus unrealized change when available; fees assumed included in broker P/L.",
    },
  };
}

export function buildLayeredEquitySeries(pointsByAccount, accountIds, options = {}) {
  const safeAccountIds = Array.isArray(accountIds) ? accountIds : [];
  const byAccount = {};
  const firstPointByAccount = {};
  for (const accountId of safeAccountIds) {
    const rows = toSortedSeries(pointsByAccount?.[accountId] || [], options.limit);
    byAccount[accountId] = rows;
    firstPointByAccount[accountId] = rows[0] || null;
  }

  const events = [];
  for (const accountId of safeAccountIds) {
    for (const row of byAccount[accountId]) {
      const epochMs = Number(row?.epochMs);
      const equity = Number(row?.equity);
      if (!Number.isFinite(epochMs) || !Number.isFinite(equity)) {
        continue;
      }
      events.push({
        accountId,
        epochMs: Math.round(epochMs),
        equity: round2(equity),
      });
    }
  }
  events.sort((a, b) => Number(a.epochMs) - Number(b.epochMs));

  const latestByAccount = new Map();
  const total = [];
  const layeredAccounts = {};
  for (const accountId of safeAccountIds) {
    layeredAccounts[accountId] = [];
  }

  const baselineEpoch = safeAccountIds.reduce((acc, accountId) => {
    const epoch = Number(firstPointByAccount[accountId]?.epochMs);
    if (!Number.isFinite(epoch)) {
      return acc;
    }
    if (!Number.isFinite(acc)) {
      return epoch;
    }
    return Math.min(acc, epoch);
  }, NaN);

  if (Number.isFinite(baselineEpoch)) {
    let baselineTotal = 0;
    const baselineAccounts = {};
    for (const accountId of safeAccountIds) {
      const value = Number(firstPointByAccount[accountId]?.equity);
      const safeValue = Number.isFinite(value) ? value : 0;
      latestByAccount.set(accountId, safeValue);
      baselineAccounts[accountId] = round2(safeValue);
      baselineTotal += safeValue;
    }

    upsertSeriesPoint(total, {
      ts: new Date(Math.round(baselineEpoch)).toISOString(),
      epochMs: Math.round(baselineEpoch),
      equity: round2(baselineTotal),
      accounts: baselineAccounts,
      source: "accounts-layered",
      stale: false,
    });
    for (const accountId of safeAccountIds) {
      upsertSeriesPoint(layeredAccounts[accountId], {
        ts: new Date(Math.round(baselineEpoch)).toISOString(),
        epochMs: Math.round(baselineEpoch),
        equity: round2(baselineAccounts[accountId]),
        source: "accounts-layered",
        stale: false,
      });
    }
  }

  for (const event of events) {
    latestByAccount.set(event.accountId, event.equity);
    let runningTotal = 0;
    const accountValues = {};
    for (const accountId of safeAccountIds) {
      const value = Number(latestByAccount.get(accountId) ?? 0);
      accountValues[accountId] = round2(value);
      runningTotal += value;
    }

    const point = {
      ts: new Date(event.epochMs).toISOString(),
      epochMs: event.epochMs,
      equity: round2(runningTotal),
      accounts: accountValues,
      source: "accounts-layered",
      stale: false,
    };
    upsertSeriesPoint(total, point);
    for (const accountId of safeAccountIds) {
      upsertSeriesPoint(layeredAccounts[accountId], {
        ts: point.ts,
        epochMs: point.epochMs,
        equity: round2(accountValues[accountId]),
        source: "accounts-layered",
        stale: false,
      });
    }
  }

  const limit = clampNumber(options.limit, 1, 50000, 5000);
  return {
    total: total.length > limit ? total.slice(total.length - limit) : total,
    accounts: Object.fromEntries(
      safeAccountIds.map((accountId) => {
        const rows = layeredAccounts[accountId] || [];
        return [accountId, rows.length > limit ? rows.slice(rows.length - limit) : rows];
      }),
    ),
  };
}

export function buildBenchmarkSeriesFromBars(bars = [], options = {}) {
  const rows = Array.isArray(bars) ? bars : [];
  if (!rows.length) {
    return [];
  }

  const points = rows
    .map((row) => {
      const epochMs = toEpochMs(row?.time ?? row?.ts ?? row?.timestamp);
      const close = Number(row?.close ?? row?.c);
      if (!Number.isFinite(epochMs) || !Number.isFinite(close)) {
        return null;
      }
      return {
        epochMs: Math.round(epochMs),
        close: round6(close),
      };
    })
    .filter(Boolean)
    .sort((a, b) => Number(a.epochMs) - Number(b.epochMs));

  if (!points.length) {
    return [];
  }

  const baseClose = Number(points[0].close);
  const baseEquity = Number(options.baseEquity);
  if (!Number.isFinite(baseClose) || baseClose <= 0 || !Number.isFinite(baseEquity) || baseEquity <= 0) {
    return [];
  }

  const limit = clampNumber(options.limit, 1, 50000, 5000);
  const series = points.map((point) => ({
    ts: new Date(point.epochMs).toISOString(),
    epochMs: point.epochMs,
    equity: round2(baseEquity * (Number(point.close) / baseClose)),
    source: "benchmark-normalized",
    stale: false,
  }));
  return series.length > limit ? series.slice(series.length - limit) : series;
}

function buildAccountPerformanceRow(account, summary, points) {
  const safeSummary = summary && typeof summary === "object" ? summary : null;
  const safePoints = toSortedSeries(points || [], 50000);
  const latestEquityPoint = safePoints[safePoints.length - 1] || null;
  return {
    accountId: account.accountId,
    label: account.label || account.accountId,
    broker: String(account.broker || "").toLowerCase(),
    summary: safeSummary,
    cash: resolveCashBreakdown(safeSummary, latestEquityPoint),
    latestEquityPoint,
    historyPoints: safePoints.length,
  };
}

function buildPeriodsPayload({
  requestedAccountId,
  accountIds,
  seriesByAccount,
  aggregateSeries,
  now,
}) {
  const nowMs = Number.isFinite(Number(now)) ? Number(now) : Date.now();
  const starts = buildPeriodStarts(nowMs);
  const out = {};

  for (const period of PERIOD_ORDER) {
    const startMs = starts[period];
    const aggregateMetrics = computePeriodMetrics(aggregateSeries, startMs, nowMs);
    const accounts = {};
    const activeIds = requestedAccountId === "all" ? accountIds : [requestedAccountId];
    for (const accountId of activeIds) {
      accounts[accountId] = computePeriodMetrics(seriesByAccount?.[accountId] || [], startMs, nowMs);
    }

    out[period] = {
      label: periodLabel(period),
      start: Number.isFinite(startMs) ? new Date(startMs).toISOString() : null,
      end: new Date(nowMs).toISOString(),
      realizedNet: aggregateMetrics.realizedNet,
      unrealizedChange: aggregateMetrics.unrealizedChange,
      equityChange: aggregateMetrics.equityChange,
      returnPct: aggregateMetrics.returnPct,
      confidence: aggregateMetrics.confidence,
      accounts,
    };
  }

  return out;
}

function computePeriodMetrics(series, startMs, endMs) {
  const rows = toSortedSeries(series || [], 50000);
  if (!rows.length) {
    return emptyPeriodMetrics(CONFIDENCE.UNAVAILABLE);
  }

  const startPoint = resolveSeriesPointAtOrBefore(rows, startMs) || rows[0];
  const endPoint = resolveSeriesPointAtOrBefore(rows, endMs) || rows[rows.length - 1];
  if (!startPoint || !endPoint) {
    return emptyPeriodMetrics(CONFIDENCE.UNAVAILABLE);
  }

  const startEquity = Number(startPoint.equity);
  const endEquity = Number(endPoint.equity);
  if (!Number.isFinite(startEquity) || !Number.isFinite(endEquity)) {
    return emptyPeriodMetrics(CONFIDENCE.UNAVAILABLE);
  }

  const equityChange = endEquity - startEquity;
  const startUnrealized = Number(startPoint.unrealizedPnl);
  const endUnrealized = Number(endPoint.unrealizedPnl);
  const unrealizedChange = Number.isFinite(startUnrealized) && Number.isFinite(endUnrealized)
    ? endUnrealized - startUnrealized
    : null;
  const realizedNet = Number.isFinite(unrealizedChange)
    ? equityChange - unrealizedChange
    : equityChange;
  const returnPct = startEquity !== 0 ? (equityChange / startEquity) * 100 : null;

  return {
    realizedNet: round2(realizedNet),
    unrealizedChange: Number.isFinite(unrealizedChange) ? round2(unrealizedChange) : null,
    equityChange: round2(equityChange),
    returnPct: Number.isFinite(returnPct) ? round4(returnPct) : null,
    confidence: Number.isFinite(unrealizedChange) ? CONFIDENCE.DERIVED : CONFIDENCE.DERIVED,
  };
}

function buildCashLedger({ requestedAccountId, accountIds, pointsByAccount, maxRows }) {
  const activeIds = requestedAccountId === "all"
    ? (Array.isArray(accountIds) ? accountIds : [])
    : [requestedAccountId];
  const rows = [];
  const limit = clampNumber(maxRows, 20, 5000, 400);

  for (const accountId of activeIds) {
    const series = toSortedSeries(pointsByAccount?.[accountId] || [], 50000);
    for (let index = 1; index < series.length; index += 1) {
      const prev = series[index - 1];
      const curr = series[index];
      const prevEquity = Number(prev?.equity);
      const currEquity = Number(curr?.equity);
      if (!Number.isFinite(prevEquity) || !Number.isFinite(currEquity)) {
        continue;
      }

      const prevCash = Number(prev?.cash);
      const currCash = Number(curr?.cash);
      const cashDelta = Number.isFinite(prevCash) && Number.isFinite(currCash)
        ? currCash - prevCash
        : null;

      const prevUnrealized = Number(prev?.unrealizedPnl);
      const currUnrealized = Number(curr?.unrealizedPnl);
      const unrealizedDelta = Number.isFinite(prevUnrealized) && Number.isFinite(currUnrealized)
        ? currUnrealized - prevUnrealized
        : null;

      const equityDelta = currEquity - prevEquity;
      const realizedDelta = Number.isFinite(unrealizedDelta)
        ? equityDelta - unrealizedDelta
        : equityDelta;
      const amount = Number.isFinite(cashDelta) ? cashDelta : realizedDelta;
      if (!Number.isFinite(amount) || Math.abs(amount) < 0.005) {
        continue;
      }

      const epochMs = Number(curr?.epochMs);
      if (!Number.isFinite(epochMs)) {
        continue;
      }

      rows.push({
        id: `${accountId}:${epochMs}:${index}`,
        accountId,
        ts: new Date(Math.round(epochMs)).toISOString(),
        epochMs: Math.round(epochMs),
        amount: round2(amount),
        realizedNet: round2(realizedDelta),
        equityDelta: round2(equityDelta),
        unrealizedDelta: Number.isFinite(unrealizedDelta) ? round2(unrealizedDelta) : null,
        balance: Number.isFinite(currCash) ? round2(currCash) : null,
        type: amount >= 0 ? "credit" : "debit",
        confidence: Number.isFinite(cashDelta) ? CONFIDENCE.DERIVED : CONFIDENCE.DERIVED,
        source: curr?.source || "account-history",
      });
    }
  }

  rows.sort((a, b) => Number(b.epochMs) - Number(a.epochMs));
  return rows.length > limit ? rows.slice(0, limit) : rows;
}

function buildDerivedClosedTrades(cashLedger) {
  const rows = Array.isArray(cashLedger) ? cashLedger : [];
  const trades = rows
    .filter((row) => Number.isFinite(Number(row.realizedNet)) && Math.abs(Number(row.realizedNet)) >= 0.01)
    .map((row) => ({
      tradeId: `derived-${row.id}`,
      accountId: row.accountId,
      symbol: "MULTI",
      side: Number(row.realizedNet) >= 0 ? "credit" : "debit",
      qty: null,
      openedAt: null,
      closedAt: row.ts,
      realizedNet: round2(Number(row.realizedNet)),
      fees: 0,
      confidence: row.confidence || CONFIDENCE.DERIVED,
      source: row.source || "derived-history",
    }));

  return trades.slice(0, 250);
}

function normalizeNativeClosedTrades(rows, limit) {
  const safeRows = (Array.isArray(rows) ? rows : [])
    .map((row, index) => {
      const closedMs = toEpochMs(row?.closedAt ?? row?.ts ?? row?.time ?? row?.timestamp);
      const realizedNet = Number(row?.realizedNet ?? row?.realized ?? row?.amount);
      if (!Number.isFinite(closedMs) || !Number.isFinite(realizedNet)) {
        return null;
      }
      const tradeId = row?.tradeId
        || row?.id
        || `${row?.accountId || "account"}:${Math.round(closedMs)}:${index}`;
      return {
        tradeId: String(tradeId),
        accountId: row?.accountId || null,
        symbol: row?.symbol || "UNKNOWN",
        side: row?.side || "unknown",
        qty: Number.isFinite(Number(row?.qty)) ? Number(row.qty) : null,
        openedAt: row?.openedAt || null,
        closedAt: new Date(Math.round(closedMs)).toISOString(),
        realizedNet: round2(realizedNet),
        fees: Number.isFinite(Number(row?.fees)) ? round2(Number(row.fees)) : 0,
        confidence: String(row?.confidence || CONFIDENCE.EXACT).toLowerCase(),
        source: row?.source || "broker-history",
      };
    })
    .filter(Boolean)
    .sort((a, b) => Date.parse(b.closedAt || 0) - Date.parse(a.closedAt || 0));

  const max = clampNumber(limit, 10, 5000, 250);
  return safeRows.length > max ? safeRows.slice(0, max) : safeRows;
}

function normalizeNativeCashLedger(rows, limit) {
  const safeRows = (Array.isArray(rows) ? rows : [])
    .map((row, index) => {
      const epochMs = toEpochMs(row?.epochMs ?? row?.ts ?? row?.time ?? row?.timestamp);
      const amount = Number(row?.amount ?? row?.realizedNet);
      if (!Number.isFinite(epochMs) || !Number.isFinite(amount)) {
        return null;
      }
      const id = row?.id || `${row?.accountId || "account"}:${Math.round(epochMs)}:${index}`;
      return {
        id: String(id),
        accountId: row?.accountId || null,
        ts: new Date(Math.round(epochMs)).toISOString(),
        epochMs: Math.round(epochMs),
        amount: round2(amount),
        realizedNet: Number.isFinite(Number(row?.realizedNet)) ? round2(Number(row.realizedNet)) : null,
        equityDelta: Number.isFinite(Number(row?.equityDelta)) ? round2(Number(row.equityDelta)) : null,
        unrealizedDelta: Number.isFinite(Number(row?.unrealizedDelta)) ? round2(Number(row.unrealizedDelta)) : null,
        balance: Number.isFinite(Number(row?.balance)) ? round2(Number(row.balance)) : null,
        type: row?.type || (amount >= 0 ? "credit" : "debit"),
        confidence: String(row?.confidence || CONFIDENCE.EXACT).toLowerCase(),
        source: row?.source || "broker-history",
      };
    })
    .filter(Boolean)
    .sort((a, b) => Number(b.epochMs) - Number(a.epochMs));

  const max = clampNumber(limit, 10, 5000, 400);
  return safeRows.length > max ? safeRows.slice(0, max) : safeRows;
}

function flattenNativeRows(mapByAccount, accountIds) {
  const out = [];
  const safeMap = mapByAccount && typeof mapByAccount === "object" ? mapByAccount : {};
  for (const accountId of Array.isArray(accountIds) ? accountIds : []) {
    const rows = safeMap[accountId];
    if (!Array.isArray(rows) || !rows.length) {
      continue;
    }
    for (const row of rows) {
      out.push({
        ...(row && typeof row === "object" ? row : {}),
        accountId: row?.accountId || accountId,
      });
    }
  }
  return out;
}

function buildPerformanceStats({ periods, aggregateSeries, closedTrades }) {
  const allTime = periods?.all_time || emptyPeriodMetrics(CONFIDENCE.UNAVAILABLE);
  const rows = Array.isArray(closedTrades) ? closedTrades : [];
  const wins = rows.filter((row) => Number(row.realizedNet) > 0).length;
  const losses = rows.filter((row) => Number(row.realizedNet) < 0).length;
  const grossWins = rows.reduce((sum, row) => (Number(row.realizedNet) > 0 ? sum + Number(row.realizedNet) : sum), 0);
  const grossLossesAbs = Math.abs(
    rows.reduce((sum, row) => (Number(row.realizedNet) < 0 ? sum + Number(row.realizedNet) : sum), 0),
  );
  const winRate = rows.length ? (wins / rows.length) * 100 : null;
  const profitFactor = grossLossesAbs > 0 ? grossWins / grossLossesAbs : null;
  const maxDrawdownPct = computeMaxDrawdownPct(aggregateSeries || []);

  return {
    wins,
    losses,
    winRate: Number.isFinite(winRate) ? round2(winRate) : null,
    profitFactor: Number.isFinite(profitFactor) ? round3(profitFactor) : null,
    maxDrawdownPct: Number.isFinite(maxDrawdownPct) ? round2(maxDrawdownPct) : null,
    allTimeReturnPct: Number.isFinite(Number(allTime.returnPct)) ? round2(Number(allTime.returnPct)) : null,
    allTimeRealizedNet: Number.isFinite(Number(allTime.realizedNet)) ? round2(Number(allTime.realizedNet)) : null,
    points: Array.isArray(aggregateSeries) ? aggregateSeries.length : 0,
  };
}

function resolveCashBreakdown(summary, fallback = null) {
  const safeSources = [summary, fallback]
    .filter((row) => row && typeof row === "object");

  const settled = pickField(safeSources, [
    "settledCash",
    "settled_cash",
    "settled",
    "cashSettled",
  ]);
  const unsettled = pickField(safeSources, [
    "unsettledCash",
    "unsettled_cash",
    "cashUnsettled",
    "pendingCash",
  ]);
  const availableToTrade = pickField(safeSources, [
    "cashAvailableToTrade",
    "cash_available_to_trade",
    "availableToTrade",
    "cash",
    "buyingPower",
  ]);
  const availableToWithdraw = pickField(safeSources, [
    "cashAvailableToWithdraw",
    "cash_available_to_withdraw",
    "availableToWithdraw",
    "withdrawableCash",
    "cash",
  ]);
  const buyingPower = pickField(safeSources, [
    "buyingPower",
    "buying_power",
  ]);
  const marginAvailable = pickField(safeSources, [
    "marginAvailable",
    "margin_available",
    "optionBuyingPower",
  ]);

  const cash = pickField(safeSources, ["cash", "cashBalance", "cash_balance"]);

  const settledValue = Number.isFinite(settled.value)
    ? settled.value
    : Number.isFinite(cash.value)
      ? cash.value
      : null;
  const settledConfidence = Number.isFinite(settled.value)
    ? settled.confidence
    : Number.isFinite(cash.value)
      ? CONFIDENCE.DERIVED
      : CONFIDENCE.UNAVAILABLE;

  const unsettledValue = Number.isFinite(unsettled.value)
    ? unsettled.value
    : Number.isFinite(cash.value) && Number.isFinite(settledValue)
      ? Math.max(0, cash.value - settledValue)
      : null;
  const unsettledConfidence = Number.isFinite(unsettled.value)
    ? unsettled.confidence
    : Number.isFinite(cash.value) && Number.isFinite(settledValue)
      ? CONFIDENCE.DERIVED
      : CONFIDENCE.UNAVAILABLE;

  const availableTradeValue = firstFiniteNumber(
    availableToTrade.value,
    buyingPower.value,
    cash.value,
  );
  const availableWithdrawValue = firstFiniteNumber(
    availableToWithdraw.value,
    settledValue,
    cash.value,
  );
  const marginValue = Number.isFinite(marginAvailable.value)
    ? marginAvailable.value
    : Number.isFinite(buyingPower.value) && Number.isFinite(availableTradeValue)
      ? Math.max(0, buyingPower.value - availableTradeValue)
      : null;

  return {
    settledCash: {
      value: normalizeMoneyOrNull(settledValue),
      confidence: settledConfidence,
      source: settled.source || cash.source || null,
    },
    unsettledCash: {
      value: normalizeMoneyOrNull(unsettledValue),
      confidence: unsettledConfidence,
      source: unsettled.source || cash.source || null,
    },
    cashAvailableToTrade: {
      value: normalizeMoneyOrNull(availableTradeValue),
      confidence: Number.isFinite(availableToTrade.value)
        ? availableToTrade.confidence
        : Number.isFinite(buyingPower.value) || Number.isFinite(cash.value)
          ? CONFIDENCE.DERIVED
          : CONFIDENCE.UNAVAILABLE,
      source: availableToTrade.source || buyingPower.source || cash.source || null,
    },
    cashAvailableToWithdraw: {
      value: normalizeMoneyOrNull(availableWithdrawValue),
      confidence: Number.isFinite(availableToWithdraw.value)
        ? availableToWithdraw.confidence
        : Number.isFinite(settledValue) || Number.isFinite(cash.value)
          ? CONFIDENCE.DERIVED
          : CONFIDENCE.UNAVAILABLE,
      source: availableToWithdraw.source || settled.source || cash.source || null,
    },
    buyingPower: {
      value: normalizeMoneyOrNull(firstFiniteNumber(buyingPower.value, availableTradeValue)),
      confidence: Number.isFinite(buyingPower.value)
        ? buyingPower.confidence
        : Number.isFinite(availableTradeValue)
          ? CONFIDENCE.DERIVED
          : CONFIDENCE.UNAVAILABLE,
      source: buyingPower.source || availableToTrade.source || null,
    },
    marginAvailable: {
      value: normalizeMoneyOrNull(marginValue),
      confidence: Number.isFinite(marginAvailable.value)
        ? marginAvailable.confidence
        : Number.isFinite(marginValue)
          ? CONFIDENCE.DERIVED
          : CONFIDENCE.UNAVAILABLE,
      source: marginAvailable.source || buyingPower.source || null,
    },
  };
}

function combineCashBreakdowns(cashByAccount, accountIds) {
  const ids = Array.isArray(accountIds) ? accountIds : [];
  const combined = emptyCashBreakdown();
  const keys = Object.keys(combined);

  for (const key of keys) {
    let total = 0;
    let hasValue = false;
    const confidences = [];
    for (const accountId of ids) {
      const field = cashByAccount?.[accountId]?.[key];
      if (!field) {
        confidences.push(CONFIDENCE.UNAVAILABLE);
        continue;
      }
      const raw = field.value;
      if (raw == null || raw === "") {
        confidences.push(String(field.confidence || CONFIDENCE.UNAVAILABLE));
        continue;
      }
      const value = Number(raw);
      if (Number.isFinite(value)) {
        total += value;
        hasValue = true;
      }
      confidences.push(String(field.confidence || CONFIDENCE.UNAVAILABLE));
    }

    combined[key] = {
      value: hasValue ? round2(total) : null,
      confidence: mergeConfidence(confidences),
      source: "accounts-aggregate",
    };
  }

  return combined;
}

function emptyCashBreakdown() {
  return {
    settledCash: { value: null, confidence: CONFIDENCE.UNAVAILABLE, source: null },
    unsettledCash: { value: null, confidence: CONFIDENCE.UNAVAILABLE, source: null },
    cashAvailableToTrade: { value: null, confidence: CONFIDENCE.UNAVAILABLE, source: null },
    cashAvailableToWithdraw: { value: null, confidence: CONFIDENCE.UNAVAILABLE, source: null },
    buyingPower: { value: null, confidence: CONFIDENCE.UNAVAILABLE, source: null },
    marginAvailable: { value: null, confidence: CONFIDENCE.UNAVAILABLE, source: null },
  };
}

function normalizeBenchmarkPayload(benchmark, fallbackSeries) {
  if (!benchmark || typeof benchmark !== "object") {
    return {
      enabled: false,
      symbol: null,
      source: null,
      stale: true,
      series: [],
    };
  }

  const series = toSortedSeries(benchmark.series || [], 5000);
  if (!series.length && Array.isArray(fallbackSeries) && fallbackSeries.length) {
    return {
      enabled: true,
      symbol: benchmark.symbol || null,
      source: benchmark.source || null,
      stale: benchmark.stale !== false,
      series: [],
    };
  }

  return {
    enabled: true,
    symbol: benchmark.symbol || "SPY",
    source: benchmark.source || null,
    stale: benchmark.stale !== false,
    series,
  };
}

function computeMaxDrawdownPct(series) {
  const rows = toSortedSeries(series || [], 50000);
  if (!rows.length) {
    return null;
  }

  let peak = Number(rows[0]?.equity);
  let maxDrawdown = 0;
  for (const row of rows) {
    const equity = Number(row?.equity);
    if (!Number.isFinite(equity)) {
      continue;
    }
    if (!Number.isFinite(peak) || equity > peak) {
      peak = equity;
    }
    if (peak > 0) {
      const dd = ((peak - equity) / peak) * 100;
      if (dd > maxDrawdown) {
        maxDrawdown = dd;
      }
    }
  }
  return maxDrawdown;
}

function buildPeriodStarts(nowMs) {
  const nowDate = new Date(nowMs);
  const todayStart = Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth(), nowDate.getUTCDate());
  const weekDay = nowDate.getUTCDay() || 7;
  const wtdStart = todayStart - (weekDay - 1) * 24 * 60 * 60 * 1000;
  const mtdStart = Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth(), 1);
  const ytdStart = Date.UTC(nowDate.getUTCFullYear(), 0, 1);

  return {
    today: todayStart,
    wtd: wtdStart,
    mtd: mtdStart,
    ytd: ytdStart,
    all_time: NaN,
  };
}

function resolveSeriesPointAtOrBefore(series, epochMs) {
  if (!Array.isArray(series) || !series.length) {
    return null;
  }
  if (!Number.isFinite(epochMs)) {
    return series[0];
  }

  let found = null;
  for (const row of series) {
    const ts = Number(row?.epochMs);
    if (!Number.isFinite(ts)) {
      continue;
    }
    if (ts <= epochMs) {
      found = row;
      continue;
    }
    break;
  }
  return found || series[0];
}

function toSortedSeries(rows, limit) {
  const safe = (Array.isArray(rows) ? rows : [])
    .map((row) => {
      const epochMs = Number(row?.epochMs ?? toEpochMs(row?.ts ?? row?.time ?? row?.timestamp));
      const equity = Number(row?.equity);
      if (!Number.isFinite(epochMs) || !Number.isFinite(equity)) {
        return null;
      }
      return {
        ...row,
        ts: new Date(Math.round(epochMs)).toISOString(),
        epochMs: Math.round(epochMs),
        equity: round2(equity),
      };
    })
    .filter(Boolean)
    .sort((a, b) => Number(a.epochMs) - Number(b.epochMs));

  const max = clampNumber(limit, 1, 50000, 5000);
  return safe.length > max ? safe.slice(safe.length - max) : safe;
}

function upsertSeriesPoint(series, point) {
  const last = series[series.length - 1];
  if (last && Number(last.epochMs) === Number(point.epochMs)) {
    series[series.length - 1] = point;
    return;
  }
  series.push(point);
}

function pickField(source, keys) {
  const safeSources = Array.isArray(source)
    ? source.filter((row) => row && typeof row === "object")
    : [source && typeof source === "object" ? source : {}];
  for (const key of keys || []) {
    for (const safe of safeSources) {
      if (!(key in safe)) {
        continue;
      }
      const raw = safe[key];
      if (raw == null || raw === "") {
        continue;
      }
      const value = Number(raw);
      if (Number.isFinite(value)) {
        return {
          value,
          confidence: CONFIDENCE.EXACT,
          source: key,
        };
      }
    }
  }
  return {
    value: null,
    confidence: CONFIDENCE.UNAVAILABLE,
    source: null,
  };
}

function mergeConfidence(values) {
  const set = new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => String(value || "").toLowerCase())
      .filter(Boolean),
  );
  if (!set.size || (set.size === 1 && set.has(CONFIDENCE.UNAVAILABLE))) {
    return CONFIDENCE.UNAVAILABLE;
  }
  if (set.has(CONFIDENCE.DERIVED) || set.has(CONFIDENCE.UNAVAILABLE)) {
    return CONFIDENCE.DERIVED;
  }
  return CONFIDENCE.EXACT;
}

function summarizeConfidence(rows) {
  const out = {
    exact: 0,
    derived: 0,
    unavailable: 0,
  };
  for (const row of Array.isArray(rows) ? rows : []) {
    const confidence = String(row?.confidence || "").toLowerCase();
    if (confidence === CONFIDENCE.EXACT) {
      out.exact += 1;
      continue;
    }
    if (confidence === CONFIDENCE.DERIVED) {
      out.derived += 1;
      continue;
    }
    out.unavailable += 1;
  }
  return out;
}

function emptyPeriodMetrics(confidence) {
  return {
    realizedNet: null,
    unrealizedChange: null,
    equityChange: null,
    returnPct: null,
    confidence,
  };
}

function periodLabel(period) {
  if (period === "today") return "Today";
  if (period === "wtd") return "WTD";
  if (period === "mtd") return "MTD";
  if (period === "ytd") return "YTD";
  return "All Time";
}

function toEpochMs(value) {
  if (value == null || value === "") {
    return NaN;
  }
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return numeric > 100000000000 ? numeric : numeric * 1000;
  }
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : NaN;
}

function normalizeMoneyOrNull(value) {
  if (value == null || value === "") {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? round2(numeric) : null;
}

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(numeric)));
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    if (value == null || value === "") {
      continue;
    }
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }
  return null;
}

function round2(value) {
  return Math.round(Number(value) * 100) / 100;
}

function round3(value) {
  return Math.round(Number(value) * 1000) / 1000;
}

function round4(value) {
  return Math.round(Number(value) * 10000) / 10000;
}

function round6(value) {
  return Math.round(Number(value) * 1000000) / 1000000;
}
