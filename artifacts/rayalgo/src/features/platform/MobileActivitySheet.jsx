import { useMemo, useState } from "react";
import { BottomSheet } from "../../components/platform/BottomSheet.jsx";
import {
  DataUnavailableState,
  SeverityRail,
} from "../../components/platform/primitives.jsx";
import {
  fmtCompactNumber,
  formatOptionContractLabel,
  formatQuotePrice,
  formatRelativeTimeShort,
} from "../../lib/formatters";
import {
  FONT_WEIGHTS,
  RADII,
  MISSING_VALUE,
  T,
  dim,
  sp,
  textSize,
} from "../../lib/uiTokens.jsx";
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
      minHeight: dim(28),
      border: "none",
      borderRadius: dim(RADII.xs),
      background: active ? T.accentHoverBg : "transparent",
      color: active ? T.accent : T.textSec,
      cursor: "pointer",
      fontFamily: T.sans,
      fontSize: textSize("caption"),
      fontWeight: FONT_WEIGHTS.medium,
      boxShadow: active ? `inset 0 -1px 0 ${T.accent}` : "none",
      transition: "background 0.12s ease, color 0.12s ease, box-shadow 0.12s ease",
    }}
    onMouseEnter={(event) => {
      if (active) return;
      event.currentTarget.style.background = T.accentHoverBg;
      event.currentTarget.style.color = T.text;
    }}
    onMouseLeave={(event) => {
      if (active) return;
      event.currentTarget.style.background = "transparent";
      event.currentTarget.style.color = T.textSec;
    }}
  >
    {children}
  </button>
);

const ToneChip = ({ label, tone }) => (
  <span
    style={{
      minWidth: dim(34),
      display: "inline-flex",
      justifyContent: "center",
      color: tone,
      border: `1px solid ${tone}40`,
      background: `${tone}0f`,
      borderRadius: dim(RADII.xs),
      fontFamily: T.sans,
      fontSize: textSize("caption"),
      fontWeight: FONT_WEIGHTS.medium,
      lineHeight: 1,
      padding: sp("3px 4px"),
      whiteSpace: "nowrap",
    }}
  >
    {label}
  </span>
);

const ActivityRow = ({
  tone = T.textSec,
  toneLabel,
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
      minHeight: dim(38),
      display: "grid",
      gridTemplateColumns: "auto auto minmax(0, 1fr) auto",
      alignItems: "center",
      gap: sp(6),
      padding: sp("6px 7px"),
      border: `1px solid ${T.borderLight}`,
      borderRadius: dim(RADII.xs),
      background: T.bg1,
      color: T.text,
      textAlign: "left",
      cursor: onClick ? "pointer" : "default",
      fontFamily: T.sans,
      transition: "background 0.12s ease, border-color 0.12s ease",
    }}
    onMouseEnter={(event) => {
      if (!onClick) return;
      event.currentTarget.style.background = `${tone}10`;
      event.currentTarget.style.borderColor = `${tone}40`;
    }}
    onMouseLeave={(event) => {
      event.currentTarget.style.background = T.bg1;
      event.currentTarget.style.borderColor = T.borderLight;
    }}
  >
    <SeverityRail tone={tone} />
    <ToneChip label={toneLabel} tone={tone} />
    <span style={{ minWidth: 0 }}>
      <span
        style={{
          display: "block",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          fontFamily: T.sans,
          fontSize: textSize("caption"),
          fontWeight: FONT_WEIGHTS.medium,
          lineHeight: 1.15,
        }}
      >
        {title}
      </span>
      <span
        style={{
          display: "block",
          marginTop: sp(3),
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          color: T.textDim,
          fontSize: textSize("caption"),
          lineHeight: 1.15,
        }}
      >
        {detail || MISSING_VALUE}
      </span>
    </span>
    <span
      style={{
        color: T.textMuted,
        fontFamily: T.sans,
        fontSize: textSize("caption"),
        fontWeight: FONT_WEIGHTS.medium,
        whiteSpace: "nowrap",
      }}
    >
      {meta || MISSING_VALUE}
    </span>
  </button>
);

const EmptyState = ({ title, detail }) => (
  <DataUnavailableState title={title} detail={detail} minHeight={96} />
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
          gap: sp(7),
          padding: sp("8px 8px max(12px, env(safe-area-inset-bottom))"),
          background: T.bg0,
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
            gap: sp(3),
            padding: sp(2),
            borderBottom: `1px solid ${T.borderLight}`,
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

        <div style={{ display: "grid", gap: sp(3), minWidth: 0 }}>
          {tab === "signals" ? (
            signalItems.length ? (
              signalItems.map((item) => {
                const tone = item.direction === "sell" ? T.red : T.green;
                return (
                  <ActivityRow
                    key={item.id}
                    testId="mobile-activity-signal-row"
                    tone={tone}
                    toneLabel={item.direction === "sell" ? "SELL" : "BUY"}
                    title={`${item.directionLabel} ${item.symbol}`}
                    detail={`${item.timeframe || MISSING_VALUE} · ${formatQuotePrice(item.price)}`}
                    meta={formatRelativeTimeShort(item.time)}
                    onClick={() => onSignalAction?.(item.symbol, item.raw)}
                  />
                );
              })
            ) : (
              <EmptyState
                title="No signal events"
                detail="Monitor results will appear here after the next scan."
              />
            )
          ) : null}

          {tab === "flow" ? (
            flowItems.length ? (
              flowItems.map((item) => {
                const isPut =
                  item.right === "P" ||
                  String(item.sentiment || "").toLowerCase() === "bearish";
                const isCall =
                  item.right === "C" ||
                  String(item.sentiment || "").toLowerCase() === "bullish";
                const tone = isPut ? T.red : isCall ? T.green : T.amber;
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
                    toneLabel={isPut ? "PUT" : isCall ? "CALL" : "FLOW"}
                    title={`${item.symbol} ${contractLabel || "FLOW"}`}
                    detail={`${fmtCompactCurrency(item.premium)} · ${scoreLabel} · ${fmtCompactNumber(item.size)}`}
                    meta={formatRelativeTimeShort(item.time)}
                    onClick={() => onFlowAction?.(item.raw)}
                  />
                );
              })
            ) : (
              <EmptyState
                title="No unusual flow"
                detail="Options prints meeting the selected threshold will appear here."
              />
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
                    toneLabel={item.tone === "profit" ? "WIN" : "RISK"}
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
              <EmptyState
                title="No notifications"
                detail="Portfolio alerts, headlines, and calendar items will appear here."
              />
            )
          ) : null}
        </div>
      </div>
    </BottomSheet>
  );
};

export default MobileActivitySheet;
