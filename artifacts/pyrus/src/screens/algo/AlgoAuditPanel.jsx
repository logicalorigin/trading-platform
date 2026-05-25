import { Fragment, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, X } from "lucide-react";
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
import { InlineFilterBar } from "../../components/platform/primitives.jsx";
import { PaginationFooter, paginateRows } from "../../components/platform/TablePagination.jsx";
import { formatEnumLabel, formatRelativeTimeShort } from "../../lib/formatters";
import { formatAppTimeForPreferences } from "../../lib/timeZone";
import { motionRowStyle } from "../../lib/motion";
import { clearAlgoFocus, setAlgoFocus, useAlgoFocus } from "../../features/platform/algoFocusStore";
import { formatMoney, formatPct, formatPlainPrice } from "./algoHelpers";
import {
  AUDIT_PAGE_SIZE,
  AUDIT_STAGE_CHIPS,
  auditRowMatchesQuery,
  buildAuditSummary,
  matchesAuditStage,
  normalizeAuditEvent,
} from "./algoAuditModel";

const AUDIT_GRID_COLUMNS = [
  `${dim(76)}px`,
  `${dim(96)}px`,
  "minmax(70px, 0.65fr)",
  "minmax(230px, 1.65fr)",
  "minmax(120px, 0.9fr)",
  `${dim(90)}px`,
  `${dim(104)}px`,
  `${dim(112)}px`,
].join(" ");

const asRecord = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};

const stageColor = (stageId) => {
  if (stageId === "blocked") return T.amber;
  if (stageId === "submitted" || stageId === "filled") return T.green;
  if (stageId === "closed") return T.cyan;
  if (stageId === "candidate") return T.accent;
  if (stageId === "config") return T.textDim;
  return T.textSec;
};

const formatPrice = (value) =>
  Number.isFinite(Number(value)) ? formatPlainPrice(value, 2) : MISSING_VALUE;

const formatBidAsk = (row) =>
  row.quote.bid != null || row.quote.ask != null
    ? `${formatPrice(row.quote.bid)} / ${formatPrice(row.quote.ask)}`
    : MISSING_VALUE;

const formatSecondaryQuote = (row) => {
  if (row.quote.mark != null) return `mark ${formatPrice(row.quote.mark)}`;
  if (row.quote.last != null) return `last ${formatPrice(row.quote.last)}`;
  return row.quote.quoteFreshness || row.quote.marketDataMode || "";
};

const formatQtyRisk = (row) => {
  const quantity = row.quantity != null ? `x${row.quantity}` : "";
  const premium = row.premiumAtRisk != null ? formatMoney(row.premiumAtRisk, 0) : "";
  const pnl = row.pnl != null ? `P&L ${formatMoney(row.pnl, 0)}` : "";
  return [quantity, premium || pnl].filter(Boolean).join(" · ") || MISSING_VALUE;
};

const formatRiskDetail = (row) => {
  if (row.pnl != null && row.premiumAtRisk != null) return `P&L ${formatMoney(row.pnl, 0)}`;
  if (row.stopPrice != null) return `stop ${formatPrice(row.stopPrice)}`;
  return "";
};

const shortId = (value) => {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.length > 18 ? `${text.slice(0, 8)}…${text.slice(-6)}` : text;
};

const renderMeta = (value, fallback = "") => {
  const text = String(value ?? "").trim();
  return text || fallback;
};

const formatLiquidityDetail = (liquidity) => {
  const spread = liquidity.spreadPercent ?? liquidity.spreadPctOfMid ?? liquidity.spreadRatio;
  const numeric = Number(spread);
  if (Number.isFinite(numeric)) {
    return `spread ${formatPct(numeric <= 1 ? numeric * 100 : numeric, 1)}`;
  }
  return liquidity.reason || liquidity.message || "";
};

const AuditStageChip = ({ row }) => {
  const color = stageColor(row.stage.id);
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: "fit-content",
        maxWidth: "100%",
        border: `1px solid ${color}55`,
        borderRadius: dim(RADII.xs),
        color,
        background: `${color}10`,
        fontFamily: T.sans,
        fontSize: fs(9),
        fontWeight: FONT_WEIGHTS.medium,
        lineHeight: 1,
        padding: sp("3px 5px"),
        textTransform: "uppercase",
        whiteSpace: "nowrap",
      }}
    >
      {row.stage.label}
    </span>
  );
};

