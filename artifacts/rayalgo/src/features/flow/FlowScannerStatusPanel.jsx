import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { MISSING_VALUE, T, dim, fs, sp } from "../../lib/uiTokens";
import { joinMotionClasses, motionVars } from "../../lib/motion.jsx";
import { formatRelativeTimeShort } from "../../lib/formatters";
import { Card } from "../../components/platform/primitives.jsx";
import { platformJsonRequest } from "../platform/platformJsonRequest";
import { AppTooltip } from "@/components/ui/tooltip";
import {
  formatScannerCount,
  resolveFlowScannerProgress,
} from "./flowScannerStatusModel.js";

const formatRelative = (value) => {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp)) return null;
  return formatRelativeTimeShort(new Date(timestamp).toISOString());
};

const lineTone = (used, cap) => {
  if (!Number.isFinite(used) || !Number.isFinite(cap) || cap <= 0) {
    return T.textDim;
  }
  const ratio = used / cap;
  if (ratio >= 0.95) return T.red;
  if (ratio >= 0.75) return T.amber;
  return T.textSec;
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
        fontWeight: 900,
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
        fontWeight: 900,
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

const ScannerStatusChip = ({ label, value, tone = T.textSec, testId, title }) => (
  <AppTooltip content={title || `${label}: ${value}`}>
    <span
      data-testid={testId}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: sp(4),
        minHeight: dim(20),
        maxWidth: "100%",
        padding: sp("2px 6px"),
        border: `1px solid ${tone}32`,
        background: `${tone}12`,
        color: tone,
        fontFamily: T.mono,
        fontSize: fs(8),
        fontWeight: 900,
        lineHeight: 1,
        textTransform: "uppercase",
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ color: T.textMuted }}>{label}</span>
      <span
        style={{
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {value}
      </span>
    </span>
  </AppTooltip>
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
      fontWeight: 800,
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
  const runtimeDiagnosticsQuery = useQuery({
    queryKey: ["flow-scanner-status-runtime-diagnostics"],
    queryFn: () =>
      platformJsonRequest("/api/diagnostics/runtime", { timeoutMs: 0 }),
    refetchInterval: enabled ? 5_000 : false,
    retry: false,
    staleTime: 2_000,
  });
  const admission =
    runtimeDiagnosticsQuery.data?.ibkr?.streams?.marketDataAdmission || null;
  const scannerUsed = admission?.flowScannerLineCount;
  const scannerCap = admission?.budget?.flowScannerLineCap;
  const scannerFree = admission?.flowScannerRemainingLineCount;
  const totalUsed = admission?.activeLineCount;
  const totalCap = admission?.budget?.maxLines;
  const progress = useMemo(
    () =>
      resolveFlowScannerProgress({
        coverage,
        coverageModeLabel,
        scannerConfig,
        scannedCoverageSymbols,
        totalCoverageSymbols,
        intendedCoverageSymbols,
        selectedCoverageSymbols,
      }),
    [
      coverage,
      coverageModeLabel,
      intendedCoverageSymbols,
      scannedCoverageSymbols,
      scannerConfig,
      selectedCoverageSymbols,
      totalCoverageSymbols,
    ],
  );
  const {
    batchLabel,
    capLabel,
    currentBatch,
    cycleLabel,
    pendingCount,
    progressText,
    queueLabel,
    recentSymbols,
    scopeLabel,
    selectedDetail,
    sourceModeLabel,
  } = progress;
  const latestLabel = newestScanAt ? `latest ${formatRelative(newestScanAt)}` : "latest --";
  const oldestLabel =
    oldestScanAt && oldestScanAt !== newestScanAt
      ? `oldest ${formatRelative(oldestScanAt)}`
      : null;
  const sourceTone = flowDisplayColor || T.textSec;
  const diagnosticsLoading =
    !runtimeDiagnosticsQuery.data &&
    (runtimeDiagnosticsQuery.isPending || runtimeDiagnosticsQuery.isLoading);
  const diagnosticsDetail = diagnosticsLoading
    ? "checking runtime diagnostics"
    : runtimeDiagnosticsQuery.isError
      ? "runtime diagnostics unavailable"
      : Number.isFinite(totalUsed) || Number.isFinite(totalCap)
        ? `app ${formatScannerCount(totalUsed)}/${formatScannerCount(totalCap)} · free ${formatScannerCount(scannerFree)}`
        : "runtime diagnostics";
  const lineValue =
    Number.isFinite(scannerUsed) || Number.isFinite(scannerCap)
      ? `${formatScannerCount(scannerUsed)}/${formatScannerCount(scannerCap)}`
      : MISSING_VALUE;
  const scanSweepActive = Boolean(enabled && coverage.isFetching);
  const statusLabel = enabled
    ? coverage.isFetching
      ? "Fetching"
      : ownerActive
        ? "Scanning"
      : "Idle"
    : "Off";

  return (
    <Card
      className="ra-panel-enter"
      data-testid={testId}
      data-scanner-state={statusLabel.toLowerCase()}
      data-source-mode={sourceModeLabel.toLowerCase()}
      style={{
        ...motionVars({ accent: toggleTone }),
        padding: dense ? sp("7px 8px") : sp("8px 10px"),
        display: "grid",
        gap: sp(7),
        borderColor: ownerActive ? `${toggleTone}66` : T.border,
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
              fontWeight: 800,
              whiteSpace: "nowrap",
            }}
          >
            Flow Scanner
          </span>
          <span
            style={{
              color: toggleTone,
              fontFamily: T.mono,
              fontSize: fs(8),
              fontWeight: 900,
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
              fontWeight: 800,
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {flowDisplayLabel || "Flow source"}
          </span>
          <ScannerStatusChip
            label="Source"
            value={scopeLabel ? `${sourceModeLabel} · ${scopeLabel}` : sourceModeLabel}
            tone={sourceTone}
            testId={`${testId}-source-chip`}
            title={`Scanner source ${sourceModeLabel}${scopeLabel ? `, ${scopeLabel}` : ""}`}
          />
          <ScannerStatusChip
            label="Cap"
            value={capLabel}
            tone={T.textSec}
            testId={`${testId}-cap-chip`}
            title={`Scanner symbol cap ${capLabel}`}
          />
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
            <span style={{ color: T.text, fontWeight: 900 }}>
              {cycleLabel}
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
                fontWeight: 900,
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
        className={joinMotionClasses(scanSweepActive && "ra-scan-sweep")}
        data-testid={`${testId}-progress-strip`}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: sp(8),
          minWidth: 0,
          padding: sp("4px 6px"),
          border: `1px solid ${scanSweepActive ? `${toggleTone}55` : T.border}`,
          background: scanSweepActive ? `${toggleTone}10` : T.bg0,
          color: T.textDim,
          fontFamily: T.mono,
          fontSize: fs(8),
          lineHeight: 1.25,
        }}
      >
        <span
          style={{
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {progressText}
        </span>
        <span
          style={{
            flexShrink: 0,
            color: scanSweepActive ? toggleTone : T.textMuted,
            fontWeight: 900,
            textTransform: "uppercase",
            whiteSpace: "nowrap",
          }}
        >
          {queueLabel}
        </span>
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
          value={cycleLabel}
          detail={selectedDetail}
          tone={T.textSec}
        />
        <ScannerMetric
          label="Scanning now"
          value={currentBatch.length ? currentBatch.slice(0, 3).join(" ") : MISSING_VALUE}
          detail={
            currentBatch.length > 3
              ? `+${currentBatch.length - 3} active`
              : batchLabel
          }
          tone={currentBatch.length ? T.accent : T.textDim}
        />
        <ScannerMetric
          label="Lines"
          value={lineValue}
          detail={diagnosticsDetail}
          tone={lineTone(scannerUsed, scannerCap)}
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
              symbol={`+${formatScannerCount(pendingCount)}`}
              label="pending"
              tone={T.textMuted}
              title={`${formatScannerCount(pendingCount)} symbols pending in this cycle`}
            />
          ) : null}
        </div>
      ) : null}
    </Card>
  );
};
