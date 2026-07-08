import {
  useMemo,
} from "react";
import {
  Activity,
  AlertTriangle,
  Power,
  RefreshCw,
} from "lucide-react";
import {
  CSS_COLOR,
  FONT_WEIGHTS,
  MISSING_VALUE,
  RADII,
  T,
  cssColorAlpha,
  dim,
  fs,
  sp,
} from "../../lib/uiTokens.jsx";
import { formatRelativeTimeShort } from "../../lib/formatters";
import { Badge, Card, Pill, StatTile } from "../../components/platform/primitives.jsx";
import { useRuntimeControlSnapshot } from "../platform/useRuntimeControlSnapshot.js";
import {
  buildRecentScannerSymbols,
  resolveFlowScannerStatusDisplay,
} from "./flowScannerStatusModel.js";
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

const formatCycleEstimate = (value) => {
  const ms = Number(value);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  if (ms >= 60_000) return `~${Math.round(ms / 60_000)}m`;
  return `~${Math.round(ms / 1_000)}s`;
};

const ProgressBar = ({ ratio, color = CSS_COLOR.accent, height = 4 }) => {
  const clamped = Math.max(0, Math.min(1, ratio || 0));
  return (
    <div
      style={{
        height,
        width: "100%",
        background: CSS_COLOR.bg1,
        borderRadius: dim(RADII.pill),
        border: "none",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          height: "100%",
          width: `${clamped * 100}%`,
          background: color,
          borderRadius: dim(RADII.pill),
          transition: "width 0.4s ease",
        }}
      />
    </div>
  );
};

const TickerChip = ({ symbol, label, tone, title }) => (
  <AppTooltip content={title}>
    <span
      onMouseEnter={(event) => {
        event.currentTarget.style.background = cssColorAlpha(tone, "24");
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.background = cssColorAlpha(tone, "12");
      }}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: sp(4),
        padding: sp("2px 8px"),
        borderRadius: dim(RADII.pill),
        border: "none",
        background: cssColorAlpha(tone, "14"),
        color: tone,
        fontFamily: T.sans,
        fontSize: fs(10),
        fontWeight: FONT_WEIGHTS.medium,
        letterSpacing: "0.02em",
        whiteSpace: "nowrap",
        transition: "background-color var(--ra-motion-standard) ease",
      }}
    >
      <span>{symbol}</span>
      {label ? <span style={{ color: CSS_COLOR.textMuted }}>{label}</span> : null}
    </span>
  </AppTooltip>
);

