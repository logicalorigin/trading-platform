import {
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  MarketIdentityChips,
  MarketIdentityMark,
} from "../platform/marketIdentity";
import {
  useSignalMonitorStateForSymbol,
} from "../platform/signalMonitorStore";
import { useTradeFlowSnapshot } from "../platform/tradeFlowStore";
import {
  resolveTradeOptionChainSnapshot,
  useTradeOptionChainSnapshot,
} from "../platform/tradeOptionChainStore";
import {
  ensureTradeTickerInfo,
  useRuntimeTickerSnapshot,
} from "../platform/runtimeTickerStore";
import { joinMotionClasses, motionVars } from "../../lib/motion";
import {
  fmtCompactNumber,
  formatQuotePrice,
  formatSignedPercent,
  getAtmStrikeFromPrice,
  isFiniteNumber,
} from "../../lib/formatters";
import {
  MISSING_VALUE,
  T,
  dim,
  fs,
  sp,
} from "../../lib/uiTokens";
import { AppTooltip } from "@/components/ui/tooltip";


const fmtQuoteVolume = (value) =>
  value == null || Number.isNaN(value) ? MISSING_VALUE : fmtCompactNumber(value);

const TickerTabStripItem = ({
  ticker,
  active,
  showClose,
  workspace,
  dragging,
  dropSide,
  onSelect,
  onClose,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
}) => {
  const fallback = useMemo(
    () => ensureTradeTickerInfo(ticker, ticker),
    [ticker],
  );
  const info = useRuntimeTickerSnapshot(ticker, fallback);
  const signalState = useSignalMonitorStateForSymbol(ticker);
  const flow = useTradeFlowSnapshot(ticker);
  const pos = isFiniteNumber(info?.pct) ? info.pct >= 0 : null;
  const isActive = ticker === active;
  const badges = [
    workspace?.selectedContract?.strike ? "OPT" : null,
    signalState?.fresh ? "SIG" : null,
    (flow?.events || []).length ? "FLOW" : null,
  ].filter(Boolean).slice(0, 3);

  return (
    <AppTooltip content={[
        ticker,
        badges.length ? `Badges: ${badges.join(", ")}` : null,
      ].filter(Boolean).join(" · ")}><div
      onClick={() => onSelect(ticker)}
      onPointerDown={(event) => onPointerDown?.(ticker, event)}
      onPointerMove={(event) => onPointerMove?.(ticker, event)}
      onPointerUp={(event) => onPointerUp?.(event)}
      onPointerCancel={(event) => onPointerCancel?.(event)}
      data-testid={`trade-tab-${ticker}`}
      data-trade-tab-ticker={ticker}
      className={joinMotionClasses("ra-interactive", isActive && "ra-focus-rail")}
      style={{
        ...motionVars({ accent: T.accent }),
        display: "flex",
        alignItems: "center",
        gap: sp(5),
        padding: sp("4px 8px 5px"),
        background: isActive ? T.bg2 : "transparent",
        borderTop: isActive
          ? `2px solid ${T.accent}`
          : "2px solid transparent",
        borderLeft:
          dropSide === "before"
            ? `3px solid ${T.accent}`
            : `1px solid ${isActive ? T.border : "transparent"}`,
        borderRight:
          dropSide === "after"
            ? `3px solid ${T.accent}`
            : `1px solid ${isActive ? T.border : "transparent"}`,
        borderTopLeftRadius: dim(4),
        borderTopRightRadius: dim(4),
        cursor: dragging ? "grabbing" : "grab",
        flexShrink: 0,
        opacity: dragging ? 0.62 : 1,
        position: "relative",
        top: 1,
        touchAction: "pan-x",
        userSelect: "none",
      }}
    >
      <MarketIdentityMark
        item={{ ticker, name: info?.name || ticker }}
        size={16}
        style={{ borderColor: isActive ? T.accent : T.border }}
      />
      <span
        style={{
          fontSize: fs(11),
          fontWeight: 400,
          fontFamily: T.sans,
          color: isActive ? T.text : T.textSec,
        }}
      >
        {ticker}
      </span>
      <span
        style={{
          fontSize: fs(9),
          fontFamily: T.sans,
          color: isActive ? "var(--ra-text-primary)" : "var(--ra-text-secondary)",
          fontVariantNumeric: "tabular-nums",
          fontWeight: 400,
        }}
      >
        {formatQuotePrice(info?.price)}
      </span>
      <span
        className="ra-trade-tab-pct"
        style={{
          fontSize: fs(9),
          fontFamily: T.sans,
          color:
            pos == null
              ? T.textDim
              : pos
                ? "var(--ra-pnl-positive)"
                : "var(--ra-pnl-negative)",
          fontVariantNumeric: "tabular-nums",
          fontWeight: 400,
        }}
      >
        {formatSignedPercent(info?.pct)}
      </span>
      {badges.map((badge) => (
        <span
          key={badge}
          style={{
            border: `1px solid ${T.border}`,
            color:
              badge === "ERR"
                ? T.red
                : badge === "SIG"
                  ? T.green
                  : badge === "FLOW"
                    ? T.cyan
                    : T.textDim,
            fontFamily: T.sans,
            fontSize: fs(7),
            fontWeight: 400,
            lineHeight: 1,
            padding: sp("2px 3px"),
          }}
        >
          {badge}
        </span>
      ))}
      {showClose ? (
        <AppTooltip content="Close"><button
          data-testid={`trade-tab-close-${ticker}`}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onClose?.(ticker);
          }}
          style={{
            background: "transparent",
            border: "none",
            color: T.textMuted,
            cursor: "pointer",
            fontSize: fs(11),
            padding: 0,
            lineHeight: 1,
            marginLeft: sp(2),
          }}
        >
          ×
        </button></AppTooltip>
      ) : null}
    </div></AppTooltip>
  );
};

