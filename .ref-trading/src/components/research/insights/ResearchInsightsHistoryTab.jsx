import React from "react";
import { B, BORDER, CARD, F, FS, G, M, R, SH1, Y } from "./shared.jsx";
import { buildOptimizerCandidateDiffs, diffResearchSetupSnapshots } from "../../../research/history/setupDiff.js";
import {
  RAYALGO_BUNDLE_DIRECTION_LABELS,
  RAYALGO_BUNDLE_TIER_LABELS,
} from "../../../research/config/rayalgoBundles.js";

const TIMEFRAME_ORDER = {
  "1m": 10,
  "2m": 20,
  "3m": 30,
  "5m": 40,
  "15m": 50,
  "30m": 60,
  "1h": 70,
  "4h": 80,
  D: 90,
  W: 100,
};

function normalizeText(value, fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function formatWhen(value) {
  if (!Number.isFinite(Number(value))) {
    return "--";
  }
  return new Date(Number(value)).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function metricColor(value, positiveThreshold = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return M;
  }
  return numeric >= positiveThreshold ? G : R;
}

function formatSignedValue(value, suffix = "", precision = 1) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "--";
  }
  const rounded = precision === 0 ? Math.round(numeric) : +numeric.toFixed(precision);
  return `${rounded >= 0 ? "+" : ""}${rounded}${suffix}`;
}

function formatPlainValue(value, suffix = "", precision = 2) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "--";
  }
  const rounded = precision === 0 ? Math.round(numeric) : +numeric.toFixed(precision);
  return `${rounded}${suffix}`;
}

function resolveDirectionFromSetup(setup = {}) {
  return setup?.topRail?.allowShorts ? "put" : "call";
}

function resolveTimeframeFromSetup(setup = {}) {
  return normalizeText(setup?.rayalgo?.candleTf || setup?.topRail?.optionCandleTf, "--");
}

function resolveLiveBundle(entryOrBatch, bundleLookup = {}) {
  const bundleId = normalizeText(entryOrBatch?.bundleContext?.bundleId) || null;
  return bundleId ? (bundleLookup[bundleId] || null) : null;
}

function resolveTierLabel(entryOrBatch, bundleLookup = {}) {
  const liveBundle = resolveLiveBundle(entryOrBatch, bundleLookup);
  const tier = normalizeText(liveBundle?.evaluation?.tier || entryOrBatch?.bundleContext?.tier).toLowerCase();
  if (!tier) {
    if (entryOrBatch?.bundleContext?.isCustom) {
      return "Custom";
    }
    return "Unbundled";
  }
  return RAYALGO_BUNDLE_TIER_LABELS[tier] || tier;
}

function resolveTierFilterValue(entryOrBatch, bundleLookup = {}) {
  const liveBundle = resolveLiveBundle(entryOrBatch, bundleLookup);
  const tier = normalizeText(liveBundle?.evaluation?.tier || entryOrBatch?.bundleContext?.tier).toLowerCase();
  if (tier) {
    return tier;
  }
  if (entryOrBatch?.bundleContext?.isCustom) {
    return "custom";
  }
  return "unbundled";
}

function compareTimeframes(left, right) {
  const leftRank = TIMEFRAME_ORDER[normalizeText(left)] || 999;
  const rightRank = TIMEFRAME_ORDER[normalizeText(right)] || 999;
  if (leftRank !== rightRank) {
    return leftRank - rightRank;
  }
  return normalizeText(left).localeCompare(normalizeText(right));
}

function buildUniqueOptions(values = [], comparator = null) {
  const next = [];
  for (const entry of values) {
    const normalized = normalizeText(entry);
    if (!normalized || next.includes(normalized)) {
      continue;
    }
    next.push(normalized);
  }
  return comparator ? next.sort(comparator) : next.sort((left, right) => left.localeCompare(right));
}

function buildRunSearchHaystack(entry, bundleLookup = {}, strategyLabel = (value) => value) {
  const liveBundle = resolveLiveBundle(entry, bundleLookup);
  return [
    entry?.marketSymbol,
    entry?.strategy,
    strategyLabel(entry?.strategy),
    entry?.bundleContext?.label,
    liveBundle?.label,
    resolveTimeframeFromSetup(entry?.setup),
    resolveDirectionFromSetup(entry?.setup),
    resolveTierLabel(entry, bundleLookup),
    entry?.bundleEvaluation?.summary?.statusText,
    entry?.replayMeta?.selectionSummaryLabel,
  ].map((value) => normalizeText(value).toLowerCase()).join(" ");
}

function buildBatchSearchHaystack(batch, bundleLookup = {}, strategyLabel = (value) => value) {
  const liveBundle = resolveLiveBundle(batch, bundleLookup);
  return [
    batch?.marketSymbol,
    batch?.strategy,
    strategyLabel(batch?.strategy),
    batch?.bundleContext?.label,
    liveBundle?.label,
    resolveTimeframeFromSetup(batch?.setup),
    resolveDirectionFromSetup(batch?.setup),
    resolveTierLabel(batch, bundleLookup),
    ...(Array.isArray(batch?.candidates)
      ? batch.candidates.flatMap((candidate) => [
        candidate?.exit,
        candidate?.dte != null ? `${candidate.dte}d` : "",
        candidate?.bundleEvaluation?.summary?.statusText,
      ])
      : []),
  ].map((value) => normalizeText(value).toLowerCase()).join(" ");
}

function buildCandidateSearchHaystack(candidate) {
  return [
    candidate?.exit,
    candidate?.dte != null ? `${candidate.dte}d` : "",
    candidate?.bundleEvaluation?.summary?.statusText,
    candidate?.bundleEvaluation?.summary?.tierSuggestion,
    candidate?.regime,
  ].map((value) => normalizeText(value).toLowerCase()).join(" ");
}

function buildCandidateDiffs(compareCandidate, selectedCandidate) {
  if (!compareCandidate || !selectedCandidate) {
    return [];
  }

  const diffs = [];
  const maybePush = (key, label, currentValue, nextValue) => {
    const current = normalizeText(currentValue, "--");
    const next = normalizeText(nextValue, "--");
    if (current === next) {
      return;
    }
    diffs.push({ key, label, current, next });
  };

  maybePush("dte", "DTE", compareCandidate?.dte != null ? `${compareCandidate.dte}D` : "--", selectedCandidate?.dte != null ? `${selectedCandidate.dte}D` : "--");
  maybePush("exit", "Exit", compareCandidate?.exit || "--", selectedCandidate?.exit || "--");
  maybePush("sl", "Stop", formatPlainValue(compareCandidate?.sl, "%", 2), formatPlainValue(selectedCandidate?.sl, "%", 2));
  maybePush("tp", "Target", formatPlainValue(compareCandidate?.tp, "%", 2), formatPlainValue(selectedCandidate?.tp, "%", 2));
  maybePush("arm", "Trail Arm", formatPlainValue(compareCandidate?.trailStartPct, "%", 2), formatPlainValue(selectedCandidate?.trailStartPct, "%", 2));
  maybePush("trail", "Trail", formatPlainValue(compareCandidate?.trailPct, "%", 2), formatPlainValue(selectedCandidate?.trailPct, "%", 2));
  maybePush("regime", "Regime", compareCandidate?.regime || "--", selectedCandidate?.regime || "--");
  maybePush("score", "Score", formatPlainValue(compareCandidate?.score, "", 4), formatPlainValue(selectedCandidate?.score, "", 4));
  return diffs;
}

