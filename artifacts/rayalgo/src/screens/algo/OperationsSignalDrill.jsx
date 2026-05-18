import { useMemo } from "react";
import {
  FONT_WEIGHTS,
  MISSING_VALUE,
  RADII,
  T,
  dim,
  fs,
  sp,
  textSize,
} from "../../lib/uiTokens.jsx";
import {
  ALGO_DRILL_TABS,
  setAlgoDrillTab,
  useAlgoFocus,
} from "../../features/platform/algoFocusStore";
import { formatEnumLabel, formatRelativeTimeShort } from "../../lib/formatters";
import { formatAppTimeForPreferences } from "../../lib/timeZone";
import {
  asRecord,
  formatContractLabel,
  formatMoney,
  formatPct,
  formatPlainPrice,
  signalActionLabel,
  signalFreshnessLabel,
} from "./algoHelpers";

const TAB_LABELS = {
  overview: "Overview",
  action: "Action",
  position: "Position",
  history: "History",
};

const Row = ({ label, value, tone }) => (
  <div
    style={{
      display: "grid",
      gridTemplateColumns: `${dim(110)}px minmax(0, 1fr)`,
      gap: sp(6),
      alignItems: "baseline",
      padding: sp("2px 0"),
      minWidth: 0,
    }}
  >
    <span
      style={{
        color: T.textMuted,
        fontFamily: T.sans,
        fontSize: textSize("caption"),
        letterSpacing: "0.04em",
        textTransform: "uppercase",
      }}
    >
      {label}
    </span>
    <span
      style={{
        color: tone || T.text,
        fontFamily: T.sans,
        fontSize: textSize("body"),
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}
    >
      {value}
    </span>
  </div>
);

const OverviewPane = ({ signal, candidate, position }) => {
  const direction = signal?.direction || candidate?.direction;
  const freshness = signalFreshnessLabel(signal);
  const action = signalActionLabel(signal, candidate?.action);
  const mark = position ? formatPlainPrice(position.lastMarkPrice, 2) : MISSING_VALUE;
  const entry = position ? formatPlainPrice(position.entryPrice, 2) : MISSING_VALUE;
  const qty = position ? Number(position.quantity ?? 0) : 0;
  return (
    <div style={{ display: "grid", gap: sp(1), padding: sp("8px 12px") }}>
      <Row
        label="Signal"
        value={`${direction ? direction.toUpperCase() : MISSING_VALUE} · score ${signal?.score ?? "—"} · ${freshness}`}
        tone={freshness === "FRESH" ? T.green : freshness === "STALE" ? T.amber : T.text}
      />
      <Row
        label="Mapped"
        value={
          candidate
            ? `${action} · ${formatContractLabel(candidate.selectedContract)}`
            : "Awaiting candidate"
        }
      />
      <Row
        label="Status"
        value={
          candidate?.actionStatus || candidate?.status || "candidate"
            ? formatEnumLabel(candidate?.actionStatus || candidate?.status || "candidate")
            : MISSING_VALUE
        }
      />
      {position ? (
        <Row
          label="Position"
          value={`${qty}× @ ${entry} → ${mark}`}
          tone={
            Number(position.lastMarkPrice ?? 0) >= Number(position.entryPrice ?? 0)
              ? T.green
              : T.red
          }
        />
      ) : (
        <Row label="Position" value="None open" />
      )}
      {candidate?.reason ? (
        <Row
          label="Blocker"
          value={formatEnumLabel(candidate.reason)}
          tone={T.amber}
        />
      ) : null}
    </div>
  );
};

const ActionPane = ({ candidate, signalOptionsProfile }) => {
  if (!candidate) {
    return (
      <div
        style={{
          padding: sp("12px 14px"),
          color: T.textDim,
          fontFamily: T.sans,
          fontSize: textSize("body"),
        }}
      >
        No candidate resolved for this signal yet.
      </div>
    );
  }
  const liquidity = asRecord(candidate.liquidity);
  const orderPlan = asRecord(candidate.orderPlan);
  const maxSpreadPct = signalOptionsProfile?.liquidityGate?.maxSpreadPctOfMid;
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
        gap: sp(3),
        padding: sp("8px 12px"),
      }}
    >
      <Row label="Contract" value={formatContractLabel(candidate.selectedContract)} />
      <Row label="Limit" value={formatMoney(orderPlan.entryLimitPrice, 2)} />
      <Row label="Bid / Ask" value={`${formatMoney(liquidity.bid, 2)} / ${formatMoney(liquidity.ask, 2)}`} />
      <Row label="Mark / Mid" value={`${formatMoney(liquidity.mark, 2)} / ${formatMoney(liquidity.mid, 2)}`} />
      <Row label="Spread" value={`${formatPct(liquidity.spreadPctOfMid)} · max ${formatPct(maxSpreadPct ?? 0, 0)}`} />
      <Row label="Premium" value={formatMoney(orderPlan.premiumAtRisk)} />
    </div>
  );
};

const computeHardStopTriggerPrice = (position, signalOptionsProfile) => {
  const entry = Number(position?.entryPrice ?? NaN);
  const hardStopPct = Number(signalOptionsProfile?.exitPolicy?.hardStopPct ?? NaN);
  if (!Number.isFinite(entry) || !Number.isFinite(hardStopPct)) return null;
  return entry * (1 + hardStopPct / 100);
};