const Cell = ({ align = "left", children, dimmed = false }) => (
  <div
    style={{
      minWidth: 0,
      color: dimmed ? T.textDim : T.textSec,
      fontFamily: T.sans,
      fontSize: textSize("caption"),
      lineHeight: 1.28,
      overflow: "hidden",
      textAlign: align,
    }}
  >
    {children}
  </div>
);

const HeaderCell = ({ children, align = "left" }) => (
  <div
    style={{
      color: T.textDim,
      fontFamily: T.sans,
      fontSize: fs(9),
      fontWeight: FONT_WEIGHTS.medium,
      letterSpacing: "0.04em",
      lineHeight: 1,
      minWidth: 0,
      textAlign: align,
      textTransform: "uppercase",
    }}
  >
    {children}
  </div>
);

const SummaryStat = ({ label, value, color = T.textSec }) => (
  <span
    style={{
      display: "inline-flex",
      alignItems: "baseline",
      gap: sp(3),
      minWidth: 0,
      color: T.textDim,
      fontFamily: T.sans,
      fontSize: textSize("caption"),
      whiteSpace: "nowrap",
    }}
  >
    <span
      style={{
        color,
        fontSize: fs(12),
        fontWeight: FONT_WEIGHTS.medium,
      }}
    >
      {value}
    </span>
    {label}
  </span>
);

const AuditDetailPanel = ({ row }) => {
  const payload = row.payload;
  const readiness = asRecord(payload.readiness);
  const liquidity = asRecord(payload.liquidity);
  const orderPlan = asRecord(payload.orderPlan);
  const markResolution = asRecord(payload.markResolution);
  const details = [
    ["Reason", row.reason],
    ["Readiness", readiness.message],
    ["Event ID", row.id],
    ["Deployment", row.metadata.deploymentName || row.metadata.deploymentId],
    ["Run", row.metadata.runId],
    ["Contract ID", row.contract.providerContractId],
    ["Ticker", row.contract.ticker],
    ["Quote", row.quote.updatedAt || row.quote.quoteFreshness],
    ["Source", row.source],
    ["Liquidity", formatLiquidityDetail(liquidity)],
    ["Order", orderPlan.entryLimitPrice != null ? `limit ${formatPrice(orderPlan.entryLimitPrice)}` : orderPlan.reason],
    ["Mark", markResolution.source || markResolution.attempts],
    ["Count", row.count != null ? row.count : ""],
  ].filter(([, value]) => String(value ?? "").trim());

  if (!details.length) return null;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
        gap: sp(5),
        padding: sp("7px 8px 8px 28px"),
        borderBottom: `1px solid ${T.border}22`,
        background: `${T.bg0}66`,
      }}
    >
      {details.map(([label, value]) => (
        <div key={label} style={{ minWidth: 0 }}>
          <div
            style={{
              color: T.textDim,
              fontFamily: T.sans,
              fontSize: fs(9),
              letterSpacing: "0.04em",
              textTransform: "uppercase",
            }}
          >
            {label}
          </div>
          <div
            style={{
              color: T.textSec,
              fontFamily: T.sans,
              fontSize: textSize("caption"),
              lineHeight: 1.35,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={String(value)}
          >
            {String(value)}
          </div>
        </div>
      ))}
    </div>
  );
};

