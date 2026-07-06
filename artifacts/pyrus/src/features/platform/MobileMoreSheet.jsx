import {
  Activity,
  Bot,
  ChartCandlestick,
  FlaskConical,
  Gauge,
  List,
  Search,
  Settings,
  SlidersHorizontal,
  Tv,
} from "lucide-react";
import { BottomSheet } from "../../components/platform/BottomSheet.jsx";
import { StatTile } from "../../components/platform/primitives.jsx";
import {
  CSS_COLOR,
  cssColorMix,
  FONT_WEIGHTS,
  MISSING_VALUE,
  RADII,
  T,
  dim,
  sp,
  textSize,
} from "../../lib/uiTokens.jsx";
import { FooterMemoryPressureIndicator } from "./FooterMemoryPressureIndicator.jsx";
import { SCREENS } from "./screenRegistry.jsx";
import { SEMANTIC_TONE } from "./semanticToneModel.js";

const SECONDARY_SCREEN_IDS = new Set([
  "flow",
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
  algo: Bot,
  backtest: ChartCandlestick,
  diagnostics: Gauge,
  settings: Settings,
};

const ActionButton = ({ Icon, label, detail, onClick, testId }) => (
  <button
    type="button"
    data-testid={testId}
    onClick={onClick}
    className="ra-hover-accent-bgbd"
    style={{
      minHeight: dim(44),
      display: "grid",
      gridTemplateColumns: `${dim(22)}px minmax(0, 1fr)`,
      alignItems: "center",
      gap: sp(7),
      padding: sp("6px 7px"),
      border: `1px solid ${CSS_COLOR.borderLight}`,
      borderRadius: dim(RADII.xs),
      background: CSS_COLOR.bg1,
      color: CSS_COLOR.text,
      textAlign: "left",
      cursor: "pointer",
      fontFamily: T.sans,
      transition: "background var(--ra-motion-fast) ease, border-color var(--ra-motion-fast) ease",
    }}
  >
    <Icon size={16} strokeWidth={2.1} style={{ color: CSS_COLOR.accent }} />
    <span style={{ minWidth: 0 }}>
      <span
        style={{
          display: "block",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          fontSize: textSize("caption"),
          fontWeight: FONT_WEIGHTS.medium,
          lineHeight: 1.1,
        }}
      >
        {label}
      </span>
      {detail ? (
        <span
          style={{
            display: "block",
            marginTop: sp(2),
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            color: CSS_COLOR.textDim,
            fontFamily: T.sans,
            fontSize: textSize("caption"),
            lineHeight: 1.1,
          }}
        >
          {detail}
        </span>
      ) : null}
    </span>
  </button>
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
  apiSourcePressureSnapshot,
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
          background: CSS_COLOR.bg0,
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
                  minHeight: dim(44),
                  display: "flex",
                  alignItems: "center",
                  gap: sp(7),
                  padding: sp("0 7px"),
                  border: `1px solid ${active ? `${cssColorMix(CSS_COLOR.accent, 25)}` : CSS_COLOR.borderLight}`,
                  borderRadius: dim(RADII.xs),
                  background: active ? CSS_COLOR.accentHoverBg : CSS_COLOR.bg1,
                  color: active ? CSS_COLOR.accent : CSS_COLOR.textSec,
                  cursor: "pointer",
                  fontFamily: T.sans,
                  fontSize: textSize("caption"),
                  fontWeight: FONT_WEIGHTS.medium,
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
          <StatTile
            label="WL"
            value={(activeWatchlist?.name || "Core").toUpperCase()}
            tone={CSS_COLOR.textSec}
            minWidth={0}
          />
          <StatTile
            label="SYM"
            value={selectedSymbol || MISSING_VALUE}
            tone={CSS_COLOR.text}
            minWidth={0}
          />
          <StatTile
            label="IBKR"
            value={session?.configured?.ibkr ? "READY" : "OFF"}
            tone={
              session?.configured?.ibkr
                ? SEMANTIC_TONE.operationalGood
                : SEMANTIC_TONE.operationalAttention
            }
            minWidth={0}
          />
          <StatTile
            label="HIST"
            value={String(historicalProvider).toUpperCase()}
            tone={session?.configured?.ibkr ? CSS_COLOR.green : CSS_COLOR.textDim}
            minWidth={0}
          />
          <StatTile
            label="RSCH"
            value={String(researchProvider).toUpperCase()}
            tone={session?.configured?.research ? CSS_COLOR.green : CSS_COLOR.textDim}
            minWidth={0}
          />
          <StatTile
            label="APP"
            value="v0.1.0"
            tone={CSS_COLOR.textSec}
            minWidth={0}
          />
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
            Icon={Bot}
            label="Algo Monitor"
            detail="Deployments, P&L, positions"
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
          <span
            style={{
              display: "inline-flex",
              minWidth: 0,
              alignItems: "center",
              gap: sp(6),
              overflow: "hidden",
            }}
          >
            <FooterMemoryPressureIndicator
              signal={memoryPressureSignal}
              runtimeControl={apiSourcePressureSnapshot}
            />
          </span>
          <FlaskConical
            aria-hidden="true"
            size={14}
            strokeWidth={2}
            style={{ color: CSS_COLOR.textMuted, flexShrink: 0 }}
          />
        </div>
      </div>
    </BottomSheet>
  );
};

export default MobileMoreSheet;
