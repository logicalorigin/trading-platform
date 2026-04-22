export function buildDisplayedResultRecord(record = null, origin = "latest") {
  if (!record) {
    return null;
  }
  const summary = buildRecentResultSummary(record);
  return {
    ...summary,
    draftSignature: record.draftSignature || null,
    replayMeta: record.replayMeta || null,
    replayDatasetSummary: record.replayDatasetSummary || record.replayMeta?.replayDatasetSummary || null,
    resultMeta: record.resultMeta || summary?.resultMeta || null,
    riskStop: record.riskStop || null,
    rayalgoScoringContext: record.rayalgoScoringContext || null,
    origin,
  };
}

export function buildRecentResultSummary(record = null) {
  if (!record) {
    return null;
  }
  return {
    resultId: record.resultId || record.id || null,
    id: record.resultId || record.id || null,
    type: record.type || "backtest_run",
    createdAt: record.createdAt || null,
    completedAt: record.completedAt || null,
    updatedAt: record.updatedAt || null,
    marketSymbol: record.marketSymbol || "SPY",
    strategy: record.strategy || "smc",
    mode: record.mode || "interactive",
    status: record.status || "completed",
    bookmarkedAt: record.bookmarkedAt || null,
    jobId: record.jobId || null,
    setup: record.setup || record.setupSnapshot || null,
    metrics: record.metrics || null,
    metricsPreview: record.metricsPreview || null,
    tradeCount: Number(record.tradeCount) || Number(record?.metrics?.n) || 0,
    skippedTradeCount: Number(record.skippedTradeCount) || 0,
    replayMeta: record.replayMeta || null,
    resultMeta: {
      selectionSummaryLabel: record?.resultMeta?.selectionSummaryLabel || record?.replayMeta?.selectionSummaryLabel || "",
      replaySampleLabel: record?.resultMeta?.replaySampleLabel || record?.replayMeta?.replaySampleLabel || "",
      dataSource: record?.resultMeta?.dataSource || record?.replayMeta?.dataSource || "",
      spotDataMeta: record?.resultMeta?.spotDataMeta || null,
    },
  };
}
