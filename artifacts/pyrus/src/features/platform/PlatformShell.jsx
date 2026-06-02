import {
  useListExecutionEvents,
} from "@workspace/api-client-react";
import {
  memo,
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
  Gauge,
  LineChart,
  List,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  RadioTower,
  ScanLine,
  Search,
  Settings as SettingsIcon,
  Tv,
  WalletCards,
} from "lucide-react";
import {
  ELEVATION,
  FONT_WEIGHTS,
  MISSING_VALUE,
  RADII,
  T,
  dim,
  fs,
  sp,
  textSize,
} from "../../lib/uiTokens.jsx";
import { joinMotionClasses, motionVars } from "../../lib/motion.jsx";
import { AppHeader } from "./AppHeader.jsx";
import { MobileActivitySheet } from "./MobileActivitySheet.jsx";
import { MobileMoreSheet } from "./MobileMoreSheet.jsx";
import { MobilePortfolioPulseSheet } from "./MobilePortfolioPulseSheet.jsx";
import { MobileWatchlistDrawer } from "./MobileWatchlistDrawer.jsx";
import { NotificationsDrawer } from "./NotificationsDrawer.jsx";
import { PlatformAlgoMonitorSidebar } from "./PlatformAlgoMonitorSidebar.jsx";
import { ToastStack } from "./ToastStack.jsx";
import { buildAlgoEventToast } from "./algoEventToasts.js";
import { useAlgoCockpitStream } from "./live-streams";
import { useToast } from "./platformContexts.jsx";
import {
  SCREENS,
  SCREEN_RENDER_POLICIES,
  ScreenLoadingFallback,
  preloadScreenModule,
} from "./screenRegistry.jsx";
import { useElementSize, useViewport } from "../../lib/responsive";
import { FooterMemoryPressureIndicator } from "./FooterMemoryPressureIndicator.jsx";
import { AppTooltip } from "@/components/ui/tooltip";
import { lazyWithRetry } from "../../lib/dynamicImport";
import {
  markScreenSwitchStart,
} from "./performanceMetrics";


const CSS_COLOR = Object.freeze({
  bg0: "var(--ra-surface-0)",
  bg1: "var(--ra-surface-1)",
  bg2: "var(--ra-surface-2)",
  bg3: "var(--ra-surface-3)",
  bg4: "var(--ra-surface-4)",
  border: "var(--ra-border-default)",
  borderLight: "var(--ra-border-light)",
  borderFocus: "var(--ra-border-focus)",
  text: "var(--ra-text-primary)",
  textSec: "var(--ra-text-secondary)",
  textDim: "var(--ra-text-dim)",
  textMuted: "var(--ra-text-muted)",
  accent: "var(--ra-color-accent)",
  accentDim: "var(--ra-accent-dim)",
  accentHoverBg: "var(--ra-accent-hover-bg)",
  accentActiveBg: "var(--ra-accent-active-bg)",
  blue: "var(--ra-blue-500)",
  purple: "var(--ra-purple-500)",
  cyan: "var(--ra-cyan-500)",
  pink: "var(--ra-pink-500)",
  green: "var(--ra-green-500)",
  greenDim: "var(--ra-green-dim)",
  greenBg: "var(--ra-green-bg)",
  red: "var(--ra-red-500)",
  redDim: "var(--ra-red-dim)",
  redBg: "var(--ra-red-bg)",
  amber: "var(--ra-amber-500)",
  amberDim: "var(--ra-amber-dim)",
  amberBg: "var(--ra-amber-bg)",
  pulseLive: "var(--ra-green-500)",
  pulseAlert: "var(--ra-amber-500)",
  pulseLoss: "var(--ra-red-500)",
  onAccent: "var(--ra-on-accent)",
});

const cssColorMix = (color, percent) =>
  `color-mix(in srgb, ${color} ${percent}%, transparent)`;

const TRANSIENT_SCREEN_IDS = new Set(["diagnostics", "settings"]);
const MOBILE_PRIMARY_SCREEN_IDS = ["market", "signals", "trade", "account"];
const WATCHLIST_SIDEBAR_WIDTH_DEFAULT = 220;
const WATCHLIST_SIDEBAR_WIDTH_MIN = 196;
const WATCHLIST_SIDEBAR_WIDTH_MAX = 320;
const ACTIVITY_SIDEBAR_WIDTH_DEFAULT = 220;
const ACTIVITY_SIDEBAR_WIDTH_MIN = 196;
const ACTIVITY_SIDEBAR_WIDTH_MAX = 320;

