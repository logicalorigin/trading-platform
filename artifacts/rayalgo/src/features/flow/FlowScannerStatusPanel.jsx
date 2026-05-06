import { useMemo } from "react";
import { MISSING_VALUE, T, dim, fs, sp } from "../../lib/uiTokens";
import { formatRelativeTimeShort } from "../../lib/formatters";
import { Card } from "../../components/platform/primitives.jsx";
import {
  lineUsageTone,
} from "../platform/runtimeControlModel.js";
import { useRuntimeControlSnapshot } from "../platform/useRuntimeControlSnapshot.js";
import { buildRecentScannerSymbols } from "./flowScannerStatusModel.js";
import { AppTooltip } from "@/components/ui/tooltip";


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

const ScannerMetric = ({ label, value, detail, tone = T.textSec }) => (
  <div
    style={{
      minWidth: 0,
      padding: sp("5px 7px"),
      background: T.bg2,
      border: `1px solid ${T.border}`,
      fontFamily: T.mono,
    }}
  >
    <div
      style={{
        color: T.textMuted,
        fontSize: fs(7),
        fontWeight: 400,
        letterSpacing: "0.05em",
        textTransform: "uppercase",
        lineHeight: 1,
      }}
    >
      {label}
    </div>
    <div
      style={{
        marginTop: sp(3),
        color: tone,
        fontSize: fs(11),
        fontWeight: 400,
        lineHeight: 1,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}
    >
      {value ?? MISSING_VALUE}
    </div>
    {detail ? (
      <div
        style={{
          marginTop: sp(2),
          color: T.textDim,
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
  <AppTooltip content={title}><span
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: sp(3),
      height: dim(20),
      padding: sp("0 6px"),
      border: `1px solid ${tone}35`,
      background: `${tone}12`,
      color: tone,
      fontFamily: T.mono,
      fontSize: fs(8),
      fontWeight: 400,
      whiteSpace: "nowrap",
    }}
  >
    <span>{symbol}</span>
    {label ? <span style={{ color: T.textMuted }}>{label}</span> : null}
  </span></AppTooltip>
);

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
  testId = "flow-scanner-status-panel",
}) => {
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
  const selectedDetail =
    intendedCoverageSymbols > selectedCoverageSymbols
      ? `selected ${formatCount(selectedCoverageSymbols)}/${formatCount(intendedCoverageSymbols)}`
      : coverage.isRotating
        ? `rotating ${formatCount(coverage.batchSize || scannerConfig.batchSize)}/cycle`
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

  return (
    <Card
      data-testid={testId}
      style={{
        padding: dense ? sp("7px 8px") : sp("8px 10px"),
        display: "grid",
        gap: sp(7),
        borderColor: scannerRuntimeActive || scanDegraded ? `${statusTone}66` : T.border,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: sp(10),
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: sp(7), minWidth: 0 }}>
          <span
            style={{
              color: T.textSec,
              fontFamily: T.display,
              fontSize: fs(11),
              fontWeight: 400,
              whiteSpace: "nowrap",
            }}
          >
            Flow Scanner
          </span>
          <span
            style={{
              color: statusTone,
              fontFamily: T.mono,
              fontSize: fs(8),
              fontWeight: 400,
              textTransform: "uppercase",
              whiteSpace: "nowrap",
            }}
          >
            {statusLabel}
          </span>
          <span
            style={{
              color: sourceTone,
              fontFamily: T.mono,
              fontSize: fs(8),
              fontWeight: 400,
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
            gap: sp(7),
            color: T.textDim,
            fontFamily: T.mono,
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
            <button
              type="button"
              onClick={onToggle}
              style={{
                minHeight: dim(24),
                padding: sp("3px 8px"),
                border: `1px solid ${toggleTone}`,
                background: enabled ? `${toggleTone}18` : T.bg1,
                color: toggleTone,
                fontFamily: T.mono,
                fontSize: fs(8),
                fontWeight: 400,
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {enabled ? "Stop Flow scan" : "Start Flow scan"}
            </button>
          ) : null}
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: dense
            ? "repeat(2, minmax(0, 1fr))"
            : "repeat(4, minmax(0, 1fr))",
          gap: sp(6),
        }}
      >
        <ScannerMetric
          label="Coverage"
          value={`${formatCount(scannedCoverageSymbols)}/${formatCount(totalCoverageSymbols || scannedCoverageSymbols)}`}
          detail={selectedDetail}
          tone={T.textSec}
        />
        <ScannerMetric
          label="Scanning now"
          value={currentBatch.length ? currentBatch.slice(0, 3).join(" ") : MISSING_VALUE}
          detail={
            currentBatch.length > 3
              ? `+${currentBatch.length - 3} active`
              : `${formatCount(scannerConfig.batchSize || coverage.batchSize)} batch / ${formatCount(scannerConfig.concurrency || coverage.concurrency)} conc`
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
          detail={
            Number.isFinite(totalUsed) || Number.isFinite(totalCap)
              ? `acct ${formatCount(accountMonitorUsed)}/${formatCount(accountMonitorCap)} · app ${formatCount(totalUsed)}/${formatCount(totalCap)}`
              : "runtime diagnostics"
          }
          tone={lineUsageTone(scannerUsed, scannerCap)}
        />
        <ScannerMetric
          label="Quality"
          value={flowQuality?.label || MISSING_VALUE}
          detail={flowQuality?.detail}
          tone={flowQuality?.color || T.textDim}
        />
      </div>

      {enabled || currentBatch.length || recentSymbols.length ? (
        <div
          data-testid="flow-scanner-live-tickers"
          style={{
            display: "flex",
            alignItems: "center",
            gap: sp(4),
            minWidth: 0,
            overflowX: "auto",
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