const StatusIcon = ({ enabled, scanning, degraded, color }) => {
  let Icon = Power;
  if (degraded) Icon = AlertTriangle;
  else if (enabled && scanning) Icon = RefreshCw;
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
  toggleTone = CSS_COLOR.accent,
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
  });
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
  const sourceTone = flowDisplayColor || CSS_COLOR.textSec;
  const scanDegraded = enabled && flowQuality?.label === "Degraded";
  const scannerRuntimeActive = Boolean(
    ownerActive || runtimeControl.flowScanner?.active,
  );
  const statusDisplay = resolveFlowScannerStatusDisplay({
    enabled,
    degraded: scanDegraded,
    runtimeActive: scannerRuntimeActive,
    loading: runtimeControl.loading,
    error: Boolean(runtimeControl.error),
  });
  const statusTone = scanDegraded ? flowQuality?.color || CSS_COLOR.red : toggleTone;
  const statusLabel = statusDisplay.label;
  const coverageRatio =
    Number.isFinite(scannedCoverageSymbols) &&
    Number.isFinite(totalCoverageSymbols) &&
    totalCoverageSymbols > 0
      ? scannedCoverageSymbols / totalCoverageSymbols
      : 0;

  return (
    <Card
      data-testid={testId}
      style={{
        padding: dense || vertical ? sp("6px 8px") : sp("8px 10px"),
        display: "grid",
        gap: sp(6),
        borderColor: scannerRuntimeActive || scanDegraded ? cssColorAlpha(statusTone, "66") : CSS_COLOR.border,
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
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: sp(6),
            minWidth: 0,
            flexWrap: "wrap",
          }}
        >
          <StatusIcon
            enabled={enabled}
            scanning={scannerRuntimeActive}
            degraded={scanDegraded}
            color={statusTone}
          />
          <span
            style={{
              color: CSS_COLOR.textSec,
              fontFamily: T.sans,
              fontSize: fs(11),
              fontWeight: FONT_WEIGHTS.regular,
              letterSpacing: "0.03em",
              whiteSpace: "normal",
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
              fontWeight: FONT_WEIGHTS.regular,
              letterSpacing: "0.04em",
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "normal",
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
            color: CSS_COLOR.textDim,
            fontFamily: T.sans,
            fontSize: fs(8),
            minWidth: 0,
          }}
        >
          <span>
            Cycle{" "}
            <span style={{ color: CSS_COLOR.text, fontWeight: FONT_WEIGHTS.regular }}>
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
              ? "repeat(auto-fit, minmax(min(100%, 144px), 1fr))"
              : "repeat(4, minmax(0, 1fr))",
          gap: sp(6),
        }}
      >
        <StatTile
          label="Coverage"
          value={`${formatCount(scannedCoverageSymbols)}/${formatCount(totalCoverageSymbols || scannedCoverageSymbols)}`}
          viz={
            totalCoverageSymbols > 0 ? (
              <ProgressBar ratio={coverageRatio} color={CSS_COLOR.accent} />
            ) : null
          }
          sub={selectedDetail}
          tone={CSS_COLOR.textSec}
          minWidth={0}
        />
        <StatTile
          label="Scanning now"
          value={currentBatch.length ? currentBatch.slice(0, 3).join(" ") : MISSING_VALUE}
          sub={
            currentBatch.length > 3
              ? `+${currentBatch.length - 3} active`
              : `${formatCount(displayBatchSize)} batch / ${formatCount(displayConcurrency)} conc`
          }
          tone={currentBatch.length ? CSS_COLOR.accent : CSS_COLOR.textDim}
          minWidth={0}
        />
        <StatTile
          label="Quality"
          value={
            <span style={{ display: "inline-flex", alignItems: "center", gap: sp(5) }}>
              <span
                aria-hidden="true"
                style={{
                  width: dim(6),
                  height: dim(6),
                  borderRadius: dim(RADII.pill),
                  background: flowQuality?.color || CSS_COLOR.textDim,
                  flexShrink: 0,
                }}
              />
              {flowQuality?.label || MISSING_VALUE}
            </span>
          }
          sub={flowQuality?.detail}
          tone={flowQuality?.color || CSS_COLOR.textDim}
          minWidth={0}
        />
      </div>

      {enabled || currentBatch.length || recentSymbols.length ? (
        <div
          data-testid="flow-scanner-live-tickers"
          style={{
            display: "flex",
            alignItems: vertical ? "flex-start" : "center",
            flexWrap: "wrap",
            gap: sp(4),
            minWidth: 0,
            overflowX: "visible",
            paddingBottom: sp(1),
          }}
        >
          {currentBatch.slice(0, 12).map((symbol) => (
            <TickerChip
              key={`current-${symbol}`}
              symbol={symbol}
              label="scanning"
              tone={CSS_COLOR.accent}
              title={`${symbol} is in the active scanner batch`}
            />
          ))}
          {recentSymbols.slice(0, 10).map((entry) => (
            <TickerChip
              key={`recent-${entry.symbol}`}
              symbol={entry.symbol}
              label={formatRelative(entry.scannedAt)}
              tone={CSS_COLOR.textSec}
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
              tone={CSS_COLOR.textMuted}
              title={`${formatCount(pendingCount)} symbols pending in this cycle`}
            />
          ) : null}
        </div>
      ) : null}
    </Card>
  );
};
