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
  candidateBlockerLabel,
  candidateLatestActivityLabel,
  entryQualityLabel,
  formatContractDetail,
  formatContractLabel,
  formatContractProviderLabel,
  formatContractSelectionSummary,
  formatMoney,
  formatPct,
  formatPlainPrice,
  formatQuoteGreeksSummary,
  formatQuoteSummary,
  shadowLinkSummary,
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

const firstDisplayValue = (...values) => {
  for (const value of values) {
    if (value !== null && value !== undefined && value !== "") return value;
  }
  return null;
};

const firstRecordValue = (key, ...records) =>
  firstDisplayValue(...records.map((record) => asRecord(record)[key]));

const formatOptionalMoney = (value, digits = 2) =>
  value === null || value === undefined || value === ""
    ? MISSING_VALUE
    : formatMoney(value, digits);

const formatQuoteAge = (ageMs) => {
  const numeric = Number(ageMs);
  if (!Number.isFinite(numeric)) return MISSING_VALUE;
  if (numeric < 1_000) return `${numeric.toFixed(0)}ms`;
  if (numeric < 60_000) return `${(numeric / 1_000).toFixed(1)}s`;
  if (numeric < 3_600_000) return `${(numeric / 60_000).toFixed(1)}m`;
  return `${(numeric / 3_600_000).toFixed(1)}h`;
};

const latestContractSelection = (candidate, events = []) => {
  const candidateSelection = asRecord(candidate?.contractSelection);
  if (Object.keys(candidateSelection).length) return candidateSelection;
  for (const event of events) {
    const payload = asRecord(event?.payload);
    const selection = asRecord(payload.contractSelection);
    if (Object.keys(selection).length) return selection;
  }
  return {};
};

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

const ActionPane = ({ candidate, events = [], signalOptionsProfile }) => {
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
  const quote = asRecord(candidate.quote);
  const orderPlan = asRecord(candidate.orderPlan);
  const selectedContract = asRecord(candidate.selectedContract);
  const contract = formatContractDetail(selectedContract);
  const provider = formatContractProviderLabel(selectedContract);
  const quoteSummary = formatQuoteSummary(quote, liquidity);
  const greeks = formatQuoteGreeksSummary(quote);
  const selection = latestContractSelection(candidate, events);
  const selectionSummary = formatContractSelectionSummary(selection);
  const multiplier = firstDisplayValue(
    selectedContract.multiplier,
    selectedContract.sharesPerContract,
  );
  const maxSpreadPct = signalOptionsProfile?.liquidityGate?.maxSpreadPctOfMid;
  const blocker = candidateBlockerLabel(candidate);
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
        gap: sp(3),
        padding: sp("8px 12px"),
      }}
    >
      <Row label="Contract" value={contract.main} />
      <Row label="Detail" value={contract.detail} />
      <Row
        label="Identity"
        value={[
          firstDisplayValue(selectedContract.underlying, candidate.symbol),
          firstDisplayValue(selectedContract.ticker, selectedContract.optionTicker),
          provider !== MISSING_VALUE ? provider : null,
        ].filter(Boolean).join(" · ") || MISSING_VALUE}
      />
      <Row
        label="Right / Exp"
        value={`${String(selectedContract.right || candidate.optionRight || MISSING_VALUE).toUpperCase()} · ${selectedContract.expirationDate || MISSING_VALUE}`}
      />
      <Row
        label="Strike / Mult"
        value={`${selectedContract.strike ?? MISSING_VALUE} · ${multiplier ?? MISSING_VALUE}`}
      />
      <Row label="Limit" value={formatMoney(orderPlan.entryLimitPrice, 2)} />
      <Row label="Quantity" value={orderPlan.quantity ?? MISSING_VALUE} />
      <Row label="Premium" value={formatMoney(orderPlan.premiumAtRisk)} />
      <Row label="Bid / Ask" value={quoteSummary.main} />
      <Row
        label="Mark / Mid"
        value={`${formatOptionalMoney(firstRecordValue("mark", quote, liquidity), 2)} / ${formatOptionalMoney(firstRecordValue("mid", quote, liquidity), 2)}`}
      />
      <Row
        label="Last"
        value={formatOptionalMoney(firstRecordValue("last", quote, liquidity), 2)}
      />
      <Row label="Spread" value={`${formatPct(liquidity.spreadPctOfMid)} · max ${formatPct(maxSpreadPct ?? 0, 0)}`} />
      <Row
        label="Freshness"
        value={quoteSummary.detail}
      />
      <Row
        label="Age / Mode"
        value={`${formatQuoteAge(quote.ageMs)} · ${quote.marketDataMode ? formatEnumLabel(quote.marketDataMode) : MISSING_VALUE}`}
      />
      <Row
        label="Updated"
        value={[
          quote.quoteUpdatedAt ? `quote ${formatRelativeTimeShort(quote.quoteUpdatedAt)}` : null,
          quote.dataUpdatedAt ? `data ${formatRelativeTimeShort(quote.dataUpdatedAt)}` : null,
        ].filter(Boolean).join(" · ") || MISSING_VALUE}
      />
      <Row
        label="Greeks"
        value={[greeks.main, greeks.full].filter((item) => item !== MISSING_VALUE).join(" · ") || MISSING_VALUE}
      />
      <Row label="OI / Volume" value={greeks.detail} />
      <Row
        label="Selection"
        value={[selectionSummary.main, selectionSummary.detail].filter((item) => item !== MISSING_VALUE).join(" · ") || MISSING_VALUE}
      />
      <Row
        label="Blocker"
        value={blocker}
        tone={blocker !== MISSING_VALUE ? T.amber : T.textSec}
      />
      <Row label="Latest" value={candidateLatestActivityLabel(candidate)} />
      <Row label="Shadow" value={shadowLinkSummary(candidate.shadowLink)} />
    </div>
  );
};

