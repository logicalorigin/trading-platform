import {
  memo,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Bell,
  Briefcase,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  RadioTower,
  Shield,
  TrendingDown,
  TrendingUp,
  Zap,
} from "lucide-react";
import { useListOrders, useListPositions } from "@workspace/api-client-react";
import {
  CSS_COLOR,
  FONT_WEIGHTS,
  MISSING_VALUE,
  RADII,
  T,
  dim,
  fs,
  sp,
  textSize,
} from "../../lib/uiTokens.jsx";
import { AppTooltip } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAccountSummaryField } from "./live-streams";
import { useSignalMonitorSnapshot } from "./signalMonitorStore.js";
import {
  BROAD_MARKET_FLOW_STORE_KEY,
  useMarketFlowSnapshotForStoreKey,
} from "./marketFlowStore.js";
import { QUERY_DEFAULTS } from "./queryDefaults.js";

const WORKING_ORDER_STATUSES = new Set([
  "PendingSubmit",
  "PreSubmitted",
  "Submitted",
  "ApiPending",
  "PendingCancel",
  "Modified",
  "Working",
  "Accepted",
]);

const isWorkingOrder = (order) => {
  const status = String(order?.status || "").trim();
  return status ? WORKING_ORDER_STATUSES.has(status) : false;
};

const fmtPnlCurrency = (value, masked = false) => {
  if (masked) return "****";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return MISSING_VALUE;
  const abs = Math.abs(numeric);
  const sign = numeric > 0 ? "+" : numeric < 0 ? "−" : "";
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
};

const fmtPercent = (value, digits = 1) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return MISSING_VALUE;
  return `${numeric.toFixed(digits)}%`;
};

const pnlTone = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric === 0) return CSS_COLOR.textSec;
  return numeric > 0 ? CSS_COLOR.green : CSS_COLOR.red;
};

const cushionTone = (percent) => {
  const numeric = Number(percent);
  if (!Number.isFinite(numeric)) return CSS_COLOR.textSec;
  if (numeric >= 50) return CSS_COLOR.green;
  if (numeric >= 25) return CSS_COLOR.amber;
  return CSS_COLOR.red;
};

const usePulseOnIncrease = (count) => {
  const previousRef = useRef(count);
  const [pulseToken, setPulseToken] = useState(0);
  useEffect(() => {
    const numeric = Number(count) || 0;
    const previous = Number(previousRef.current) || 0;
    if (numeric > previous) {
      setPulseToken((current) => current + 1);
    }
    previousRef.current = numeric;
  }, [count]);
  return pulseToken;
};

const PulseChip = ({ icon: Icon, value, tone = CSS_COLOR.text, title, accent, onClick, pulseToken }) => {
  const interactive = typeof onClick === "function";
  const Tag = interactive ? "button" : "div";
  return (
    <AppTooltip content={title}>
      <Tag
        key={pulseToken ? `pulse-${pulseToken}` : undefined}
        type={interactive ? "button" : undefined}
        onClick={onClick}
        className={interactive ? "ra-interactive" : undefined}
        data-pulse-hit={pulseToken ? "1" : undefined}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: sp(3),
          minHeight: dim(22),
          padding: sp("0 6px"),
          background: "transparent",
          border: "none",
          borderRadius: dim(RADII.xs),
          color: tone,
          fontFamily: T.sans,
          fontVariantNumeric: "tabular-nums",
          fontWeight: FONT_WEIGHTS.medium,
          fontSize: textSize("body"),
          whiteSpace: "nowrap",
          cursor: interactive ? "pointer" : "default",
          transition: "background 0.12s ease, color 0.12s ease",
          animation: pulseToken ? "raPulseHit 0.45s ease-out" : undefined,
          transformOrigin: "center",
        }}
        onMouseEnter={(event) => {
          if (!interactive) return;
          event.currentTarget.style.background = CSS_COLOR.accentHoverBg;
        }}
        onMouseLeave={(event) => {
          if (!interactive) return;
          event.currentTarget.style.background = "transparent";
        }}
      >
        <Icon
          size={dim(13)}
          strokeWidth={2.2}
          color={accent || tone}
          aria-hidden="true"
          style={{ flex: "0 0 auto" }}
        />
        <span>{value}</span>
      </Tag>
    </AppTooltip>
  );
};