function SummaryCell({ label, value, color = "#0f172a" }) {
  return (
    <div
      style={{
        minWidth: 0,
        padding: "8px 9px",
        borderRadius: 8,
        border: `1px solid ${BORDER}`,
        background: "#ffffff",
      }}
    >
      <div style={{ fontSize: 10, fontFamily: FS, letterSpacing: "0.08em", textTransform: "uppercase", color: "#9ca3af" }}>
        {label}
      </div>
      <div style={{ marginTop: 3, fontSize: 13, fontFamily: F, fontWeight: 700, color }}>
        {value}
      </div>
    </div>
  );
}

function ActionButton({ children, onClick, tone = "default", disabled = false }) {
  const styles = tone === "primary"
    ? { background: `${B}10`, borderColor: `${B}40`, color: B }
    : tone === "positive"
      ? { background: `${G}10`, borderColor: `${G}40`, color: G }
      : tone === "warning"
        ? { background: "#fffbeb", borderColor: "#fde68a", color: Y }
        : { background: "#f8fafc", borderColor: "#e2e8f0", color: "#475569" };
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      style={{
        padding: "4px 8px",
        borderRadius: 6,
        border: `1px solid ${styles.borderColor}`,
        background: styles.background,
        color: styles.color,
        fontSize: 11,
        fontFamily: F,
        fontWeight: 700,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.45 : 1,
      }}
    >
      {children}
    </button>
  );
}

function FilterInput({ value, onChange, placeholder }) {
  return (
    <input
      type="search"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      style={{
        minWidth: 180,
        height: 30,
        borderRadius: 8,
        border: `1px solid ${BORDER}`,
        background: "#ffffff",
        padding: "0 10px",
        fontSize: 12,
        fontFamily: F,
        color: "#0f172a",
      }}
    />
  );
}

function FilterSelect({ value, onChange, options = [] }) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      style={{
        height: 30,
        borderRadius: 8,
        border: `1px solid ${BORDER}`,
        background: "#ffffff",
        padding: "0 10px",
        fontSize: 12,
        fontFamily: F,
        color: "#0f172a",
      }}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

function TagChip({ children, tone = "neutral" }) {
  const palette = tone === "positive"
    ? { borderColor: `${G}30`, background: `${G}08`, color: G }
    : tone === "warning"
      ? { borderColor: "#fde68a", background: "#fffbeb", color: Y }
      : tone === "primary"
        ? { borderColor: `${B}30`, background: `${B}08`, color: B }
        : { borderColor: BORDER, background: "#ffffff", color: "#475569" };
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        minHeight: 24,
        padding: "0 8px",
        borderRadius: 999,
        border: `1px solid ${palette.borderColor}`,
        background: palette.background,
        color: palette.color,
        fontSize: 11,
        fontFamily: F,
        fontWeight: 700,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

function DiffBadge({ diff }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        minHeight: 24,
        padding: "0 8px",
        borderRadius: 999,
        border: `1px solid ${BORDER}`,
        background: "#ffffff",
        color: "#475569",
        fontSize: 11,
        fontFamily: F,
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ color: "#94a3b8", textTransform: "uppercase", fontSize: 10 }}>{diff.label}</span>
      <span>{diff.current}</span>
      <span style={{ color: B }}>→</span>
      <span style={{ color: "#0f172a", fontWeight: 700 }}>{diff.next}</span>
    </span>
  );
}

function DiffSummary({ title, diffs = [], emptyLabel = "Aligned with current setup." }) {
  return (
    <div
      style={{
        display: "grid",
        gap: 6,
        padding: "9px 10px",
        borderRadius: 8,
        border: `1px solid ${BORDER}`,
        background: "#ffffff",
      }}
    >
      <div style={{ fontSize: 10, fontFamily: FS, letterSpacing: "0.08em", textTransform: "uppercase", color: "#94a3b8" }}>
        {title}
      </div>
      {diffs.length ? (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {diffs.slice(0, 8).map((diff) => (
            <DiffBadge key={`${title}-${diff.key}`} diff={diff} />
          ))}
        </div>
      ) : (
        <div style={{ fontSize: 11, fontFamily: F, color: "#64748b" }}>{emptyLabel}</div>
      )}
    </div>
  );
}

function ComparisonCell({
  label,
  primaryValue,
  secondaryValue,
  primaryColor = "#0f172a",
  secondaryColor = "#64748b",
}) {
  return (
    <div
      style={{
        minWidth: 0,
        padding: "8px 9px",
        borderRadius: 8,
        border: `1px solid ${BORDER}`,
        background: "#ffffff",
      }}
    >
      <div style={{ fontSize: 10, fontFamily: FS, letterSpacing: "0.08em", textTransform: "uppercase", color: "#9ca3af" }}>
        {label}
      </div>
      <div style={{ marginTop: 4, display: "grid", gap: 2 }}>
        <div style={{ fontSize: 13, fontFamily: F, fontWeight: 700, color: primaryColor }}>{primaryValue}</div>
        <div style={{ fontSize: 11, fontFamily: F, color: secondaryColor }}>vs {secondaryValue}</div>
      </div>
    </div>
  );
}

