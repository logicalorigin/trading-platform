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
  CheckCircle2,
  CircleAlert,
  Ellipsis,
  Gauge,
  LineChart,
  List,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  RadioTower,
  Search,
  Settings as SettingsIcon,
  Tv,
  WalletCards,
  XCircle,
} from "lucide-react";
import { ELEVATION, FONT_WEIGHTS, MISSING_VALUE, RADII, T, dim, fs, sp, textSize } from "../../lib/uiTokens.jsx";
import { joinMotionClasses, motionVars } from "../../lib/motion.jsx";
import { AppHeader } from "./AppHeader.jsx";
import { MobileActivitySheet } from "./MobileActivitySheet.jsx";
import { MobileMoreSheet } from "./MobileMoreSheet.jsx";
import { MobilePortfolioPulseSheet } from "./MobilePortfolioPulseSheet.jsx";
import { MobileWatchlistDrawer } from "./MobileWatchlistDrawer.jsx";
import { NotificationsDrawer } from "./NotificationsDrawer.jsx";
import { PlatformAlgoMonitorSidebar } from "./PlatformAlgoMonitorSidebar.jsx";
import { buildAlgoEventToast } from "./algoEventToasts.js";
import { useAlgoCockpitStream } from "./live-streams";
import { useToast } from "./platformContexts.jsx";
import {
  SCREENS,
  SCREEN_RENDER_POLICIES,
  ScreenLoadingFallback,
} from "./screenRegistry.jsx";
import { useElementSize, useViewport } from "../../lib/responsive";
import { FooterMemoryPressureIndicator } from "./FooterMemoryPressureIndicator.jsx";
import { AppTooltip } from "@/components/ui/tooltip";
import { lazyWithRetry } from "../../lib/dynamicImport";
import {
  markScreenReady,
  markScreenSwitchStart,
} from "./performanceMetrics";


