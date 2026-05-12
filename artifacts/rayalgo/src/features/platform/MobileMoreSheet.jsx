import {
  Activity,
  ChartCandlestick,
  FlaskConical,
  Gauge,
  List,
  RadioTower,
  Search,
  Settings,
  SlidersHorizontal,
  Tv,
} from "lucide-react";
import { BottomSheet } from "../../components/platform/BottomSheet.jsx";
import { MISSING_VALUE, T, dim, fs, sp } from "../../lib/uiTokens.jsx";
import { FooterMemoryPressureIndicator } from "./FooterMemoryPressureIndicator.jsx";
import { SCREENS } from "./screenRegistry.jsx";

const SECONDARY_SCREEN_IDS = new Set([
  "gex",
  "research",
  "algo",
  "backtest",
  "diagnostics",
  "settings",
]);

const SCREEN_ICON_COMPONENTS = {
  gex: Activity,
  research: Search,
  algo: RadioTower,
  backtest: ChartCandlestick,
  diagnostics: Gauge,
  settings: Settings,
};

const ActionButton = ({ Icon, label, detail, onClick, testId }) => (
  <button
    type="button"
    data-testid={testId}
    onClick={onClick}
    style={{
      minHeight: dim(48),
      display: "grid",
      gridTemplateColumns: `${dim(24)}px minmax(0, 1fr)`,
      alignItems: "center",
      gap: sp(8),
      padding: sp("7px 9px"),
      border: `1px solid ${T.border}`,
      background: T.bg1,
      color: T.text,
      textAlign: "left",
      cursor: "pointer",
      fontFamily: T.sans,
    }}
  >
    <Icon size={16} strokeWidth={2.1} style={{ color: T.accent }} />
    <span style={{ minWidth: 0 }}>
      <span
        style={{
          display: "block",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          fontSize: fs(11),
          lineHeight: 1.1,
        }}
      >
        {label}
      </span>
      {detail ? (
        <span
          style={{
            display: "block",
            marginTop: 2,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            color: T.textDim,
            fontFamily: T.mono,
            fontSize: fs(8),
            lineHeight: 1.1,
          }}
        >
          {detail}
        </span>
      ) : null}
    </span>
  </button>
);

const StatusChip = ({ label, value, tone = T.textSec }) => (
  <div
    style={{
      minWidth: 0,
      padding: sp("5px 7px"),
      border: `1px solid ${T.border}`,
      background: T.bg1,
      fontFamily: T.mono,
    }}
  >
    <div
      style={{
        color: T.textMuted,
        fontSize: fs(7),
        lineHeight: 1.05,
        letterSpacing: "0.04em",
      }}
    >
      {label}
    </div>
    <div
      style={{
        marginTop: 2,
        color: tone,
        fontSize: fs(9),
        lineHeight: 1.1,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}
    >
      {value || MISSING_VALUE}
    </div>
  </div>
);

export const MobileMoreSheet = ({
  open,
  onClose,
  activeScreen,
  setScreen,
  onOpenWatchlist,
  onOpenActivity,
  onOpenBloomberg,
  activeWatchlist,
  selectedSymbol,
  session,
  memoryPressureSignal,
}) => {
  const secondaryScreens = SCREENS.filter((screen) =>
    SECONDARY_SCREEN_IDS.has(screen.id),
  );
  const historicalProvider =
    session?.marketDataProviders?.historical || MISSING_VALUE;
  const researchProvider =
    session?.marketDataProviders?.research || MISSING_VALUE;

  const handleScreenSelect = (screenId) => {
    setScreen?.(screenId);
    onClose?.();
  };

  const handleAction = (action) => {
    onClose?.();
    action?.();
  };

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="More"
      testId="mobile-more-sheet"
      maxHeight="84dvh"
    >
      <div
        style={{
          display: "grid",
          gap: sp(10),
          padding: sp("10px 10px max(14px, env(safe-area-inset-bottom))"),
          background: T.bg0,
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
            gap: sp(6),
          }}
        >
          {secondaryScreens.map((screen) => {
            const Icon = SCREEN_ICON_COMPONENTS[screen.id] || SlidersHorizontal;
            const active = activeScreen === screen.id;
            return (
              <button
                key={screen.id}
                type="button"
                data-testid={`mobile-more-screen-${screen.id}`}
                aria-current={active ? "page" : undefined}
                onClick={() => handleScreenSelect(screen.id)}
                style={{
                  minHeight: dim(46),
                  display: "flex",
                  alignItems: "center",
                  gap: sp(8),
                  padding: sp("0 9px"),
                  border: `1px solid ${active ? T.accent : T.border}`,
                  background: active ? `${T.accent}18` : T.bg1,
                  color: active ? T.text : T.textSec,
                  cursor: "pointer",
                  fontFamily: T.sans,
                  fontSize: fs(11),
                  textAlign: "left",
                }}
              >
                <Icon size={15} strokeWidth={2.1} />
                <span
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {screen.label}
                </span>
              </button>
            );
          })}
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
            gap: sp(5),
          }}
        >
          <StatusChip
            label="WL"
            value={(activeWatchlist?.name || "Core").toUpperCase()}
          />
          <StatusChip label="SYM" value={selectedSymbol} tone={T.text} />
          <StatusChip
            label="IBKR"
            value={session?.configured?.ibkr ? "READY" : "OFF"}
            tone={session?.configured?.ibkr ? T.green : T.red}
          />
          <StatusChip
            label="HIST"
            value={String(historicalProvider).toUpperCase()}
            tone={session?.configured?.ibkr ? T.green : T.textDim}
          />
          <StatusChip
            label="RSCH"
            value={String(researchProvider).toUpperCase()}
            tone={session?.configured?.research ? T.green : T.textDim}
          />
          <StatusChip label="APP" value="v0.1.0" />
        </div>

        <div
          style={{
            display: "grid",
            gap: sp(6),
          }}
        >
          <ActionButton
            Icon={List}
            label="Watchlist"
            detail={activeWatchlist?.name || "Open symbols"}
            onClick={() => handleAction(onOpenWatchlist)}
            testId="mobile-more-watchlist"
          />
          <ActionButton
            Icon={Activity}
            label="Activity & Notifications"
            detail="Signals, flow, alerts"
            onClick={() => handleAction(onOpenActivity)}
            testId="mobile-more-activity"
          />
          <ActionButton
            Icon={Tv}
            label="Bloomberg Live"
            detail="Open floating video"
            onClick={() => handleAction(onOpenBloomberg)}
            testId="mobile-more-bloomberg"
          />
        </div>

        <div
          style={{
            display: "flex",
            minWidth: 0,
            alignItems: "center",
            justifyContent: "space-between",
            gap: sp(8),
            paddingTop: sp(2),
          }}
        >
          <FooterMemoryPressureIndicator signal={memoryPressureSignal} />
          <FlaskConical
            size={14}
            strokeWidth={2}
            style={{ color: T.textMuted, flexShrink: 0 }}
          />
        </div>
      </div>
    </BottomSheet>
  );
};

export default MobileMoreSheet;
