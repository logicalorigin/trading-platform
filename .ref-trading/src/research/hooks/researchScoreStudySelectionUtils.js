export function resolveDefaultScoreStudySelectedRunId({
  runs = [],
  selectedRunId = null,
  presetId = null,
  symbol = null,
} = {}) {
  const validRuns = [...(Array.isArray(runs) ? runs : [])]
    .filter((run) => (
      run?.runId
      && String(run.validityStatus || "valid").trim().toLowerCase() !== "invalid"
    ))
    .sort((left, right) => {
      const leftTs = Date.parse(left?.completedAt || left?.updatedAt || left?.createdAt || "") || 0;
      const rightTs = Date.parse(right?.completedAt || right?.updatedAt || right?.createdAt || "") || 0;
      return rightTs - leftTs;
    });

  const normalizedSelectedRunId = String(selectedRunId || "").trim();
  if (normalizedSelectedRunId && validRuns.some((run) => run.runId === normalizedSelectedRunId)) {
    return normalizedSelectedRunId;
  }

  const normalizedPresetId = String(presetId || "").trim();
  if (!normalizedPresetId) {
    return null;
  }

  const normalizedSymbol = String(symbol || "").trim().toUpperCase();
  const presetRuns = validRuns.filter((run) => run?.presetId === normalizedPresetId);
  const scopedPresetRuns = normalizedSymbol
    ? presetRuns.filter((run) => String(run?.symbol || "").trim().toUpperCase() === normalizedSymbol)
    : presetRuns;
  return scopedPresetRuns[0]?.runId || presetRuns[0]?.runId || null;
}