const screenHeadingStyle = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0, 0, 0, 0)",
  whiteSpace: "nowrap",
  border: 0,
};

const clampWatchlistSidebarWidth = (value) =>
  Math.min(
    WATCHLIST_SIDEBAR_WIDTH_MAX,
    Math.max(WATCHLIST_SIDEBAR_WIDTH_MIN, Number(value) || WATCHLIST_SIDEBAR_WIDTH_DEFAULT),
  );
const clampActivitySidebarWidth = (value) =>
  Math.min(
    ACTIVITY_SIDEBAR_WIDTH_MAX,
    Math.max(ACTIVITY_SIDEBAR_WIDTH_MIN, Number(value) || ACTIVITY_SIDEBAR_WIDTH_DEFAULT),
  );
const MOBILE_PRIMARY_SCREEN_SET = new Set(MOBILE_PRIMARY_SCREEN_IDS);
const MOBILE_NAV_ICONS = {
  market: LineChart,
  signals: ScanLine,
  flow: Activity,
  trade: ChartCandlestick,
  account: WalletCards,
  gex: Activity,
  research: Search,
  algo: RadioTower,
  backtest: ChartCandlestick,
  diagnostics: Gauge,
  settings: SettingsIcon,
};
const MAX_RETAINED_INACTIVE_SCREENS = 2;
const DEFERRED_SCREEN_UNMOUNT_MS = 1_200;
const BloombergLiveDock = lazyWithRetry(
  () => import("./BloombergLiveDock"),
  { label: "BloombergLiveDock" },
);

/**
 * ScreenTransitionHost — wraps a screen so it fades + lifts on every
 * activation, including retainInactive screens that stay mounted between
 * switches.
 *
 * The .ra-screen-enter CSS class carries the screen-enter keyframe.
 * CSS animations don't natively re-fire on display:none → display:flex,
 * so activation toggles between two equivalent animation names. That
 * replays the animation without a synchronous layout read.
 *
 * Honors prefers-reduced-motion / data-pyrus-reduced-motion via the
 * media-query and html[data-pyrus-reduced-motion="on"] overrides in
 * index.css — the animation becomes a no-op when motion is reduced.
 */
const ScreenTransitionHost = ({ screenId, screenLabel, active, children }) => {
  const [activationToken, setActivationToken] = useState(0);
  const screenHeadingId = `platform-screen-title-${screenId}`;
  useEffect(() => {
    if (!active) return;
    setActivationToken((current) => (current + 1) % 2);
  }, [active]);
  return (
    <div
      data-testid={`screen-host-${screenId}`}
      aria-hidden={!active}
      aria-labelledby={active ? screenHeadingId : undefined}
      className={[
        "ra-screen-enter",
        activationToken === 1 ? "ra-screen-enter-alt" : null,
      ]
        .filter(Boolean)
        .join(" ")}
      style={{
        flex: 1,
        width: "100%",
        minWidth: 0,
        minHeight: 0,
        display: active ? "flex" : "none",
        flexDirection: "column",
      }}
    >
      {active ? (
        <h1 id={screenHeadingId} style={screenHeadingStyle}>
          {screenLabel || screenId}
        </h1>
      ) : null}
      {children}
    </div>
  );
};

const screenCanRetainInactive = (screenId) => {
  const renderPolicy = SCREEN_RENDER_POLICIES[screenId] || {};
  return (
    renderPolicy.retainInactive === true &&
    !TRANSIENT_SCREEN_IDS.has(screenId)
  );
};

