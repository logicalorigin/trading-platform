import { useMemo, useState } from "react";
import {
  FONT_WEIGHTS,
  RADII,
  T,
  dim,
  fs,
  sp,
  textSize,
} from "../../lib/uiTokens.jsx";
import { InlineFilterBar } from "../../components/platform/primitives.jsx";
import { formatEnumLabel } from "../../lib/formatters";
import { formatAppTimeForPreferences } from "../../lib/timeZone";
import { motionRowStyle } from "../../lib/motion";
import { setAlgoFocus } from "../../features/platform/algoFocusStore";

const STAGE_CHIPS = [
  { id: "signal", label: "Signal", matches: (type) => /signal/.test(type) && !/options/.test(type) },
  { id: "candidate", label: "Candidate", matches: (type) => /candidate/.test(type) },
  { id: "eligible", label: "Eligible", matches: (type) => /eligible/.test(type) },
  { id: "submitted", label: "Submitted", matches: (type) => /submit|order|entry/.test(type) && !/skipped|blocked/.test(type) },
  { id: "filled", label: "Filled", matches: (type) => /fill|filled/.test(type) },
  { id: "closed", label: "Closed", matches: (type) => /closed|exit/.test(type) },
  { id: "blocked", label: "Blocked", matches: (type) => /blocked|skipped|gateway/.test(type) },
  { id: "config", label: "Config", matches: (type) => /strategy_settings|enabled|paused|deployment/.test(type) },
];

const matchesStage = (eventType, stageIds) => {
  if (!stageIds.length) return true;
  const type = String(eventType || "");
  return stageIds.some((id) => {
    const chip = STAGE_CHIPS.find((entry) => entry.id === id);
    return chip ? chip.matches(type) : false;
  });
};

export const AlgoAuditPanel = ({
  events = [],
  focusedDeployment,
  userPreferences,
  onJumpToOperations,
}) => {
  const [symbolFilter, setSymbolFilter] = useState("");
  const [stageFilters, setStageFilters] = useState([]);
  const filteredEvents = useMemo(() => {
    const symbolQuery = symbolFilter.trim().toUpperCase();
    return events.filter((event) => {
      if (symbolQuery) {
        const symbol = String(event?.symbol || "").toUpperCase();
        if (!symbol.includes(symbolQuery)) return false;
      }
      if (!matchesStage(event?.eventType, stageFilters)) return false;
      return true;
    });
  }, [events, stageFilters, symbolFilter]);

  const stageCounts = useMemo(() => {
    const counts = {};
    for (const chip of STAGE_CHIPS) {
      counts[chip.id] = events.filter((event) => chip.matches(String(event?.eventType || ""))).length;
    }
    return counts;
  }, [events]);

  const handleSymbolClick = (symbol) => {
    if (!symbol) return;
    setAlgoFocus(symbol, "history");
    onJumpToOperations?.();
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: sp(5),
        background: T.bg1,
        border: `1px solid ${T.border}`,
        borderRadius: dim(RADII.md),
        padding: sp("8px 10px"),
        flex: "0 1 auto",
        minWidth: 0,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: sp(8),
        }}
      >
        <div>
          <div
            style={{
              fontSize: fs(12),
              fontWeight: FONT_WEIGHTS.medium,
              fontFamily: T.sans,
              color: T.text,
            }}
          >
            Audit
          </div>
          <div
            style={{ fontSize: textSize("caption"), color: T.textDim, fontFamily: T.sans }}
          >
            {focusedDeployment
              ? `filtered to ${focusedDeployment.name}`
              : "latest automation events"}
          </div>
        </div>
        <span
          style={{ fontSize: textSize("body"), color: T.textDim, fontFamily: T.sans }}
        >
          {filteredEvents.length} / {events.length} rows
        </span>
      </div>

      <InlineFilterBar
        dataTestId="algo-audit-filter-bar"
        textValue={symbolFilter}
        onTextChange={setSymbolFilter}
        textPlaceholder="Filter by symbol…"
        chips={STAGE_CHIPS.map((chip) => ({
          id: chip.id,
          label: chip.label,
          count: stageCounts[chip.id],
        }))}
        selectedChipIds={stageFilters}
        onChipsChange={setStageFilters}
        mode="multi"
      />

      {!filteredEvents.length ? (
        <div
          style={{
            padding: sp("18px 10px"),
            border: `1px dashed ${T.border}`,
            borderRadius: dim(RADII.sm),
            fontSize: fs(10),
            color: T.textDim,
            fontFamily: T.sans,
            lineHeight: 1.5,
          }}
        >
          {events.length === 0
            ? "No execution events have been recorded yet."
            : "No events match the current filter."}
        </div>
      ) : (
        filteredEvents.map((event, index) => (
          <div
            key={event.id}
            className="ra-row-enter"
            style={{
              ...motionRowStyle(index, 10, 140),
              display: "grid",
              gridTemplateColumns: `${dim(64)}px ${dim(150)}px 1fr ${dim(96)}px`,
              gap: sp(8),
              alignItems: "start",
              padding: sp("6px 0"),
              borderBottom: `1px solid ${T.border}08`,
              fontSize: textSize("caption"),
            }}
          >
            <span style={{ color: T.textDim, fontFamily: T.mono }}>
              {formatAppTimeForPreferences(event.occurredAt, userPreferences)}
            </span>
            <span
              style={{ color: T.accent, fontFamily: T.sans, fontWeight: FONT_WEIGHTS.regular }}
            >
              {formatEnumLabel(event.eventType)}
            </span>
            <span
              style={{
                color: T.textSec,
                fontFamily: T.sans,
                lineHeight: 1.4,
              }}
            >
              {event.summary}
            </span>
            {event.symbol ? (
              <button
                type="button"
                onClick={() => handleSymbolClick(event.symbol)}
                style={{
                  background: "transparent",
                  border: "none",
                  padding: 0,
                  color: T.text,
                  fontFamily: T.sans,
                  textAlign: "right",
                  textDecoration: "underline dotted",
                  textDecorationColor: T.textDim,
                  cursor: "pointer",
                }}
              >
                {event.symbol}
              </button>
            ) : (
              <span
                style={{
                  color: T.textDim,
                  fontFamily: T.sans,
                  textAlign: "right",
                }}
              >
                {event.providerAccountId || "system"}
              </span>
            )}
          </div>
        ))
      )}
    </div>
  );
};

export default AlgoAuditPanel;
