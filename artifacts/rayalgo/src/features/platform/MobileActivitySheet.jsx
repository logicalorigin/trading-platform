import { useMemo, useState } from "react";
import { BottomSheet } from "../../components/platform/BottomSheet.jsx";
import {
  fmtCompactNumber,
  formatOptionContractLabel,
  formatQuotePrice,
  formatRelativeTimeShort,
} from "../../lib/formatters";
import { MISSING_VALUE, T, dim, fs, sp } from "../../lib/uiTokens.jsx";
import {
  buildHeaderSignalTapeItems,
  buildHeaderUnusualTapeItems,
} from "./headerBroadcastModel";
import { useMarketAlertsSnapshot } from "./marketAlertsStore";
import {
  BROAD_MARKET_FLOW_STORE_KEY,
  useMarketFlowSnapshotForStoreKey,
} from "./marketFlowStore";
import { useSignalMonitorSnapshot } from "./signalMonitorStore";

const fmtCompactCurrency = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return MISSING_VALUE;
  if (Math.abs(numeric) >= 1e6) return `$${(numeric / 1e6).toFixed(2)}M`;
  if (Math.abs(numeric) >= 1e3) return `$${(numeric / 1e3).toFixed(1)}K`;
  return `$${numeric.toFixed(0)}`;
};

const SegmentButton = ({ active, children, onClick, testId }) => (
  <button
    type="button"
    data-testid={testId}
    aria-pressed={active}
    onClick={onClick}
    style={{
      minHeight: dim(34),
      border: `1px solid ${active ? T.accent : T.border}`,
      background: active ? `${T.accent}18` : T.bg1,
      color: active ? T.text : T.textDim,
      cursor: "pointer",
      fontFamily: T.mono,
      fontSize: fs(9),
    }}
  >
    {children}
  </button>
);

const ActivityRow = ({
  tone = T.textSec,
  title,
  detail,
  meta,
  onClick,
  testId,
}) => (
  <button
    type="button"
    data-testid={testId}
    onClick={onClick}
    disabled={!onClick}
    style={{
      minHeight: dim(44),
      display: "grid",
      gridTemplateColumns: "minmax(0, 1fr) auto",
      alignItems: "center",
      gap: sp(8),
      padding: sp("6px 8px"),
      border: "none",
      borderLeft: `3px solid ${tone}`,
      borderBottom: `1px solid ${T.border}22`,
      background: `${tone}0d`,
      color: T.text,
      textAlign: "left",
      cursor: onClick ? "pointer" : "default",
      fontFamily: T.sans,
    }}
  >
    <span style={{ minWidth: 0 }}>
      <span
        style={{
          display: "block",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          fontFamily: T.mono,
          fontSize: fs(11),
          lineHeight: 1.1,
        }}
      >
        {title}
      </span>
      <span
        style={{
          display: "block",
          marginTop: 3,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          color: T.textDim,
          fontSize: fs(9),
          lineHeight: 1.1,
        }}
      >
        {detail || MISSING_VALUE}
      </span>
    </span>
    <span
      style={{
        color: T.textMuted,
        fontFamily: T.mono,
        fontSize: fs(8),
        whiteSpace: "nowrap",
      }}
    >
      {meta || MISSING_VALUE}
    </span>
  </button>
);

const EmptyState = ({ children }) => (
  <div
    style={{
      minHeight: dim(128),
      display: "grid",
      placeItems: "center",
      padding: sp(16),
      color: T.textDim,
      fontFamily: T.sans,
      fontSize: fs(10),
      textAlign: "center",
      border: `1px solid ${T.border}`,
      background: T.bg1,
    }}
  >
    {children}
  </div>
);