const PlatformScreenStack = memo(({
  activeScreen,
  mountedScreens,
  renderScreenById,
}) => {
  const previousActiveScreenRef = useRef(activeScreen);
  const handoffTimersRef = useRef(new Map());
  const [retainedInactiveScreens, setRetainedInactiveScreens] = useState([]);
  const [deferredInactiveScreens, setDeferredInactiveScreens] = useState([]);

  useEffect(() => {
    const previousScreen = previousActiveScreenRef.current;
    previousActiveScreenRef.current = activeScreen;
    if (!previousScreen || previousScreen === activeScreen) {
      setRetainedInactiveScreens((current) =>
        current.filter(
          (screenId) =>
            screenId !== activeScreen && screenCanRetainInactive(screenId),
        ),
      );
      return undefined;
    }

    setRetainedInactiveScreens((current) => {
      const next = current.filter(
        (screenId) =>
          screenId !== activeScreen &&
          screenId !== previousScreen &&
          screenCanRetainInactive(screenId),
      );
      if (screenCanRetainInactive(previousScreen)) {
        next.unshift(previousScreen);
      }
      return next.slice(0, MAX_RETAINED_INACTIVE_SCREENS);
    });

    setDeferredInactiveScreens((current) =>
      current.includes(previousScreen) ? current : [...current, previousScreen],
    );
    const existingTimer = handoffTimersRef.current.get(previousScreen);
    if (existingTimer) {
      window.clearTimeout(existingTimer);
    }
    const timer = window.setTimeout(() => {
      handoffTimersRef.current.delete(previousScreen);
      setDeferredInactiveScreens((current) =>
        current.filter((screenId) => screenId !== previousScreen),
      );
    }, DEFERRED_SCREEN_UNMOUNT_MS);
    handoffTimersRef.current.set(previousScreen, timer);

    return undefined;
  }, [activeScreen]);

  useEffect(
    () => () => {
      handoffTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      handoffTimersRef.current.clear();
    },
    [],
  );

  return (
    <div
      data-testid="platform-screen-stack"
      style={{
        flex: 1,
        minWidth: 0,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {SCREENS.map(({ id, label }) => {
        const active = activeScreen === id;
        const shouldRender =
          mountedScreens[id] &&
          (active ||
            retainedInactiveScreens.includes(id) ||
            deferredInactiveScreens.includes(id));
        return shouldRender ? (
          <ScreenTransitionHost
            key={id}
            screenId={id}
            screenLabel={label}
            active={active}
          >
            <Suspense fallback={<ScreenLoadingFallback screenId={id} />}>
              {renderScreenById(id)}
            </Suspense>
          </ScreenTransitionHost>
        ) : null;
      })}
    </div>
  );
});
PlatformScreenStack.displayName = "PlatformScreenStack";

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
            background: CSS_COLOR.accent,
            boxShadow: ELEVATION.lg,
            color: CSS_COLOR.onAccent,
            cursor: "pointer",
          }}
        >
          <Tv size={dim(16)} />
        </button>
      </AppTooltip>
    </div>
  );
};

