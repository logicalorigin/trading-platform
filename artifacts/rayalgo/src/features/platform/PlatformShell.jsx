import {
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  Activity,
  ChartCandlestick,
  Ellipsis,
  LineChart,
  List,
  Tv,
  WalletCards,
} from "lucide-react";
import { ELEVATION, FONT_WEIGHTS, MISSING_VALUE, RADII, T, dim, fs, sp, textSize } from "../../lib/uiTokens.jsx";
import { joinMotionClasses, motionVars } from "../../lib/motion.jsx";
import { MobileActivitySheet } from "./MobileActivitySheet.jsx";
import { MobileMoreSheet } from "./MobileMoreSheet.jsx";
import { MobileWatchlistDrawer } from "./MobileWatchlistDrawer.jsx";
import {
  SCREENS,
  SCREEN_RENDER_POLICIES,
  ScreenLoadingFallback,
} from "./screenRegistry.jsx";
import { useViewport } from "../../lib/responsive";
import { FooterMemoryPressureIndicator } from "./FooterMemoryPressureIndicator.jsx";
import { AppTooltip } from "@/components/ui/tooltip";
import { lazyWithRetry } from "../../lib/dynamicImport";
import {
  markScreenReady,
  markScreenSwitchStart,
} from "./performanceMetrics";


const TRANSIENT_SCREEN_IDS = new Set(["diagnostics", "settings"]);
const MOBILE_PRIMARY_SCREEN_IDS = ["market", "flow", "trade", "account"];
const MOBILE_PRIMARY_SCREEN_SET = new Set(MOBILE_PRIMARY_SCREEN_IDS);
const MOBILE_NAV_ICONS = {
  market: LineChart,
  flow: Activity,
  trade: ChartCandlestick,
  account: WalletCards,
};
const BloombergLiveDock = lazyWithRetry(
  () => import("./BloombergLiveDock"),
  { label: "BloombergLiveDock" },
);