export const MobileActivitySheet = ({
  open,
  onClose,
  onSignalAction,
  onFlowAction,
  onSelectSymbol,
}) => {
  const [tab, setTab] = useState("signals");
  const signalSnapshot = useSignalMonitorSnapshot({ subscribeToUpdates: open });
  const flowSnapshot = useMarketFlowSnapshotForStoreKey(BROAD_MARKET_FLOW_STORE_KEY, {
    subscribe: open,
  });
  const marketAlerts = useMarketAlertsSnapshot({ subscribeToUpdates: open });

  const signalItems = useMemo(
    () => buildHeaderSignalTapeItems(signalSnapshot, { maxItems: 32 }),
    [signalSnapshot],
  );
  const flowItems = useMemo(
    () =>
      buildHeaderUnusualTapeItems(
        (flowSnapshot?.flowEvents || []).filter((event) => event?.isUnusual),
        { maxItems: 32 },
      ),
    [flowSnapshot?.flowEvents],
  );
  const notificationItems = marketAlerts?.items || [];

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Activity & Notifications"
      testId="mobile-activity-sheet"
      maxHeight="84dvh"
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: sp(8),
          padding: sp("10px 10px max(14px, env(safe-area-inset-bottom))"),
          background: T.bg0,
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
            gap: sp(4),
          }}
        >
          <SegmentButton
            active={tab === "signals"}
            onClick={() => setTab("signals")}
            testId="mobile-activity-tab-signals"
          >
            SIG {signalItems.length}
          </SegmentButton>
          <SegmentButton
            active={tab === "flow"}
            onClick={() => setTab("flow")}
            testId="mobile-activity-tab-flow"
          >
            FLOW {flowItems.length}
          </SegmentButton>
          <SegmentButton
            active={tab === "notifications"}
            onClick={() => setTab("notifications")}
            testId="mobile-activity-tab-notifications"
          >
            NOTIF {notificationItems.length}
          </SegmentButton>
        </div>

        <div style={{ display: "grid", gap: sp(3) }}>
          {tab === "signals" ? (
            signalItems.length ? (
              signalItems.map((item) => {
                const tone = item.direction === "sell" ? T.red : T.green;
                return (
                  <ActivityRow
                    key={item.id}
                    testId="mobile-activity-signal-row"
                    tone={tone}
                    title={`${item.directionLabel} ${item.symbol}`}
                    detail={`${item.timeframe || MISSING_VALUE} · ${formatQuotePrice(item.price)}`}
                    meta={formatRelativeTimeShort(item.time)}
                    onClick={() => onSignalAction?.(item.symbol, item.raw)}
                  />
                );
              })
            ) : (
              <EmptyState>No signal events are available yet.</EmptyState>
            )
          ) : null}

          {tab === "flow" ? (
            flowItems.length ? (
              flowItems.map((item) => {
                const isPut =
                  item.right === "P" ||
                  String(item.sentiment || "").toLowerCase() === "bearish";
                const tone = isPut ? T.red : T.green;
                const contractLabel =
                  formatOptionContractLabel(item, {
                    includeSymbol: false,
                    fallback: "",
                  }) ||
                  String(item.contract || "").replace(
                    new RegExp(`^${item.symbol}\\s+`, "i"),
                    "",
                  );
                const scoreLabel = item.score
                  ? `${item.score.toFixed(item.score >= 10 ? 0 : 1)}x`
                  : MISSING_VALUE;
                return (
                  <ActivityRow
                    key={item.id}
                    testId="mobile-activity-flow-row"
                    tone={tone}
                    title={`${item.symbol} ${contractLabel || "FLOW"}`}
                    detail={`${fmtCompactCurrency(item.premium)} · ${scoreLabel} · ${fmtCompactNumber(item.size)}`}
                    meta={formatRelativeTimeShort(item.time)}
                    onClick={() => onFlowAction?.(item.raw)}
                  />
                );
              })
            ) : (
              <EmptyState>No unusual flow is available yet.</EmptyState>
            )
          ) : null}

          {tab === "notifications" ? (
            notificationItems.length ? (
              notificationItems.map((item) => {
                const tone = item.tone === "profit" ? T.green : T.red;
                return (
                  <ActivityRow
                    key={item.id || `${item.symbol}-${item.label}`}
                    testId="mobile-activity-notification-row"
                    tone={tone}
                    title={item.label || "Portfolio alert"}
                    detail={item.detail || item.symbol || MISSING_VALUE}
                    meta={item.tone === "profit" ? "WIN" : "RISK"}
                    onClick={
                      item.symbol ? () => onSelectSymbol?.(item.symbol) : undefined
                    }
                  />
                );
              })
            ) : (
              <EmptyState>No notifications are available yet.</EmptyState>
            )
          ) : null}
        </div>
      </div>
    </BottomSheet>
  );
};

export default MobileActivitySheet;