// Browser-style horizontal tabs of recently-viewed tickers.
export const TickerTabStrip = ({
  recent,
  active,
  workspacesByTicker = {},
  onSelect,
  onClose,
  onAddNew,
  onReorder,
}) => {
  const dragRef = useRef(null);
  const dragTargetRef = useRef(null);
  const suppressClickRef = useRef(false);
  const [dragVisual, setDragVisual] = useState(null);

  const clearDrag = useCallback(() => {
    dragRef.current = null;
    dragTargetRef.current = null;
    setDragVisual(null);
  }, []);

  const handleTabPointerDown = useCallback((ticker, event) => {
    if (event.button != null && event.button !== 0) return;
    dragRef.current = {
      ticker,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
    setDragVisual({ ticker, overTicker: null, side: null, moved: false });
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }, []);

  const handleTabPointerMove = useCallback((ticker, event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    const moved =
      drag.moved ||
      Math.abs(event.clientX - drag.startX) > 4 ||
      Math.abs(event.clientY - drag.startY) > 4;
    drag.moved = moved;

    if (!moved) return;
    const tabElement = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest("[data-trade-tab-ticker]");
    const overTicker =
      tabElement?.getAttribute("data-trade-tab-ticker") || ticker;
    const rect =
      tabElement?.getBoundingClientRect?.() ||
      event.currentTarget.getBoundingClientRect();
    const side = event.clientX < rect.left + rect.width / 2 ? "before" : "after";
    const nextVisual = {
      ticker: drag.ticker,
      overTicker: overTicker === drag.ticker ? null : overTicker,
      side: overTicker === drag.ticker ? null : side,
      moved: true,
    };
    dragTargetRef.current = nextVisual;
    setDragVisual(nextVisual);
  }, []);

  const handleTabPointerUp = useCallback((event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);

    if (drag.moved) {
      suppressClickRef.current = true;
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
      const target = dragTargetRef.current;
      if (target?.overTicker && target.side) {
        onReorder?.(drag.ticker, target.overTicker, target.side);
      }
    }
    clearDrag();
  }, [clearDrag, onReorder]);

  const handleTabSelect = useCallback((ticker) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    onSelect(ticker);
  }, [onSelect]);

  return (
    <div
      data-testid="trade-tab-strip"
      style={{
        display: "flex",
        alignItems: "stretch",
        gap: sp(1),
        padding: sp("4px 6px 0"),
        background: T.bg1,
        borderBottom: `1px solid ${T.border}`,
        overflowX: "auto",
        flexShrink: 0,
      }}
    >
      {recent.map((ticker) => (
        <TickerTabStripItem
          key={ticker}
          ticker={ticker}
          active={active}
          workspace={workspacesByTicker[ticker]}
          showClose={recent.length > 1}
          dragging={dragVisual?.ticker === ticker && dragVisual.moved}
          dropSide={dragVisual?.overTicker === ticker ? dragVisual.side : null}
          onSelect={handleTabSelect}
          onClose={onClose}
          onPointerDown={handleTabPointerDown}
          onPointerMove={handleTabPointerMove}
          onPointerUp={handleTabPointerUp}
          onPointerCancel={clearDrag}
        />
      ))}
      <AppTooltip content="Add ticker"><button
        onClick={onAddNew}
        style={{
          background: "transparent",
          border: "none",
          color: T.textDim,
          cursor: "pointer",
          fontSize: fs(13),
          padding: sp("3px 8px"),
          fontWeight: 400,
          lineHeight: 1,
        }}
      >
        +
      </button></AppTooltip>
    </div>
  );
};

