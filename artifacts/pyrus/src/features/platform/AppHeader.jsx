import {
  memo,
  useCallback,
  useEffect,
  useState,
} from "react";
import {
  Activity,
  Bell,
  ChartCandlestick,
  Gauge,
  LineChart,
  List,
  RadioTower,
  Search,
  Settings as SettingsIcon,
  TrendingUp,
  WalletCards,
} from "lucide-react";
import {
  CSS_COLOR,
  cssColorMix,
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
import { AppTooltip } from "@/components/ui/tooltip";
import { PyrusBrandLockup, PyrusWordmark } from "../../components/brand/PyrusLogo";
import { PyrusMark } from "../../components/brand/pyrus-mark";
import { PortfolioPulseZone } from "./PortfolioPulseZone.jsx";
import { CommandPalette } from "./CommandPalette.jsx";
import { SCREENS } from "./screenRegistry.jsx";
import { useAccountSectionTransitionSnapshot } from "./accountSectionTransitionStore.js";
import { useAccountSection } from "./useAccountSection.js";
import { LoadingSpinner, SegmentedControl } from "../../components/platform/primitives.jsx";
import { useUserPreferences } from "../preferences/useUserPreferences";
import { computeUnseenCount, useNotificationSnapshot } from "./notificationStore.js";

const ACCOUNT_SECTION_OPTIONS = [
  { value: "real", label: "Real" },
  { value: "shadow", label: "Shadow" },
];

const AccountSectionTabs = () => {
  const [section, setSection] = useAccountSection();
  return (
    <AppTooltip content="Switch between live broker account and shadow paper account">
      <div
        data-testid="header-account-section-tabs"
        style={{
          display: "inline-flex",
          alignItems: "center",
          flex: "0 0 auto",
        }}
      >
        <SegmentedControl
          options={ACCOUNT_SECTION_OPTIONS}
          value={section}
          onChange={setSection}
          ariaLabel="Account section"
          buttonTestId="header-account-section"
        />
      </div>
    </AppTooltip>
  );
};

const AccountSectionTransitionStatus = () => {
  const { transitioning, targetSection } = useAccountSectionTransitionSnapshot();
  if (!transitioning || !targetSection) {
    return null;
  }

  const label = `Loading ${targetSection}...`;
  const tone = targetSection === "shadow" ? CSS_COLOR.pink : CSS_COLOR.green;
  return (
    <span
      data-testid="header-account-section-transition"
      aria-live="polite"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: sp(5),
        minHeight: dim(24),
        padding: sp("0 8px"),
        borderRadius: dim(RADII.pill),
        border: `1px solid ${CSS_COLOR.border}`,
        background: CSS_COLOR.bg1,
        color: CSS_COLOR.textSec,
        fontFamily: T.sans,
        fontSize: textSize("label"),
        whiteSpace: "nowrap",
        flex: "0 0 auto",
      }}
    >
      <LoadingSpinner size={14} color={tone} />
      {label}
    </span>
  );
};

const ICONIZED_SCREEN_IDS = new Set(["settings"]);

const ModeChip = ({ environment }) => {
  const mode = String(environment || "").toLowerCase();
  const isLive = mode === "live";
  const label = isLive ? "LIVE" : mode === "paper" ? "PAPER" : (environment || "—").toString().toUpperCase();
  const isPaper = mode === "paper";
  const palette = isLive
    ? { bg: `${cssColorMix(CSS_COLOR.red, 13)}`, border: CSS_COLOR.red, text: CSS_COLOR.red }
    : isPaper
      ? { bg: CSS_COLOR.bg0, border: CSS_COLOR.borderLight, text: CSS_COLOR.textSec }
      : { bg: CSS_COLOR.bg0, border: CSS_COLOR.borderLight, text: CSS_COLOR.textMuted };
  return (
    <AppTooltip
      content={
        isLive
          ? "LIVE mode — real broker account, real money"
          : isPaper
            ? "Paper trading mode — no real money at risk"
            : `Mode: ${label}`
      }
    >
      <span
        data-testid="header-mode-chip"
        data-mode={mode}
        aria-label={`Trading mode: ${label}`}
        style={{
          display: "inline-flex",
          alignItems: "center",
          padding: sp("0px 6px"),
          minHeight: dim(18),
          borderRadius: dim(RADII.pill),
          border: `1px solid ${palette.border}`,
          background: palette.bg,
          color: palette.text,
          fontFamily: T.sans,
          fontSize: fs(9),
          fontWeight: FONT_WEIGHTS.medium,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          lineHeight: 1,
          whiteSpace: "nowrap",
          flex: "0 0 auto",
          ...(isLive
            ? { boxShadow: `0 0 0 0 ${cssColorMix(CSS_COLOR.red, 20)}`, animation: "pulseAlertLoss 2.8s ease-in-out infinite" }
            : {}),
        }}
      >
        {label}
      </span>
    </AppTooltip>
  );
};