const PortfolioPulseZoneInner = ({
  accountId,
  mode,
  maskValues = false,
  brokerAuthenticated = false,
  watchlistsBusy,
  algoEvents,
  onAlertClick,
  onPositionsClick,
  onOrdersClick,
  onSignalsClick,
  onFlowClick,
  onAlgoClick,
  scrollersCollapsed = false,
  onToggleScrollers,
  enabled = true,
  vertical = false,
  compact = false,
  centerSlot = null,
}) => {
  const dayPnlMetric = useAccountSummaryField({
    accountId,
    mode,
    fieldName: "dayPnl",
    enabled,
  });
  const cushionMetric = useAccountSummaryField({
    accountId,
    mode,
    fieldName: "maintenanceMarginCushionPercent",
    enabled,
  });
  const brokerQueryEnabled = Boolean(enabled && brokerAuthenticated && accountId && mode);
  const positionsQuery = useListPositions(
    { accountId, mode },
    {
      query: {
        enabled: brokerQueryEnabled,
        ...QUERY_DEFAULTS,
        refetchInterval: false,
      },
    },
  );
  const ordersQuery = useListOrders(
    { accountId, mode },
    {
      query: {
        enabled: brokerQueryEnabled,
        ...QUERY_DEFAULTS,
        refetchInterval: false,
      },
    },
  );
  const dayPnlValue = dayPnlMetric && typeof dayPnlMetric === "object" ? dayPnlMetric.value : null;
  const cushionValue = cushionMetric && typeof cushionMetric === "object" ? cushionMetric.value : null;
  const dayPnlNumeric = Number(dayPnlValue);
  const positionsList = Array.isArray(positionsQuery?.data?.positions)
    ? positionsQuery.data.positions
    : [];
  const positionsCount = positionsList.length;
  const ordersList = Array.isArray(ordersQuery?.data?.orders) ? ordersQuery.data.orders : [];
  const workingOrdersCount = ordersList.filter(isWorkingOrder).length;
  const totalAlerts = watchlistsBusy?.totalAlerts || 0;
  const winAlerts = watchlistsBusy?.winAlerts || 0;
  const lossAlerts = watchlistsBusy?.lossAlerts || 0;
  const PnlIcon =
    !Number.isFinite(dayPnlNumeric) || dayPnlNumeric === 0
      ? TrendingUp
      : dayPnlNumeric > 0
        ? TrendingUp
        : TrendingDown;
  const alertTone =
    totalAlerts === 0 ? CSS_COLOR.textMuted : lossAlerts > winAlerts ? CSS_COLOR.red : CSS_COLOR.amber;
  const positionsTone = positionsCount > 0 ? CSS_COLOR.text : CSS_COLOR.textMuted;
  const ordersTone = workingOrdersCount > 0 ? CSS_COLOR.text : CSS_COLOR.textMuted;
  const signalSnapshot = useSignalMonitorSnapshot();
  const signalEventsCount = Array.isArray(signalSnapshot?.events)
    ? signalSnapshot.events.length
    : 0;
  const flowSnapshot = useMarketFlowSnapshotForStoreKey(BROAD_MARKET_FLOW_STORE_KEY);
  const flowEventsCount = Array.isArray(flowSnapshot?.flowEvents)
    ? flowSnapshot.flowEvents.length
    : 0;
  const algoEventsCount = Array.isArray(algoEvents) ? algoEvents.length : 0;
  const signalTone = signalEventsCount > 0 ? CSS_COLOR.accent : CSS_COLOR.textMuted;
  const flowTone = flowEventsCount > 0 ? CSS_COLOR.accent : CSS_COLOR.textMuted;
  const algoTone = algoEventsCount > 0 ? CSS_COLOR.accent : CSS_COLOR.textMuted;
  const liveEventsTotal = signalEventsCount + flowEventsCount + algoEventsCount;
  const signalPulse = usePulseOnIncrease(signalEventsCount);
  const flowPulse = usePulseOnIncrease(flowEventsCount);
  const algoPulse = usePulseOnIncrease(algoEventsCount);
  const alertPulse = usePulseOnIncrease(totalAlerts);
  return (
    <div
      data-testid="portfolio-pulse-zone"
      data-layout={vertical ? "vertical" : "horizontal"}
      className="ra-hide-scrollbar"
      style={
        vertical
          ? {
              display: "flex",
              flexDirection: "column",
              alignItems: "stretch",
              gap: sp(2),
              padding: sp(4),
              minWidth: 0,
              background: CSS_COLOR.bg0,
              overflow: "visible",
            }
          : {
              display: "flex",
              alignItems: "center",
              gap: sp(2),
              padding: sp("1px 8px"),
              minWidth: 0,
              background: CSS_COLOR.bg0,
              borderTop: `1px solid ${CSS_COLOR.borderLight}`,
              boxShadow: `0 1px 0 ${CSS_COLOR.border}`,
              flexShrink: 0,
              overflow: "hidden",
            }
      }
    >
      <PulseChip
        icon={PnlIcon}
        value={fmtPnlCurrency(dayPnlValue, maskValues)}
        tone={pnlTone(dayPnlValue)}
        title="Day P/L (realized + unrealized today)"
      />
      <span style={{ width: 1, alignSelf: "stretch", background: CSS_COLOR.borderLight, opacity: 0.6 }} aria-hidden="true" />
      <PulseChip
        icon={Briefcase}
        value={brokerQueryEnabled ? String(positionsCount) : MISSING_VALUE}
        tone={positionsTone}
        title={
          brokerQueryEnabled
            ? `${positionsCount} open position${positionsCount === 1 ? "" : "s"}`
            : "Positions (broker not connected)"
        }
        onClick={brokerQueryEnabled && positionsCount > 0 ? onPositionsClick : undefined}
      />
      <PulseChip
        icon={ClipboardList}
        value={brokerQueryEnabled ? String(workingOrdersCount) : MISSING_VALUE}
        tone={ordersTone}
        title={
          brokerQueryEnabled
            ? `${workingOrdersCount} working order${workingOrdersCount === 1 ? "" : "s"}`
            : "Working orders (broker not connected)"
        }
        onClick={brokerQueryEnabled && workingOrdersCount > 0 ? onOrdersClick : undefined}
      />
      <span style={{ width: 1, alignSelf: "stretch", background: CSS_COLOR.borderLight, opacity: 0.6 }} aria-hidden="true" />
      <PulseChip
        icon={Shield}
        value={fmtPercent(cushionValue, 0)}
        tone={cushionTone(cushionValue)}
        title="Maintenance margin cushion"
      />
      <span style={{ width: 1, alignSelf: "stretch", background: CSS_COLOR.borderLight, opacity: 0.6 }} aria-hidden="true" />
      <PulseChip
        icon={Bell}
        value={totalAlerts > 0 ? String(totalAlerts) : "0"}
        tone={alertTone}
        accent={alertTone}
        title={
          totalAlerts > 0
            ? `${totalAlerts} position alert${totalAlerts === 1 ? "" : "s"} firing (${winAlerts} win · ${lossAlerts} loss)`
            : "No position alerts"
        }
        onClick={onAlertClick}
        pulseToken={alertPulse}
      />
      {centerSlot && !vertical ? (
        <div
          style={{
            flex: "1 1 auto",
            minWidth: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
            margin: sp("0 6px"),
          }}
        >
          {centerSlot}
        </div>
      ) : (
        <div style={{ flex: "1 1 auto", minWidth: 0 }} aria-hidden="true" />
      )}
      {compact && !vertical ? (
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="ra-interactive"
              data-testid="portfolio-pulse-live-events-trigger"
              aria-label="Show live events"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: sp(3),
                minHeight: dim(22),
                padding: sp("0 6px"),
                background: "transparent",
                border: `1px solid ${CSS_COLOR.borderLight}`,
                borderRadius: dim(RADII.xs),
                color: liveEventsTotal > 0 ? CSS_COLOR.accent : CSS_COLOR.textMuted,
                fontFamily: T.sans,
                fontVariantNumeric: "tabular-nums",
                fontWeight: FONT_WEIGHTS.medium,
                fontSize: textSize("body"),
                whiteSpace: "nowrap",
                cursor: "pointer",
              }}
            >
              <ChevronDown size={dim(13)} strokeWidth={2.2} aria-hidden="true" />
              <span>{String(liveEventsTotal)} live</span>
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" sideOffset={8} style={{ width: "auto", padding: sp(2) }}>
            <div style={{ display: "flex", alignItems: "center", gap: sp(2) }}>
              <PulseChip
                icon={Zap}
                value={signalEventsCount > 0 ? String(signalEventsCount) : "0"}
                tone={signalTone}
                accent={signalTone}
                title={
                  signalEventsCount > 0
                    ? `${signalEventsCount} recent signal${signalEventsCount === 1 ? "" : "s"}`
                    : "No recent signals"
                }
                onClick={signalEventsCount > 0 ? onSignalsClick : undefined}
                pulseToken={signalPulse}
              />
              <PulseChip
                icon={Zap}
                value={flowEventsCount > 0 ? String(flowEventsCount) : "0"}
                tone={flowTone}
                accent={flowTone}
                title={
                  flowEventsCount > 0
                    ? `${flowEventsCount} unusual flow event${flowEventsCount === 1 ? "" : "s"}`
                    : "No flow alerts"
                }
                onClick={flowEventsCount > 0 ? onFlowClick : undefined}
                pulseToken={flowPulse}
              />
              <PulseChip
                icon={RadioTower}
                value={algoEventsCount > 0 ? String(algoEventsCount) : "0"}
                tone={algoTone}
                accent={algoTone}
                title={
                  algoEventsCount > 0
                    ? `${algoEventsCount} recent algo event${algoEventsCount === 1 ? "" : "s"}`
                    : "No algo events"
                }
                onClick={algoEventsCount > 0 ? onAlgoClick : undefined}
                pulseToken={algoPulse}
              />
            </div>
          </PopoverContent>
        </Popover>
      ) : (
        <>
          <PulseChip
            icon={Zap}
            value={signalEventsCount > 0 ? String(signalEventsCount) : "0"}
            tone={signalTone}
            accent={signalTone}
            title={
              signalEventsCount > 0
                ? `${signalEventsCount} recent signal${signalEventsCount === 1 ? "" : "s"} in tape`
                : "No recent signals"
            }
            onClick={signalEventsCount > 0 ? onSignalsClick : undefined}
            pulseToken={signalPulse}
          />
          <PulseChip
            icon={Zap}
            value={flowEventsCount > 0 ? String(flowEventsCount) : "0"}
            tone={flowTone}
            accent={flowTone}
            title={
              flowEventsCount > 0
                ? `${flowEventsCount} unusual flow event${flowEventsCount === 1 ? "" : "s"}`
                : "No flow alerts"
            }
            onClick={flowEventsCount > 0 ? onFlowClick : undefined}
            pulseToken={flowPulse}
          />
          <PulseChip
            icon={RadioTower}
            value={algoEventsCount > 0 ? String(algoEventsCount) : "0"}
            tone={algoTone}
            accent={algoTone}
            title={
              algoEventsCount > 0
                ? `${algoEventsCount} recent algo event${algoEventsCount === 1 ? "" : "s"}`
                : "No algo events"
            }
            onClick={algoEventsCount > 0 ? onAlgoClick : undefined}
            pulseToken={algoPulse}
          />
        </>
      )}
      {typeof onToggleScrollers === "function" ? (
        <AppTooltip
          content={
            scrollersCollapsed
              ? "Show live event scrollers"
              : "Hide live event scrollers to reclaim chart space"
          }
        >
          <button
            type="button"
            className="ra-interactive"
            onClick={onToggleScrollers}
            aria-label={scrollersCollapsed ? "Show live event scrollers" : "Hide live event scrollers"}
            aria-pressed={!scrollersCollapsed}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: dim(22),
              height: dim(22),
              padding: 0,
              marginLeft: sp(2),
              background: "transparent",
              border: `1px solid ${CSS_COLOR.borderLight}`,
              borderRadius: dim(RADII.xs),
              color: CSS_COLOR.textSec,
              cursor: "pointer",
              transition: "background 0.12s ease, color 0.12s ease, border-color 0.12s ease",
            }}
            onMouseEnter={(event) => {
              event.currentTarget.style.background = CSS_COLOR.accentHoverBg;
              event.currentTarget.style.color = CSS_COLOR.accent;
              event.currentTarget.style.borderColor = CSS_COLOR.accent;
            }}
            onMouseLeave={(event) => {
              event.currentTarget.style.background = "transparent";
              event.currentTarget.style.color = CSS_COLOR.textSec;
              event.currentTarget.style.borderColor = CSS_COLOR.borderLight;
            }}
          >
            {scrollersCollapsed ? (
              <ChevronDown size={dim(13)} strokeWidth={2.2} aria-hidden="true" />
            ) : (
              <ChevronUp size={dim(13)} strokeWidth={2.2} aria-hidden="true" />
            )}
          </button>
        </AppTooltip>
      ) : null}
    </div>
  );
};

export const PortfolioPulseZone = memo(PortfolioPulseZoneInner);
