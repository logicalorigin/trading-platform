import { useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Link2,
  RefreshCw,
  X,
} from "lucide-react";
import { AppTooltip } from "@/components/ui/tooltip";
import { DataUnavailableState } from "../../components/platform/primitives.jsx";
import {
  formatCalendarMeta,
  fmtCompactNumber,
} from "../../lib/formatters";
import {
  MISSING_VALUE,
  T,
  dim,
  fs,
  sp,
} from "../../lib/uiTokens";
import {
  activeWatchlistSymbols,
  allWatchlistSymbols,
} from "../platform/watchlistModel";
import { TradeEquityPanel } from "../trade/TradeEquityPanel.jsx";
import {
  MARKET_CALENDAR_EVENT_TYPES,
  MARKET_CALENDAR_TIMING_FILTERS,
  attachMarketCalendarRelations,
  buildMarketCalendarEventsFromEarnings,
  buildMarketCalendarMonthGrid,
  filterMarketCalendarEvents,
  formatMarketCalendarEventTypeLabel,
  paginateMarketCalendarUniverse,
  resolveMarketCalendarProviderStatus,
  shiftMarketCalendarMonth,
} from "./marketCalendarModel.js";

const SCOPE_OPTIONS = Object.freeze([
  ["universe", "Universe"],
  ["active_watchlist", "Active WL"],
  ["all_watchlists", "All WL"],
  ["held_positions", "Held"],
]);

const EVENT_TYPE_FILTER_OPTIONS = Object.freeze([
  ["all", "All events"],
  ...MARKET_CALENDAR_EVENT_TYPES.map((eventType) => [
    eventType,
    formatMarketCalendarEventTypeLabel(eventType),
  ]),
]);

const TIMING_FILTER_OPTIONS = Object.freeze(
  MARKET_CALENDAR_TIMING_FILTERS.map((timing) => [
    timing,
    timing === "all" ? "All timing" : timing.toUpperCase(),
  ]),
);

const statusTone = (status) => {
  if (status === "live") return T.accent;
  if (status === "degraded") return T.red;
  if (status === "loading") return T.amber;
  return T.textDim;
};

const iconButtonStyle = {
  width: dim(28),
  height: dim(28),
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  border: `1px solid ${T.border}`,
  background: T.bg2,
  color: T.textSec,
  cursor: "pointer",
  padding: 0,
};

const chipStyle = (active, color = T.accent) => ({
  border: `1px solid ${active ? `${color}80` : T.border}`,
  background: active ? `${color}16` : T.bg2,
  color: active ? color : T.textDim,
  cursor: "pointer",
  font: `800 ${fs(8)}px ${T.mono}`,
  padding: sp("4px 7px"),
  textTransform: "uppercase",
  whiteSpace: "nowrap",
});

const selectStyle = {
  border: `1px solid ${T.border}`,
  background: T.bg2,
  color: T.textSec,
  font: `800 ${fs(8)}px ${T.mono}`,
  height: dim(28),
  padding: sp("0 8px"),
  textTransform: "uppercase",
};

const formatCurrencyCompact = (value) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return MISSING_VALUE;
  return `$${fmtCompactNumber(value)}`;
};

const formatEstimateActual = (estimate, actual, formatter) => {
  const estimateLabel = formatter(estimate);
  const actualLabel = formatter(actual);
  if (actualLabel !== MISSING_VALUE && estimateLabel !== MISSING_VALUE) {
    return `${actualLabel} / ${estimateLabel}`;
  }
  return actualLabel !== MISSING_VALUE ? actualLabel : estimateLabel;
};

const formatEps = (value) =>
  typeof value === "number" && Number.isFinite(value)
    ? `$${value.toFixed(2)}`
    : MISSING_VALUE;

const formatFiscalDate = (value) => (value ? formatCalendarMeta(value) : MISSING_VALUE);

