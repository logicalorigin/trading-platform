import {
  CSS_COLOR,
  FONT_WEIGHTS,
  RADII,
  T,
  dim,
  fs,
  sp,
  textSize,
} from "../../lib/uiTokens.jsx";
import { MicroSparkline } from "../../components/platform/primitives.jsx";
import { useMemo } from "react";
import {
  seriesFromBuffer,
  useAlgoKpiHistory,
} from "../../features/platform/algoKpiHistoryStore";
import { formatMoney, formatPct } from "./algoHelpers";

const Cell = ({
  label,
  value,
  hint,
  tone,
  history,
  sparkPositive,
  compact,
  hideHint = false,
}) => {
  const visibleHint = hideHint ? null : hint;
  if (compact) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: sp(4),
          padding: sp("2px 6px"),
          minWidth: 0,
          minHeight: dim(26),
          background: CSS_COLOR.bg1,
        }}
      >
        <span
          style={{
            color: CSS_COLOR.textMuted,
            fontFamily: T.sans,
            fontSize: textSize("caption"),
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            flex: "0 1 auto",
            minWidth: 0,
          }}
        >
          {label}
        </span>
        <span
          style={{
            display: "inline-flex",
            alignItems: "baseline",
            justifyContent: "flex-end",
            gap: sp(4),
            minWidth: 0,
            flex: "1 1 auto",
          }}
        >
          <span
            style={{
              color: tone || CSS_COLOR.text,
              fontFamily: T.sans,
              fontSize: fs(12),
              fontWeight: FONT_WEIGHTS.medium,
              lineHeight: 1.1,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              minWidth: 0,
            }}
          >
            {value}
          </span>
          {visibleHint ? (
            <span
              style={{
                color: CSS_COLOR.textDim,
                fontFamily: T.sans,
                fontSize: textSize("caption"),
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                minWidth: 0,
              }}
            >
              {visibleHint}
            </span>
          ) : null}
        </span>
      </div>
    );
  }
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap: sp(1),
        padding: sp("5px 8px"),
        minWidth: 0,
        minHeight: dim(58),
      }}
    >
      <span
        style={{
          color: CSS_COLOR.textMuted,
          fontFamily: T.sans,
          fontSize: textSize("caption"),
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {label}
      </span>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: sp(4),
          minWidth: 0,
        }}
      >
        <span
          style={{
            color: tone || CSS_COLOR.text,
            fontFamily: T.sans,
            fontSize: fs(14),
            fontWeight: FONT_WEIGHTS.medium,
            lineHeight: 1.1,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {value}
        </span>
        {history && history.length >= 2 ? (
          <MicroSparkline
            data={history}
            width={dim(56)}
            height={dim(18)}
            positive={sparkPositive ?? null}
          />
        ) : null}
      </div>
      {visibleHint ? (
        <span
          style={{
            color: CSS_COLOR.textDim,
            fontFamily: T.sans,
            fontSize: textSize("caption"),
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {visibleHint}
        </span>
      ) : null}
    </div>
  );
};

export const OperationsKpiStrip = ({
  cockpitKpis,
  cockpitSignalFreshness,
  cockpitTradePath,
  signalOptionsPerformanceSummary,
  signalOptionsPositions,
  signalOptionsCandidates,
  deploymentId,
  algoIsPhone = false,
  algoIsNarrow = false,
  algoIsPocketWidth = false,
}) => {
  const dense = algoIsPhone || algoIsNarrow;
  const buffer = useAlgoKpiHistory(deploymentId);
  const series = useMemo(
    () => ({
      realized: seriesFromBuffer(buffer, "realized"),
      unrealized: seriesFromBuffer(buffer, "unrealized"),
      winRate: seriesFromBuffer(buffer, "winRate"),
      profitFactor: seriesFromBuffer(buffer, "profitFactor"),
      freshSignals: seriesFromBuffer(buffer, "freshSignals"),
      openPositions: seriesFromBuffer(buffer, "openPositions"),
    }),
    [buffer],
  );
  const realized = Number(cockpitKpis?.dailyRealizedPnl ?? 0);
  const unrealized = Number(cockpitKpis?.openUnrealizedPnl ?? 0);
  const wins = Number(signalOptionsPerformanceSummary?.wins ?? 0);
  const losses = Number(signalOptionsPerformanceSummary?.losses ?? 0);
  const winRate = signalOptionsPerformanceSummary?.winRatePercent;
  const profitFactor = signalOptionsPerformanceSummary?.profitFactor;
  const freshSignals = Number(cockpitSignalFreshness?.fresh ?? 0);
  const totalSignals =
    Number(cockpitSignalFreshness?.fresh ?? 0) +
    Number(cockpitSignalFreshness?.notFresh ?? 0);
  const openPositions = Number(
    cockpitKpis?.openPositions ?? signalOptionsPositions?.length ?? 0,
  );
  const pending = Number(
    cockpitTradePath?.pendingCandidates ??
      signalOptionsCandidates?.filter(
        (candidate) =>
          candidate?.actionStatus === "candidate" ||
          candidate?.status === "candidate",
      ).length ??
      0,
  );

  return (
    <div
      data-testid="algo-operations-kpi-strip"
      data-algo-pocket-grid={algoIsPocketWidth ? "two" : undefined}
      style={{
        display: "grid",
        gridTemplateColumns: algoIsPocketWidth
          ? "repeat(2, minmax(0, 1fr))"
          : dense
            ? "repeat(auto-fit, minmax(132px, max-content))"
            : "repeat(auto-fit, minmax(156px, max-content))",
        justifyContent: algoIsPocketWidth ? undefined : "start",
        gap: 1,
        background: CSS_COLOR.border,
        border: `1px solid ${CSS_COLOR.border}`,
        borderRadius: dim(RADII.sm),
        padding: sp(1),
        minWidth: 0,
      }}
    >
      <Cell
        compact
        label="Realized today"
        value={formatMoney(realized, 2)}
        hint={realized > 0 ? "session pnl" : realized < 0 ? "session loss" : null}
        tone={realized > 0 ? CSS_COLOR.green : realized < 0 ? CSS_COLOR.red : CSS_COLOR.text}
        history={series.realized}
        sparkPositive={realized >= 0}
        hideHint={dense}
      />
      <Cell
        compact
        label="Unrealized"
        value={formatMoney(unrealized, 2)}
        hint={`${openPositions} open`}
        tone={unrealized > 0 ? CSS_COLOR.green : unrealized < 0 ? CSS_COLOR.red : CSS_COLOR.text}
        history={series.unrealized}
        sparkPositive={unrealized >= 0}
        hideHint={dense}
      />
      <Cell
        compact
        label="Win / Loss"
        value={`${wins}W · ${losses}L`}
        hint={
          Number.isFinite(winRate)
            ? `${formatPct(winRate, 0)} win`
            : "—"
        }
        history={series.winRate}
        hideHint={dense}
      />
      <Cell
        compact
        label="Profit factor"
        value={
          Number.isFinite(Number(profitFactor))
            ? Number(profitFactor).toFixed(2)
            : "—"
        }
        hint={
          Number.isFinite(Number(profitFactor)) && Number(profitFactor) >= 1
            ? "session"
            : Number.isFinite(Number(profitFactor))
              ? "below 1.0"
              : null
        }
        tone={
          Number.isFinite(Number(profitFactor)) && Number(profitFactor) >= 1
            ? CSS_COLOR.green
            : Number.isFinite(Number(profitFactor))
              ? CSS_COLOR.amber
              : CSS_COLOR.text
        }
        history={series.profitFactor}
        sparkPositive={
          Number.isFinite(Number(profitFactor)) && Number(profitFactor) >= 1
        }
        hideHint={dense}
      />
      <Cell
        compact
        label="Signals"
        value={`${freshSignals} / ${totalSignals}`}
        hint={
          totalSignals > 0
            ? `${formatPct((freshSignals / totalSignals) * 100, 0)} fresh`
            : "no scan yet"
        }
        history={series.freshSignals}
        hideHint={dense}
      />
      <Cell
        compact
        label="Pipeline"
        value={`${openPositions} open${pending > 0 ? ` · ${pending} pending` : ""}`}
        hint={
          Number(cockpitTradePath?.blockedCandidates) > 0
            ? `${cockpitTradePath.blockedCandidates} blocked`
            : null
        }
        tone={Number(cockpitTradePath?.blockedCandidates) > 0 ? CSS_COLOR.amber : CSS_COLOR.text}
        history={series.openPositions}
        hideHint={dense}
      />
    </div>
  );
};

export default OperationsKpiStrip;