const ScreenReadyProbe = ({ screenId, active }) => {
  useEffect(() => {
    if (!active) return undefined;
    if (
      typeof window === "undefined" ||
      typeof window.requestAnimationFrame !== "function"
    ) {
      markScreenReady(screenId);
      return undefined;
    }
    const frameId = window.requestAnimationFrame(() => {
      markScreenReady(screenId);
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [active, screenId]);

  return null;
};

const BloombergLiveDockLauncher = () => {
  const [mounted, setMounted] = useState(false);

  if (mounted) {
    return (
      <Suspense fallback={null}>
        <BloombergLiveDock initialOpen />
      </Suspense>
    );
  }

  return (
    <div
      style={{
        position: "fixed",
        right: sp(14),
        bottom: sp(34),
        zIndex: 10020,
      }}
    >
      <AppTooltip content="Open Bloomberg Live">
        <button
          type="button"
          onClick={() => setMounted(true)}
          aria-label="Open Bloomberg Live"
          style={{
            width: dim(36),
            height: dim(36),
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            border: "none",
            borderRadius: dim(RADII.pill),
            background: T.accent,
            boxShadow: ELEVATION.lg,
            color: T.onAccent,
            cursor: "pointer",
          }}
        >
          <Tv size={dim(16)} />
        </button>
      </AppTooltip>
    </div>
  );
};

const fmtCompactCurrency = (value, masked = false) => {
  if (masked) return "****";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return MISSING_VALUE;
  if (Math.abs(numeric) >= 1e6) return `$${(numeric / 1e6).toFixed(2)}M`;
  if (Math.abs(numeric) >= 1e3) return `$${(numeric / 1e3).toFixed(1)}K`;
  return `$${numeric.toFixed(0)}`;
};

const MobileHeaderChip = ({ label, value, tone = T.text }) => (
  <span
    className="ra-header-chip"
    style={{
      minWidth: 0,
      flexShrink: 0,
      display: "inline-flex",
      alignItems: "baseline",
      gap: sp(3),
      paddingRight: sp(8),
      marginRight: sp(1),
      borderRight: `1px solid ${T.borderLight}`,
      color: tone,
      fontFamily: T.sans,
      fontSize: textSize("caption"),
      fontWeight: FONT_WEIGHTS.label,
      whiteSpace: "nowrap",
      overflow: "hidden",
      letterSpacing: 0,
    }}
  >
    <span
      style={{
        color: T.textMuted,
        fontSize: textSize("micro"),
        fontWeight: FONT_WEIGHTS.medium,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
      }}
    >
      {label}
    </span>
    <span
      style={{
        minWidth: 0,
        overflow: "hidden",
        textOverflow: "ellipsis",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {value || MISSING_VALUE}
    </span>
  </span>
);

const MobileIconButton = ({ Icon, label, onClick, testId, active = false }) => (
  <AppTooltip content={label}>
    <button
      className="ra-interactive"
      data-testid={testId}
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      style={{
        width: dim(32),
        minWidth: dim(32),
        height: dim(32),
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        border: `1px solid ${active ? T.accent : T.border}`,
        background: active ? `${T.accent}18` : T.bg1,
        color: active ? T.accent : T.textSec,
        borderRadius: dim(RADII.pill),
        cursor: "pointer",
      }}
    >
      <Icon size={16} strokeWidth={2.2} />
    </button>
  </AppTooltip>
);

const MobileBottomNav = ({ activeScreen, setScreen, onOpenMore, watchlistsBusy }) => (
  <nav
    data-testid="mobile-bottom-nav"
    aria-label="Primary mobile navigation"
    style={{
      flexShrink: 0,
      display: "grid",
      gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
      gap: sp(2),
      padding: sp("4px 6px max(5px, env(safe-area-inset-bottom))"),
      background: T.bg1,
      borderTop: `1px solid ${T.border}`,
      minHeight: `calc(${dim(54)}px + env(safe-area-inset-bottom))`,
    }}
  >
    {MOBILE_PRIMARY_SCREEN_IDS.map((screenId) => {
      const screen = SCREENS.find((item) => item.id === screenId);
      const Icon = MOBILE_NAV_ICONS[screenId] || Activity;
      const active = activeScreen === screenId;
      const isTradeTab = screenId === "trade";
      const totalAlerts = watchlistsBusy?.totalAlerts || 0;
      const winAlerts = watchlistsBusy?.winAlerts || 0;
      const lossAlerts = watchlistsBusy?.lossAlerts || 0;
      const hasAlerts = isTradeTab && totalAlerts > 0;
      const alertColor = lossAlerts > winAlerts ? T.red : T.amber;
      return (
        <button
          key={screenId}
          type="button"
          data-testid={`mobile-bottom-nav-${screenId}`}
          aria-current={active ? "page" : undefined}
          onClick={() => setScreen(screenId)}
          className={joinMotionClasses("ra-interactive", active && "ra-focus-rail")}
          style={{
            ...motionVars({ accent: hasAlerts ? alertColor : T.accent }),
            minWidth: 0,
            minHeight: dim(46),
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: sp(2),
            border: `1px solid ${active ? T.accent : "transparent"}`,
            background: active ? `${T.accent}14` : "transparent",
            color: active ? T.accent : T.textDim,
            cursor: "pointer",
            fontFamily: T.sans,
            fontSize: textSize("caption"),
            position: "relative",
          }}
        >
          <Icon size={17} strokeWidth={2.1} />
          <span
            style={{
              maxWidth: "100%",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {screen?.label || screenId}
          </span>
          {hasAlerts ? (
            <span
              style={{
                position: "absolute",
                top: 3,
                right: "24%",
                minWidth: dim(15),
                height: dim(15),
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: dim(999),
                background: alertColor,
                color: T.onAccent,
                fontFamily: T.sans,
                fontSize: fs(7),
              }}
            >
              {totalAlerts}
            </span>
          ) : null}
        </button>
      );
    })}
    <button
      type="button"
      data-testid="mobile-bottom-nav-more"
      aria-current={!MOBILE_PRIMARY_SCREEN_SET.has(activeScreen) ? "page" : undefined}
      onClick={onOpenMore}
      className={joinMotionClasses(
        "ra-interactive",
        !MOBILE_PRIMARY_SCREEN_SET.has(activeScreen) && "ra-focus-rail",
      )}
      style={{
        ...motionVars({ accent: T.accent }),
        minWidth: 0,
        minHeight: dim(46),
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: sp(2),
        border: `1px solid ${
          !MOBILE_PRIMARY_SCREEN_SET.has(activeScreen) ? T.accent : "transparent"
        }`,
        background: !MOBILE_PRIMARY_SCREEN_SET.has(activeScreen)
          ? `${T.accent}14`
          : "transparent",
        color: !MOBILE_PRIMARY_SCREEN_SET.has(activeScreen) ? T.accent : T.textDim,
        cursor: "pointer",
        fontFamily: T.sans,
        fontSize: textSize("caption"),
      }}
    >
      <Ellipsis size={17} strokeWidth={2.1} />
      <span>More</span>
    </button>
  </nav>
);

const FooterField = ({ label, value, valueColor }) => (
  <span style={{ display: "inline-flex", alignItems: "baseline", gap: sp(6), minWidth: 0 }}>
    <span
      style={{
        color: T.textMuted,
        fontSize: textSize("caption"),
        fontWeight: FONT_WEIGHTS.medium,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
      }}
    >
      {label}
    </span>
    <span
      style={{
        color: valueColor || T.textSec,
        fontSize: textSize("body"),
        fontWeight: FONT_WEIGHTS.medium,
        fontVariantNumeric: "tabular-nums",
        letterSpacing: "-0.005em",
      }}
    >
      {value}
    </span>
  </span>
);

const FooterStatusField = ({ label, value, ok }) => (
  <span style={{ display: "inline-flex", alignItems: "center", gap: sp(6), minWidth: 0 }}>
    <span
      style={{
        width: dim(6),
        height: dim(6),
        borderRadius: dim(RADII.pill),
        background: ok ? T.green : T.red,
        flexShrink: 0,
      }}
    />
    <span
      style={{
        color: T.textMuted,
        fontSize: textSize("caption"),
        fontWeight: FONT_WEIGHTS.medium,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
      }}
    >
      {label}
    </span>
    <span
      style={{
        color: T.text,
        fontSize: textSize("body"),
        fontWeight: FONT_WEIGHTS.medium,
        letterSpacing: "-0.005em",
      }}
    >
      {value}
    </span>
  </span>
);

const FooterDivider = () => (
  <span
    aria-hidden="true"
    style={{
      width: 1,
      height: dim(14),
      background: T.border,
      flexShrink: 0,
    }}
  />
);

export const PlatformShell = ({
  activeScreen,
  mountedScreens,
  setScreen,
  renderScreenById,
  fontCss,
  toasts,
  onDismissToast,
  latencyDebugEnabled,
  LatencyDebugStripComponent,
  HeaderKpiStripComponent,
  HeaderAccountStripComponent,
  HeaderStatusClusterComponent,
  HeaderBroadcastScrollerStackComponent,
  WatchlistComponent,
  memoryPressureSignal,
  activeWatchlist,
  watchlistSymbols,
  signalMonitorStates,
  signalMatrixStates,
  selectedSymbol,
  sidebarCollapsed,
  setSidebarCollapsed,
  onSelectSymbol,
  onFocusMarketChart,
  onSelectWatchlist,
  onCreateWatchlist,
  onRenameWatchlist,
  onDeleteWatchlist,
  onSetDefaultWatchlist,
  onAddSymbolToWatchlist,
  onReorderSymbolInWatchlist,
  onRemoveSymbolFromWatchlist,
  onSignalAction,
  watchlists,
  watchlistsBusy,
  accounts,
  primaryAccountId,
  primaryAccount,
  onSelectAccount,
  maskAccountValues,
  session,
  environment,
  bridgeTone,
  theme,
  onToggleTheme,
  runtimeWatchlistSymbols,
  sessionMetadataSettled,
  onFlowAction,
  signalScanEnabled,
  signalScanPending,
  signalEvaluationPending,
  signalScanErrored,
  onToggleSignalScan,
}) => {
  const viewport = useViewport();
  const { isPhone, isNarrow } = viewport.flags;
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const [mobileActivityOpen, setMobileActivityOpen] = useState(false);
  const [mobileWatchlistOpen, setMobileWatchlistOpen] = useState(false);
  const [mobileBloombergMounted, setMobileBloombergMounted] = useState(false);
  const mobileAutoCollapseRef = useRef(false);
  const previousActiveScreenRef = useRef(activeScreen);
  const handleSetScreen = useCallback(
    (screenId) => {
      if (!screenId || screenId === activeScreen) {
        return;
      }
      markScreenSwitchStart(screenId, "navigation");
      setScreen(screenId);
    },
    [activeScreen, setScreen],
  );

  useLayoutEffect(() => {
    if (previousActiveScreenRef.current === activeScreen) {
      return;
    }
    previousActiveScreenRef.current = activeScreen;
    markScreenSwitchStart(activeScreen, "programmatic");
  }, [activeScreen]);

  useEffect(() => {
    if (!isPhone) {
      mobileAutoCollapseRef.current = false;
      setMobileMoreOpen(false);
      setMobileActivityOpen(false);
      setMobileWatchlistOpen(false);
      return;
    }

    if (mobileAutoCollapseRef.current) return;
    mobileAutoCollapseRef.current = true;
    if (!sidebarCollapsed) {
      setSidebarCollapsed(true);
    }
  }, [isPhone, setSidebarCollapsed, sidebarCollapsed]);
  const mobileSidebarWidth = Math.max(
    280,
    Math.min(viewport.width ? viewport.width - 28 : 320, 340),
  );
  const sidebarWidth = isPhone
    ? sidebarCollapsed
      ? 0
      : mobileSidebarWidth
    : sidebarCollapsed
      ? 40
      : 248;
  const headerGridTemplate = isPhone
    ? "minmax(0, 1fr)"
    : isNarrow
      ? "minmax(0, 1fr) auto"
      : "auto minmax(0, 1fr) auto";
  const compactAccountId = primaryAccountId || accounts?.[0]?.id || MISSING_VALUE;
  const compactNetLiq = fmtCompactCurrency(
    primaryAccount?.netLiquidation,
    maskAccountValues,
  );
  const compactWatchlist = (activeWatchlist?.name || "Core").toUpperCase();
  const compactIbkrReady = Boolean(session?.configured?.ibkr);

  return (
  <div
    className="ra-shell"
    data-layout={isPhone ? "phone" : isNarrow ? "tablet" : "desktop"}
    data-viewport={isPhone ? "phone" : isNarrow ? "tablet" : "desktop"}
    style={{
      height: isPhone ? "100dvh" : "100vh",
      display: "flex",
      flexDirection: "column",
      background: T.bg0,
      color: T.text,
      fontFamily: T.sans,
      minWidth: 0,
      overflow: "hidden",
    }}
  >
    <style>{fontCss}</style>
    <ToastStack
      toasts={toasts}
      onDismiss={onDismissToast}
      bottomOffset={isPhone ? 76 : 20}
    />
    {latencyDebugEnabled && LatencyDebugStripComponent ? (
      <LatencyDebugStripComponent
        screen={activeScreen}
        mountedScreens={mountedScreens}
      />
    ) : null}

    <div
      data-testid="platform-compact-header"
      style={{
        display: "grid",
        gridTemplateColumns: headerGridTemplate,
        alignItems: "center",
        gap: sp(isPhone ? 2 : 6),
        padding: sp(isPhone ? "3px 6px" : "6px 14px"),
        minWidth: 0,
        background: T.bg1,
        borderBottom: "none",
        boxShadow: `0 1px 0 ${T.border}`,
        flexShrink: 0,
      }}
    >
      {isPhone ? (
        <>
          <div
            data-testid="mobile-top-chrome"
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr)",
              alignItems: "center",
              gap: sp(2),
              minWidth: 0,
            }}
          >
            <div
              className="ra-hide-scrollbar"
              style={{
                order: 2,
                display: "flex",
                alignItems: "center",
                gap: sp(4),
                minWidth: 0,
                maxWidth: "100%",
                overflowX: "auto",
              }}
            >
              <MobileHeaderChip label="ACCT" value={compactAccountId} />
              <MobileHeaderChip label="NLV" value={compactNetLiq} tone={T.text} />
              <MobileHeaderChip
                label="IBKR"
                value={compactIbkrReady ? "ON" : "OFF"}
                tone={compactIbkrReady ? T.green : T.red}
              />
              <MobileHeaderChip label="SYM" value={selectedSymbol} tone={T.text} />
              <MobileHeaderChip label="WL" value={compactWatchlist} />
            </div>
            <div
              style={{
                order: 1,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: sp(4),
                minWidth: 0,
                width: "100%",
              }}
            >
              <div style={{ minWidth: 0, overflow: "hidden" }}>
                <HeaderStatusClusterComponent
                  session={session}
                  environment={environment}
                  bridgeTone={bridgeTone}
                  theme={theme}
                  onToggleTheme={onToggleTheme}
                  compact
                />
              </div>
              <MobileIconButton
                Icon={Activity}
                label="Open activity and notifications"
                testId="mobile-activity-trigger"
                onClick={() => setMobileActivityOpen(true)}
                active={mobileActivityOpen}
              />
              <MobileIconButton
                Icon={List}
                label="Open watchlist"
                testId="mobile-watchlist-trigger"
                onClick={() => setMobileWatchlistOpen(true)}
                active={mobileWatchlistOpen}
              />
            </div>
          </div>
          <div
            data-testid="mobile-kpi-rail"
            className="ra-hide-scrollbar"
            style={{
              minWidth: 0,
              display: "flex",
              alignItems: "center",
              overflowX: "auto",
            }}
          >
            <HeaderKpiStripComponent onSelect={onSelectSymbol} compact />
          </div>
        </>
      ) : (
        <>
          <div
            data-testid="platform-screen-nav"
            className="ra-hide-scrollbar"
            style={{
              display: "flex",
              alignItems: "center",
              gap: sp(2),
              minWidth: 0,
              flexWrap: "nowrap",
              overflowX: "auto",
            }}
          >
            {SCREENS.map((screen) => {
              const isTradeTab = screen.id === "trade";
              const totalAlerts = watchlistsBusy?.totalAlerts || 0;
              const winAlerts = watchlistsBusy?.winAlerts || 0;
              const lossAlerts = watchlistsBusy?.lossAlerts || 0;
              const hasAlerts = isTradeTab && totalAlerts > 0;
              const alertColor = lossAlerts > winAlerts ? T.red : T.amber;
              const pulseAnim = hasAlerts
                ? lossAlerts > winAlerts
                  ? "pulseAlertLoss 1.8s ease-in-out infinite"
                  : "pulseAlert 1.8s ease-in-out infinite"
                : "none";
              return (
                <AppTooltip key={screen.id} content={
                    hasAlerts
                      ? `${totalAlerts} position${totalAlerts === 1 ? "" : "s"} at alert threshold (${winAlerts} win · ${lossAlerts} loss)`
                      : screen.label
                  }><button
                  key={screen.id}
                  className={joinMotionClasses(
                    "ra-interactive",
                    activeScreen === screen.id && "ra-focus-rail",
                  )}
                  onClick={() => handleSetScreen(screen.id)}
                  style={{
                    ...motionVars({
                      accent: hasAlerts ? alertColor : T.accent,
                    }),
                    padding: sp("8px 14px"),
                    minHeight: dim(38),
                    fontSize: textSize("paragraphMuted"),
                    fontWeight: FONT_WEIGHTS.medium,
                    fontFamily: T.sans,
                    background:
                      activeScreen === screen.id ? `${T.accent}14` : "transparent",
                    border: "none",
                    borderRadius: dim(RADII.pill),
                    cursor: "pointer",
                    color: activeScreen === screen.id ? T.accent : T.textSec,
                    transition: "background 0.18s ease, color 0.18s ease",
                    animation: pulseAnim,
                    position: "relative",
                    whiteSpace: "nowrap",
                  }}
                  onMouseEnter={(event) => {
                    if (activeScreen === screen.id) return;
                    event.currentTarget.style.color = T.text;
                    event.currentTarget.style.background = T.accentHoverBg;
                  }}
                  onMouseLeave={(event) => {
                    if (activeScreen === screen.id) return;
                    event.currentTarget.style.color = T.textSec;
                    event.currentTarget.style.background = "transparent";
                  }}
                >
                  {screen.label}
                  {hasAlerts ? (
                    <span
                      style={{
                        marginLeft: sp(3),
                        padding: sp("0px 4px"),
                        borderRadius: RADII.none,
                        background: alertColor,
                        color: T.onAccent,
                        fontSize: fs(8),
                        fontWeight: FONT_WEIGHTS.regular,
                        fontFamily: T.sans,
                        letterSpacing: "0.04em",
                        verticalAlign: "middle",
                      }}
                    >
                      {totalAlerts}
                    </span>
                  ) : null}
                </button></AppTooltip>
              );
            })}
          </div>

          <div
            className="ra-hide-scrollbar"
            style={{
              minWidth: 0,
              display: "flex",
              alignItems: "center",
              overflowX: "auto",
            }}
          >
            <HeaderKpiStripComponent onSelect={onSelectSymbol} />
          </div>

          <div
            data-testid="platform-header-controls"
            className="ra-hide-scrollbar"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-end",
              gap: sp(4),
              minWidth: 0,
              flexWrap: "nowrap",
              overflowX: "auto",
            }}
          >
            <HeaderAccountStripComponent
              accounts={accounts}
              primaryAccountId={primaryAccountId}
              primaryAccount={primaryAccount}
              onSelectAccount={onSelectAccount}
              maskValues={maskAccountValues}
            />
            <HeaderStatusClusterComponent
              session={session}
              environment={environment}
              bridgeTone={bridgeTone}
              theme={theme}
              onToggleTheme={onToggleTheme}
            />
          </div>
        </>
      )}
    </div>

    <HeaderBroadcastScrollerStackComponent
      symbols={runtimeWatchlistSymbols}
      enabled={sessionMetadataSettled}
      onSignalAction={onSignalAction}
      onFlowAction={onFlowAction}
      signalScanEnabled={signalScanEnabled}
      signalScanPending={signalScanPending}
      signalEvaluationPending={signalEvaluationPending}
      signalScanErrored={signalScanErrored}
      onToggleSignalScan={onToggleSignalScan}
    />

    <MobileMoreSheet
      open={isPhone && mobileMoreOpen}
      onClose={() => setMobileMoreOpen(false)}
      activeScreen={activeScreen}
      setScreen={handleSetScreen}
      onOpenWatchlist={() => setMobileWatchlistOpen(true)}
      onOpenActivity={() => setMobileActivityOpen(true)}
      onOpenBloomberg={() => setMobileBloombergMounted(true)}
      activeWatchlist={activeWatchlist}
      selectedSymbol={selectedSymbol}
      session={session}
      memoryPressureSignal={memoryPressureSignal}
    />

    <MobileActivitySheet
      open={isPhone && mobileActivityOpen}
      onClose={() => setMobileActivityOpen(false)}
      onSignalAction={onSignalAction}
      onFlowAction={onFlowAction}
      onSelectSymbol={onSelectSymbol}
    />

    <MobileWatchlistDrawer
      open={isPhone && mobileWatchlistOpen}
      onClose={() => setMobileWatchlistOpen(false)}
      WatchlistComponent={WatchlistComponent}
      activeWatchlist={activeWatchlist}
      watchlistSymbols={watchlistSymbols}
      signalMonitorStates={signalMonitorStates}
      signalMatrixStates={signalMatrixStates}
      selectedSymbol={selectedSymbol}
      onSelectSymbol={onSelectSymbol}
      onFocusMarketChart={onFocusMarketChart}
      onSelectWatchlist={onSelectWatchlist}
      onCreateWatchlist={onCreateWatchlist}
      onRenameWatchlist={onRenameWatchlist}
      onDeleteWatchlist={onDeleteWatchlist}
      onSetDefaultWatchlist={onSetDefaultWatchlist}
      onAddSymbolToWatchlist={onAddSymbolToWatchlist}
      onReorderSymbolInWatchlist={onReorderSymbolInWatchlist}
      onRemoveSymbolFromWatchlist={onRemoveSymbolFromWatchlist}
      onSignalAction={onSignalAction}
      watchlists={watchlists}
      watchlistsBusy={watchlistsBusy}
    />
    {isPhone && mobileBloombergMounted ? (
      <Suspense fallback={null}>
        <BloombergLiveDock initialOpen />
      </Suspense>
    ) : null}

    <div style={{ flex: 1, display: "flex", overflow: "hidden", minWidth: 0 }}>
      {!isPhone ? (
      <div
        style={{
          width: sidebarWidth,
          transition: "width 0.2s",
          flexShrink: 0,
          overflow: "hidden",
          position: isPhone ? "fixed" : undefined,
          inset: isPhone ? "0 auto 0 0" : undefined,
          height: isPhone ? "100dvh" : undefined,
          maxWidth: isPhone ? "calc(100vw - 28px)" : undefined,
          zIndex: isPhone ? 130 : undefined,
          boxShadow: isPhone && !sidebarCollapsed ? `18px 0 48px ${T.bg0}cc` : undefined,
          pointerEvents: isPhone && sidebarCollapsed ? "none" : undefined,
        }}
      >
        {sidebarCollapsed ? (
          <div
            style={{
              height: "100%",
              background: T.bg1,
              borderRight: "none",
              boxShadow: `1px 0 0 ${T.border}`,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              paddingTop: sp(8),
            }}
          >
            <button
              onClick={() => setSidebarCollapsed(false)}
              style={{
                width: dim(28),
                height: dim(28),
                border: `1px solid ${T.border}`,
                borderRadius: dim(RADII.sm),
                background: T.bg1,
                color: T.textSec,
                cursor: "pointer",
                fontSize: fs(12),
              }}
            >
              ☰
            </button>
          </div>
        ) : (
          <div style={{ position: "relative", height: "100%" }}>
            <button
              onClick={() => setSidebarCollapsed(true)}
              aria-label={isPhone ? "Close watchlist panel" : "Collapse watchlist"}
              style={{
                position: "absolute",
                top: isPhone ? 10 : 8,
                right: 6,
                zIndex: 2,
                width: dim(isPhone ? 28 : 22),
                height: dim(isPhone ? 28 : 22),
                border: `1px solid ${T.border}`,
                borderRadius: dim(RADII.sm),
                background: T.bg1,
                color: T.textSec,
                cursor: "pointer",
                fontSize: fs(isPhone ? 13 : 10),
              }}
            >
              {isPhone ? "×" : "◂"}
            </button>
            <WatchlistComponent
              watchlists={watchlists}
              activeWatchlist={activeWatchlist}
              watchlistSymbols={watchlistSymbols}
              signalStates={signalMonitorStates}
              signalMatrixStates={signalMatrixStates}
              selected={selectedSymbol}
              onSelect={onSelectSymbol}
              onChartFocus={onFocusMarketChart}
              onSelectWatchlist={onSelectWatchlist}
              onCreateWatchlist={onCreateWatchlist}
              onRenameWatchlist={onRenameWatchlist}
              onDeleteWatchlist={onDeleteWatchlist}
              onSetDefaultWatchlist={onSetDefaultWatchlist}
              onAddSymbol={onAddSymbolToWatchlist}
              onReorderSymbol={onReorderSymbolInWatchlist}
              onRemoveSymbol={onRemoveSymbolFromWatchlist}
              onSignalAction={onSignalAction}
              busy={Boolean(watchlistsBusy?.mutating)}
            />
          </div>
        )}
      </div>
      ) : null}

      <div
        style={{
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {SCREENS.map(({ id }) => {
          const active = activeScreen === id;
          const renderPolicy = SCREEN_RENDER_POLICIES[id] || {};
          const retainInactive =
            renderPolicy.retainInactive === true &&
            !TRANSIENT_SCREEN_IDS.has(id);
          const shouldRender =
            mountedScreens[id] && (active || retainInactive);
          return shouldRender ? (
            <div
              key={id}
              data-testid={`screen-host-${id}`}
              aria-hidden={!active}
              style={{
                flex: 1,
                width: "100%",
                minWidth: 0,
                minHeight: 0,
                display: active ? "flex" : "none",
                flexDirection: "column",
              }}
            >
              <Suspense
                fallback={<ScreenLoadingFallback label={`Loading ${id}`} />}
              >
                {renderScreenById(id)}
                <ScreenReadyProbe screenId={id} active={active} />
              </Suspense>
            </div>
          ) : null;
        })}
      </div>
    </div>

    {isPhone ? (
      <MobileBottomNav
        activeScreen={activeScreen}
        setScreen={handleSetScreen}
        onOpenMore={() => setMobileMoreOpen(true)}
        watchlistsBusy={watchlistsBusy}
      />
    ) : (
      <div
        data-testid="platform-bottom-status"
        className="ra-hide-scrollbar"
        style={{
          display: "flex",
          alignItems: "center",
          height: dim(34),
          padding: sp("0 16px"),
          background: T.bg1,
          borderTop: "none",
          boxShadow: `0 -1px 0 ${T.border}`,
          flexShrink: 0,
          fontFamily: T.sans,
          gap: sp(14),
          overflowX: "auto",
          overflowY: "hidden",
          whiteSpace: "nowrap",
        }}
      >
        <FooterField label="Watchlist" value={activeWatchlist?.name || "Core"} />
        <FooterDivider />
        <FooterField label="Symbol" value={selectedSymbol} valueColor={T.text} />
        <FooterDivider />
        <FooterStatusField
          label="Historical"
          value={session?.marketDataProviders?.historical || MISSING_VALUE}
          ok={Boolean(session?.configured?.ibkr)}
        />
        <FooterDivider />
        <FooterStatusField
          label="Research"
          value={session?.marketDataProviders?.research || MISSING_VALUE}
          ok={Boolean(session?.configured?.research)}
        />
        <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: sp(12) }}>
          <span
            style={{
              color: T.textMuted,
              fontSize: textSize("caption"),
              fontWeight: FONT_WEIGHTS.medium,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            v0.1.0
          </span>
          <FooterMemoryPressureIndicator signal={memoryPressureSignal} />
        </span>
      </div>
    )}
    {!isPhone ? <BloombergLiveDockLauncher /> : null}
  </div>
  );
};

const ToastStack = ({ toasts, onDismiss, bottomOffset = 20 }) => (
  toasts.length ? (
    <div
      style={{
        position: "fixed",
        bottom: dim(bottomOffset),
        right: dim(20),
        zIndex: 200,
        display: "flex",
        flexDirection: "column",
        gap: sp(6),
        pointerEvents: "none",
      }}
    >
      {toasts.map((toast) => {
        const color =
          toast.kind === "success"
            ? T.green
            : toast.kind === "error"
              ? T.red
              : toast.kind === "warn"
                ? T.amber
                : T.accent;
        const icon =
          toast.kind === "success"
            ? "✓"
            : toast.kind === "error"
              ? "✕"
              : toast.kind === "warn"
                ? "⚠"
                : "ⓘ";
      return (
        <AppTooltip key={toast.id} content="Click to dismiss"><div
          key={toast.id}
          onClick={() => onDismiss?.(toast.id)}
          style={{
            background: T.bg1,
            border: `1px solid ${T.border}`,
            borderRadius: dim(RADII.md),
            padding: sp("12px 16px"),
            minWidth: dim(280),
            maxWidth: dim(360),
            boxShadow: ELEVATION.lg,
            animation: toast.leaving
              ? "toastSlideOut 0.2s ease-in forwards"
              : "toastSlideIn 0.22s ease-out",
            pointerEvents: "auto",
            cursor: "pointer",
            transition: "transform 0.12s ease, border-color 0.12s ease",
          }}
          onMouseEnter={(event) => {
            event.currentTarget.style.borderColor = T.accent;
            event.currentTarget.style.transform = "translateX(-2px)";
          }}
          onMouseLeave={(event) => {
            event.currentTarget.style.borderColor = T.border;
            event.currentTarget.style.transform = "translateX(0)";
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: sp(8),
            }}
          >
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: dim(24),
                height: dim(24),
                borderRadius: dim(RADII.pill),
                background: `${color}14`,
                color,
                fontSize: fs(13),
                fontWeight: FONT_WEIGHTS.label,
                lineHeight: 1,
                flexShrink: 0,
              }}
            >
              {icon}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: textSize("paragraphMuted"),
                  fontWeight: FONT_WEIGHTS.medium,
                  letterSpacing: "-0.005em",
                  color: T.text,
                  marginBottom: toast.body ? sp(3) : 0,
                }}
              >
                {toast.title}
              </div>
              {toast.body ? (
                <div
                  style={{
                    fontSize: textSize("body"),
                    color: T.textSec,
                    fontFamily: T.sans,
                    lineHeight: 1.4,
                  }}
                >
                  {toast.body}
                </div>
              ) : null}
            </div>
            <span
              style={{
                fontSize: textSize("caption"),
                color: T.textMuted,
                fontWeight: FONT_WEIGHTS.regular,
                opacity: 0.6,
                marginLeft: sp(4),
                marginTop: sp(2),
              }}
            >
              ✕
            </span>
          </div>
        </div></AppTooltip>
      );
      })}
    </div>
  ) : null
);