const MobileBottomNav = ({ activeScreen, setScreen, onOpenMore, watchlistsBusy }) => {
  const activeSecondaryScreen = MOBILE_PRIMARY_SCREEN_SET.has(activeScreen)
    ? null
    : SCREENS.find((item) => item.id === activeScreen);
  const MoreIcon = activeSecondaryScreen
    ? MOBILE_NAV_ICONS[activeSecondaryScreen.id] || Ellipsis
    : Ellipsis;
  const moreLabel = activeSecondaryScreen?.label || "More";

  return (
  <nav
    data-testid="mobile-bottom-nav"
    aria-label="Primary mobile navigation"
    className="ra-glass-surface ra-mobile-bottom-nav"
    style={{
      flexShrink: 0,
      display: "grid",
      gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
      gap: sp(3),
      padding: "6px 8px max(8px, env(safe-area-inset-bottom))",
      borderTop: `1px solid ${CSS_COLOR.border}`,
      minHeight: `calc(${dim(58)}px + env(safe-area-inset-bottom))`,
    }}
  >
    {MOBILE_PRIMARY_SCREEN_IDS.map((screenId) => {
      const screen = SCREENS.find((item) => item.id === screenId);
      const Icon = MOBILE_NAV_ICONS[screenId] || Activity;
      const active = activeScreen === screenId;
      return (
        <button
          key={screenId}
          type="button"
          data-testid={`mobile-bottom-nav-${screenId}`}
          aria-current={active ? "page" : undefined}
          onClick={() => setScreen(screenId)}
          className={joinMotionClasses(
            "ra-interactive",
            "ra-mobile-nav-item",
            active && "ra-focus-rail",
          )}
          style={{
            ...motionVars({ accent: CSS_COLOR.accent }),
            minWidth: 0,
            minHeight: dim(48),
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: sp(2),
            border: "1px solid transparent",
            borderRadius: dim(RADII.sm),
            background: active ? `${cssColorMix(CSS_COLOR.accent, 7)}` : "transparent",
            color: active ? CSS_COLOR.accent : CSS_COLOR.textDim,
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
        "ra-mobile-nav-item",
        !MOBILE_PRIMARY_SCREEN_SET.has(activeScreen) && "ra-focus-rail",
      )}
      style={{
        ...motionVars({ accent: CSS_COLOR.accent }),
        minWidth: 0,
        minHeight: dim(48),
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: sp(2),
        border: "1px solid transparent",
        borderRadius: dim(RADII.sm),
        background: !MOBILE_PRIMARY_SCREEN_SET.has(activeScreen)
          ? `${cssColorMix(CSS_COLOR.accent, 7)}`
          : "transparent",
        color: !MOBILE_PRIMARY_SCREEN_SET.has(activeScreen) ? CSS_COLOR.accent : CSS_COLOR.textDim,
        cursor: "pointer",
        fontFamily: T.sans,
        fontSize: textSize("caption"),
      }}
    >
      <MoreIcon size={17} strokeWidth={2.1} />
      <span
        style={{
          maxWidth: "100%",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {moreLabel}
      </span>
    </button>
  </nav>
  );
};

const FooterField = ({ label, value, valueColor }) => (
  <span style={{ display: "inline-flex", alignItems: "baseline", gap: sp(6), minWidth: 0 }}>
    <span
      style={{
        color: CSS_COLOR.textMuted,
        fontSize: textSize("caption"),
        fontWeight: FONT_WEIGHTS.medium,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
      }}
    >
      {label}
    </span>
    <span
      style={{
        color: valueColor || CSS_COLOR.textSec,
        fontSize: textSize("body"),
        fontWeight: FONT_WEIGHTS.medium,
        fontVariantNumeric: "tabular-nums",
        letterSpacing: 0,
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
        background: ok ? CSS_COLOR.green : CSS_COLOR.red,
        flexShrink: 0,
      }}
    />
    <span
      style={{
        color: CSS_COLOR.textMuted,
        fontSize: textSize("caption"),
        fontWeight: FONT_WEIGHTS.medium,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
      }}
    >
      {label}
    </span>
    <span
      style={{
        color: CSS_COLOR.text,
        fontSize: textSize("body"),
        fontWeight: FONT_WEIGHTS.medium,
        letterSpacing: 0,
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
      background: CSS_COLOR.border,
      flexShrink: 0,
    }}
  />
);

const FrameSidebar = ({
  side = "left",
  label,
  testId,
  collapsed,
  width,
  resizing,
  onExpand,
  onResizeStart,
  ExpandIcon,
  children,
}) => {
  const isLeft = side === "left";
  const collapsedWidth = 40;

  if (collapsed) {
    return (
      <div
        data-testid={testId}
        data-collapsed="true"
        style={{
          width: dim(collapsedWidth),
          flexShrink: 0,
          overflow: "hidden",
          background: CSS_COLOR.bg1,
          boxShadow: isLeft ? `1px 0 0 ${CSS_COLOR.border}` : `-1px 0 0 ${CSS_COLOR.border}`,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          paddingTop: sp(8),
        }}
      >
        <AppTooltip content={`Expand ${label}`}>
          <button
            type="button"
            onClick={onExpand}
            aria-label={`Expand ${label}`}
            className="ra-interactive"
            style={{
              width: dim(28),
              height: dim(28),
              display: "grid",
              placeItems: "center",
              border: `1px solid ${CSS_COLOR.border}`,
              borderRadius: dim(RADII.sm),
              background: CSS_COLOR.bg1,
              color: CSS_COLOR.textSec,
              cursor: "pointer",
              padding: 0,
            }}
          >
            <ExpandIcon size={14} strokeWidth={1.8} />
          </button>
        </AppTooltip>
      </div>
    );
  }

  return (
    <div
      data-testid={testId}
      data-collapsed="false"
      style={{
        width,
        transition: resizing ? "none" : "width 0.2s",
        flexShrink: 0,
        overflow: "hidden",
        position: "relative",
        background: CSS_COLOR.bg0,
        boxShadow: isLeft ? `1px 0 0 ${CSS_COLOR.border}` : `-1px 0 0 ${CSS_COLOR.border}`,
      }}
    >
      {children}
      <button
        type="button"
        data-testid={`${testId}-resize-handle`}
        aria-label={`Resize ${label}`}
        onPointerDown={onResizeStart}
        style={{
          position: "absolute",
          top: 0,
          [isLeft ? "right" : "left"]: 0,
          width: dim(8),
          height: "100%",
          border: "none",
          padding: 0,
          background: "transparent",
          cursor: "col-resize",
          touchAction: "none",
          zIndex: 3,
        }}
      />
    </div>
  );
};

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
  signalMonitorProfile,
  signalMonitorEvents,
  signalMatrixStates,
  headerSignalMatrixStates,
  selectedSymbol,
  sidebarCollapsed,
  setSidebarCollapsed,
  watchlistSidebarWidth = WATCHLIST_SIDEBAR_WIDTH_DEFAULT,
  setWatchlistSidebarWidth,
  activitySidebarCollapsed = false,
  setActivitySidebarCollapsed,
  activitySidebarWidth = ACTIVITY_SIDEBAR_WIDTH_DEFAULT,
  setActivitySidebarWidth,
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
  brokerAuthenticated,
  session,
  environment,
  bridgeTone,
  theme,
  onToggleTheme,
  safeQaMode = false,
  runtimeWatchlistSymbols,
  sessionMetadataSettled,
  frameAuxiliaryDataEnabled = false,
  onFlowAction,
  signalScanEnabled,
  signalScanPending,
  signalEvaluationPending,
  signalScanErrored,
  onToggleSignalScan,
  onChangeSignalMonitorTimeframe,
  onChangeSignalMonitorFreshWindowBars,
  onChangeSignalMonitorMaxSymbols,
}) => {
  const viewport = useViewport();
  const { isPhone, isTablet, isNarrow } = viewport.flags;
  const auxiliaryDrawerViewport = isPhone || isTablet;
  const headerWidth = viewport.width || 0;
  const [headerRef, headerSize] = useElementSize();
  const headerEffectiveWidth = headerSize.width || headerWidth;
  const headerTight =
    !isPhone &&
    (isNarrow || (headerEffectiveWidth > 0 && headerEffectiveWidth <= 1440));
  const headerUltraTight =
    !isPhone && headerEffectiveWidth > 0 && headerEffectiveWidth < 1120;
  const headerShowKpis = !isPhone;
  const headerAccountMinimal =
    !isPhone && headerEffectiveWidth > 0 && headerEffectiveWidth < 1180;
  const headerCompactStatus =
    headerUltraTight ||
    (headerShowKpis && headerEffectiveWidth > 0 && headerEffectiveWidth < 1760);
  const headerStatusMinimal =
    !isPhone && headerEffectiveWidth > 0 && headerEffectiveWidth < 980;
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const [mobileActivityOpen, setMobileActivityOpen] = useState(false);
  const [mobileWatchlistOpen, setMobileWatchlistOpen] = useState(false);
  const [mobilePulseOpen, setMobilePulseOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [mobileBloombergMounted, setMobileBloombergMounted] = useState(false);
  const [watchlistResizing, setWatchlistResizing] = useState(false);
  const [activityResizing, setActivityResizing] = useState(false);
  const mobileAutoCollapseRef = useRef(false);
  const previousActiveScreenRef = useRef(activeScreen);
  const resizeCleanupRef = useRef(null);
  const toastedEventIdsRef = useRef(new Set());
  const hasReceivedLiveRef = useRef(false);
  const toast = useToast();
  const handleSetScreen = useCallback(
    (screenId) => {
      if (!screenId || screenId === activeScreen) {
        return;
      }
      void preloadScreenModule(screenId);
      markScreenSwitchStart(screenId, "navigation");
      setScreen(screenId);
    },
    [activeScreen, setScreen],
  );
  const handleAlgoAction = useCallback(() => {
    handleSetScreen("algo");
  }, [handleSetScreen]);
  const handleAlgoLiveEvents = useCallback(
    (events) => {
      const liveEvents = Array.isArray(events) ? events : [];
      if (!hasReceivedLiveRef.current) {
        hasReceivedLiveRef.current = true;
        liveEvents.forEach((event) => {
          if (event?.id) {
            toastedEventIdsRef.current.add(event.id);
          }
        });
        return;
      }

      liveEvents.forEach((event) => {
        if (!event?.id || toastedEventIdsRef.current.has(event.id)) {
          return;
        }
        toastedEventIdsRef.current.add(event.id);
        const toastSpec = buildAlgoEventToast(event);
        if (toastSpec) {
          toast.push(toastSpec);
        }
      });

      if (toastedEventIdsRef.current.size > 500) {
        toastedEventIdsRef.current = new Set(
          Array.from(toastedEventIdsRef.current).slice(-300),
        );
      }
    },
    [toast],
  );

  useEffect(() => {
    hasReceivedLiveRef.current = false;
    toastedEventIdsRef.current = new Set();
  }, [environment]);

  const algoFrameRuntimeEnabled = Boolean(
    frameAuxiliaryDataEnabled &&
      (
        activeScreen === "algo" ||
        (!auxiliaryDrawerViewport && !activitySidebarCollapsed) ||
        (auxiliaryDrawerViewport && (mobileActivityOpen || mobilePulseOpen)) ||
        notificationsOpen
      ),
  );
  const algoCockpitStreamFreshness = useAlgoCockpitStream({
    deploymentId: null,
    mode: environment || "paper",
    eventLimit: 20,
    enabled: algoFrameRuntimeEnabled,
    onLiveEvents: handleAlgoLiveEvents,
  });
  const algoEventsQuery = useListExecutionEvents(
    { limit: 20 },
    {
      query: {
        enabled: algoFrameRuntimeEnabled,
        staleTime: 15_000,
        refetchInterval:
          algoFrameRuntimeEnabled && !algoCockpitStreamFreshness.algoCriticalFresh
            ? 30_000
            : false,
        retry: false,
        refetchOnWindowFocus: false,
      },
    },
  );

  useLayoutEffect(() => {
    if (previousActiveScreenRef.current === activeScreen) {
      return;
    }
    previousActiveScreenRef.current = activeScreen;
    markScreenSwitchStart(activeScreen, "programmatic");
  }, [activeScreen]);

  useEffect(() => {
    return () => {
      resizeCleanupRef.current?.();
    };
  }, []);

  const resolvedWatchlistSidebarWidth = clampWatchlistSidebarWidth(
    watchlistSidebarWidth,
  );
  const resolvedActivitySidebarWidth = clampActivitySidebarWidth(
    activitySidebarWidth,
  );
  const handleWatchlistResizeStart = useCallback(
    (event) => {
      if (isPhone || sidebarCollapsed || !setWatchlistSidebarWidth) {
        return;
      }
      event.preventDefault();
      resizeCleanupRef.current?.();

      const startX = event.clientX;
      const startWidth = resolvedWatchlistSidebarWidth;
      setWatchlistResizing(true);

      const handlePointerMove = (moveEvent) => {
        setWatchlistSidebarWidth(
          clampWatchlistSidebarWidth(startWidth + moveEvent.clientX - startX),
        );
      };
      const cleanup = () => {
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", cleanup);
        window.removeEventListener("pointercancel", cleanup);
        resizeCleanupRef.current = null;
        setWatchlistResizing(false);
      };

      resizeCleanupRef.current = cleanup;
      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", cleanup);
      window.addEventListener("pointercancel", cleanup);
    },
    [
      isPhone,
      resolvedWatchlistSidebarWidth,
      setWatchlistSidebarWidth,
      sidebarCollapsed,
    ],
  );
  const handleActivityResizeStart = useCallback(
    (event) => {
      if (isPhone || activitySidebarCollapsed || !setActivitySidebarWidth) {
        return;
      }
      event.preventDefault();
      resizeCleanupRef.current?.();

      const startX = event.clientX;
      const startWidth = resolvedActivitySidebarWidth;
      setActivityResizing(true);

      const handlePointerMove = (moveEvent) => {
        setActivitySidebarWidth(
          clampActivitySidebarWidth(startWidth - (moveEvent.clientX - startX)),
        );
      };
      const cleanup = () => {
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", cleanup);
        window.removeEventListener("pointercancel", cleanup);
        resizeCleanupRef.current = null;
        setActivityResizing(false);
      };

      resizeCleanupRef.current = cleanup;
      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", cleanup);
      window.addEventListener("pointercancel", cleanup);
    },
    [
      activitySidebarCollapsed,
      isPhone,
      resolvedActivitySidebarWidth,
      setActivitySidebarWidth,
    ],
  );

  useEffect(() => {
    if (!auxiliaryDrawerViewport) {
      mobileAutoCollapseRef.current = false;
      setMobileMoreOpen(false);
      setMobileActivityOpen(false);
      setMobileWatchlistOpen(false);
      return;
    }
    if (!isPhone) {
      mobileAutoCollapseRef.current = false;
      return;
    }

    if (mobileAutoCollapseRef.current) return;
    mobileAutoCollapseRef.current = true;
    if (!sidebarCollapsed) {
      setSidebarCollapsed(true);
    }
  }, [auxiliaryDrawerViewport, isPhone, setSidebarCollapsed, sidebarCollapsed]);
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
      : resolvedWatchlistSidebarWidth;
  const headerGridTemplate = isPhone
    ? "minmax(0, 1fr)"
    : "minmax(0, max-content) minmax(0, max-content) minmax(0, 1fr) minmax(0, max-content)";
  return (
  <div
    className="ra-shell"
    data-layout={isPhone ? "phone" : isNarrow ? "tablet" : "desktop"}
    data-viewport={isPhone ? "phone" : isNarrow ? "tablet" : "desktop"}
    style={{
      height: isPhone ? "100dvh" : "100vh",
      display: "flex",
      flexDirection: "column",
      background: CSS_COLOR.bg0,
      color: CSS_COLOR.text,
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

    <AppHeader
      headerRef={headerRef}
      isPhone={isPhone}
      headerTight={headerTight}
      headerGridTemplate={headerGridTemplate}
      headerShowKpis={headerShowKpis}
      headerAccountMinimal={headerAccountMinimal}
      headerCompactStatus={headerCompactStatus}
      headerStatusMinimal={headerStatusMinimal}
      activeScreen={activeScreen}
      handleSetScreen={handleSetScreen}
      watchlistsBusy={watchlistsBusy}
      selectedSymbol={selectedSymbol}
      session={session}
      environment={environment}
      bridgeTone={bridgeTone}
      theme={theme}
      onToggleTheme={onToggleTheme}
      safeQaMode={safeQaMode}
      accounts={accounts}
      primaryAccountId={primaryAccountId}
      primaryAccount={primaryAccount}
      onSelectAccount={onSelectAccount}
      maskAccountValues={maskAccountValues}
      brokerAuthenticated={brokerAuthenticated}
      onSelectSymbol={onSelectSymbol}
      mobileActivityOpen={mobileActivityOpen}
      mobileWatchlistOpen={mobileWatchlistOpen}
      setMobileActivityOpen={setMobileActivityOpen}
      setMobileWatchlistOpen={setMobileWatchlistOpen}
      mobilePulseOpen={mobilePulseOpen}
      setMobilePulseOpen={setMobilePulseOpen}
      notificationsOpen={notificationsOpen}
      setNotificationsOpen={setNotificationsOpen}
      runtimeWatchlistSymbols={runtimeWatchlistSymbols}
      sessionMetadataSettled={sessionMetadataSettled}
      onSignalAction={onSignalAction}
      onFlowAction={onFlowAction}
      handleAlgoAction={handleAlgoAction}
      algoEventsQuery={algoEventsQuery}
      signalScanEnabled={signalScanEnabled}
      signalScanPending={signalScanPending}
      signalEvaluationPending={signalEvaluationPending}
      signalScanErrored={signalScanErrored}
      onToggleSignalScan={onToggleSignalScan}
      onChangeSignalMonitorTimeframe={onChangeSignalMonitorTimeframe}
      onChangeSignalMonitorFreshWindowBars={onChangeSignalMonitorFreshWindowBars}
      onChangeSignalMonitorMaxSymbols={onChangeSignalMonitorMaxSymbols}
      headerSignalMatrixStates={headerSignalMatrixStates}
      signalMatrixStates={signalMatrixStates}
      HeaderKpiStripComponent={HeaderKpiStripComponent}
      HeaderAccountStripComponent={HeaderAccountStripComponent}
      HeaderStatusClusterComponent={HeaderStatusClusterComponent}
      HeaderBroadcastScrollerStackComponent={HeaderBroadcastScrollerStackComponent}
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
      open={auxiliaryDrawerViewport && mobileActivityOpen}
      onClose={() => setMobileActivityOpen(false)}
      environment={environment}
      dataEnabled={algoFrameRuntimeEnabled}
      signalMatrixStates={signalMatrixStates}
      onOpenAlgo={(focus) => {
        setMobileActivityOpen(false);
        handleSetScreen("algo", focus);
      }}
      onOpenTradeSymbol={(symbol) => {
        if (symbol) {
          onSelectSymbol?.(symbol);
        }
        setMobileActivityOpen(false);
        handleSetScreen("trade");
      }}
    />

    <NotificationsDrawer
      open={notificationsOpen}
      onClose={() => setNotificationsOpen(false)}
      algoEvents={algoEventsQuery?.data?.events}
      onAlgoEventClick={() => {
        setNotificationsOpen(false);
        handleSetScreen("algo");
      }}
    />

    <MobilePortfolioPulseSheet
      open={isPhone && mobilePulseOpen}
      onClose={() => setMobilePulseOpen(false)}
      accountId={primaryAccountId}
      mode={environment}
      maskValues={maskAccountValues}
      brokerAuthenticated={brokerAuthenticated}
      watchlistsBusy={watchlistsBusy}
      algoEvents={algoEventsQuery?.data?.events}
      enabled={sessionMetadataSettled && !safeQaMode}
      onAlertClick={() => handleSetScreen("trade")}
      onPositionsClick={() => handleSetScreen("trade")}
      onOrdersClick={() => handleSetScreen("trade")}
      onSignalsClick={() => handleSetScreen("flow")}
      onFlowClick={() => handleSetScreen("flow")}
      onAlgoClick={() => handleSetScreen("algo")}
    />

    <MobileWatchlistDrawer
      open={isPhone && mobileWatchlistOpen}
      onClose={() => setMobileWatchlistOpen(false)}
      WatchlistComponent={WatchlistComponent}
      activeWatchlist={activeWatchlist}
      watchlistSymbols={watchlistSymbols}
      signalMonitorStates={signalMonitorStates}
      signalMonitorProfile={signalMonitorProfile}
      signalMonitorEvents={signalMonitorEvents}
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
        <FrameSidebar
          side="left"
          label="watchlist sidebar"
          testId="platform-watchlist-sidebar"
          collapsed={sidebarCollapsed}
          width={sidebarWidth}
          resizing={watchlistResizing}
          onExpand={() => setSidebarCollapsed(false)}
          onResizeStart={handleWatchlistResizeStart}
          ExpandIcon={PanelLeftOpen}
        >
          <div style={{ position: "relative", height: "100%" }}>
            <WatchlistComponent
              watchlists={watchlists}
              activeWatchlist={activeWatchlist}
              watchlistSymbols={watchlistSymbols}
              signalStates={signalMonitorStates}
              signalProfile={signalMonitorProfile}
              signalEvents={signalMonitorEvents}
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
              headerAccessory={
                <AppTooltip content="Collapse watchlist">
                  <button
                    type="button"
                    data-testid="watchlist-sidebar-collapse"
                    onClick={() => setSidebarCollapsed(true)}
                    aria-label="Collapse watchlist"
                    style={{
                      width: dim(28),
                      height: dim(32),
                      display: "grid",
                      placeItems: "center",
                      border: `1px solid ${CSS_COLOR.border}`,
                      borderRadius: dim(RADII.sm),
                      background: "transparent",
                      color: CSS_COLOR.textSec,
                      cursor: "pointer",
                      fontFamily: T.sans,
                      fontSize: fs(11),
                      lineHeight: 1,
                    }}
                    className="ra-interactive"
                  >
                    <PanelLeftClose size={14} strokeWidth={1.8} />
                  </button>
                </AppTooltip>
              }
            />
          </div>
        </FrameSidebar>
      ) : null}

      <PlatformScreenStack
        activeScreen={activeScreen}
        mountedScreens={mountedScreens}
        renderScreenById={renderScreenById}
      />

      {!isPhone ? (
        <FrameSidebar
          side="right"
          label="algo monitor sidebar"
          testId="platform-activity-sidebar"
          collapsed={isTablet || activitySidebarCollapsed}
          width={isTablet || activitySidebarCollapsed ? 40 : resolvedActivitySidebarWidth}
          resizing={activityResizing}
          onExpand={() => {
            if (isTablet) {
              setMobileActivityOpen(true);
              return;
            }
            setActivitySidebarCollapsed?.(false);
          }}
          onResizeStart={handleActivityResizeStart}
          ExpandIcon={PanelRightOpen}
        >
          <PlatformAlgoMonitorSidebar
            isVisible={!activitySidebarCollapsed}
            dataEnabled={algoFrameRuntimeEnabled}
            signalMatrixStates={signalMatrixStates}
            externalStreamFreshness={
              algoFrameRuntimeEnabled ? algoCockpitStreamFreshness : null
            }
            environment={environment}
            onOpenAlgo={(focus) => handleSetScreen("algo", focus)}
            onOpenTradeSymbol={(symbol) => {
              if (symbol) {
                onSelectSymbol?.(symbol);
              }
              handleSetScreen("trade");
            }}
            headerAccessory={
              <AppTooltip content="Collapse algo monitor">
                <button
                  type="button"
                  data-testid="activity-sidebar-collapse"
                  onClick={() => setActivitySidebarCollapsed?.(true)}
                  aria-label="Collapse algo monitor"
                  style={{
                    width: dim(28),
                    height: dim(32),
                    display: "grid",
                    placeItems: "center",
                    border: `1px solid ${CSS_COLOR.border}`,
                    borderRadius: dim(RADII.sm),
                    background: "transparent",
                    color: CSS_COLOR.textSec,
                    cursor: "pointer",
                    fontFamily: T.sans,
                    fontSize: fs(11),
                    lineHeight: 1,
                  }}
                  className="ra-interactive"
                >
                  <PanelRightClose size={14} strokeWidth={1.8} />
                </button>
              </AppTooltip>
            }
          />
        </FrameSidebar>
      ) : null}
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
          background: CSS_COLOR.bg1,
          borderTop: "none",
          boxShadow: `0 -1px 0 ${CSS_COLOR.border}`,
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
        <FooterField label="Symbol" value={selectedSymbol} valueColor={CSS_COLOR.text} />
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
              color: CSS_COLOR.textMuted,
              fontSize: textSize("caption"),
              fontWeight: FONT_WEIGHTS.medium,
              letterSpacing: "0.04em",
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