const TRANSIENT_SCREEN_IDS = new Set(["diagnostics", "settings"]);
const MOBILE_PRIMARY_SCREEN_IDS = ["market", "flow", "trade", "account"];
const WATCHLIST_SIDEBAR_WIDTH_DEFAULT = 220;
const WATCHLIST_SIDEBAR_WIDTH_MIN = 196;
const WATCHLIST_SIDEBAR_WIDTH_MAX = 320;
const ACTIVITY_SIDEBAR_WIDTH_DEFAULT = 220;
const ACTIVITY_SIDEBAR_WIDTH_MIN = 196;
const ACTIVITY_SIDEBAR_WIDTH_MAX = 320;

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
const ScreenTransitionHost = ({ screenId, active, children }) => {
  const [activationToken, setActivationToken] = useState(0);
  useEffect(() => {
    if (!active) return;
    setActivationToken((current) => (current + 1) % 2);
  }, [active]);
  return (
    <div
      data-testid={`screen-host-${screenId}`}
      aria-hidden={!active}
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
      {children}
    </div>
  );
};

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
      {SCREENS.map(({ id }) => {
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
            active={active}
          >
            <Suspense
              fallback={<ScreenLoadingFallback label={`Loading ${id}`} />}
            >
              {renderScreenById(id)}
              <ScreenReadyProbe screenId={id} active={active} />
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
      borderTop: `1px solid ${T.border}`,
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
            ...motionVars({ accent: T.accent }),
            minWidth: 0,
            minHeight: dim(48),
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: sp(2),
            border: "1px solid transparent",
            borderRadius: dim(RADII.sm),
            background: active ? `${T.accent}12` : "transparent",
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
        ...motionVars({ accent: T.accent }),
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
          ? `${T.accent}12`
          : "transparent",
        color: !MOBILE_PRIMARY_SCREEN_SET.has(activeScreen) ? T.accent : T.textDim,
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
        color: T.textMuted,
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
        color: valueColor || T.textSec,
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
        background: ok ? T.green : T.red,
        flexShrink: 0,
      }}
    />
    <span
      style={{
        color: T.textMuted,
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
        color: T.text,
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
      background: T.border,
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
          background: T.bg1,
          boxShadow: isLeft ? `1px 0 0 ${T.border}` : `-1px 0 0 ${T.border}`,
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
              border: `1px solid ${T.border}`,
              borderRadius: dim(RADII.sm),
              background: T.bg1,
              color: T.textSec,
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
        background: T.bg0,
        boxShadow: isLeft ? `1px 0 0 ${T.border}` : `-1px 0 0 ${T.border}`,
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
  const { isPhone, isNarrow } = viewport.flags;
  const headerWidth = viewport.width || 0;
  const [headerRef, headerSize] = useElementSize();
  const headerEffectiveWidth = headerSize.width || headerWidth;
  const headerTight =
    !isPhone &&
    (isNarrow || (headerEffectiveWidth > 0 && headerEffectiveWidth <= 1440));
  const headerUltraTight =
    !isPhone && headerEffectiveWidth > 0 && headerEffectiveWidth < 1120;
  const headerShowKpis = !isPhone;
  const headerKpiMaxItems =
    !headerEffectiveWidth || headerEffectiveWidth >= 1500
      ? null
      : headerEffectiveWidth >= 1320
        ? 5
        : headerEffectiveWidth >= 1120
          ? 4
          : 2;
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
        (!isPhone && !activitySidebarCollapsed) ||
        (isPhone && (mobileActivityOpen || mobilePulseOpen)) ||
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

    <AppHeader
      headerRef={headerRef}
      isPhone={isPhone}
      headerTight={headerTight}
      headerGridTemplate={headerGridTemplate}
      headerShowKpis={headerShowKpis}
      headerKpiMaxItems={headerKpiMaxItems}
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
      open={isPhone && mobileActivityOpen}
      onClose={() => setMobileActivityOpen(false)}
      environment={environment}
      dataEnabled={algoFrameRuntimeEnabled}
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
      enabled={sessionMetadataSettled}
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
                      border: `1px solid ${T.border}`,
                      borderRadius: dim(RADII.sm),
                      background: "transparent",
                      color: T.textSec,
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
          collapsed={activitySidebarCollapsed}
          width={activitySidebarCollapsed ? 40 : resolvedActivitySidebarWidth}
          resizing={activityResizing}
          onExpand={() => setActivitySidebarCollapsed?.(false)}
          onResizeStart={handleActivityResizeStart}
          ExpandIcon={PanelRightOpen}
        >
          <PlatformAlgoMonitorSidebar
            isVisible={!activitySidebarCollapsed}
            dataEnabled={algoFrameRuntimeEnabled}
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
                    border: `1px solid ${T.border}`,
                    borderRadius: dim(RADII.sm),
                    background: "transparent",
                    color: T.textSec,
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
        const ToastIcon =
          toast.kind === "success"
            ? CheckCircle2
            : toast.kind === "error"
              ? XCircle
              : toast.kind === "warn"
                ? CircleAlert
                : Activity;
      return (
        <AppTooltip key={toast.id} content="Click to dismiss"><div
          key={toast.id}
          onClick={() => onDismiss?.(toast.id)}
          style={{
            background: T.bg1,
            border: `1px solid ${color}33`,
            borderRadius: dim(RADII.xs),
            padding: sp("8px 10px"),
            minWidth: dim(244),
            maxWidth: dim(330),
            boxShadow: ELEVATION.sm,
            animation: toast.leaving
              ? "toastSlideOut 0.2s ease-in forwards"
              : "toastSlideIn 0.22s ease-out",
            pointerEvents: "auto",
            cursor: "pointer",
            transition: "background 0.12s ease, transform 0.12s ease, border-color 0.12s ease",
          }}
          onMouseEnter={(event) => {
            event.currentTarget.style.background = `${color}0f`;
            event.currentTarget.style.borderColor = `${color}55`;
            event.currentTarget.style.transform = "translateX(-2px)";
          }}
          onMouseLeave={(event) => {
            event.currentTarget.style.background = T.bg1;
            event.currentTarget.style.borderColor = `${color}33`;
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
                width: dim(20),
                height: dim(20),
                borderRadius: dim(RADII.xs),
                background: `${color}12`,
                color,
                lineHeight: 1,
                flexShrink: 0,
              }}
            >
              <ToastIcon size={dim(13)} strokeWidth={2.3} />
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: textSize("paragraphMuted"),
                  fontWeight: FONT_WEIGHTS.medium,
                  letterSpacing: 0,
                  color: T.text,
                  marginBottom: toast.body ? sp(2) : 0,
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
                    lineHeight: 1.35,
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
                fontWeight: FONT_WEIGHTS.medium,
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
