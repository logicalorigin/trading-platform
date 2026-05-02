import { Suspense } from "react";
import BloombergLiveDock from "./BloombergLiveDock";
import { MISSING_VALUE, T, dim, fs, sp } from "../../lib/uiTokens.jsx";
import { joinMotionClasses, motionVars } from "../../lib/motion.jsx";
import { SCREENS, ScreenLoadingFallback } from "./screenRegistry.jsx";

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
  activeWatchlist,
  watchlistSymbols,
  signalMonitorStates,
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
}) => (
  <div
    style={{
      height: "100vh",
      display: "flex",
      flexDirection: "column",
      background: T.bg0,
      color: T.text,
      fontFamily: T.sans,
    }}
  >
    <style>{fontCss}</style>
    <ToastStack toasts={toasts} onDismiss={onDismissToast} />
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
        gridTemplateColumns: "auto minmax(0, 1fr) auto",
        alignItems: "center",
        gap: sp(6),
        padding: sp("3px 8px"),
        minWidth: 0,
        background: T.bg1,
        borderBottom: `1px solid ${T.border}`,
        flexShrink: 0,
      }}
    >
      <div
        data-testid="platform-screen-nav"
        style={{
          display: "flex",
          alignItems: "center",
          gap: sp(2),
          minWidth: 0,
          flexWrap: "nowrap",
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
            <button
              key={screen.id}
              className={joinMotionClasses(
                "ra-interactive",
                activeScreen === screen.id && "ra-focus-rail",
              )}
              onClick={() => setScreen(screen.id)}
              style={{
                ...motionVars({
                  accent: hasAlerts ? alertColor : T.accent,
                }),
                padding: sp("3px 6px"),
                minHeight: dim(28),
                fontSize: fs(10),
                fontWeight: 700,
                fontFamily: T.sans,
                background: activeScreen === screen.id ? T.bg3 : "transparent",
                border: `1px solid ${activeScreen === screen.id ? T.accent : T.border}`,
                borderRadius: 0,
                cursor: "pointer",
                color: activeScreen === screen.id ? T.text : T.textDim,
                transition:
                  "background 0.15s ease, color 0.15s ease, border-color 0.15s ease",
                animation: pulseAnim,
                position: "relative",
                whiteSpace: "nowrap",
              }}
              onMouseEnter={(event) => {
                if (activeScreen === screen.id) return;
                event.currentTarget.style.color = T.textSec;
                event.currentTarget.style.background = T.bg2;
                event.currentTarget.style.borderColor = T.textMuted;
              }}
              onMouseLeave={(event) => {
                if (activeScreen === screen.id) return;
                event.currentTarget.style.color = T.textDim;
                event.currentTarget.style.background = "transparent";
                event.currentTarget.style.borderColor = T.border;
              }}
              title={
                hasAlerts
                  ? `${totalAlerts} position${totalAlerts === 1 ? "" : "s"} at alert threshold (${winAlerts} win · ${lossAlerts} loss)`
                  : screen.label
              }
            >
              {screen.label}
              {hasAlerts ? (
                <span
                  style={{
                    marginLeft: sp(3),
                    padding: sp("0px 4px"),
                    borderRadius: 0,
                    background: alertColor,
                    color: "#fff",
                    fontSize: fs(8),
                    fontWeight: 800,
                    fontFamily: T.sans,
                    letterSpacing: "0.04em",
                    verticalAlign: "middle",
                  }}
                >
                  {totalAlerts}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div
        style={{
          minWidth: 0,
          display: "flex",
          alignItems: "center",
        }}
      >
        <HeaderKpiStripComponent onSelect={onSelectSymbol} />
      </div>

      <div
        data-testid="platform-header-controls"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: sp(4),
          minWidth: 0,
          flexWrap: "nowrap",
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

    <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
      <div
        style={{
          width: sidebarCollapsed ? 40 : 248,
          transition: "width 0.2s",
          flexShrink: 0,
          overflow: "hidden",
        }}
      >
        {sidebarCollapsed ? (
          <div
            style={{
              height: "100%",
              background: T.bg1,
              borderRight: `1px solid ${T.border}`,
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
                border: "none",
                borderRadius: 0,
                background: T.bg2,
                color: T.textDim,
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
              style={{
                position: "absolute",
                top: 8,
                right: 6,
                zIndex: 2,
                width: dim(18),
                height: dim(18),
                border: "none",
                borderRadius: 0,
                background: T.bg3,
                color: T.textDim,
                cursor: "pointer",
                fontSize: fs(9),
              }}
            >
              ◂
            </button>
            <WatchlistComponent
              watchlists={watchlists}
              activeWatchlist={activeWatchlist}
              watchlistSymbols={watchlistSymbols}
              signalStates={signalMonitorStates}
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
          return mountedScreens[id] ? (
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
              </Suspense>
            </div>
          ) : null;
        })}
      </div>
    </div>

    <div
      data-testid="platform-bottom-status"
      style={{
        display: "flex",
        alignItems: "center",
        height: dim(24),
        padding: sp("0 12px"),
        background: T.bg1,
        borderTop: `1px solid ${T.border}`,
        flexShrink: 0,
        fontSize: fs(9),
        fontFamily: T.sans,
        gap: sp(12),
      }}
    >
      <span style={{ color: T.textMuted }}>
        WL {(activeWatchlist?.name || "Core").toUpperCase()}
      </span>
      <span style={{ color: T.textMuted }}>SYM {selectedSymbol}</span>
      <span style={{ color: session?.configured?.ibkr ? T.green : T.red }}>
        HIST {(session?.marketDataProviders?.historical || MISSING_VALUE).toUpperCase()}
      </span>
      <span style={{ color: session?.configured?.research ? T.green : T.red }}>
        RSCH {(session?.marketDataProviders?.research || MISSING_VALUE).toUpperCase()}
      </span>
      <span style={{ flex: 1 }} />
      <span style={{ color: T.textMuted }}>v0.1.0</span>
    </div>
    <BloombergLiveDock />
  </div>
);

const ToastStack = ({ toasts, onDismiss }) => (
  toasts.length ? (
    <div
      style={{
        position: "fixed",
        bottom: dim(20),
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
        <div
          key={toast.id}
          onClick={() => onDismiss?.(toast.id)}
          title="Click to dismiss"
          style={{
            background: T.bg2,
            border: `1px solid ${color}`,
            borderLeft: `3px solid ${color}`,
            borderRadius: dim(4),
            padding: sp("8px 12px"),
            minWidth: dim(260),
            maxWidth: dim(340),
            boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
            animation: toast.leaving
              ? "toastSlideOut 0.2s ease-in forwards"
              : "toastSlideIn 0.22s ease-out",
            pointerEvents: "auto",
            cursor: "pointer",
            transition: "transform 0.1s, background 0.1s",
          }}
          onMouseEnter={(event) => {
            event.currentTarget.style.background = T.bg3;
            event.currentTarget.style.transform = "translateX(-2px)";
          }}
          onMouseLeave={(event) => {
            event.currentTarget.style.background = T.bg2;
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
                fontSize: fs(14),
                color,
                fontWeight: 700,
                lineHeight: 1,
                marginTop: 1,
              }}
            >
              {icon}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: fs(11),
                  fontWeight: 700,
                  color: T.text,
                  marginBottom: toast.body ? sp(2) : 0,
                }}
              >
                {toast.title}
              </div>
              {toast.body ? (
                <div
                  style={{
                    fontSize: fs(10),
                    color: T.textSec,
                    fontFamily: T.mono,
                    lineHeight: 1.4,
                  }}
                >
                  {toast.body}
                </div>
              ) : null}
            </div>
            <span
              style={{
                fontSize: fs(11),
                color: T.textMuted,
                fontWeight: 600,
                opacity: 0.6,
                marginLeft: sp(4),
                marginTop: 1,
              }}
            >
              ✕
            </span>
          </div>
        </div>
      );
      })}
    </div>
  ) : null
);
