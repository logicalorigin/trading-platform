import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Power,
  RadioTower,
} from "lucide-react";
import { MISSING_VALUE, T, dim, fs, sp } from "../../lib/uiTokens";
import { formatRelativeTimeShort } from "../../lib/formatters";
import { Badge, Card, Pill } from "../../components/platform/primitives.jsx";
import {
  lineUsageTone,
} from "../platform/runtimeControlModel.js";
import { useRuntimeControlSnapshot } from "../platform/useRuntimeControlSnapshot.js";
import { buildRecentScannerSymbols } from "./flowScannerStatusModel.js";
import { AppTooltip } from "@/components/ui/tooltip";

const SPARKLINE_HISTORY = 24;

const safeCount = (value) =>
  Number.isFinite(value) ? Math.max(0, Math.round(value)) : null;

const formatCount = (value) => {
  const count = safeCount(value);
  return count == null ? MISSING_VALUE : count.toLocaleString();
};

const formatRelative = (value) => {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp)) return null;
  return formatRelativeTimeShort(new Date(timestamp).toISOString());
};

const formatCycleEstimate = (value) => {
  const ms = Number(value);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  if (ms >= 60_000) return `~${Math.round(ms / 60_000)}m`;
  return `~${Math.round(ms / 1_000)}s`;
};