export const AlgoAuditPanel = ({
  events = [],
  focusedDeployment,
  userPreferences,
  onJumpToOperations,
  algoIsPhone = false,
}) => {
  const [symbolFilter, setSymbolFilter] = useState("");
  const [stageFilters, setStageFilters] = useState([]);
  const [page, setPage] = useState(0);
  const [expandedEventId, setExpandedEventId] = useState(null);
  const focus = useAlgoFocus();
  const auditRows = useMemo(() => events.map(normalizeAuditEvent), [events]);
  const filteredEvents = useMemo(() => {
    const matching = auditRows.filter((row) => {
      if (!auditRowMatchesQuery(row, symbolFilter)) return false;
      if (!matchesAuditStage(row.eventType, stageFilters)) return false;
      return true;
    });
    if (!focus.focusedSymbol) return matching;
    const focused = String(focus.focusedSymbol).toUpperCase();
    const matches = matching.filter(
      (row) => String(row.symbol || "").toUpperCase() === focused,
    );
    const rest = matching.filter(
      (row) => String(row.symbol || "").toUpperCase() !== focused,
    );
    return [...matches, ...rest];
  }, [auditRows, focus.focusedSymbol, stageFilters, symbolFilter]);
  const paginatedEvents = paginateRows(filteredEvents, page, AUDIT_PAGE_SIZE);
  const pageEvents = paginatedEvents.pageRows;
  const auditSummary = useMemo(
    () => buildAuditSummary(filteredEvents),
    [filteredEvents],
  );
  useEffect(() => {
    setPage(0);
    setExpandedEventId(null);
  }, [focus.focusedSymbol, stageFilters, symbolFilter]);
  useEffect(() => {
    if (paginatedEvents.safePage !== page) {
      setPage(paginatedEvents.safePage);
    }
  }, [page, paginatedEvents.safePage]);

  const stageCounts = useMemo(() => {
    const counts = {};
    for (const chip of AUDIT_STAGE_CHIPS) {
      counts[chip.id] = auditRows.filter((row) => chip.matches(String(row.eventType || "").toLowerCase())).length;
    }
    return counts;
  }, [auditRows]);

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
              fontSize: textSize("bodyStrong"),
              fontWeight: FONT_WEIGHTS.label,
              fontFamily: T.sans,
              color: T.text,
              letterSpacing: 0,
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
        {focus.focusedSymbol ? (
          <button
            type="button"
            onClick={clearAlgoFocus}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: sp(3),
              background: `${T.accent}12`,
              border: `1px solid ${T.accent}55`,
              borderRadius: dim(RADII.xs),
              color: T.accent,
              cursor: "pointer",
              fontFamily: T.sans,
              fontSize: textSize("caption"),
              padding: sp("3px 5px"),
            }}
            title="Clear focused symbol"
          >
            {focus.focusedSymbol}
            <X size={12} aria-hidden="true" />
          </button>
        ) : (
          <span
            style={{ fontSize: textSize("body"), color: T.textDim, fontFamily: T.sans }}
          >
            {filteredEvents.length} / {events.length} rows
          </span>
        )}
      </div>

      <InlineFilterBar
        dataTestId="algo-audit-filter-bar"
        textValue={symbolFilter}
        onTextChange={setSymbolFilter}
        textPlaceholder="Search symbol, reason, contract…"
        chips={AUDIT_STAGE_CHIPS.map((chip) => ({
          id: chip.id,
          label: chip.label,
          count: stageCounts[chip.id],
        }))}
        selectedChipIds={stageFilters}
        onChipsChange={setStageFilters}
        mode="multi"
      />

      <div
        data-testid="algo-audit-summary"
        style={{
          display: "flex",
          alignItems: "center",
          gap: sp(8),
          minWidth: 0,
          overflowX: "auto",
          borderTop: `1px solid ${T.border}44`,
          borderBottom: `1px solid ${T.border}44`,
          padding: sp("5px 1px"),
        }}
      >
        <SummaryStat label="visible" value={`${filteredEvents.length}/${auditRows.length}`} />
        <SummaryStat label="blocked" value={auditSummary.blocked} color={auditSummary.blocked ? T.amber : T.textSec} />
        <SummaryStat label="trade" value={auditSummary.trades} color={auditSummary.trades ? T.green : T.textSec} />
        <SummaryStat label="config" value={auditSummary.config} />
        <SummaryStat
          label="latest"
          value={
            auditSummary.latestOccurredAt
              ? formatRelativeTimeShort(new Date(auditSummary.latestOccurredAt))
              : MISSING_VALUE
          }
          color={auditSummary.latestOccurredAt ? T.cyan : T.textDim}
        />
      </div>

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
          {auditRows.length === 0
            ? "No execution events have been recorded yet."
            : "No events match the current filter."}
        </div>
      ) : (
        <>
          <div
            data-testid="algo-audit-table"
            style={{
              border: `1px solid ${T.border}55`,
              borderRadius: dim(RADII.sm),
              maxHeight: algoIsPhone ? "none" : dim(560),
              overflow: "auto",
              minWidth: 0,
            }}
          >
            {!algoIsPhone ? (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: AUDIT_GRID_COLUMNS,
                  gap: sp(6),
                  alignItems: "center",
                  minWidth: dim(910),
                  position: "sticky",
                  top: 0,
                  zIndex: 1,
                  background: T.bg1,
                  borderBottom: `1px solid ${T.border}`,
                  padding: sp("6px 8px"),
                }}
              >
                <HeaderCell>Time</HeaderCell>
                <HeaderCell>Stage</HeaderCell>
                <HeaderCell>Symbol</HeaderCell>
                <HeaderCell>Event</HeaderCell>
                <HeaderCell>Contract</HeaderCell>
                <HeaderCell align="right">Bid / Ask</HeaderCell>
                <HeaderCell align="right">Qty / Risk</HeaderCell>
                <HeaderCell align="right">Acct / Source</HeaderCell>
              </div>
            ) : null}

            {pageEvents.map((event, index) => {
          const isFocused =
            focus.focusedSymbol &&
            String(event.symbol || "").toUpperCase() ===
              String(focus.focusedSymbol).toUpperCase();
          const rowKey = event.id || `${event.eventType}-${event.occurredAt}-${index}`;
          const isExpanded = expandedEventId === rowKey;
          const stageAccent = stageColor(event.stage.id);
          if (algoIsPhone) {
            return (
              <Fragment key={rowKey}>
                <div
                  className="ra-row-enter"
                  data-focused={isFocused ? "true" : undefined}
                  data-testid="algo-audit-row"
                  style={{
                    ...motionRowStyle(index, 10, 140),
                    display: "grid",
                    gap: sp(5),
                    padding: sp("8px 8px"),
                    borderLeft: isFocused
                      ? `3px solid ${T.accent}`
                      : `3px solid ${stageAccent}55`,
                    borderBottom: `1px solid ${T.border}22`,
                    background: isFocused ? `${T.accent}10` : "transparent",
                    minWidth: 0,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: sp(6),
                      minWidth: 0,
                    }}
                  >
                    <span style={{ color: T.textDim, fontFamily: T.sans, fontSize: textSize("caption") }}>
                      {formatAppTimeForPreferences(event.occurredAt, userPreferences)}
                    </span>
                    <AuditStageChip row={event} />
                    {event.symbol ? (
                      <button
                        type="button"
                        onClick={() => handleSymbolClick(event.symbol)}
                        style={{
                          background: "transparent",
                          border: "none",
                          color: T.text,
                          cursor: "pointer",
                          fontFamily: T.sans,
                          fontSize: textSize("caption"),
                          fontWeight: FONT_WEIGHTS.medium,
                          padding: 0,
                          textDecoration: "underline dotted",
                          textDecorationColor: T.textDim,
                        }}
                      >
                        {event.symbol}
                      </button>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => setExpandedEventId(isExpanded ? null : rowKey)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: sp(4),
                      minWidth: 0,
                      background: "transparent",
                      border: "none",
                      color: T.textSec,
                      cursor: "pointer",
                      fontFamily: T.sans,
                      fontSize: textSize("caption"),
                      lineHeight: 1.35,
                      padding: 0,
                      textAlign: "left",
                    }}
                  >
                    {isExpanded ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronRight size={13} aria-hidden="true" />}
                    <span
                      style={{
                        minWidth: 0,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {formatEnumLabel(event.eventType)} · {event.summary}
                    </span>
                  </button>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                      gap: sp(5),
                    }}
                  >
                    {[
                      ["Contract", event.contract.label || MISSING_VALUE],
                      ["Bid / Ask", formatBidAsk(event)],
                      ["Qty / Risk", formatQtyRisk(event)],
                      ["Acct / Source", [event.account || "system", event.source].filter(Boolean).join(" · ")],
                    ].map(([label, value]) => (
                      <div key={label} style={{ minWidth: 0 }}>
                        <div style={{ color: T.textDim, fontFamily: T.sans, fontSize: fs(9), textTransform: "uppercase" }}>
                          {label}
                        </div>
                        <div
                          style={{
                            color: T.textSec,
                            fontFamily: T.sans,
                            fontSize: textSize("caption"),
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {value || MISSING_VALUE}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                {isExpanded ? <AuditDetailPanel row={event} /> : null}
              </Fragment>
            );
          }
          return (
            <Fragment key={rowKey}>
              <div
                className="ra-row-enter"
                data-focused={isFocused ? "true" : undefined}
                data-testid="algo-audit-row"
                style={{
                  ...motionRowStyle(index, 10, 140),
                  display: "grid",
                  gridTemplateColumns: AUDIT_GRID_COLUMNS,
                  gap: sp(6),
                  alignItems: "center",
                  minWidth: dim(910),
                  padding: sp("6px 8px"),
                  borderLeft: isFocused
                    ? `3px solid ${T.accent}`
                    : `3px solid ${stageAccent}55`,
                  background: isFocused ? `${T.accent}10` : "transparent",
                  borderBottom: `1px solid ${T.border}22`,
                }}
              >
                <Cell dimmed>
                  <div>{formatAppTimeForPreferences(event.occurredAt, userPreferences)}</div>
                  <div style={{ color: T.textMuted }}>
                    {formatRelativeTimeShort(event.occurredAt)}
                  </div>
                </Cell>
                <Cell>
                  <AuditStageChip row={event} />
                </Cell>
                <Cell>
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
                        fontSize: textSize("caption"),
                        fontWeight: FONT_WEIGHTS.medium,
                        textAlign: "left",
                        textDecoration: "underline dotted",
                        textDecorationColor: T.textDim,
                        cursor: "pointer",
                      }}
                    >
                      {event.symbol}
                    </button>
                  ) : (
                    <span style={{ color: T.textDim }}>system</span>
                  )}
                </Cell>
                <Cell>
                  <button
                    type="button"
                    onClick={() => setExpandedEventId(isExpanded ? null : rowKey)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: sp(4),
                      minWidth: 0,
                      width: "100%",
                      background: "transparent",
                      border: "none",
                      color: T.textSec,
                      cursor: "pointer",
                      fontFamily: T.sans,
                      fontSize: textSize("caption"),
                      lineHeight: 1.28,
                      padding: 0,
                      textAlign: "left",
                    }}
                  >
                    {isExpanded ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronRight size={13} aria-hidden="true" />}
                    <span
                      style={{
                        minWidth: 0,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                      title={`${formatEnumLabel(event.eventType)} · ${event.summary}`}
                    >
                      <span style={{ color: T.text, fontWeight: FONT_WEIGHTS.medium }}>
                        {formatEnumLabel(event.eventType)}
                      </span>
                      <span style={{ color: T.textDim }}> · </span>
                      {event.detailText || event.summary}
                    </span>
                  </button>
                  <div
                    style={{
                      color: T.textDim,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={event.summary}
                  >
                    {event.summary}
                  </div>
                </Cell>
                <Cell>
                  <div title={event.contract.label || undefined}>
                    {event.contract.label || MISSING_VALUE}
                  </div>
                  <div style={{ color: T.textDim }} title={event.contract.providerContractId || event.contract.ticker}>
                    {shortId(event.contract.providerContractId || event.contract.ticker)}
                  </div>
                </Cell>
                <Cell align="right">
                  <div>{formatBidAsk(event)}</div>
                  <div style={{ color: T.textDim, fontFamily: T.sans }}>
                    {formatSecondaryQuote(event)}
                  </div>
                </Cell>
                <Cell align="right">
                  <div>{formatQtyRisk(event)}</div>
                  <div style={{ color: T.textDim }}>
                    {formatRiskDetail(event)}
                  </div>
                </Cell>
                <Cell align="right">
                  <div title={event.account || "system"}>
                    {renderMeta(event.account, "system")}
                  </div>
                  <div style={{ color: T.textDim }} title={event.source || event.metadata.deploymentName}>
                    {renderMeta(event.source || event.metadata.deploymentName)}
                  </div>
                </Cell>
              </div>
              {isExpanded ? <AuditDetailPanel row={event} /> : null}
            </Fragment>
          );
        })}
          </div>
          <PaginationFooter
            dataTestId="algo-audit-pagination"
            label="Rows"
            onPageChange={setPage}
            page={paginatedEvents.safePage}
            pageCount={paginatedEvents.pageCount}
            pageSize={AUDIT_PAGE_SIZE}
            total={paginatedEvents.total}
            style={{ paddingTop: sp(2), borderTop: `1px solid ${T.border}` }}
          />
        </>
      )}
    </div>
  );
};

export default AlgoAuditPanel;