const isLiveMode = (environment) => String(environment || "").toLowerCase() === "live";

const SCROLLERS_COLLAPSED_STORAGE_KEY = "pyrus.header.scrollersCollapsed.v1";

const readScrollersCollapsed = () => {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(SCROLLERS_COLLAPSED_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
};

const writeScrollersCollapsed = (value) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SCROLLERS_COLLAPSED_STORAGE_KEY, value ? "1" : "0");
  } catch {
    /* swallow quota errors */
  }
};

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

const MOBILE_SYMBOL_CONTEXT_SCREEN_SET = new Set(["market", "flow", "gex", "trade"]);

const fmtCompactCurrency = (value, masked = false) => {
  if (masked) return "****";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return MISSING_VALUE;
  if (Math.abs(numeric) >= 1e6) return `$${(numeric / 1e6).toFixed(2)}M`;
  if (Math.abs(numeric) >= 1e3) return `$${(numeric / 1e3).toFixed(1)}K`;
  return `$${numeric.toFixed(0)}`;
};

const MobileHeaderChip = ({ label, value, tone = CSS_COLOR.text }) => (
  <span
    className="ra-header-chip ra-mobile-header-chip"
    style={{
      minWidth: 0,
      flex: "0 1 auto",
      display: "inline-flex",
      alignItems: "baseline",
      gap: sp(2),
      maxWidth: dim(126),
      minHeight: dim(22),
      padding: sp("2px 6px"),
      border: `1px solid ${CSS_COLOR.borderLight}`,
      borderRadius: dim(RADII.pill),
      background: CSS_COLOR.bg0,
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
        color: CSS_COLOR.textMuted,
        fontSize: textSize("micro"),
        fontWeight: FONT_WEIGHTS.medium,
        letterSpacing: 0,
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
      className="ra-interactive ra-mobile-icon-button"
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
        border: `1px solid ${active ? CSS_COLOR.accent : CSS_COLOR.border}`,
        background: active ? `${cssColorMix(CSS_COLOR.accent, 9)}` : CSS_COLOR.bg1,
        color: active ? CSS_COLOR.accent : CSS_COLOR.textSec,
        borderRadius: dim(RADII.pill),
        cursor: "pointer",
      }}
    >
      <Icon size={16} strokeWidth={2.2} />
    </button>
  </AppTooltip>
);