const computeHardStopTriggerPrice = (position, signalOptionsProfile) => {
  const entry = Number(position?.entryPrice ?? NaN);
  const hardStopPct = Number(signalOptionsProfile?.exitPolicy?.hardStopPct ?? NaN);
  if (!Number.isFinite(entry) || !Number.isFinite(hardStopPct)) return null;
  return entry * (1 + hardStopPct / 100);
};

const PositionPane = ({ position, candidate, signalOptionsProfile }) => {
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
  const selectedContract = asRecord(position.selectedContract);
  const contract = formatContractDetail(selectedContract);
  const provider = formatContractProviderLabel(selectedContract);
  const positionQuote = asRecord(position.quote);
  const candidateQuote = asRecord(candidate?.quote);
  const quoteSource = Object.keys(positionQuote).length
    ? positionQuote
    : candidateQuote;
  const quoteSummary = formatQuoteSummary(quoteSource, candidate?.liquidity);
  const greeks = formatQuoteGreeksSummary(quoteSource);
  const multiplier = Number(selectedContract.multiplier ?? 100);
  const unrealized =
    Number.isFinite(entry) && Number.isFinite(mark)
      ? (mark - entry) * qty * multiplier
      : null;
  const triggerPrice = computeHardStopTriggerPrice(position, signalOptionsProfile);
  const currentStop = Number(position.stopPrice ?? NaN);
  const peak = Number(position.peakPrice ?? NaN);
  const quality = entryQualityLabel(position.signalQuality);
  return (
    <div style={{ display: "grid", gap: sp(1), padding: sp("8px 12px") }}>
      <Row label="Contract" value={contract.main} />
      <Row label="Detail" value={contract.detail} />
      <Row label="Provider" value={provider} />
      <Row label="Qty" value={qty} />
      <Row label="Entry → Mark" value={`${formatPlainPrice(entry, 2)} → ${formatPlainPrice(mark, 2)}`} />
      <Row label="Live quote" value={quoteSummary.main} />
      <Row
        label="Greeks"
        value={[greeks.main, greeks.detail].filter((item) => item !== MISSING_VALUE).join(" · ") || MISSING_VALUE}
      />
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
      <Row label="Premium" value={formatMoney(position.premiumAtRisk)} />
      <Row label="Peak" value={formatPlainPrice(peak, 2)} />
      <Row label="Opened" value={formatRelativeTimeShort(position.openedAt)} />
      <Row label="Marked" value={formatRelativeTimeShort(position.lastMarkedAt)} />
      <Row label="Quality" value={quality} />
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

const HistoryPane = ({ candidate, events, userPreferences }) => {
  const timeline = Array.isArray(candidate?.timeline) ? candidate.timeline : [];
  if (!events?.length && !timeline.length) {
    return (
      <div
        style={{
          padding: sp("12px 14px"),
          color: T.textDim,
          fontFamily: T.sans,
          fontSize: textSize("body"),
        }}
      >
        No candidate timeline or execution events for this symbol yet.
      </div>
    );
  }
  const timelineRows = timeline
    .slice()
    .reverse()
    .slice(0, 8)
    .map((item) => ({
      id: asRecord(item).id || `${asRecord(item).type}-${asRecord(item).occurredAt}`,
      occurredAt: asRecord(item).occurredAt,
      label: formatEnumLabel(asRecord(item).type || "candidate"),
      summary: asRecord(item).summary || asRecord(item).reason || "Candidate update",
    }));
  const eventRows = (events || []).slice(0, 8).map((event) => ({
    id: event.id,
    occurredAt: event.occurredAt,
    label: formatEnumLabel(event.eventType),
    summary: event.summary,
  }));
  const rows = [...timelineRows, ...eventRows].slice(0, 12);
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
      {rows.map((row) => (
        <div
          key={row.id}
          style={{
            display: "grid",
            gridTemplateColumns: `${dim(64)}px ${dim(140)}px minmax(0, 1fr)`,
            gap: sp(5),
            alignItems: "baseline",
            padding: sp("2px 0"),
          }}
        >
          <span style={{ color: T.textDim, fontFamily: T.sans }}>
            {formatAppTimeForPreferences(row.occurredAt, userPreferences)}
          </span>
          <span style={{ color: T.accent }}>
            {row.label}
          </span>
          <span style={{ color: T.textSec, lineHeight: 1.35 }}>
            {row.summary}
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
        <ActionPane
          candidate={candidate}
          events={filteredEvents}
          signalOptionsProfile={signalOptionsProfile}
        />
      )}
      {drillTab === "position" && (
        <PositionPane
          position={position}
          candidate={candidate}
          signalOptionsProfile={signalOptionsProfile}
        />
      )}
      {drillTab === "history" && (
        <HistoryPane
          candidate={candidate}
          events={filteredEvents}
          userPreferences={userPreferences}
        />
      )}
    </div>
  );
};

export default OperationsSignalDrill;