const PositionPane = ({ position, signalOptionsProfile }) => {
  if (!position) {
    return (
      <div
        style={{
          padding: sp("12px 14px"),
          color: T.textDim,
          fontFamily: T.sans,
          fontSize: textSize("body"),
        }}
      >
        No open position for this symbol.
      </div>
    );
  }
  const entry = Number(position.entryPrice ?? NaN);
  const mark = Number(position.lastMarkPrice ?? NaN);
  const qty = Number(position.quantity ?? 0);
  const multiplier = Number(asRecord(position.selectedContract).multiplier ?? 100);
  const unrealized =
    Number.isFinite(entry) && Number.isFinite(mark)
      ? (mark - entry) * qty * multiplier
      : null;
  const triggerPrice = computeHardStopTriggerPrice(position, signalOptionsProfile);
  const currentStop = Number(position.stopPrice ?? NaN);
  return (
    <div style={{ display: "grid", gap: sp(1), padding: sp("8px 12px") }}>
      <Row label="Contract" value={formatContractLabel(position.selectedContract)} />
      <Row label="Qty" value={qty} />
      <Row label="Entry → Mark" value={`${formatPlainPrice(entry, 2)} → ${formatPlainPrice(mark, 2)}`} />
      <Row
        label="P&L"
        value={formatMoney(unrealized, 2)}
        tone={
          Number(unrealized) > 0
            ? T.green
            : Number(unrealized) < 0
              ? T.red
              : T.text
        }
      />
      <Row label="Opened" value={formatRelativeTimeShort(position.openedAt)} />
      {triggerPrice != null ? (
        <Row
          label="Hard stop"
          value={`triggers @ ${formatPlainPrice(triggerPrice, 2)}`}
          tone={T.amber}
        />
      ) : null}
      {Number.isFinite(currentStop) ? (
        <Row
          label="Active stop"
          value={formatPlainPrice(currentStop, 2)}
          tone={T.amber}
        />
      ) : null}
    </div>
  );
};

const HistoryPane = ({ events, userPreferences }) => {
  if (!events?.length) {
    return (
      <div
        style={{
          padding: sp("12px 14px"),
          color: T.textDim,
          fontFamily: T.sans,
          fontSize: textSize("body"),
        }}
      >
        No execution events for this symbol yet.
      </div>
    );
  }
  return (
    <div
      style={{
        display: "grid",
        gap: sp(1),
        padding: sp("6px 12px"),
        fontFamily: T.sans,
        fontSize: textSize("caption"),
      }}
    >
      {events.slice(0, 10).map((event) => (
        <div
          key={event.id}
          style={{
            display: "grid",
            gridTemplateColumns: `${dim(64)}px ${dim(140)}px minmax(0, 1fr)`,
            gap: sp(5),
            alignItems: "baseline",
            padding: sp("2px 0"),
          }}
        >
          <span style={{ color: T.textDim, fontFamily: T.mono }}>
            {formatAppTimeForPreferences(event.occurredAt, userPreferences)}
          </span>
          <span style={{ color: T.accent }}>
            {formatEnumLabel(event.eventType)}
          </span>
          <span style={{ color: T.textSec, lineHeight: 1.35 }}>
            {event.summary}
          </span>
        </div>
      ))}
    </div>
  );
};

export const OperationsSignalDrill = ({
  signal,
  candidate,
  position,
  events = [],
  userPreferences,
  signalOptionsProfile,
}) => {
  const focus = useAlgoFocus();
  const drillTab = focus.drillTab || "overview";
  const filteredEvents = useMemo(
    () =>
      events.filter(
        (event) =>
          String(event?.symbol || "").toUpperCase() ===
          String(signal?.symbol || "").toUpperCase(),
      ),
    [events, signal?.symbol],
  );
  return (
    <div data-testid="algo-signal-drill" style={{ minWidth: 0 }}>
      <div
        style={{
          display: "flex",
          gap: sp(1),
          padding: sp("4px 8px"),
          borderBottom: `1px solid ${T.border}`,
        }}
      >
        {ALGO_DRILL_TABS.map((tab) => {
          const selected = drillTab === tab;
          return (
            <button
              key={tab}
              type="button"
              onClick={() => setAlgoDrillTab(tab)}
              style={{
                padding: sp("3px 10px"),
                borderRadius: dim(RADII.pill),
                border: "none",
                background: selected ? T.bg2 : "transparent",
                color: selected ? T.text : T.textMuted,
                fontFamily: T.sans,
                fontSize: textSize("caption"),
                fontWeight: selected ? FONT_WEIGHTS.medium : FONT_WEIGHTS.regular,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
                cursor: "pointer",
              }}
            >
              {TAB_LABELS[tab]}
            </button>
          );
        })}
      </div>
      {drillTab === "overview" && (
        <OverviewPane signal={signal} candidate={candidate} position={position} />
      )}
      {drillTab === "action" && (
        <ActionPane candidate={candidate} signalOptionsProfile={signalOptionsProfile} />
      )}
      {drillTab === "position" && (
        <PositionPane position={position} signalOptionsProfile={signalOptionsProfile} />
      )}
      {drillTab === "history" && (
        <HistoryPane events={filteredEvents} userPreferences={userPreferences} />
      )}
    </div>
  );
};

export default OperationsSignalDrill;