// One row showing ticker + price + key stats.
export const TradeTickerHeader = ({
  ticker,
  chainRows = [],
  expirationValue = "",
  chainStatus = "empty",
}) => {
  const fallback = useMemo(
    () => ensureTradeTickerInfo(ticker, ticker),
    [ticker],
  );
  const info = useRuntimeTickerSnapshot(ticker, fallback);
  const chainSnapshot = useTradeOptionChainSnapshot(ticker);
  const { chainRows: snapshotChainRows, chainStatus: snapshotChainStatus } =
    resolveTradeOptionChainSnapshot(chainSnapshot, expirationValue);
  const resolvedChainRows = chainRows.length ? chainRows : snapshotChainRows;
  const resolvedChainStatus =
    chainRows.length || chainStatus !== "empty"
      ? chainStatus
      : snapshotChainStatus;
  const pos = isFiniteNumber(info?.pct) ? info.pct >= 0 : null;
  const atmRow =
    (isFiniteNumber(info?.price)
      ? resolvedChainRows.reduce((closest, row) => {
          if (!closest) return row;
          return Math.abs(row.k - info.price) < Math.abs(closest.k - info.price)
            ? row
            : closest;
        }, null)
      : null) ||
    resolvedChainRows.find((row) => row.isAtm);
  const impMove =
    atmRow && isFiniteNumber(atmRow.cPrem) && isFiniteNumber(atmRow.pPrem)
      ? (atmRow.cPrem + atmRow.pPrem) * 0.85
      : null;
  const impPct =
    impMove != null && isFiniteNumber(info?.price) && info.price > 0
      ? (impMove / info.price) * 100
      : null;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: sp(16),
        background: T.bg2,
        border: `1px solid ${T.border}`,
        borderRadius: dim(6),
        padding: sp("8px 14px"),
        flexShrink: 0,
      }}
    >
      <MarketIdentityMark
        item={{ ticker, name: info?.name || ticker }}
        size={30}
        showMarketIcon
      />
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: sp(8),
          minWidth: 0,
        }}
      >
        <span
          style={{
            fontSize: fs(20),
            fontWeight: 400,
            fontFamily: T.sans,
            color: T.text,
            letterSpacing: 0,
          }}
        >
          {ticker}
        </span>
        <span
          style={{
            fontSize: fs(11),
            color: T.textDim,
            fontFamily: T.sans,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {info?.name || ticker}
        </span>
        <MarketIdentityChips
          item={{ ticker, name: info?.name || ticker }}
          compact
          maxChips={2}
          showExchange={false}
          showSector
        />
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: sp(8) }}>
        <span
          style={{
            fontSize: fs(22),
            fontWeight: 400,
            fontFamily: T.sans,
            color: T.text,
          }}
        >
          {formatQuotePrice(info?.price)}
        </span>
        <span
          style={{
            fontSize: fs(12),
            fontWeight: 400,
            fontFamily: T.sans,
            color: pos == null ? T.textDim : pos ? T.green : T.red,
          }}
        >
          {isFiniteNumber(info?.chg)
            ? `${info.chg >= 0 ? "▲ +" : "▼ -"}${Math.abs(info.chg).toFixed(2)}`
            : MISSING_VALUE}
        </span>
        <span
          style={{
            fontSize: fs(12),
            fontWeight: 400,
            fontFamily: T.sans,
            color: pos == null ? T.textDim : pos ? T.green : T.red,
          }}
        >
          {isFiniteNumber(info?.pct)
            ? `(${formatSignedPercent(info.pct)})`
            : MISSING_VALUE}
        </span>
      </div>
      <span style={{ flex: 1 }} />
      <div
        style={{
          display: "flex",
          gap: sp(14),
          fontSize: fs(10),
          fontFamily: T.sans,
        }}
      >
        <div>
          <span style={{ color: T.textMuted }}>VOL </span>
          <span style={{ color: T.text, fontWeight: 400 }}>
            {fmtQuoteVolume(info?.volume)}
          </span>
        </div>
        <div>
          <span style={{ color: T.textMuted }}>IV </span>
          <span style={{ color: T.text, fontWeight: 400 }}>
            {isFiniteNumber(info?.iv)
              ? `${(info.iv * 100).toFixed(1)}%`
              : MISSING_VALUE}
          </span>
        </div>
        <div>
          <span style={{ color: T.textMuted }}>IMP </span>
          <span
            style={{
              color: impMove != null ? T.cyan : T.textDim,
              fontWeight: 400,
            }}
          >
            {impMove != null ? `±${impMove.toFixed(2)}` : MISSING_VALUE}
          </span>{" "}
          <span style={{ color: T.textDim }}>
            {impPct != null ? `(${impPct.toFixed(2)}%)` : ""}
          </span>
        </div>
        <div>
          <span style={{ color: T.textMuted }}>ATM </span>
          <span style={{ color: T.accent, fontWeight: 400 }}>
            {atmRow?.k ?? getAtmStrikeFromPrice(info?.price) ?? MISSING_VALUE}
          </span>
        </div>
        <div>
          <span style={{ color: T.textMuted }}>CHAIN </span>
          <span
            style={{
              color: resolvedChainStatus === "live" ? T.accent : T.textDim,
              fontWeight: 400,
            }}
          >
            {resolvedChainStatus}
          </span>
        </div>
      </div>
    </div>
  );
};