const formatDateHeading = (value) => {
  if (!value) return MISSING_VALUE;
  const parsed = new Date(`${value}T12:00:00Z`);
  if (!Number.isFinite(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(parsed);
};

const formatMonthDay = (value) => {
  if (!value) return MISSING_VALUE;
  const parsed = new Date(`${value}T12:00:00Z`);
  if (!Number.isFinite(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(parsed);
};

const MarketCalendarSkeleton = () => (
  <div
    data-testid="market-calendar-month-skeleton"
    aria-hidden="true"
    style={{
      display: "grid",
      gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
      gap: sp(4),
    }}
  >
    {Array.from({ length: 42 }).map((_, index) => (
      <div
        key={index}
        className="ra-skeleton"
        style={{
          minHeight: dim(82),
          border: `1px solid ${T.border}`,
          background: T.bg2,
        }}
      />
    ))}
  </div>
);

const EventDetailMetric = ({ label, value }) => (
  <div
    style={{
      minWidth: 0,
      padding: sp("6px 7px"),
      border: `1px solid ${T.border}`,
      background: T.bg2,
    }}
  >
    <div
      style={{
        color: T.textDim,
        font: `800 ${fs(7)}px ${T.mono}`,
        textTransform: "uppercase",
      }}
    >
      {label}
    </div>
    <div
      style={{
        marginTop: sp(3),
        color: T.textSec,
        font: `900 ${fs(11)}px ${T.mono}`,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}
    >
      {value}
    </div>
  </div>
);

export const MarketCalendarOverlay = ({
  open,
  monthDate,
  onChangeMonth,
  onClose,
  earningsEntries = [],
  earningsPending = false,
  earningsError = false,
  researchConfigured = false,
  watchlists = [],
  fallbackSymbols = [],
  heldSymbols = [],
  onSelectSymbol,
  onOpenTrade,
  onLinkedContextChange,
  stockAggregateStreamingEnabled = false,
}) => {
  const [scope, setScope] = useState("universe");
  const [eventTypeFilter, setEventTypeFilter] = useState("earnings");
  const [timingFilter, setTimingFilter] = useState("all");
  const [selectedEventId, setSelectedEventId] = useState(null);
  const [universePage, setUniversePage] = useState(0);

  const activeSymbols = useMemo(
    () => activeWatchlistSymbols(null, fallbackSymbols),
    [fallbackSymbols],
  );
  const watchlistSymbols = useMemo(
    () => allWatchlistSymbols(watchlists, fallbackSymbols),
    [watchlists, fallbackSymbols],
  );
  const providerStatus = resolveMarketCalendarProviderStatus({
    researchConfigured,
    isPending: earningsPending,
    isError: earningsError,
    eventCount: earningsEntries.length,
  });
  const providerState =
    providerStatus.status === "degraded"
      ? "degraded"
      : providerStatus.status === "loading"
        ? "loading"
        : providerStatus.status === "research_off"
          ? "disconnected"
          : "live";
  const calendarEvents = useMemo(
    () =>
      attachMarketCalendarRelations(
        buildMarketCalendarEventsFromEarnings(earningsEntries, {
          provider: "fmp",
          providerState,
        }),
        {
          activeWatchlistSymbols: activeSymbols,
          allWatchlistSymbols: watchlistSymbols,
          heldSymbols,
        },
      ),
    [activeSymbols, earningsEntries, heldSymbols, providerState, watchlistSymbols],
  );
  const eventTypes = useMemo(
    () =>
      eventTypeFilter === "all"
        ? MARKET_CALENDAR_EVENT_TYPES
        : [eventTypeFilter],
    [eventTypeFilter],
  );
  const filteredEvents = useMemo(
    () =>
      filterMarketCalendarEvents(calendarEvents, {
        scope,
        eventTypes,
        timing: timingFilter,
      }),
    [calendarEvents, eventTypes, scope, timingFilter],
  );
  const monthGrid = useMemo(
    () =>
      buildMarketCalendarMonthGrid({
        monthDate,
        events: filteredEvents,
      }),
    [filteredEvents, monthDate],
  );
  const filteredEventSignature = filteredEvents.map((event) => event.id).join("|");
  const selectedEvent =
    filteredEvents.find((event) => event.id === selectedEventId) ||
    calendarEvents.find((event) => event.id === selectedEventId) ||
    null;
  const universePageData = useMemo(
    () =>
      paginateMarketCalendarUniverse(calendarEvents, {
        page: universePage,
        pageSize: 12,
      }),
    [calendarEvents, universePage],
  );

  useEffect(() => {
    if (!open) {
      setSelectedEventId(null);
      return;
    }
    setSelectedEventId((current) =>
      current && filteredEvents.some((event) => event.id === current)
        ? current
        : filteredEvents[0]?.id || null,
    );
  }, [filteredEventSignature, open]);

  useEffect(() => {
    setUniversePage(0);
  }, [filteredEventSignature]);

  if (!open) return null;

  const handleShiftMonth = (delta) => {
    onChangeMonth?.(shiftMarketCalendarMonth(monthDate, delta));
  };
  const handleLinkChart = (event) => {
    if (!event?.symbol) return;
    onSelectSymbol?.(event.symbol);
    onLinkedContextChange?.({ symbol: event.symbol, timeframe: "1d" });
  };
  const handleOpenTrade = (event) => {
    if (!event?.symbol) return;
    onOpenTrade?.(event.symbol);
    onClose?.();
  };

  return (
    <div
      data-testid="market-calendar-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Market calendar"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10040,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: sp(12),
        background: "rgba(0,0,0,.58)",
      }}
    >
      <div
        className="ra-modal-enter"
        style={{
          width: "min(1180px, calc(100vw - 24px))",
          maxHeight: "calc(100vh - 24px)",
          display: "flex",
          flexDirection: "column",
          border: `1px solid ${T.borderStrong}`,
          background: T.bg1,
          boxShadow: "0 22px 80px rgba(0,0,0,.42)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: sp(8),
            padding: sp("9px 10px"),
            borderBottom: `1px solid ${T.border}`,
            background: T.bg2,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: sp(9), minWidth: 0 }}>
            <CalendarDays size={dim(17)} color={T.accent} strokeWidth={2.2} />
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  color: T.text,
                  font: `900 ${fs(14)}px ${T.display}`,
                  letterSpacing: "0.03em",
                  textTransform: "uppercase",
                }}
              >
                Market Calendar
              </div>
              <div
                style={{
                  color: T.textDim,
                  font: `800 ${fs(8)}px ${T.mono}`,
                  textTransform: "uppercase",
                }}
              >
                {monthGrid.label} . {filteredEvents.length} shown . {calendarEvents.length} loaded
              </div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: sp(6) }}>
            <span
              data-testid="market-calendar-provider-status"
              style={{
                color: statusTone(providerStatus.status),
                border: `1px solid ${statusTone(providerStatus.status)}55`,
                background: `${statusTone(providerStatus.status)}12`,
                font: `900 ${fs(8)}px ${T.mono}`,
                padding: sp("4px 7px"),
                textTransform: "uppercase",
                whiteSpace: "nowrap",
              }}
            >
              {providerStatus.label}
            </span>
            <AppTooltip content="Previous month"><button
              type="button"
              onClick={() => handleShiftMonth(-1)}
              style={iconButtonStyle}
            >
              <ChevronLeft size={dim(15)} />
            </button></AppTooltip>
            <AppTooltip content="Next month"><button
              type="button"
              onClick={() => handleShiftMonth(1)}
              style={iconButtonStyle}
            >
              <ChevronRight size={dim(15)} />
            </button></AppTooltip>
            <AppTooltip content="Close calendar"><button
              type="button"
              onClick={onClose}
              data-testid="market-calendar-close"
              style={iconButtonStyle}
            >
              <X size={dim(15)} />
            </button></AppTooltip>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            gap: sp(8),
            flexWrap: "wrap",
            alignItems: "center",
            padding: sp("8px 10px"),
            borderBottom: `1px solid ${T.border}`,
            background: T.bg1,
          }}
        >
          <div style={{ display: "flex", gap: sp(4), flexWrap: "wrap" }}>
            {SCOPE_OPTIONS.map(([value, label]) => (
              <button
                key={value}
                type="button"
                data-testid={`market-calendar-scope-${value}`}
                onClick={() => setScope(value)}
                style={chipStyle(scope === value)}
              >
                {label}
              </button>
            ))}
          </div>
          <select
            aria-label="Calendar event type"
            value={eventTypeFilter}
            onChange={(event) => setEventTypeFilter(event.target.value)}
            style={selectStyle}
          >
            {EVENT_TYPE_FILTER_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <select
            aria-label="Calendar timing"
            value={timingFilter}
            onChange={(event) => setTimingFilter(event.target.value)}
            style={selectStyle}
          >
            {TIMING_FILTER_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <div
            style={{
              marginLeft: "auto",
              color: T.textDim,
              font: `800 ${fs(8)}px ${T.mono}`,
              textTransform: "uppercase",
              whiteSpace: "nowrap",
            }}
          >
            {providerStatus.detail}
          </div>
        </div>

        <div
          style={{
            overflow: "auto",
            padding: sp(10),
            display: "flex",
            alignItems: "stretch",
            gap: sp(10),
            flexWrap: "wrap",
          }}
        >
          <div
            style={{
              flex: "1 1 610px",
              minWidth: 0,
              display: "grid",
              gap: sp(8),
              alignContent: "start",
            }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
                gap: sp(4),
                color: T.textDim,
                font: `900 ${fs(8)}px ${T.mono}`,
                textTransform: "uppercase",
              }}
            >
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
                <div key={day} style={{ padding: sp("0 4px") }}>
                  {day}
                </div>
              ))}
            </div>
            {earningsPending ? (
              <MarketCalendarSkeleton />
            ) : filteredEvents.length ? (
              <div
                data-testid="market-calendar-month-grid"
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
                  gap: sp(4),
                }}
              >
                {monthGrid.days.map((day) => (
                  <div
                    key={day.date}
                    data-testid={`market-calendar-day-${day.date}`}
                    style={{
                      minHeight: dim(82),
                      border: `1px solid ${day.isToday ? `${T.accent}80` : T.border}`,
                      background: day.inMonth ? T.bg2 : T.bg0,
                      opacity: day.inMonth ? 1 : 0.62,
                      padding: sp(5),
                      display: "flex",
                      flexDirection: "column",
                      gap: sp(4),
                      minWidth: 0,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        color: day.isToday ? T.accent : T.textDim,
                        font: `900 ${fs(8)}px ${T.mono}`,
                      }}
                    >
                      <span>{day.dayOfMonth}</span>
                      {day.events.length ? <span>{day.events.length}</span> : null}
                    </div>
                    <div style={{ display: "grid", gap: sp(3), minWidth: 0 }}>
                      {day.events.slice(0, 3).map((event) => (
                        <button
                          key={event.id}
                          type="button"
                          data-testid={`market-calendar-event-${event.id}`}
                          onClick={() => setSelectedEventId(event.id)}
                          className="ra-interactive"
                          style={{
                            border: `1px solid ${selectedEventId === event.id ? `${T.accent}88` : T.border}`,
                            background:
                              selectedEventId === event.id ? `${T.accent}14` : T.bg1,
                            color: selectedEventId === event.id ? T.accent : T.textSec,
                            cursor: "pointer",
                            minWidth: 0,
                            textAlign: "left",
                            font: `900 ${fs(8)}px ${T.mono}`,
                            padding: sp("3px 4px"),
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {event.symbol} {event.timingLabel}
                        </button>
                      ))}
                      {day.events.length > 3 ? (
                        <span
                          style={{
                            color: T.textDim,
                            font: `800 ${fs(7)}px ${T.mono}`,
                          }}
                        >
                          +{day.events.length - 3} more
                        </span>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <DataUnavailableState
                title={
                  providerStatus.status === "degraded"
                    ? "Calendar degraded"
                    : "No calendar events"
                }
                detail={providerStatus.detail}
                loading={providerStatus.status === "loading"}
                minHeight={260}
                fill
                tone={statusTone(providerStatus.status)}
              />
            )}
          </div>

          <aside
            style={{
              flex: "0 1 360px",
              minWidth: "min(100%, 300px)",
              display: "grid",
              gap: sp(8),
              alignContent: "start",
            }}
          >
            <div
              data-testid="market-calendar-detail"
              style={{
                border: `1px solid ${T.border}`,
                background: T.bg2,
                padding: sp(8),
                display: "grid",
                gap: sp(8),
              }}
            >
              {selectedEvent ? (
                <>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: sp(8),
                      alignItems: "flex-start",
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div
                        style={{
                          color: T.text,
                          font: `900 ${fs(16)}px ${T.display}`,
                          letterSpacing: "0.03em",
                        }}
                      >
                        {selectedEvent.symbol}
                      </div>
                      <div
                        style={{
                          color: T.textDim,
                          font: `800 ${fs(8)}px ${T.mono}`,
                          textTransform: "uppercase",
                        }}
                      >
                        {selectedEvent.eventTypeLabel} . {formatDateHeading(selectedEvent.date)}
                      </div>
                    </div>
                    <span
                      style={{
                        color: T.accent,
                        border: `1px solid ${T.accent}55`,
                        background: `${T.accent}12`,
                        padding: sp("3px 6px"),
                        font: `900 ${fs(8)}px ${T.mono}`,
                        textTransform: "uppercase",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {selectedEvent.relationLabel}
                    </span>
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                      gap: sp(6),
                    }}
                  >
                    <EventDetailMetric label="Timing" value={selectedEvent.timingLabel} />
                    <EventDetailMetric
                      label="Fiscal"
                      value={
                        selectedEvent.fiscalPeriod ||
                        formatFiscalDate(selectedEvent.fiscalDateEnding)
                      }
                    />
                    <EventDetailMetric
                      label="EPS"
                      value={formatEstimateActual(
                        selectedEvent.epsEstimated,
                        selectedEvent.epsActual,
                        formatEps,
                      )}
                    />
                    <EventDetailMetric
                      label="Revenue"
                      value={formatEstimateActual(
                        selectedEvent.revenueEstimated,
                        selectedEvent.revenueActual,
                        formatCurrencyCompact,
                      )}
                    />
                    <EventDetailMetric label="Provider" value={selectedEvent.provider.toUpperCase()} />
                    <EventDetailMetric label="State" value={providerStatus.label.toUpperCase()} />
                  </div>

                  <div style={{ display: "flex", gap: sp(6), flexWrap: "wrap" }}>
                    <button
                      type="button"
                      onClick={() => handleLinkChart(selectedEvent)}
                      style={{
                        ...chipStyle(false, T.accent),
                        display: "inline-flex",
                        alignItems: "center",
                        gap: sp(5),
                      }}
                    >
                      <Link2 size={dim(12)} />
                      Link Chart
                    </button>
                    <button
                      type="button"
                      onClick={() => handleOpenTrade(selectedEvent)}
                      style={{
                        ...chipStyle(false, T.green),
                        display: "inline-flex",
                        alignItems: "center",
                        gap: sp(5),
                      }}
                    >
                      <ExternalLink size={dim(12)} />
                      Trade
                    </button>
                  </div>

                  <div
                    data-testid="market-calendar-detail-mini-chart"
                    style={{
                      height: dim(230),
                      minHeight: dim(210),
                      background: T.bg1,
                    }}
                  >
                    <TradeEquityPanel
                      ticker={selectedEvent.symbol}
                      flowEvents={[]}
                      historicalDataEnabled
                      earningsEventsEnabled={researchConfigured}
                      stockAggregateStreamingEnabled={stockAggregateStreamingEnabled}
                      dataTestId="market-calendar-detail-chart"
                      compact
                      surfaceUiStateKey={`market-calendar-detail:${selectedEvent.symbol}`}
                      workspaceChart={{ timeframe: "1d" }}
                    />
                  </div>
                </>
              ) : (
                <DataUnavailableState
                  title="No event selected"
                  detail={providerStatus.detail}
                  minHeight={220}
                  tone={statusTone(providerStatus.status)}
                />
              )}
            </div>

            <div
              data-testid="market-calendar-universe"
              style={{
                border: `1px solid ${T.border}`,
                background: T.bg2,
                padding: sp(8),
                display: "grid",
                gap: sp(7),
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: sp(8),
                }}
              >
                <div
                  style={{
                    color: T.textSec,
                    font: `900 ${fs(10)}px ${T.display}`,
                    textTransform: "uppercase",
                  }}
                >
                  Event Universe
                </div>
                <div
                  style={{
                    color: T.textDim,
                    font: `800 ${fs(8)}px ${T.mono}`,
                    textTransform: "uppercase",
                    whiteSpace: "nowrap",
                  }}
                >
                  {universePageData.total} symbols
                </div>
              </div>
              <div style={{ display: "grid", gap: sp(4) }}>
                {universePageData.rows.length ? (
                  universePageData.rows.map((row) => (
                    <button
                      type="button"
                      key={row.symbol}
                      onClick={() => {
                        const event = calendarEvents.find(
                          (candidate) => candidate.symbol === row.symbol,
                        );
                        if (event) setSelectedEventId(event.id);
                      }}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "54px minmax(0, 1fr) 54px",
                        alignItems: "center",
                        gap: sp(6),
                        border: `1px solid ${T.border}`,
                        background: T.bg1,
                        color: T.textSec,
                        cursor: "pointer",
                        padding: sp("5px 6px"),
                        font: `800 ${fs(8)}px ${T.mono}`,
                      }}
                    >
                      <span style={{ color: T.accent, fontWeight: 900 }}>{row.symbol}</span>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {formatMonthDay(row.nextDate)} . {row.relationLabel}
                      </span>
                      <span style={{ color: T.textDim, textAlign: "right" }}>
                        {row.count} evt
                      </span>
                    </button>
                  ))
                ) : (
                  <DataUnavailableState
                    title="No event universe"
                    detail={providerStatus.detail}
                    minHeight={88}
                    tone={statusTone(providerStatus.status)}
                  />
                )}
              </div>
              <div style={{ display: "flex", gap: sp(6), justifyContent: "flex-end" }}>
                <button
                  type="button"
                  onClick={() => setUniversePage((current) => Math.max(0, current - 1))}
                  disabled={universePageData.page <= 0}
                  style={{
                    ...chipStyle(false),
                    opacity: universePageData.page <= 0 ? 0.42 : 1,
                    cursor: universePageData.page <= 0 ? "not-allowed" : "pointer",
                  }}
                >
                  Prev
                </button>
                <span
                  style={{
                    color: T.textDim,
                    font: `800 ${fs(8)}px ${T.mono}`,
                    alignSelf: "center",
                  }}
                >
                  {universePageData.page + 1}/{universePageData.pageCount}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setUniversePage((current) =>
                      Math.min(universePageData.pageCount - 1, current + 1),
                    )
                  }
                  disabled={universePageData.page >= universePageData.pageCount - 1}
                  style={{
                    ...chipStyle(false),
                    opacity:
                      universePageData.page >= universePageData.pageCount - 1 ? 0.42 : 1,
                    cursor:
                      universePageData.page >= universePageData.pageCount - 1
                        ? "not-allowed"
                        : "pointer",
                  }}
                >
                  Next
                </button>
                {earningsPending ? (
                  <RefreshCw
                    size={dim(14)}
                    className="ra-refresh-spin"
                    color={T.amber}
                    style={{ alignSelf: "center" }}
                  />
                ) : null}
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
};
