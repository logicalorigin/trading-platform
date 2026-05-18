import {
  FONT_WEIGHTS,
  RADII,
  T,
  dim,
  fs,
  sp,
  textSize,
} from "../../lib/uiTokens.jsx";
import { formatMoney, formatPct } from "./algoHelpers";

const Cell = ({ label, value, hint, tone }) => (
  <div
    style={{
      display: "flex",
      flexDirection: "column",
      justifyContent: "center",
      gap: sp(1),
      padding: sp("6px 10px"),
      minWidth: 0,
      minHeight: dim(56),
    }}
  >
    <span
      style={{
        color: T.textMuted,
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
    <span
      style={{
        color: tone || T.text,
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
    {hint ? (
      <span
        style={{
          color: T.textDim,
          fontFamily: T.sans,
          fontSize: textSize("caption"),
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {hint}
      </span>
    ) : null}
  </div>
);

export const OperationsKpiStrip = ({
  cockpitKpis,
  cockpitSignalFreshness,
  cockpitTradePath,
  signalOptionsPerformanceSummary,
  signalOptionsPositions,
  signalOptionsCandidates,
  algoIsPhone,
}) => {
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
      style={{
        display: "grid",
        gridTemplateColumns: algoIsPhone
          ? "repeat(2, minmax(0, 1fr))"
          : "repeat(6, minmax(0, 1fr))",
        gap: sp(1),
        background: T.bg1,
        border: `1px solid ${T.border}`,
        borderRadius: dim(RADII.md),
        padding: sp(1),
        minWidth: 0,
      }}
    >
      <Cell
        label="Realized today"
        value={formatMoney(realized, 2)}
        hint={realized > 0 ? "session pnl" : realized < 0 ? "session loss" : null}
        tone={realized > 0 ? T.green : realized < 0 ? T.red : T.text}
      />
      <Cell
        label="Unrealized"
        value={formatMoney(unrealized, 2)}
        hint={`${openPositions} open`}
        tone={unrealized > 0 ? T.green : unrealized < 0 ? T.red : T.text}
      />
      <Cell
        label="Win / Loss"
        value={`${wins}W · ${losses}L`}
        hint={
          Number.isFinite(winRate)
            ? `${formatPct(winRate, 0)} win`
            : "—"
        }
      />
      <Cell
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
            ? T.green
            : Number.isFinite(Number(profitFactor))
              ? T.amber
              : T.text
        }
      />
      <Cell
        label="Signals"
        value={`${freshSignals} / ${totalSignals}`}
        hint={
          totalSignals > 0
            ? `${formatPct((freshSignals / totalSignals) * 100, 0)} fresh`
            : "no scan yet"
        }
      />
      <Cell
        label="Pipeline"
        value={`${openPositions} open${pending > 0 ? ` · ${pending} pending` : ""}`}
        hint={
          Number(cockpitTradePath?.blockedCandidates) > 0
            ? `${cockpitTradePath.blockedCandidates} blocked`
            : null
        }
        tone={Number(cockpitTradePath?.blockedCandidates) > 0 ? T.amber : T.text}
      />
    </div>
  );
};

export default OperationsKpiStrip;