export default function ResearchInsightsHistoryTab({
  runHistory = [],
  optimizerHistory = [],
  recentResults = [],
  recentBacktestJobs = [],
  recentOptimizerJobs = [],
  rayalgoBundles = [],
  currentSetupSnapshot = null,
  currentBundleContext = null,
  onLoadHistoryRun = null,
  onOpenStoredResult = null,
  onApplyHistoryOptimizer = null,
  onSaveOptBundle = null,
  onSaveHistoryBundle = null,
  onPromoteBundle = null,
  onClearRunHistory = null,
  onClearOptimizerHistory = null,
  strategyLabel = (value) => value,
}) {
  const [selectedRunId, setSelectedRunId] = React.useState(null);
  const [compareRunId, setCompareRunId] = React.useState(null);
  const [selectedBatchId, setSelectedBatchId] = React.useState(null);
  const [selectedCandidateId, setSelectedCandidateId] = React.useState(null);
  const [compareCandidateId, setCompareCandidateId] = React.useState(null);
  const [notice, setNotice] = React.useState(null);
  const [runSearch, setRunSearch] = React.useState("");
  const [runDirectionFilter, setRunDirectionFilter] = React.useState("all");
  const [runTimeframeFilter, setRunTimeframeFilter] = React.useState("all");
  const [runTierFilter, setRunTierFilter] = React.useState("all");
  const [batchSearch, setBatchSearch] = React.useState("");
  const [batchDirectionFilter, setBatchDirectionFilter] = React.useState("all");
  const [batchTimeframeFilter, setBatchTimeframeFilter] = React.useState("all");
  const [batchTierFilter, setBatchTierFilter] = React.useState("all");
  const [candidateSearch, setCandidateSearch] = React.useState("");

  const bundleLookup = React.useMemo(
    () => Object.fromEntries((Array.isArray(rayalgoBundles) ? rayalgoBundles : []).map((bundle) => [bundle.id, bundle])),
    [rayalgoBundles],
  );

  React.useEffect(() => {
    if (!notice) {
      return undefined;
    }
    const timerId = window.setTimeout(() => setNotice(null), 2800);
    return () => window.clearTimeout(timerId);
  }, [notice]);

  const runTimeframeOptions = React.useMemo(
    () => buildUniqueOptions(runHistory.map((entry) => resolveTimeframeFromSetup(entry?.setup)), compareTimeframes),
    [runHistory],
  );
  const batchTimeframeOptions = React.useMemo(
    () => buildUniqueOptions(optimizerHistory.map((batch) => resolveTimeframeFromSetup(batch?.setup)), compareTimeframes),
    [optimizerHistory],
  );

  const filteredRunHistory = React.useMemo(() => {
    const query = normalizeText(runSearch).toLowerCase();
    return (Array.isArray(runHistory) ? runHistory : []).filter((entry) => {
      if (runDirectionFilter !== "all" && resolveDirectionFromSetup(entry?.setup) !== runDirectionFilter) {
        return false;
      }
      if (runTimeframeFilter !== "all" && resolveTimeframeFromSetup(entry?.setup) !== runTimeframeFilter) {
        return false;
      }
      if (runTierFilter !== "all" && resolveTierFilterValue(entry, bundleLookup) !== runTierFilter) {
        return false;
      }
      if (query && !buildRunSearchHaystack(entry, bundleLookup, strategyLabel).includes(query)) {
        return false;
      }
      return true;
    });
  }, [bundleLookup, runDirectionFilter, runHistory, runSearch, runTierFilter, runTimeframeFilter, strategyLabel]);

  const filteredOptimizerHistory = React.useMemo(() => {
    const query = normalizeText(batchSearch).toLowerCase();
    return (Array.isArray(optimizerHistory) ? optimizerHistory : []).filter((batch) => {
      if (batchDirectionFilter !== "all" && resolveDirectionFromSetup(batch?.setup) !== batchDirectionFilter) {
        return false;
      }
      if (batchTimeframeFilter !== "all" && resolveTimeframeFromSetup(batch?.setup) !== batchTimeframeFilter) {
        return false;
      }
      if (batchTierFilter !== "all" && resolveTierFilterValue(batch, bundleLookup) !== batchTierFilter) {
        return false;
      }
      if (query && !buildBatchSearchHaystack(batch, bundleLookup, strategyLabel).includes(query)) {
        return false;
      }
      return true;
    });
  }, [batchDirectionFilter, batchSearch, batchTierFilter, batchTimeframeFilter, bundleLookup, optimizerHistory, strategyLabel]);

  React.useEffect(() => {
    const hasSelected = filteredRunHistory.some((entry) => entry.id === selectedRunId);
    if (hasSelected) {
      return;
    }
    setSelectedRunId(filteredRunHistory[0]?.id || null);
  }, [filteredRunHistory, selectedRunId]);

  React.useEffect(() => {
    if (compareRunId && !(Array.isArray(runHistory) ? runHistory : []).some((entry) => entry.id === compareRunId)) {
      setCompareRunId(null);
    }
  }, [compareRunId, runHistory]);

  React.useEffect(() => {
    const hasSelected = filteredOptimizerHistory.some((entry) => entry.id === selectedBatchId);
    if (hasSelected) {
      return;
    }
    setSelectedBatchId(filteredOptimizerHistory[0]?.id || null);
  }, [filteredOptimizerHistory, selectedBatchId]);

  const selectedRun = React.useMemo(
    () => filteredRunHistory.find((entry) => entry.id === selectedRunId) || filteredRunHistory[0] || null,
    [filteredRunHistory, selectedRunId],
  );
  const compareRun = React.useMemo(
    () => (Array.isArray(runHistory) ? runHistory : []).find((entry) => entry.id === compareRunId) || null,
    [compareRunId, runHistory],
  );
  const selectedBatch = React.useMemo(
    () => filteredOptimizerHistory.find((entry) => entry.id === selectedBatchId) || filteredOptimizerHistory[0] || null,
    [filteredOptimizerHistory, selectedBatchId],
  );

  const filteredCandidates = React.useMemo(() => {
    const query = normalizeText(candidateSearch).toLowerCase();
    const list = Array.isArray(selectedBatch?.candidates) ? selectedBatch.candidates : [];
    if (!query) {
      return list;
    }
    return list.filter((candidate) => buildCandidateSearchHaystack(candidate).includes(query));
  }, [candidateSearch, selectedBatch?.candidates]);

  React.useEffect(() => {
    const hasSelected = filteredCandidates.some((candidate) => candidate.id === selectedCandidateId);
    if (hasSelected) {
      return;
    }
    setSelectedCandidateId(filteredCandidates[0]?.id || null);
  }, [filteredCandidates, selectedCandidateId]);

  React.useEffect(() => {
    if (compareCandidateId && !(Array.isArray(selectedBatch?.candidates) ? selectedBatch.candidates : []).some((candidate) => candidate.id === compareCandidateId)) {
      setCompareCandidateId(null);
    }
  }, [compareCandidateId, selectedBatch?.candidates]);

  const selectedCandidate = React.useMemo(
    () => filteredCandidates.find((candidate) => candidate.id === selectedCandidateId) || filteredCandidates[0] || null,
    [filteredCandidates, selectedCandidateId],
  );
  const compareCandidate = React.useMemo(
    () => (Array.isArray(selectedBatch?.candidates) ? selectedBatch.candidates : []).find((candidate) => candidate.id === compareCandidateId) || null,
    [compareCandidateId, selectedBatch?.candidates],
  );

  const runDiffs = React.useMemo(
    () => diffResearchSetupSnapshots(currentSetupSnapshot, selectedRun?.setup),
    [currentSetupSnapshot, selectedRun?.setup],
  );
  const compareRunDiffs = React.useMemo(
    () => diffResearchSetupSnapshots(compareRun?.setup, selectedRun?.setup),
    [compareRun?.setup, selectedRun?.setup],
  );
  const batchSetupDiffs = React.useMemo(
    () => diffResearchSetupSnapshots(currentSetupSnapshot, selectedBatch?.setup),
    [currentSetupSnapshot, selectedBatch?.setup],
  );
  const candidateDiffs = React.useMemo(
    () => buildOptimizerCandidateDiffs(currentSetupSnapshot, selectedCandidate),
    [currentSetupSnapshot, selectedCandidate],
  );
  const candidateCompareDiffs = React.useMemo(
    () => buildCandidateDiffs(compareCandidate, selectedCandidate),
    [compareCandidate, selectedCandidate],
  );

  const selectedRunLiveBundle = resolveLiveBundle(selectedRun, bundleLookup);
  const selectedBatchLiveBundle = resolveLiveBundle(selectedBatch, bundleLookup);
  const selectedRunDirection = resolveDirectionFromSetup(selectedRun?.setup);
  const selectedBatchDirection = resolveDirectionFromSetup(selectedBatch?.setup);
  const selectedRunIsRayAlgo = normalizeText(selectedRun?.setup?.topRail?.strategy || selectedRun?.strategy).toLowerCase() === "rayalgo";

  const handleSaveHistoryBundle = React.useCallback((entry) => {
    const result = onSaveHistoryBundle?.(entry);
    setNotice(result?.ok ? `Saved ${result.bundle?.label || "history bundle"}.` : (result?.reason || "Save blocked."));
  }, [onSaveHistoryBundle]);

  const handlePromoteBundle = React.useCallback((bundleId, nextTier) => {
    const result = onPromoteBundle?.(bundleId, nextTier);
    if (!result?.ok) {
      setNotice(result?.reason || "Tier change blocked.");
      return;
    }
    const tierLabel = RAYALGO_BUNDLE_TIER_LABELS[normalizeText(nextTier).toLowerCase()] || nextTier;
    if (result.changed) {
      setNotice(`${result.bundle?.label || "Bundle"} set to ${tierLabel}.`);
    } else {
      setNotice(`${result.bundle?.label || "Bundle"} is already ${tierLabel}.`);
    }
  }, [onPromoteBundle]);

  const selectedRunTierValue = normalizeText(selectedRunLiveBundle?.evaluation?.tier || selectedRun?.bundleContext?.tier).toLowerCase();
  const canPromoteRunToExperimental = Boolean(selectedRunLiveBundle && selectedRunTierValue === "test");
  const canPromoteRunToCore = Boolean(selectedRunLiveBundle && selectedRunTierValue === "experimental");

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {notice ? (
        <div
          style={{
            padding: "8px 10px",
            borderRadius: 8,
            border: `1px solid ${B}25`,
            background: `${B}08`,
            color: B,
            fontSize: 12,
            fontFamily: F,
            fontWeight: 700,
          }}
        >
          {notice}
        </div>
      ) : null}

      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)" }}>
        <div style={{ border: `1px solid ${BORDER}`, borderRadius: 10, background: CARD, boxShadow: SH1, overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "10px 12px", borderBottom: `1px solid ${BORDER}` }}>
            <div>
              <div style={{ fontSize: 13, fontFamily: F, fontWeight: 700, color: "#0f172a" }}>Recent Persisted Results</div>
              <div style={{ marginTop: 2, fontSize: 11, fontFamily: F, color: "#64748b" }}>
                Completed runs persist automatically even before you bookmark them.
              </div>
            </div>
            <TagChip tone="primary">{recentResults.length} results</TagChip>
          </div>
          {!recentResults.length ? (
            <div style={{ padding: 14, fontSize: 12, fontFamily: F, color: "#94a3b8" }}>
              No persisted backtest results yet.
            </div>
          ) : (
            <div style={{ display: "grid", gap: 8, padding: 12 }}>
              {recentResults.slice(0, 6).map((entry) => (
                <div key={entry.resultId || entry.id} style={{ border: `1px solid ${BORDER}`, borderRadius: 10, background: "#fbfdff", padding: "10px 12px", display: "grid", gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <div style={{ fontSize: 13, fontFamily: F, fontWeight: 700, color: "#0f172a" }}>
                      {entry.marketSymbol || "SPY"} · {strategyLabel(entry.strategy)} · {formatWhen(entry.createdAt)}
                    </div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <TagChip>{entry.mode === "background" ? "Background" : "Interactive"}</TagChip>
                      {entry.bookmarkedAt ? <TagChip tone="positive">Bookmarked</TagChip> : null}
                    </div>
                  </div>
                  <div style={{ fontSize: 11.5, fontFamily: F, color: "#64748b" }}>
                    {entry.replayMeta?.selectionSummaryLabel || entry.resultMeta?.selectionSummaryLabel || "Stored backtest result"}
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <TagChip tone="positive">{entry.metrics?.n ?? 0} trades</TagChip>
                    {Number.isFinite(Number(entry.metrics?.roi)) ? <TagChip>{entry.metrics.roi >= 0 ? "+" : ""}{entry.metrics.roi}% ROI</TagChip> : null}
                    {entry.replayMeta?.replayDatasetSummary ? <TagChip>{entry.replayMeta.replayDatasetSummary.resolved} resolved</TagChip> : null}
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <ActionButton
                      tone="primary"
                      onClick={() => {
                        onOpenStoredResult?.(entry);
                        setNotice(`Opened persisted result from ${formatWhen(entry.createdAt)}.`);
                      }}
                    >
                      Open Result
                    </ActionButton>
                    <ActionButton
                      onClick={() => {
                        onLoadHistoryRun?.(entry.setup || entry.setupSnapshot || null);
                        setNotice(`Loaded setup from persisted result.`);
                      }}
                    >
                      Load Setup
                    </ActionButton>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ border: `1px solid ${BORDER}`, borderRadius: 10, background: CARD, boxShadow: SH1, overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "10px 12px", borderBottom: `1px solid ${BORDER}` }}>
            <div>
              <div style={{ fontSize: 13, fontFamily: F, fontWeight: 700, color: "#0f172a" }}>Jobs And Reconnect</div>
              <div style={{ marginTop: 2, fontSize: 11, fontFamily: F, color: "#64748b" }}>
                Active or recent server-owned jobs stay visible after refresh.
              </div>
            </div>
            <TagChip tone="warning">{recentBacktestJobs.length + recentOptimizerJobs.length} jobs</TagChip>
          </div>
          {!(recentBacktestJobs.length + recentOptimizerJobs.length) ? (
            <div style={{ padding: 14, fontSize: 12, fontFamily: F, color: "#94a3b8" }}>
              No recent server jobs yet.
            </div>
          ) : (
            <div style={{ display: "grid", gap: 8, padding: 12 }}>
              {[...recentBacktestJobs.slice(0, 3), ...recentOptimizerJobs.slice(0, 3)].map((job) => (
                <div key={job.jobId} style={{ border: `1px solid ${BORDER}`, borderRadius: 10, background: "#ffffff", padding: "10px 12px", display: "grid", gap: 7 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <div style={{ fontSize: 13, fontFamily: F, fontWeight: 700, color: "#0f172a" }}>
                      {(job.jobType || "backtest") === "optimizer" ? "Optimizer job" : "Backtest job"} · {job.marketSymbol || "SPY"}
                    </div>
                    <TagChip tone={job.status === "completed" ? "positive" : job.status === "failed" ? "warning" : "primary"}>
                      {job.status || "queued"}
                    </TagChip>
                  </div>
                  <div style={{ fontSize: 11.5, fontFamily: F, color: "#64748b" }}>
                    {job.progress?.detail || "Server-owned execution state."}
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <TagChip>{job.progress?.stage || "--"}</TagChip>
                    {job.progress?.counts?.candidates ? <TagChip>{job.progress.counts.processed || 0}/{job.progress.counts.candidates} processed</TagChip> : null}
                    {job.resultId ? <TagChip tone="positive">Result ready</TagChip> : null}
                    {job.optimizerResult?.candidateCount ? <TagChip tone="positive">{job.optimizerResult.candidateCount} candidates</TagChip> : null}
                  </div>
                  {(job.jobType || "backtest") === "optimizer" && Array.isArray(job.optimizerResult?.results) && job.optimizerResult.results[0] ? (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <ActionButton
                        tone="primary"
                        onClick={() => {
                          onApplyHistoryOptimizer?.(job.optimizerResult.results[0], currentSetupSnapshot);
                          setNotice("Applied the top optimizer candidate from recent jobs.");
                        }}
                      >
                        Apply Best Candidate
                      </ActionButton>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div
        style={{
          border: `1px solid ${BORDER}`,
          borderRadius: 10,
          background: CARD,
          boxShadow: SH1,
          overflow: "hidden",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "10px 12px", borderBottom: `1px solid ${BORDER}` }}>
          <div>
            <div style={{ fontSize: 13, fontFamily: F, fontWeight: 700, color: "#0f172a" }}>Recent Backtests</div>
            <div style={{ marginTop: 2, fontSize: 11, fontFamily: F, color: "#64748b" }}>
              Filter archived runs, compare two saved setups, and promote or save RayAlgo variants from validated evidence.
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <TagChip tone="primary">{filteredRunHistory.length} / {runHistory.length} runs</TagChip>
            {runHistory.length ? <ActionButton onClick={onClearRunHistory}>Clear Runs</ActionButton> : null}
          </div>
        </div>
        {!runHistory.length ? (
          <div style={{ padding: 18, textAlign: "center", color: "#94a3b8", fontFamily: F, fontSize: 13 }}>
            Backtest history will appear here after completed runs.
          </div>
        ) : (
          <div style={{ display: "grid", gap: 12, padding: 12 }}>
            <div style={{ display: "grid", gap: 8, padding: "10px 12px", borderRadius: 10, border: `1px solid ${BORDER}`, background: "#fbfdff" }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <FilterInput value={runSearch} onChange={setRunSearch} placeholder="Search symbol, bundle, status, or replay note" />
                <FilterSelect
                  value={runDirectionFilter}
                  onChange={setRunDirectionFilter}
                  options={[
                    { value: "all", label: "All directions" },
                    { value: "call", label: "Calls" },
                    { value: "put", label: "Puts" },
                  ]}
                />
                <FilterSelect
                  value={runTimeframeFilter}
                  onChange={setRunTimeframeFilter}
                  options={[
                    { value: "all", label: "All timeframes" },
                    ...runTimeframeOptions.map((value) => ({ value, label: value })),
                  ]}
                />
                <FilterSelect
                  value={runTierFilter}
                  onChange={setRunTierFilter}
                  options={[
                    { value: "all", label: "All tiers" },
                    { value: "test", label: "Test" },
                    { value: "experimental", label: "Experimental" },
                    { value: "core", label: "Core" },
                    { value: "custom", label: "Custom" },
                    { value: "unbundled", label: "Unbundled" },
                  ]}
                />
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <TagChip>{compareRun ? `Comparing ${formatWhen(compareRun.createdAt)}` : "Compare tray idle"}</TagChip>
                {selectedRun ? <TagChip tone="positive">Selected {resolveTimeframeFromSetup(selectedRun.setup)} {RAYALGO_BUNDLE_DIRECTION_LABELS[selectedRunDirection]}</TagChip> : null}
                {selectedRun ? <TagChip tone="warning">{resolveTierLabel(selectedRun, bundleLookup)}</TagChip> : null}
              </div>
            </div>

            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: F, fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
                    {["When", "Symbol", "Dir", "TF", "Strategy", "Bundle", "Tier", "N", "ROI", "WR", "PF", "DD", "", ""].map((header, index) => (
                      <th
                        key={`run-history-header-${header || "column"}-${index}`}
                        style={{
                          padding: "4px 6px",
                          textAlign: "left",
                          color: "#94a3b8",
                          fontFamily: FS,
                          fontWeight: 600,
                          fontSize: 10,
                          textTransform: "uppercase",
                          letterSpacing: "0.06em",
                        }}
                      >
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredRunHistory.map((entry) => {
                    const direction = resolveDirectionFromSetup(entry?.setup);
                    const tierLabel = resolveTierLabel(entry, bundleLookup);
                    const timeframe = resolveTimeframeFromSetup(entry?.setup);
                    return (
                      <tr
                        key={entry.id}
                        onClick={() => setSelectedRunId(entry.id)}
                        style={{
                          borderBottom: "1px solid #f1f5f9",
                          background: entry.id === selectedRun?.id ? `${B}08` : "transparent",
                          cursor: "pointer",
                        }}
                      >
                        <td style={{ padding: "5px 6px", color: "#475569" }}>{formatWhen(entry.createdAt)}</td>
                        <td style={{ padding: "5px 6px", color: "#0f172a" }}>{entry.marketSymbol}</td>
                        <td style={{ padding: "5px 6px", color: direction === "put" ? R : G }}>{direction === "put" ? "Put" : "Call"}</td>
                        <td style={{ padding: "5px 6px", color: "#475569" }}>{timeframe}</td>
                        <td style={{ padding: "5px 6px", color: "#0f172a" }}>{strategyLabel(entry.strategy)}</td>
                        <td style={{ padding: "5px 6px", color: "#64748b", maxWidth: 220, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {entry.bundleContext?.label || (entry.bundleContext?.isCustom ? "Custom state" : "--")}
                        </td>
                        <td style={{ padding: "5px 6px", color: "#475569" }}>{tierLabel}</td>
                        <td style={{ padding: "5px 6px", color: "#475569" }}>{entry.metrics?.n ?? 0}</td>
                        <td style={{ padding: "5px 6px", color: metricColor(entry.metrics?.roi) }}>{Number.isFinite(Number(entry.metrics?.roi)) ? `${entry.metrics.roi >= 0 ? "+" : ""}${entry.metrics.roi}%` : "--"}</td>
                        <td style={{ padding: "5px 6px", color: metricColor(entry.metrics?.wr, 50) }}>{Number.isFinite(Number(entry.metrics?.wr)) ? `${entry.metrics.wr}%` : "--"}</td>
                        <td style={{ padding: "5px 6px", color: metricColor(entry.metrics?.pf, 1) }}>{Number.isFinite(Number(entry.metrics?.pf)) ? entry.metrics.pf : "--"}</td>
                        <td style={{ padding: "5px 6px", color: R }}>{Number.isFinite(Number(entry.metrics?.dd)) ? `${entry.metrics.dd}%` : "--"}</td>
                        <td style={{ padding: "5px 6px" }}>
                          <ActionButton
                            tone={compareRun?.id === entry.id ? "warning" : "default"}
                            onClick={(event) => {
                              event.stopPropagation();
                              setCompareRunId((current) => (current === entry.id || selectedRun?.id === entry.id ? null : entry.id));
                            }}
                          >
                            {compareRun?.id === entry.id ? "Comparing" : "Compare"}
                          </ActionButton>
                        </td>
                        <td style={{ padding: "5px 6px" }}>
                          <ActionButton
                            tone="primary"
                            onClick={(event) => {
                              event.stopPropagation();
                              onLoadHistoryRun?.(entry.setup);
                              setNotice(`Loaded ${entry.marketSymbol} ${strategyLabel(entry.strategy)} setup from history.`);
                            }}
                          >
                            Load Setup
                          </ActionButton>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {selectedRun ? (
              <div style={{ display: "grid", gap: 10, padding: "10px 12px", borderRadius: 10, border: `1px solid ${BORDER}`, background: "#fbfdff" }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                  <div style={{ display: "grid", gap: 6 }}>
                    <div style={{ fontSize: 13, fontFamily: F, fontWeight: 700, color: "#0f172a" }}>
                      {selectedRun.marketSymbol} · {strategyLabel(selectedRun.strategy)} · {formatWhen(selectedRun.createdAt)}
                    </div>
                    <div style={{ marginTop: 2, fontSize: 11, fontFamily: F, color: "#64748b" }}>
                      {selectedRun.bundleContext?.label || (selectedRun.bundleContext?.isCustom ? "Custom RayAlgo state" : "Unbundled run")}
                      {selectedRun.bundleEvaluation?.summary?.statusText ? ` · ${selectedRun.bundleEvaluation.summary.statusText}` : ""}
                      {selectedRun.replayMeta?.selectionSummaryLabel ? ` · ${selectedRun.replayMeta.selectionSummaryLabel}` : ""}
                    </div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <TagChip tone="positive">{RAYALGO_BUNDLE_DIRECTION_LABELS[selectedRunDirection] || selectedRunDirection}</TagChip>
                      <TagChip>{resolveTimeframeFromSetup(selectedRun.setup)}</TagChip>
                      <TagChip tone="warning">{resolveTierLabel(selectedRun, bundleLookup)}</TagChip>
                      {selectedRunLiveBundle ? <TagChip tone="primary">Live bundle linked</TagChip> : null}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <ActionButton
                      tone="primary"
                      onClick={() => {
                        onLoadHistoryRun?.(selectedRun.setup);
                        setNotice(`Loaded ${selectedRun.marketSymbol} ${strategyLabel(selectedRun.strategy)} setup from history.`);
                      }}
                    >
                      Load Setup
                    </ActionButton>
                    <ActionButton
                      tone="positive"
                      disabled={!selectedRunIsRayAlgo}
                      onClick={() => handleSaveHistoryBundle(selectedRun)}
                    >
                      Save Variant
                    </ActionButton>
                    {canPromoteRunToExperimental ? (
                      <ActionButton
                        tone="warning"
                        onClick={() => handlePromoteBundle(selectedRunLiveBundle.id, "experimental")}
                      >
                        Promote Experimental
                      </ActionButton>
                    ) : null}
                    {canPromoteRunToCore ? (
                      <ActionButton
                        tone="warning"
                        onClick={() => handlePromoteBundle(selectedRunLiveBundle.id, "core")}
                      >
                        Approve Core
                      </ActionButton>
                    ) : null}
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 8 }}>
                  <SummaryCell label="Trades" value={selectedRun.metrics?.n ?? 0} />
                  <SummaryCell label="Expectancy" value={Number.isFinite(Number(selectedRun.metrics?.exp)) ? `${selectedRun.metrics.exp >= 0 ? "+" : ""}${selectedRun.metrics.exp}` : "--"} color={metricColor(selectedRun.metrics?.exp)} />
                  <SummaryCell label="ROI" value={Number.isFinite(Number(selectedRun.metrics?.roi)) ? `${selectedRun.metrics.roi >= 0 ? "+" : ""}${selectedRun.metrics.roi}%` : "--"} color={metricColor(selectedRun.metrics?.roi)} />
                  <SummaryCell label="Win Rate" value={Number.isFinite(Number(selectedRun.metrics?.wr)) ? `${selectedRun.metrics.wr}%` : "--"} color={metricColor(selectedRun.metrics?.wr, 50)} />
                  <SummaryCell label="PF" value={Number.isFinite(Number(selectedRun.metrics?.pf)) ? selectedRun.metrics.pf : "--"} color={metricColor(selectedRun.metrics?.pf, 1)} />
                  <SummaryCell label="Drawdown" value={Number.isFinite(Number(selectedRun.metrics?.dd)) ? `${selectedRun.metrics.dd}%` : "--"} color={R} />
                </div>

                <DiffSummary
                  title="Current vs Saved Setup"
                  diffs={runDiffs}
                  emptyLabel="Saved run matches the current active setup."
                />

                {compareRun ? (
                  <>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                      <div style={{ fontSize: 12, fontFamily: F, fontWeight: 700, color: "#0f172a" }}>
                        Compare Run · {compareRun.marketSymbol} · {formatWhen(compareRun.createdAt)}
                      </div>
                      <ActionButton onClick={() => setCompareRunId(null)}>Clear Compare</ActionButton>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 8 }}>
                      <ComparisonCell label="Trades" primaryValue={selectedRun.metrics?.n ?? 0} secondaryValue={compareRun.metrics?.n ?? 0} />
                      <ComparisonCell label="ROI" primaryValue={formatSignedValue(selectedRun.metrics?.roi, "%", 1)} secondaryValue={formatSignedValue(compareRun.metrics?.roi, "%", 1)} primaryColor={metricColor(selectedRun.metrics?.roi)} secondaryColor={metricColor(compareRun.metrics?.roi)} />
                      <ComparisonCell label="Win Rate" primaryValue={formatPlainValue(selectedRun.metrics?.wr, "%", 1)} secondaryValue={formatPlainValue(compareRun.metrics?.wr, "%", 1)} primaryColor={metricColor(selectedRun.metrics?.wr, 50)} secondaryColor={metricColor(compareRun.metrics?.wr, 50)} />
                      <ComparisonCell label="PF" primaryValue={formatPlainValue(selectedRun.metrics?.pf, "", 2)} secondaryValue={formatPlainValue(compareRun.metrics?.pf, "", 2)} primaryColor={metricColor(selectedRun.metrics?.pf, 1)} secondaryColor={metricColor(compareRun.metrics?.pf, 1)} />
                      <ComparisonCell label="Drawdown" primaryValue={formatPlainValue(selectedRun.metrics?.dd, "%", 1)} secondaryValue={formatPlainValue(compareRun.metrics?.dd, "%", 1)} primaryColor={R} secondaryColor={R} />
                    </div>
                    <DiffSummary
                      title="Selected vs Compare Setup"
                      diffs={compareRunDiffs}
                      emptyLabel="Selected run and compare run share the same saved setup."
                    />
                  </>
                ) : null}

                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 11, fontFamily: F, color: "#64748b" }}>
                  <span>Current bundle: {currentBundleContext?.label || (currentBundleContext?.isCustom ? "Custom" : "--")}</span>
                  <span>Saved bundle: {selectedRun.bundleContext?.label || (selectedRun.bundleContext?.isCustom ? "Custom" : "--")}</span>
                  <span>Live bundle tier: {selectedRunLiveBundle?.evaluation?.tier || "--"}</span>
                  <span>Replay source: {selectedRun.replayMeta?.spotSource || selectedRun.replayMeta?.dataSource || "--"}</span>
                </div>

                {selectedRun.bundleEvaluation?.summary?.sessionBadges?.length || selectedRun.bundleEvaluation?.summary?.regimeBadges?.length ? (
                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                    {selectedRun.bundleEvaluation?.summary?.sessionBadges?.length ? (
                      <div style={{ fontSize: 11, fontFamily: F, color: "#64748b" }}>
                        Sessions: {selectedRun.bundleEvaluation.summary.sessionBadges.join(", ")}
                      </div>
                    ) : null}
                    {selectedRun.bundleEvaluation?.summary?.regimeBadges?.length ? (
                      <div style={{ fontSize: 11, fontFamily: F, color: "#64748b" }}>
                        Regimes: {selectedRun.bundleEvaluation.summary.regimeBadges.join(", ")}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {selectedRun.trades?.length ? (
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: F, fontSize: 11 }}>
                      <thead>
                        <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
                          {["Entry", "Ticker", "P&L", "Bars", "Reason"].map((header, index) => (
                            <th key={`run-trades-header-${header}-${index}`} style={{ padding: "4px 5px", textAlign: "left", color: "#94a3b8", fontFamily: FS, fontSize: 10, textTransform: "uppercase" }}>
                              {header}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {selectedRun.trades.slice(-8).map((trade, index) => (
                          <tr key={`${trade.ts}-${trade.optionTicker}-${index}`} style={{ borderBottom: "1px solid #f8fafc" }}>
                            <td style={{ padding: "4px 5px", color: "#475569" }}>{trade.ts || "--"}</td>
                            <td style={{ padding: "4px 5px", color: "#0f766e" }}>{trade.optionTicker || "--"}</td>
                            <td style={{ padding: "4px 5px", color: metricColor(trade.pnl), fontWeight: 700 }}>
                              {Number.isFinite(Number(trade.pnl)) ? `${trade.pnl >= 0 ? "+" : ""}$${trade.pnl}` : "--"}
                            </td>
                            <td style={{ padding: "4px 5px", color: "#475569" }}>{trade.bh ?? "--"}</td>
                            <td style={{ padding: "4px 5px", color: "#64748b" }}>{(trade.er || "--").replace(/_/g, " ")}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        )}
      </div>

      <div
        style={{
          border: `1px solid ${BORDER}`,
          borderRadius: 10,
          background: CARD,
          boxShadow: SH1,
          overflow: "hidden",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "10px 12px", borderBottom: `1px solid ${BORDER}` }}>
          <div>
            <div style={{ fontSize: 13, fontFamily: F, fontWeight: 700, color: "#0f172a" }}>Optimizer Snapshots</div>
            <div style={{ marginTop: 2, fontSize: 11, fontFamily: F, color: "#64748b" }}>
              Filter archived batches, compare candidate variants, and save the winners into the RayAlgo bundle library.
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <TagChip tone="primary">{filteredOptimizerHistory.length} / {optimizerHistory.length} batches</TagChip>
            {optimizerHistory.length ? <ActionButton onClick={onClearOptimizerHistory}>Clear Batches</ActionButton> : null}
          </div>
        </div>
        {!optimizerHistory.length ? (
          <div style={{ padding: 18, textAlign: "center", color: "#94a3b8", fontFamily: F, fontSize: 13 }}>
            Optimizer batches will appear here after you run the real-data shortlist.
          </div>
        ) : (
          <div style={{ display: "grid", gap: 12, padding: 12 }}>
            <div style={{ display: "grid", gap: 8, padding: "10px 12px", borderRadius: 10, border: `1px solid ${BORDER}`, background: "#fbfdff" }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <FilterInput value={batchSearch} onChange={setBatchSearch} placeholder="Search bundle, candidate exit, DTE, or status" />
                <FilterSelect
                  value={batchDirectionFilter}
                  onChange={setBatchDirectionFilter}
                  options={[
                    { value: "all", label: "All directions" },
                    { value: "call", label: "Calls" },
                    { value: "put", label: "Puts" },
                  ]}
                />
                <FilterSelect
                  value={batchTimeframeFilter}
                  onChange={setBatchTimeframeFilter}
                  options={[
                    { value: "all", label: "All timeframes" },
                    ...batchTimeframeOptions.map((value) => ({ value, label: value })),
                  ]}
                />
                <FilterSelect
                  value={batchTierFilter}
                  onChange={setBatchTierFilter}
                  options={[
                    { value: "all", label: "All tiers" },
                    { value: "test", label: "Test" },
                    { value: "experimental", label: "Experimental" },
                    { value: "core", label: "Core" },
                    { value: "custom", label: "Custom" },
                    { value: "unbundled", label: "Unbundled" },
                  ]}
                />
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <TagChip>{compareCandidate ? `Comparing ${compareCandidate.dte}D ${compareCandidate.exit}` : "Candidate compare idle"}</TagChip>
                {selectedBatch ? <TagChip tone="positive">{RAYALGO_BUNDLE_DIRECTION_LABELS[selectedBatchDirection] || selectedBatchDirection}</TagChip> : null}
                {selectedBatch ? <TagChip>{resolveTimeframeFromSetup(selectedBatch.setup)}</TagChip> : null}
                {selectedBatch ? <TagChip tone="warning">{resolveTierLabel(selectedBatch, bundleLookup)}</TagChip> : null}
              </div>
            </div>

            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: F, fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
                    {["When", "Symbol", "Dir", "TF", "Strategy", "Bundle", "Tier", "Cands", "Best", "Score", ""].map((header, index) => (
                      <th
                        key={`optimizer-history-header-${header || "column"}-${index}`}
                        style={{
                          padding: "4px 6px",
                          textAlign: "left",
                          color: "#94a3b8",
                          fontFamily: FS,
                          fontWeight: 600,
                          fontSize: 10,
                          textTransform: "uppercase",
                          letterSpacing: "0.06em",
                        }}
                      >
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredOptimizerHistory.map((batch) => {
                    const best = batch.candidates?.[0] || null;
                    const direction = resolveDirectionFromSetup(batch?.setup);
                    return (
                      <tr
                        key={batch.id}
                        onClick={() => setSelectedBatchId(batch.id)}
                        style={{
                          borderBottom: "1px solid #f1f5f9",
                          background: batch.id === selectedBatch?.id ? `${B}08` : "transparent",
                          cursor: "pointer",
                        }}
                      >
                        <td style={{ padding: "5px 6px", color: "#475569" }}>{formatWhen(batch.createdAt)}</td>
                        <td style={{ padding: "5px 6px", color: "#0f172a" }}>{batch.marketSymbol}</td>
                        <td style={{ padding: "5px 6px", color: direction === "put" ? R : G }}>{direction === "put" ? "Put" : "Call"}</td>
                        <td style={{ padding: "5px 6px", color: "#475569" }}>{resolveTimeframeFromSetup(batch?.setup)}</td>
                        <td style={{ padding: "5px 6px", color: "#0f172a" }}>{strategyLabel(batch.strategy)}</td>
                        <td style={{ padding: "5px 6px", color: "#64748b", maxWidth: 220, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {batch.bundleContext?.label || "--"}
                        </td>
                        <td style={{ padding: "5px 6px", color: "#475569" }}>{resolveTierLabel(batch, bundleLookup)}</td>
                        <td style={{ padding: "5px 6px", color: "#475569" }}>{batch.candidates?.length || 0}</td>
                        <td style={{ padding: "5px 6px", color: "#0f172a" }}>{best ? `${best.dte}D · ${best.exit}` : "--"}</td>
                        <td style={{ padding: "5px 6px", color: B, fontWeight: 700 }}>{best?.score ?? "--"}</td>
                        <td style={{ padding: "5px 6px" }}>
                          <ActionButton
                            tone="primary"
                            onClick={(event) => {
                              event.stopPropagation();
                              onLoadHistoryRun?.(batch.setup);
                              setNotice(`Loaded optimizer base setup from ${formatWhen(batch.createdAt)}.`);
                            }}
                          >
                            Load Base
                          </ActionButton>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {selectedBatch ? (
              <div style={{ display: "grid", gap: 10, padding: "10px 12px", borderRadius: 10, border: `1px solid ${BORDER}`, background: "#fbfdff" }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                  <div style={{ display: "grid", gap: 6 }}>
                    <div style={{ fontSize: 13, fontFamily: F, fontWeight: 700, color: "#0f172a" }}>
                      {selectedBatch.marketSymbol} · {strategyLabel(selectedBatch.strategy)} optimizer · {formatWhen(selectedBatch.createdAt)}
                    </div>
                    <div style={{ marginTop: 2, fontSize: 11, fontFamily: F, color: "#64748b" }}>
                      {selectedBatch.bundleContext?.label || "No base bundle selected"} · {selectedBatch.candidates?.length || 0} stored candidates
                      {selectedBatch.bundleContext?.tier ? ` · ${selectedBatch.bundleContext.tier}` : ""}
                    </div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <TagChip tone="positive">{RAYALGO_BUNDLE_DIRECTION_LABELS[selectedBatchDirection] || selectedBatchDirection}</TagChip>
                      <TagChip>{resolveTimeframeFromSetup(selectedBatch.setup)}</TagChip>
                      <TagChip tone="warning">{resolveTierLabel(selectedBatch, bundleLookup)}</TagChip>
                      {selectedBatchLiveBundle ? <TagChip tone="primary">Live bundle linked</TagChip> : null}
                    </div>
                  </div>
                  <ActionButton
                    tone="primary"
                    onClick={() => {
                      onLoadHistoryRun?.(selectedBatch.setup);
                      setNotice(`Loaded optimizer base setup from ${formatWhen(selectedBatch.createdAt)}.`);
                    }}
                  >
                    Load Base Setup
                  </ActionButton>
                </div>

                <DiffSummary
                  title="Current vs Stored Base Setup"
                  diffs={batchSetupDiffs}
                  emptyLabel="Stored optimizer base already matches the current active setup."
                />

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <FilterInput value={candidateSearch} onChange={setCandidateSearch} placeholder="Filter candidates by DTE, exit, regime, or status" />
                  <TagChip tone="primary">{filteredCandidates.length} / {(selectedBatch.candidates || []).length} candidates</TagChip>
                </div>

                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: F, fontSize: 12 }}>
                    <thead>
                      <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
                        {["#", "DTE", "Exit", "N", "ROI", "WR", "PF", "DD", "Score", "", "", ""].map((header, index) => (
                          <th
                            key={`optimizer-candidate-header-${header || "column"}-${index}`}
                            style={{
                              padding: "4px 6px",
                              textAlign: "left",
                              color: "#94a3b8",
                              fontFamily: FS,
                              fontWeight: 600,
                              fontSize: 10,
                              textTransform: "uppercase",
                            }}
                          >
                            {header}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredCandidates.slice(0, 12).map((candidate, index) => (
                        <tr
                          key={candidate.id || `${selectedBatch.id}-${index}`}
                          onClick={() => setSelectedCandidateId(candidate.id)}
                          style={{
                            borderBottom: "1px solid #f8fafc",
                            background: candidate.id === selectedCandidate?.id ? `${B}08` : "transparent",
                            cursor: "pointer",
                          }}
                        >
                          <td style={{ padding: "5px 6px", color: index < 3 ? B : "#94a3b8", fontWeight: 700 }}>{index + 1}</td>
                          <td style={{ padding: "5px 6px", color: "#0f172a" }}>{candidate.dte}D</td>
                          <td style={{ padding: "5px 6px", color: "#0f172a" }}>{candidate.exit}</td>
                          <td style={{ padding: "5px 6px", color: "#475569" }}>{candidate.n}</td>
                          <td style={{ padding: "5px 6px", color: metricColor(candidate.roi) }}>{Number.isFinite(Number(candidate.roi)) ? `${candidate.roi >= 0 ? "+" : ""}${candidate.roi}%` : "--"}</td>
                          <td style={{ padding: "5px 6px", color: metricColor(candidate.wr, 50) }}>{Number.isFinite(Number(candidate.wr)) ? `${candidate.wr}%` : "--"}</td>
                          <td style={{ padding: "5px 6px", color: metricColor(candidate.pf, 1) }}>{Number.isFinite(Number(candidate.pf)) ? candidate.pf : "--"}</td>
                          <td style={{ padding: "5px 6px", color: R }}>{Number.isFinite(Number(candidate.dd)) ? `${candidate.dd}%` : "--"}</td>
                          <td style={{ padding: "5px 6px", color: B, fontWeight: 700 }}>{candidate.score ?? "--"}</td>
                          <td style={{ padding: "5px 6px" }}>
                            <ActionButton
                              tone={compareCandidate?.id === candidate.id ? "warning" : "default"}
                              onClick={(event) => {
                                event.stopPropagation();
                                setCompareCandidateId((current) => (current === candidate.id || selectedCandidate?.id === candidate.id ? null : candidate.id));
                              }}
                            >
                              {compareCandidate?.id === candidate.id ? "Comparing" : "Compare"}
                            </ActionButton>
                          </td>
                          <td style={{ padding: "5px 6px" }}>
                            <ActionButton
                              tone="primary"
                              onClick={(event) => {
                                event.stopPropagation();
                                onApplyHistoryOptimizer?.(candidate, selectedBatch.setup);
                                setNotice(`Loaded ${candidate.dte}D ${candidate.exit} optimizer candidate.`);
                              }}
                            >
                              Apply
                            </ActionButton>
                          </td>
                          <td style={{ padding: "5px 6px" }}>
                            <ActionButton
                              tone="positive"
                              onClick={(event) => {
                                event.stopPropagation();
                                const result = onSaveOptBundle?.(candidate, { setup: selectedBatch.setup });
                                setNotice(result?.ok ? `Saved ${result.bundle?.label || "optimizer bundle"}.` : (result?.reason || "Save blocked."));
                              }}
                            >
                              Save Bundle
                            </ActionButton>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {selectedCandidate ? (
                  <div style={{ display: "grid", gap: 8, padding: "10px 12px", borderRadius: 8, border: `1px solid ${BORDER}`, background: "#ffffff" }}>
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                      <div style={{ display: "grid", gap: 6 }}>
                        <div style={{ fontSize: 12, fontFamily: F, fontWeight: 700, color: "#0f172a" }}>
                          Candidate {selectedCandidate.dte}D · {selectedCandidate.exit}
                        </div>
                        <div style={{ marginTop: 2, fontSize: 11, fontFamily: F, color: "#64748b" }}>
                          Score {selectedCandidate.score ?? "--"} · PF {selectedCandidate.pf ?? "--"} · Suggested {selectedCandidate.bundleEvaluation?.summary?.tierSuggestion || "test"}
                        </div>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          <TagChip tone="primary">{selectedCandidate.regime || "none"}</TagChip>
                          <TagChip>{selectedCandidate.n || 0} trades</TagChip>
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <ActionButton
                          tone="primary"
                          onClick={() => {
                            onApplyHistoryOptimizer?.(selectedCandidate, selectedBatch.setup);
                            setNotice(`Loaded ${selectedCandidate.dte}D ${selectedCandidate.exit} optimizer candidate.`);
                          }}
                        >
                          Apply Candidate
                        </ActionButton>
                        <ActionButton
                          tone="positive"
                          onClick={() => {
                            const result = onSaveOptBundle?.(selectedCandidate, { setup: selectedBatch.setup });
                            setNotice(result?.ok ? `Saved ${result.bundle?.label || "optimizer bundle"}.` : (result?.reason || "Save blocked."));
                          }}
                        >
                          Save As Bundle
                        </ActionButton>
                      </div>
                    </div>

                    <DiffSummary
                      title="Current vs Candidate Deltas"
                      diffs={candidateDiffs}
                      emptyLabel="Candidate matches the current active execution inputs."
                    />

                    {compareCandidate ? (
                      <>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                          <div style={{ fontSize: 12, fontFamily: F, fontWeight: 700, color: "#0f172a" }}>
                            Compare Candidate · {compareCandidate.dte}D · {compareCandidate.exit}
                          </div>
                          <ActionButton onClick={() => setCompareCandidateId(null)}>Clear Compare</ActionButton>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 8 }}>
                          <ComparisonCell label="ROI" primaryValue={formatSignedValue(selectedCandidate.roi, "%", 1)} secondaryValue={formatSignedValue(compareCandidate.roi, "%", 1)} primaryColor={metricColor(selectedCandidate.roi)} secondaryColor={metricColor(compareCandidate.roi)} />
                          <ComparisonCell label="Win Rate" primaryValue={formatPlainValue(selectedCandidate.wr, "%", 1)} secondaryValue={formatPlainValue(compareCandidate.wr, "%", 1)} primaryColor={metricColor(selectedCandidate.wr, 50)} secondaryColor={metricColor(compareCandidate.wr, 50)} />
                          <ComparisonCell label="PF" primaryValue={formatPlainValue(selectedCandidate.pf, "", 2)} secondaryValue={formatPlainValue(compareCandidate.pf, "", 2)} primaryColor={metricColor(selectedCandidate.pf, 1)} secondaryColor={metricColor(compareCandidate.pf, 1)} />
                          <ComparisonCell label="Drawdown" primaryValue={formatPlainValue(selectedCandidate.dd, "%", 1)} secondaryValue={formatPlainValue(compareCandidate.dd, "%", 1)} primaryColor={R} secondaryColor={R} />
                          <ComparisonCell label="Score" primaryValue={formatPlainValue(selectedCandidate.score, "", 4)} secondaryValue={formatPlainValue(compareCandidate.score, "", 4)} primaryColor={B} secondaryColor={B} />
                        </div>
                        <DiffSummary
                          title="Selected vs Compare Candidate"
                          diffs={candidateCompareDiffs}
                          emptyLabel="Selected candidate and compare candidate share the same execution inputs."
                        />
                      </>
                    ) : null}

                    <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 11, fontFamily: F, color: "#64748b" }}>
                      <span>Base bundle: {selectedBatch.bundleContext?.label || "--"}</span>
                      <span>Base tier: {selectedBatchLiveBundle?.evaluation?.tier || selectedBatch.bundleContext?.tier || "--"}</span>
                      <span>Candidate status: {selectedCandidate.bundleEvaluation?.summary?.statusText || "--"}</span>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