const MobileHeaderContext = ({ activeScreen, selectedSymbol }) => {
  const screen = SCREENS.find((item) => item.id === activeScreen);
  const label = screen?.label || activeScreen;
  const symbol = MOBILE_SYMBOL_CONTEXT_SCREEN_SET.has(activeScreen)
    ? String(selectedSymbol || "").trim().toUpperCase()
    : "";
  const Icon = MOBILE_NAV_ICONS[activeScreen] || LineChart;
  const accessibleLabel = symbol ? `${label} ${symbol}` : label;

  return (
    <div
      data-testid="mobile-header-context"
      className="ra-mobile-header-context"
      aria-label={accessibleLabel}
      style={{
        minWidth: 0,
        maxWidth: "100%",
        justifySelf: "stretch",
        height: dim(28),
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: sp(5),
        padding: sp("0 8px"),
        border: `1px solid ${CSS_COLOR.borderLight}`,
        borderRadius: dim(RADII.pill),
        background: CSS_COLOR.bg0,
        color: CSS_COLOR.text,
        fontFamily: T.sans,
        boxSizing: "border-box",
        overflow: "hidden",
      }}
    >
      <Icon size={dim(13)} strokeWidth={2.2} color={CSS_COLOR.accent} style={{ flex: "0 0 auto" }} />
      <span
        style={{
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          color: CSS_COLOR.textSec,
          fontSize: textSize("caption"),
          fontWeight: FONT_WEIGHTS.medium,
          lineHeight: 1,
        }}
      >
        {label}
      </span>
      {symbol ? (
        <span
          style={{
            flex: "0 0 auto",
            color: CSS_COLOR.text,
            fontSize: textSize("caption"),
            fontWeight: FONT_WEIGHTS.label,
            lineHeight: 1,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {symbol}
        </span>
      ) : null}
    </div>
  );
};

const AppHeaderInner = ({
  headerRef,
  isPhone,
  headerTight,
  headerGridTemplate,
  headerShowKpis,
  headerKpiMaxItems,
  headerAccountMinimal,
  headerCompactStatus,
  headerStatusMinimal,
  activeScreen,
  handleSetScreen,
  watchlistsBusy,
  selectedSymbol,
  session,
  environment,
  bridgeTone,
  theme,
  onToggleTheme,
  accounts,
  primaryAccountId,
  primaryAccount,
  onSelectAccount,
  maskAccountValues,
  brokerAuthenticated,
  onSelectSymbol,
  mobileActivityOpen,
  mobileWatchlistOpen,
  setMobileActivityOpen,
  setMobileWatchlistOpen,
  mobilePulseOpen,
  setMobilePulseOpen,
  notificationsOpen,
  setNotificationsOpen,
  runtimeWatchlistSymbols,
  sessionMetadataSettled,
  onSignalAction,
  onFlowAction,
  handleAlgoAction,
  algoEventsQuery,
  signalScanEnabled,
  signalScanPending,
  signalEvaluationPending,
  signalScanErrored,
  onToggleSignalScan,
  onChangeSignalMonitorTimeframe,
  onChangeSignalMonitorFreshWindowBars,
  onChangeSignalMonitorMaxSymbols,
  headerSignalMatrixStates,
  signalMatrixStates,
  HeaderKpiStripComponent,
  HeaderAccountStripComponent,
  HeaderStatusClusterComponent,
  HeaderBroadcastScrollerStackComponent,
}) => {
  const compactAccountId = primaryAccountId || accounts?.[0]?.id || MISSING_VALUE;
  const compactNetLiq = fmtCompactCurrency(
    primaryAccount?.netLiquidation,
    maskAccountValues,
  );
  const [scrollersCollapsed, setScrollersCollapsed] = useState(readScrollersCollapsed);
  useEffect(() => {
    writeScrollersCollapsed(scrollersCollapsed);
  }, [scrollersCollapsed]);
  const handleToggleScrollers = useCallback(() => {
    setScrollersCollapsed((current) => !current);
  }, []);

  const [commandOpen, setCommandOpen] = useState(false);
  const openCommandPalette = useCallback(() => setCommandOpen(true), []);
  const closeCommandPalette = useCallback(() => setCommandOpen(false), []);
  useEffect(() => {
    const handler = (event) => {
      const isShortcut =
        (event.metaKey || event.ctrlKey) && (event.key === "k" || event.key === "K");
      if (!isShortcut) return;
      event.preventDefault();
      setCommandOpen((current) => !current);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const isMac = typeof navigator !== "undefined" && /mac/i.test(navigator.platform);

  const { preferences: userPreferences } = useUserPreferences();
  const headerKpiSymbols = userPreferences?.appearance?.headerKpiSymbols;
  const customKpiSymbols =
    Array.isArray(headerKpiSymbols) && headerKpiSymbols.length > 0 ? headerKpiSymbols : null;

  const notifications = useNotificationSnapshot();
  const unseenNotifications = computeUnseenCount(notifications.toasts, notifications.lastReadAt);

  return (
    <>
      <div
        ref={headerRef}
        data-testid="platform-compact-header"
        data-mode={String(environment || "").toLowerCase()}
        className={isPhone ? "ra-mobile-app-header" : undefined}
        style={{
          display: "grid",
          gridTemplateColumns: headerGridTemplate,
          alignItems: "center",
          justifyContent: "stretch",
          gap: sp(isPhone ? 1 : 2),
          padding: isPhone
            ? "max(5px, env(safe-area-inset-top)) 7px 4px"
            : sp(headerTight ? "2px 4px" : "2px 6px"),
          minWidth: 0,
          background: CSS_COLOR.bg1,
          borderTop: isLiveMode(environment) ? `1px solid ${CSS_COLOR.red}` : "none",
          borderBottom: "none",
          boxShadow: `0 1px 0 ${CSS_COLOR.border}`,
          flexShrink: 0,
          overflow: "hidden",
        }}
      >
        {isPhone ? (
          <div
            data-testid="mobile-top-chrome"
            className="ra-mobile-top-chrome"
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr)",
              alignItems: "center",
              gap: sp(3),
              minWidth: 0,
            }}
          >
            <div
              data-testid="mobile-kpi-rail"
              className="ra-hide-scrollbar ra-mobile-kpi-rail"
              style={{
                order: 2,
                display: "flex",
                alignItems: "center",
                gap: sp(5),
                minWidth: 0,
                maxWidth: "100%",
                flexWrap: "nowrap",
                overflowX: "auto",
                overflowY: "hidden",
                padding: sp("0 1px 1px"),
                scrollSnapType: "x proximity",
              }}
            >
              <div
                style={{
                  flex: "0 0 auto",
                  maxWidth: `min(58vw, ${dim(220)}px)`,
                  minWidth: 0,
                  overflow: "hidden",
                }}
              >
                <HeaderStatusClusterComponent
                  session={session}
                  environment={environment}
                  bridgeTone={bridgeTone}
                  theme={theme}
                  onToggleTheme={onToggleTheme}
                  compact
                  mobileSheet
                />
              </div>
              <MobileHeaderChip label="ACCT" value={compactAccountId} />
              <MobileHeaderChip label="NLV" value={compactNetLiq} tone={CSS_COLOR.text} />
            </div>
            <div
              className="ra-mobile-title-bar"
              style={{
                order: 1,
                display: "grid",
                gridTemplateColumns: "auto minmax(0, 1fr) auto",
                alignItems: "center",
                gap: sp(8),
                minWidth: 0,
                width: "100%",
                padding: sp("0 1px"),
              }}
            >
              <div
                aria-label="PYRUS"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: sp(5),
                  justifySelf: "start",
                  minWidth: 0,
                }}
              >
                <PyrusMark className="h-[21px] w-[21px]" />
                <PyrusWordmark width={96} title="" style={{ color: CSS_COLOR.text }} />
                <ModeChip environment={environment} />
              </div>
              <MobileHeaderContext
                activeScreen={activeScreen}
                selectedSymbol={selectedSymbol}
              />
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: sp(6),
                  justifySelf: "end",
                }}
              >
                <MobileIconButton
                  Icon={TrendingUp}
                  label="Open portfolio pulse"
                  testId="mobile-pulse-trigger"
                  onClick={() => setMobilePulseOpen && setMobilePulseOpen(true)}
                  active={Boolean(mobilePulseOpen)}
                />
                <MobileIconButton
                  Icon={RadioTower}
                  label="Open algo monitor"
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
          </div>
        ) : (
          <>
            <div
              aria-label="PYRUS"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: sp(3),
                justifySelf: "start",
                minWidth: 0,
                paddingInline: sp(3),
              }}
            >
              <PyrusBrandLockup compact={headerTight} />
              <ModeChip environment={environment} />
            </div>

            <div
              data-testid="platform-screen-nav"
              className="ra-hide-scrollbar"
              style={{
                display: "flex",
                alignItems: "center",
                gap: sp(1),
                width: "auto",
                maxWidth: "100%",
                minWidth: 0,
                flex: "0 1 auto",
                flexWrap: "nowrap",
                overflow: "hidden",
                justifySelf: "start",
              }}
            >
              {SCREENS.map((screen) => {
                const isIconized = ICONIZED_SCREEN_IDS.has(screen.id);
                return (
                  <AppTooltip key={screen.id} content={screen.label}>
                    <button
                      className={joinMotionClasses(
                        "ra-interactive",
                        activeScreen === screen.id && "ra-focus-rail",
                      )}
                      onClick={() => handleSetScreen(screen.id)}
                      style={{
                        ...motionVars({ accent: CSS_COLOR.accent }),
                        padding: isIconized ? sp("2px 4px") : sp("2px 5px"),
                        minHeight: dim(22),
                        fontSize: textSize("body"),
                        fontWeight: FONT_WEIGHTS.medium,
                        fontFamily: T.sans,
                        background: "transparent",
                        border: "none",
                        borderRadius: 0,
                        cursor: "pointer",
                        color: activeScreen === screen.id ? CSS_COLOR.text : CSS_COLOR.textSec,
                        boxShadow:
                          activeScreen === screen.id
                            ? `inset 0 -1px 0 ${CSS_COLOR.accent}`
                            : "none",
                        transition: "color 0.18s ease, box-shadow 0.18s ease",
                        position: "relative",
                        whiteSpace: "nowrap",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: sp(2),
                      }}
                      onMouseEnter={(event) => {
                        if (activeScreen === screen.id) return;
                        event.currentTarget.style.color = CSS_COLOR.text;
                      }}
                      onMouseLeave={(event) => {
                        if (activeScreen === screen.id) return;
                        event.currentTarget.style.color = CSS_COLOR.textSec;
                      }}
                    >
                      {isIconized ? (
                        <SettingsIcon size={dim(14)} strokeWidth={2} aria-hidden="true" />
                      ) : (
                        screen.label
                      )}
                    </button>
                  </AppTooltip>
                );
              })}
            </div>

            <div aria-hidden="true" style={{ minWidth: 0 }} />

            <div
              data-testid="platform-header-controls"
              className="ra-hide-scrollbar"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "flex-end",
                gap: sp(1),
                width: "auto",
                maxWidth: "100%",
                minWidth: 0,
                flex: "0 1 auto",
                flexWrap: "nowrap",
                overflow: "hidden",
                justifySelf: "end",
              }}
            >
              <AppTooltip content={`Open command palette (${isMac ? "⌘" : "Ctrl"}+K)`}>
                <button
                  type="button"
                  data-testid="header-command-palette-trigger"
                  className="ra-interactive"
                  onClick={openCommandPalette}
                  aria-label="Open command palette"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: sp(2),
                    minHeight: dim(22),
                    padding: sp("0 6px"),
                    background: "transparent",
                    border: `1px solid ${CSS_COLOR.borderLight}`,
                    borderRadius: dim(RADII.xs),
                    color: CSS_COLOR.textSec,
                    cursor: "pointer",
                    fontFamily: T.sans,
                    fontSize: textSize("body"),
                    fontWeight: FONT_WEIGHTS.medium,
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
                  <Search size={dim(13)} strokeWidth={2.2} aria-hidden="true" />
                  {headerCompactStatus ? null : (
                    <span
                      style={{
                        fontFamily: T.mono,
                        fontSize: fs(10),
                        color: CSS_COLOR.textMuted,
                        letterSpacing: "0.04em",
                      }}
                    >
                      {isMac ? "⌘K" : "Ctrl K"}
                    </span>
                  )}
                </button>
              </AppTooltip>
              <AppTooltip content={unseenNotifications > 0 ? `${unseenNotifications} new notification${unseenNotifications === 1 ? "" : "s"}` : "Notifications"}>
                <button
                  type="button"
                  data-testid="header-notifications-trigger"
                  className="ra-interactive"
                  onClick={() => setNotificationsOpen && setNotificationsOpen(true)}
                  aria-label={
                    unseenNotifications > 0
                      ? `Notifications (${unseenNotifications} unread)`
                      : "Notifications"
                  }
                  aria-pressed={Boolean(notificationsOpen)}
                  style={{
                    position: "relative",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: dim(26),
                    height: dim(22),
                    background: "transparent",
                    border: `1px solid ${CSS_COLOR.borderLight}`,
                    borderRadius: dim(RADII.xs),
                    color: unseenNotifications > 0 ? CSS_COLOR.accent : CSS_COLOR.textSec,
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
                    event.currentTarget.style.color = unseenNotifications > 0 ? CSS_COLOR.accent : CSS_COLOR.textSec;
                    event.currentTarget.style.borderColor = CSS_COLOR.borderLight;
                  }}
                >
                  <Bell size={dim(13)} strokeWidth={2.2} aria-hidden="true" />
                  {unseenNotifications > 0 ? (
                    <span
                      style={{
                        position: "absolute",
                        top: -3,
                        right: -3,
                        minWidth: dim(13),
                        height: dim(13),
                        padding: sp("0px 3px"),
                        borderRadius: dim(RADII.pill),
                        background: CSS_COLOR.accent,
                        color: CSS_COLOR.onAccent,
                        fontFamily: T.sans,
                        fontSize: fs(8),
                        fontWeight: FONT_WEIGHTS.medium,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        lineHeight: 1,
                      }}
                    >
                      {unseenNotifications > 9 ? "9+" : unseenNotifications}
                    </span>
                  ) : null}
                </button>
              </AppTooltip>
              <AccountSectionTabs />
              <AccountSectionTransitionStatus />
              <HeaderAccountStripComponent
                accounts={accounts}
                primaryAccountId={primaryAccountId}
                primaryAccount={primaryAccount}
                onSelectAccount={onSelectAccount}
                maskValues={maskAccountValues}
                compact={headerTight}
                minimal={headerAccountMinimal}
                dense
              />
              <HeaderStatusClusterComponent
                session={session}
                environment={environment}
                bridgeTone={bridgeTone}
                theme={theme}
                onToggleTheme={onToggleTheme}
                showThemeToggle={false}
                compact={headerCompactStatus}
                minimal={headerStatusMinimal}
                dense
              />
            </div>
          </>
        )}
      </div>

      {!isPhone ? (
        <PortfolioPulseZone
          accountId={primaryAccountId}
          mode={environment}
          maskValues={maskAccountValues}
          brokerAuthenticated={brokerAuthenticated}
          watchlistsBusy={watchlistsBusy}
          algoEvents={algoEventsQuery?.data?.events}
          onAlertClick={() => handleSetScreen("trade")}
          onPositionsClick={() => handleSetScreen("trade")}
          onOrdersClick={() => handleSetScreen("trade")}
          onSignalsClick={() => handleSetScreen("flow")}
          onFlowClick={() => handleSetScreen("flow")}
          onAlgoClick={() => handleSetScreen("algo")}
          scrollersCollapsed={scrollersCollapsed}
          onToggleScrollers={handleToggleScrollers}
          enabled={sessionMetadataSettled}
          compact={headerTight}
          centerSlot={
            headerShowKpis ? (
              <HeaderKpiStripComponent
                onSelect={onSelectSymbol}
                compact={headerTight}
                dense
                maxItems={headerKpiMaxItems}
                symbols={customKpiSymbols}
              />
            ) : null
          }
        />
      ) : null}

      {scrollersCollapsed && !isPhone ? null : (
      <HeaderBroadcastScrollerStackComponent
        symbols={runtimeWatchlistSymbols}
        enabled={sessionMetadataSettled}
        onSignalAction={onSignalAction}
        onFlowAction={onFlowAction}
        onAlgoAction={handleAlgoAction}
        algoEvents={algoEventsQuery?.data?.events || []}
        signalScanEnabled={signalScanEnabled}
        signalScanPending={signalScanPending}
        signalEvaluationPending={signalEvaluationPending}
        signalScanErrored={signalScanErrored}
        onToggleSignalScan={onToggleSignalScan}
        onChangeSignalMonitorTimeframe={onChangeSignalMonitorTimeframe}
        onChangeSignalMonitorFreshWindowBars={onChangeSignalMonitorFreshWindowBars}
        onChangeSignalMonitorMaxSymbols={onChangeSignalMonitorMaxSymbols}
        signalMatrixStates={
          headerSignalMatrixStates?.length ? headerSignalMatrixStates : signalMatrixStates
        }
      />
      )}

      <CommandPalette
        open={commandOpen}
        onClose={closeCommandPalette}
        onSelectSymbol={onSelectSymbol}
        handleSetScreen={handleSetScreen}
        theme={theme}
        onToggleTheme={onToggleTheme}
        scrollersCollapsed={scrollersCollapsed}
        onToggleScrollers={handleToggleScrollers}
      />
    </>
  );
};

export const AppHeader = memo(AppHeaderInner);