const Sparkline = ({ values, color, width = 56, height = 14 }) => {
  if (!Array.isArray(values) || values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const step = width / Math.max(values.length - 1, 1);
  const plotted = values.map((value, index) => {
    const x = index * step;
    const y = height - ((value - min) / range) * Math.max(height - 2, 1) - 1;
    return [x.toFixed(2), y.toFixed(2)];
  });
  const points = plotted.map(([x, y]) => `${x},${y}`).join(" ");
  const areaPath = `M ${plotted
    .map(([x, y], index) => `${index === 0 ? "" : "L "}${x},${y}`)
    .join(" ")} L ${width},${height} L 0,${height} Z`;
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      style={{ display: "block" }}
    >
      <path d={areaPath} fill={`${color}1f`} />
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.4"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
};

const ProgressBar = ({ ratio, color = T.accent, height = 4 }) => {
  const clamped = Math.max(0, Math.min(1, ratio || 0));
  return (
    <div
      style={{
        height,
        width: "100%",
        background: T.bg3,
        borderRadius: dim(999),
        border: "none",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          height: "100%",
          width: `${clamped * 100}%`,
          background: color,
          borderRadius: dim(999),
          transition: "width 0.4s ease",
        }}
      />
    </div>
  );
};

const ScannerMetric = ({ label, value, detail, chart, dotColor, tone = T.textSec }) => (
  <div
    style={{
      minWidth: 0,
      padding: sp("8px 10px"),
      background: T.bg2,
      border: "none",
      borderRadius: dim(8),
      transition:
        "background-color var(--ra-motion-fast) var(--ra-motion-ease)",
    }}
  >
    <div
      style={{
        color: T.textMuted,
        fontFamily: T.sans,
        fontSize: fs(9),
        fontWeight: 500,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        lineHeight: 1,
      }}
    >
      {label}
    </div>
    <div
      style={{
        marginTop: sp(4),
        display: "flex",
        alignItems: "center",
        gap: sp(5),
        color: tone,
        fontFamily: T.sans,
        fontSize: fs(13),
        fontWeight: 600,
        letterSpacing: "-0.01em",
        lineHeight: 1.1,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}
    >
      {dotColor ? (
        <span
          style={{
            width: dim(6),
            height: dim(6),
            borderRadius: "50%",
            background: dotColor,
            flexShrink: 0,
          }}
        />
      ) : null}
      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
        {value ?? MISSING_VALUE}
      </span>
    </div>
    {chart ? <div style={{ marginTop: sp(3) }}>{chart}</div> : null}
    {detail ? (
      <div
        style={{
          marginTop: sp(3),
          color: T.textDim,
          fontFamily: T.sans,
          fontSize: fs(7),
          lineHeight: 1.1,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {detail}
      </div>
    ) : null}
  </div>
);

const TickerChip = ({ symbol, label, tone, title }) => (
  <AppTooltip content={title}>
    <span
      onMouseEnter={(event) => {
        event.currentTarget.style.background = `${tone}24`;
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.background = `${tone}12`;
      }}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: sp(4),
        padding: sp("2px 8px"),
        borderRadius: dim(999),
        border: "none",
        background: `${tone}14`,
        color: tone,
        fontFamily: T.sans,
        fontSize: fs(10),
        fontWeight: 500,
        letterSpacing: "0.02em",
        whiteSpace: "nowrap",
        transition: "background-color 0.18s ease",
      }}
    >
      <span>{symbol}</span>
      {label ? <span style={{ color: T.textMuted }}>{label}</span> : null}
    </span>
  </AppTooltip>
);

const StatusIcon = ({ enabled, scanning, degraded, color }) => {
  let Icon = Power;
  if (degraded) Icon = AlertTriangle;
  else if (enabled && scanning) Icon = RadioTower;
  else if (enabled) Icon = Activity;
  return <Icon size={dim(14)} strokeWidth={2.2} color={color} />;
};

export const FlowScannerStatusPanel = ({
  enabled,
  ownerActive,
  flowDisplayLabel,
  flowDisplayColor,
  flowQuality,
  coverage = {},
  coverageModeLabel = "watchlist",
  scannedCoverageSymbols = 0,
  totalCoverageSymbols = 0,
  intendedCoverageSymbols = 0,
  selectedCoverageSymbols = 0,
  newestScanAt = null,
  oldestScanAt = null,
  scannerConfig = {},
  onToggle,
  toggleTone = T.accent,
  formatAppTime,
  showToggle = true,
  dense = false,
  layout = "horizontal",
  testId = "flow-scanner-status-panel",
}) => {
  const vertical = layout === "vertical";
  const runtimeControl = useRuntimeControlSnapshot({
    enabled,
    runtimeDiagnosticsEnabled: false,
    lineUsageEnabled: enabled,
    lineUsageStreamEnabled: false,
    lineUsagePollInterval: 5_000,
  });
  const lineUsage = runtimeControl.lineUsage;
  const scannerUsed = lineUsage.flowScanner?.used;
  const scannerCap = lineUsage.flowScanner?.cap;
  const accountMonitorUsed = lineUsage.accountMonitor?.used;
  const accountMonitorCap = lineUsage.accountMonitor?.cap;
  const totalUsed = lineUsage.total?.used;
  const totalCap = lineUsage.total?.cap;
  const currentBatch = Array.isArray(coverage.currentBatch)
    ? coverage.currentBatch.filter(Boolean)
    : [];
  const recentSymbols = useMemo(
    () => buildRecentScannerSymbols(coverage.lastScannedAt, currentBatch),
    [coverage.lastScannedAt, currentBatch],
  );
  const pendingCount = Math.max(
    0,
    (safeCount(totalCoverageSymbols) ?? 0) -
      Math.max(currentBatch.length + recentSymbols.length, safeCount(scannedCoverageSymbols) ?? 0),
  );
  const latestLabel = newestScanAt ? `latest ${formatRelative(newestScanAt)}` : "latest --";
  const oldestLabel =
    oldestScanAt && oldestScanAt !== newestScanAt
      ? `oldest ${formatRelative(oldestScanAt)}`
      : null;
  const displayBatchSize = coverage.batchSize ?? scannerConfig.batchSize;
  const displayConcurrency = coverage.concurrency ?? scannerConfig.concurrency;
  const cycleEstimateLabel = formatCycleEstimate(coverage.estimatedCycleMs);
  const selectedDetail =
    intendedCoverageSymbols > selectedCoverageSymbols
      ? `selected ${formatCount(selectedCoverageSymbols)}/${formatCount(intendedCoverageSymbols)}`
      : coverage.isRotating
        ? `rotating ${formatCount(displayBatchSize)}/cycle${cycleEstimateLabel ? ` · ${cycleEstimateLabel}` : ""}`
        : cycleEstimateLabel
          ? `${coverageModeLabel} · ${cycleEstimateLabel}`
          : coverageModeLabel;
  const sourceTone = flowDisplayColor || T.textSec;
  const scanDegraded = enabled && flowQuality?.label === "Degraded";
  const scannerRuntimeActive = Boolean(
    ownerActive || runtimeControl.flowScanner?.active,
  );
  const statusTone = scanDegraded ? flowQuality?.color || T.red : toggleTone;
  const statusLabel = enabled
    ? scanDegraded
      ? "Degraded"
      : scannerRuntimeActive
      ? "Scanning"
      : "Idle"
    : "Off";
  const linesTone = lineUsageTone(scannerUsed, scannerCap);
  const coverageRatio =
    Number.isFinite(scannedCoverageSymbols) &&
    Number.isFinite(totalCoverageSymbols) &&
    totalCoverageSymbols > 0
      ? scannedCoverageSymbols / totalCoverageSymbols
      : 0;

  const [linesHistory, setLinesHistory] = useState([]);
  useEffect(() => {
    if (!Number.isFinite(scannerUsed)) return;
    setLinesHistory((prev) => {
      const next = [...prev, scannerUsed];
      return next.length > SPARKLINE_HISTORY
        ? next.slice(next.length - SPARKLINE_HISTORY)
        : next;
    });
  }, [scannerUsed]);

  return (
    <Card
      data-testid={testId}
      style={{
        padding: dense || vertical ? sp("6px 8px") : sp("8px 10px"),
        display: "grid",
        gap: sp(6),
        borderColor: scannerRuntimeActive || scanDegraded ? `${statusTone}66` : T.border,
        height: vertical ? "100%" : undefined,
        alignContent: vertical ? "start" : undefined,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: vertical ? "column" : "row",
          alignItems: vertical ? "stretch" : "center",
          justifyContent: "space-between",
          gap: sp(vertical ? 4 : 8),
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: sp(6), minWidth: 0 }}>
          <StatusIcon
            enabled={enabled}
            scanning={scannerRuntimeActive}
            degraded={scanDegraded}
            color={statusTone}
          />
          <span
            style={{
              color: T.textSec,
              fontFamily: T.sans,
              fontSize: fs(11),
              fontWeight: 400,
              letterSpacing: "0.03em",
              whiteSpace: "nowrap",
            }}
          >
            Flow Scanner
          </span>
          <Badge color={statusTone}>{statusLabel.toUpperCase()}</Badge>
          <span
            style={{
              color: sourceTone,
              fontFamily: T.sans,
              fontSize: fs(8),
              fontWeight: 400,
              letterSpacing: "0.04em",
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {flowDisplayLabel || "Flow source"}
          </span>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: sp(6),
            color: T.textDim,
            fontFamily: T.sans,
            fontSize: fs(8),
            minWidth: 0,
          }}
        >
          <span>
            Cycle{" "}
            <span style={{ color: T.text, fontWeight: 400 }}>
              {formatCount(scannedCoverageSymbols)}/{formatCount(totalCoverageSymbols || scannedCoverageSymbols)}
            </span>
          </span>
          <span>{latestLabel}</span>
          {oldestLabel ? <span>{oldestLabel}</span> : null}
          {showToggle ? (
            <Pill
              active={enabled}
              color={toggleTone}
              onClick={onToggle}
              aria-label={enabled ? "Stop Flow scan" : "Start Flow scan"}
            >
              {enabled ? "Stop scan" : "Start scan"}
            </Pill>
          ) : null}
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: vertical
            ? "minmax(0, 1fr)"
            : dense
              ? "repeat(2, minmax(0, 1fr))"
              : "repeat(4, minmax(0, 1fr))",
          gap: sp(6),
        }}
      >
        <ScannerMetric
          label="Coverage"
          value={`${formatCount(scannedCoverageSymbols)}/${formatCount(totalCoverageSymbols || scannedCoverageSymbols)}`}
          chart={
            totalCoverageSymbols > 0 ? (
              <ProgressBar ratio={coverageRatio} color={T.accent} />
            ) : null
          }
          detail={selectedDetail}
          tone={T.textSec}
        />
        <ScannerMetric
          label="Scanning now"
          value={currentBatch.length ? currentBatch.slice(0, 3).join(" ") : MISSING_VALUE}
          detail={
            currentBatch.length > 3
              ? `+${currentBatch.length - 3} active`
              : `${formatCount(displayBatchSize)} batch / ${formatCount(displayConcurrency)} conc`
          }
          tone={currentBatch.length ? T.accent : T.textDim}
        />
        <ScannerMetric
          label="Lines"
          value={
            Number.isFinite(scannerUsed) || Number.isFinite(scannerCap)
              ? `${formatCount(scannerUsed)}/${formatCount(scannerCap)}`
              : MISSING_VALUE
          }
          chart={<Sparkline values={linesHistory} color={linesTone} />}
          detail={
            Number.isFinite(totalUsed) || Number.isFinite(totalCap)
              ? `acct ${formatCount(accountMonitorUsed)}/${formatCount(accountMonitorCap)} · app ${formatCount(totalUsed)}/${formatCount(totalCap)}`
              : "runtime diagnostics"
          }
          tone={linesTone}
        />
        <ScannerMetric
          label="Quality"
          value={flowQuality?.label || MISSING_VALUE}
          dotColor={flowQuality?.color || T.textDim}
          detail={flowQuality?.detail}
          tone={flowQuality?.color || T.textDim}
        />
      </div>

      {enabled || currentBatch.length || recentSymbols.length ? (
        <div
          data-testid="flow-scanner-live-tickers"
          style={{
            display: "flex",
            alignItems: vertical ? "flex-start" : "center",
            flexWrap: vertical ? "wrap" : "nowrap",
            gap: sp(4),
            minWidth: 0,
            overflowX: vertical ? "visible" : "auto",
            paddingBottom: sp(1),
          }}
        >
          {currentBatch.slice(0, 12).map((symbol) => (
            <TickerChip
              key={`current-${symbol}`}
              symbol={symbol}
              label="scanning"
              tone={T.accent}
              title={`${symbol} is in the active scanner batch`}
            />
          ))}
          {recentSymbols.slice(0, 10).map((entry) => (
            <TickerChip
              key={`recent-${entry.symbol}`}
              symbol={entry.symbol}
              label={formatRelative(entry.scannedAt)}
              tone={T.textSec}
              title={
                formatAppTime
                  ? `${entry.symbol} last scanned ${formatAppTime(entry.scannedAt)}`
                  : `${entry.symbol} last scanned`
              }
            />
          ))}
          {pendingCount > 0 ? (
            <TickerChip
              symbol={`+${formatCount(pendingCount)}`}
              label="pending"
              tone={T.textMuted}
              title={`${formatCount(pendingCount)} symbols pending in this cycle`}
            />
          ) : null}
        </div>
      ) : null}
    </Card>
  );
};
