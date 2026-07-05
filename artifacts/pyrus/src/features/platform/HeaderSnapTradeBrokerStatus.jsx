import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  DatabaseZap,
  ExternalLink,
  PlugZap,
  RefreshCw,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  getGetSnapTradeReadinessQueryKey,
  getListAccountsQueryKey,
  getListBrokerConnectionsQueryKey,
  useGenerateSnapTradeConnectionPortal,
  useGetSnapTradeReadiness,
  useRegisterSnapTradeCurrentUser,
  useSyncSnapTradeBrokerageConnections,
} from "@workspace/api-client-react";
import { AppTooltip } from "@/components/ui/tooltip";
import { Select } from "../../components/platform/primitives.jsx";
import {
  CSS_COLOR,
  cssColorMix,
  dim,
  ELEVATION,
  FONT_WEIGHTS,
  MISSING_VALUE,
  RADII,
  sp,
  T,
  textSize,
} from "../../lib/uiTokens.jsx";
import {
  writeSnapTradeExecutionAccountState,
  useSnapTradeExecutionAccountState,
} from "../broker/snapTradeExecutionAccountStore.js";
import {
  SNAPTRADE_BROKER_CHOICES,
  buildSnapTradeConnectionPortalBody,
} from "../../screens/settings/snapTradeConnectModel.js";

const AUTH_SESSION_QUERY_KEY = ["auth-session"];
const DEFAULT_BROKER = "INTERACTIVE-BROKERS-FLEX";

async function readAuthSession({ signal }) {
  const response = await fetch("/api/auth/session", {
    headers: { Accept: "application/json" },
    signal,
  });
  if (!response.ok) {
    throw new Error("Auth session unavailable");
  }
  return response.json();
}

function readErrorMessage(error, fallback) {
  const payload = error?.data || error?.body || error?.payload;
  return (
    payload?.detail ||
    payload?.message ||
    error?.detail ||
    error?.message ||
    fallback
  );
}

function formatDateTime(value) {
  if (!value) return MISSING_VALUE;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return MISSING_VALUE;
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatAccountCount(count) {
  const value = Number(count || 0);
  return `${value.toLocaleString()} account${value === 1 ? "" : "s"}`;
}

function firstReadyAccountId(accounts) {
  return (
    (Array.isArray(accounts) ? accounts : []).find(
      (account) => account?.executionReady === true,
    )?.id ||
    (Array.isArray(accounts) ? accounts : [])[0]?.id ||
    ""
  );
}

function chooseSyncedAccountId(accounts, selectedAccountId = "") {
  const selected = String(selectedAccountId || "").trim();
  if (
    selected &&
    (Array.isArray(accounts) ? accounts : []).some(
      (account) => account?.id === selected && account?.executionReady === true,
    )
  ) {
    return selected;
  }
  return firstReadyAccountId(accounts);
}

function buildStatusModel({
  authLoading,
  authError,
  credentialsReady,
  executionAccount,
  readinessError,
  readinessLoading,
  userRegistered,
}) {
  if (authLoading || readinessLoading) {
    return {
      label: "Checking",
      tone: CSS_COLOR.textDim,
      Icon: RefreshCw,
      pulse: true,
    };
  }
  if (authError || readinessError) {
    return {
      label: "Session",
      tone: CSS_COLOR.red,
      Icon: AlertTriangle,
      pulse: false,
    };
  }
  if (!credentialsReady) {
    return {
      label: "Setup",
      tone: CSS_COLOR.amber,
      Icon: AlertTriangle,
      pulse: false,
    };
  }
  if (!userRegistered) {
    return {
      label: "Activate",
      tone: CSS_COLOR.amber,
      Icon: PlugZap,
      pulse: false,
    };
  }
  if (executionAccount?.executionReady === true) {
    return {
      label: "Ready",
      tone: CSS_COLOR.green,
      Icon: CheckCircle2,
      pulse: false,
    };
  }
  return {
    label: "Connect",
    tone: CSS_COLOR.accent,
    Icon: PlugZap,
    pulse: false,
  };
}

function StatusRow({ label, value, tone = CSS_COLOR.textSec }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 0.74fr) minmax(0, 1.26fr)",
        gap: sp(8),
        alignItems: "baseline",
        borderBottom: `1px solid ${cssColorMix(CSS_COLOR.border, 35)}`,
        padding: sp("6px 0"),
        fontFamily: T.sans,
        minWidth: 0,
      }}
    >
      <span
        style={{
          color: CSS_COLOR.textMuted,
          fontSize: textSize("caption"),
          fontWeight: FONT_WEIGHTS.medium,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
      <span
        style={{
          color: tone,
          fontSize: textSize("paragraphMuted"),
          fontWeight: FONT_WEIGHTS.medium,
          minWidth: 0,
          overflowWrap: "anywhere",
          textAlign: "right",
        }}
      >
        {value ?? MISSING_VALUE}
      </span>
    </div>
  );
}

function BrokerActionButton({
  children,
  disabled = false,
  loading = false,
  onClick,
  tone = CSS_COLOR.textSec,
  variant = "secondary",
}) {
  const primary = variant === "primary";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-disabled={disabled}
      style={{
        minHeight: dim(30),
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: sp(6),
        padding: sp("6px 10px"),
        border: `1px solid ${primary ? tone : CSS_COLOR.border}`,
        borderRadius: dim(RADII.sm),
        background: primary ? cssColorMix(tone, 10) : CSS_COLOR.bg1,
        color: disabled ? CSS_COLOR.textMuted : tone,
        cursor: disabled ? "default" : "pointer",
        fontSize: textSize("paragraphMuted"),
        fontWeight: FONT_WEIGHTS.medium,
        fontFamily: T.sans,
        letterSpacing: 0,
      }}
    >
      {loading ? (
        <RefreshCw
          size={dim(12)}
          strokeWidth={2.2}
          aria-hidden="true"
          style={{ animation: "premiumFlowSpin 820ms linear infinite" }}
        />
      ) : null}
      {children}
    </button>
  );
}

export function HeaderSnapTradeBrokerStatus({
  compressed = false,
  compact = false,
  minimal = false,
  mobileSheet = false,
  surfaceStyle,
  theme = "dark",
}) {
  const queryClient = useQueryClient();
  const triggerRef = useRef(null);
  const popoverRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [popoverPosition, setPopoverPosition] = useState(null);
  const [selectedBroker, setSelectedBroker] = useState(DEFAULT_BROKER);
  const [lastPortal, setLastPortal] = useState(null);
  const [lastSync, setLastSync] = useState(null);
  const [portalLaunchBlocked, setPortalLaunchBlocked] = useState(false);
  const [localError, setLocalError] = useState("");
  const executionState = useSnapTradeExecutionAccountState();
  const executionAccount = executionState.selectedAccount || null;

  const authSessionQuery = useQuery({
    queryKey: AUTH_SESSION_QUERY_KEY,
    queryFn: readAuthSession,
    staleTime: 60_000,
    retry: false,
  });
  const authSession = authSessionQuery.data || {};
  const csrfToken = authSession.csrfToken || "";
  const csrfHeaders = useMemo(
    () => (csrfToken ? { "x-csrf-token": csrfToken } : {}),
    [csrfToken],
  );

  const readinessQuery = useGetSnapTradeReadiness({
    query: {
      enabled: authSessionQuery.isSuccess,
      retry: false,
      staleTime: 15_000,
    },
  });

  const registerMutation = useRegisterSnapTradeCurrentUser({
    request: { headers: csrfHeaders },
    mutation: {
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: getGetSnapTradeReadinessQueryKey(),
        });
      },
    },
  });

  const portalMutation = useGenerateSnapTradeConnectionPortal({
    request: { headers: csrfHeaders },
  });

  const syncMutation = useSyncSnapTradeBrokerageConnections({
    request: { headers: csrfHeaders },
    mutation: {
      onSuccess: (data) => {
        const accounts = Array.isArray(data?.accounts) ? data.accounts : [];
        const selectedAccountId = chooseSyncedAccountId(
          accounts,
          executionState.selectedAccount?.id,
        );
        writeSnapTradeExecutionAccountState({
          accounts,
          selectedAccountId,
          savedAt: data?.syncedAt,
        });
        setLastSync(data);
        void queryClient.invalidateQueries({
          queryKey: getListBrokerConnectionsQueryKey(),
        });
        void queryClient.invalidateQueries({
          queryKey: getListAccountsQueryKey(),
        });
      },
    },
  });

  const readiness = readinessQuery.data || null;
  const credentialsReady = readiness?.configured === true;
  const userRegistered = Boolean(
    readiness?.user?.registered === true ||
      readiness?.user?.snapTradeUserIdPresent === true,
  );
  const upstreamReady =
    readiness?.clientInfo?.reachable === true ||
    (readiness?.upstream ? readiness.upstream.reachable !== false : false);
  const syncedAccountCount =
    lastSync?.totals?.storedAccounts || executionState.accounts?.length || 0;
  const executionReadyCount =
    lastSync?.accounts?.filter((account) => account.executionReady === true)
      .length ||
    executionState.executionReadyCount ||
    0;
  const statusModel = buildStatusModel({
    authLoading: authSessionQuery.isLoading,
    authError: authSessionQuery.isError,
    credentialsReady,
    executionAccount,
    readinessError: readinessQuery.isError,
    readinessLoading: readinessQuery.isLoading,
    userRegistered,
  });
  const StatusIcon = statusModel.Icon;
  const selectedBrokerLabel =
    SNAPTRADE_BROKER_CHOICES.find((choice) => choice.value === selectedBroker)
      ?.label ||
    SNAPTRADE_BROKER_CHOICES[0]?.label ||
    selectedBroker;
  const busy =
    registerMutation.isPending ||
    portalMutation.isPending ||
    syncMutation.isPending ||
    authSessionQuery.isLoading ||
    readinessQuery.isLoading;
  const mutationError =
    readErrorMessage(registerMutation.error, "") ||
    readErrorMessage(portalMutation.error, "") ||
    readErrorMessage(syncMutation.error, "");
  const visibleError =
    localError ||
    mutationError ||
    (authSessionQuery.error
      ? readErrorMessage(authSessionQuery.error, "Auth session unavailable.")
      : "") ||
    (readinessQuery.error
      ? readErrorMessage(readinessQuery.error, "SnapTrade readiness unavailable.")
      : "");
  const connectDisabled = Boolean(
    !csrfToken ||
      !credentialsReady ||
      registerMutation.isPending ||
      portalMutation.isPending ||
      syncMutation.isPending,
  );
  const syncDisabled = Boolean(
    !csrfToken ||
      !credentialsReady ||
      !userRegistered ||
      registerMutation.isPending ||
      portalMutation.isPending ||
      syncMutation.isPending,
  );
  const triggerAccountLabel =
    executionAccount?.displayName ||
    (syncedAccountCount ? formatAccountCount(syncedAccountCount) : "No account");

  const updatePopoverPosition = useCallback(() => {
    if (typeof window === "undefined" || !triggerRef.current) {
      return;
    }
    const margin = dim(8);
    const gap = dim(6);
    const triggerRect = triggerRef.current.getBoundingClientRect();
    const viewportWidth = window.innerWidth || 0;
    const viewportHeight = window.innerHeight || 0;
    const width = Math.max(
      0,
      Math.min(dim(364), Math.max(0, viewportWidth - margin * 2)),
    );
    const left = Math.min(
      Math.max(margin, triggerRect.right - width),
      Math.max(margin, viewportWidth - margin - width),
    );
    const top = Math.min(
      Math.max(margin, triggerRect.bottom + gap),
      Math.max(margin, viewportHeight - margin - dim(220)),
    );
    setPopoverPosition({
      left,
      top,
      width,
      maxHeight: Math.max(dim(220), viewportHeight - top - margin),
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setPopoverPosition(null);
      return;
    }
    if (mobileSheet) {
      setPopoverPosition(null);
      return;
    }
    updatePopoverPosition();
  }, [mobileSheet, open, updatePopoverPosition]);

  useEffect(() => {
    if (!open || typeof document === "undefined") {
      return undefined;
    }

    if (mobileSheet) {
      const previousOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = previousOverflow;
      };
    }
    return undefined;
  }, [mobileSheet, open]);

  useEffect(() => {
    if (!open || typeof document === "undefined") {
      return undefined;
    }

    const handlePointerDown = (event) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (
        triggerRef.current?.contains(target) ||
        popoverRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
    };
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    const handleReposition = () => {
      if (!mobileSheet) {
        updatePopoverPosition();
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleReposition);
    window.addEventListener("scroll", handleReposition, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleReposition);
      window.removeEventListener("scroll", handleReposition, true);
    };
  }, [mobileSheet, open, updatePopoverPosition]);

  const refresh = useCallback(() => {
    setLocalError("");
    setPortalLaunchBlocked(false);
    void authSessionQuery.refetch();
    void readinessQuery.refetch();
  }, [authSessionQuery, readinessQuery]);

  const launchPortal = useCallback(async () => {
    if (!csrfToken) {
      setLocalError("Auth session is missing a CSRF token.");
      return;
    }
    if (!credentialsReady) {
      setLocalError("SnapTrade app credentials are not configured.");
      return;
    }

    setLocalError("");
    setPortalLaunchBlocked(false);
    try {
      if (!userRegistered) {
        await registerMutation.mutateAsync();
      }
      const portal = await portalMutation.mutateAsync({
        data: {
          ...buildSnapTradeConnectionPortalBody(selectedBroker),
          darkMode: theme === "dark",
        },
      });
      setLastPortal(portal);
      const opened =
        typeof window !== "undefined"
          ? window.open(portal.redirectUri, "_blank", "noopener,noreferrer")
          : null;
      if (!opened) {
        setPortalLaunchBlocked(true);
      }
      void readinessQuery.refetch();
    } catch (error) {
      setLocalError(
        readErrorMessage(error, "SnapTrade Connection Portal could not be opened."),
      );
    }
  }, [
    csrfToken,
    credentialsReady,
    portalMutation,
    readinessQuery,
    registerMutation,
    selectedBroker,
    theme,
    userRegistered,
  ]);

  const syncAccounts = useCallback(async () => {
    if (!csrfToken) {
      setLocalError("Auth session is missing a CSRF token.");
      return;
    }
    if (!credentialsReady) {
      setLocalError("SnapTrade app credentials are not configured.");
      return;
    }

    setLocalError("");
    setPortalLaunchBlocked(false);
    try {
      await syncMutation.mutateAsync();
      void readinessQuery.refetch();
    } catch (error) {
      setLocalError(
        readErrorMessage(error, "SnapTrade accounts could not be synced."),
      );
    }
  }, [csrfToken, credentialsReady, readinessQuery, syncMutation]);

  const popover = (
    <>
      {mobileSheet ? (
        <div
          aria-hidden="true"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 279,
            background: cssColorMix(CSS_COLOR.bg0, 40),
            touchAction: "none",
          }}
        />
      ) : null}
      <div
        ref={popoverRef}
        role="dialog"
        aria-modal={mobileSheet ? true : undefined}
        aria-label="Broker connection"
        style={{
          position: "fixed",
          top: mobileSheet ? "auto" : popoverPosition?.top ?? dim(40),
          left: mobileSheet ? 0 : popoverPosition?.left ?? dim(8),
          right: mobileSheet ? 0 : undefined,
          bottom: mobileSheet ? 0 : undefined,
          zIndex: mobileSheet ? 280 : 240,
          width: mobileSheet ? "100vw" : popoverPosition?.width ?? dim(364),
          maxWidth: mobileSheet ? "100vw" : `calc(100vw - ${dim(16)}px)`,
          maxHeight: mobileSheet
            ? "min(82dvh, 560px)"
            : Math.min(popoverPosition?.maxHeight ?? dim(420), dim(420)),
          visibility: !mobileSheet && !popoverPosition ? "hidden" : undefined,
          overflowY: "auto",
          WebkitOverflowScrolling: mobileSheet ? "touch" : undefined,
          overscrollBehavior: mobileSheet ? "contain" : undefined,
          boxSizing: "border-box",
          padding: mobileSheet
            ? sp("10px 10px max(12px, env(safe-area-inset-bottom))")
            : sp(10),
          background: CSS_COLOR.bg0,
          border: mobileSheet ? `1px solid ${CSS_COLOR.borderLight}` : "none",
          borderBottom: mobileSheet ? "none" : undefined,
          borderTopLeftRadius: mobileSheet ? dim(RADII.md) : undefined,
          borderTopRightRadius: mobileSheet ? dim(RADII.md) : undefined,
          boxShadow: mobileSheet
            ? `0 -18px 48px ${cssColorMix(CSS_COLOR.bg0, 80)}`
            : ELEVATION.lg,
          color: CSS_COLOR.text,
          fontFamily: T.sans,
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) auto auto",
            alignItems: "center",
            gap: sp(6),
            marginBottom: sp(8),
          }}
        >
          <div
            style={{
              minWidth: 0,
              display: "flex",
              alignItems: "baseline",
              gap: sp(6),
              whiteSpace: "nowrap",
            }}
          >
            <span
              style={{
                color: CSS_COLOR.text,
                fontSize: textSize("paragraph"),
                fontWeight: FONT_WEIGHTS.medium,
                lineHeight: 1.15,
              }}
            >
              Broker
            </span>
            <span style={{ color: CSS_COLOR.textMuted }}>/</span>
            <span
              style={{
                color: statusModel.tone,
                fontSize: textSize("paragraph"),
                fontWeight: FONT_WEIGHTS.label,
                lineHeight: 1.15,
              }}
            >
              {statusModel.label}
            </span>
          </div>
          <AppTooltip content="Refresh">
            <button
              type="button"
              onClick={refresh}
              disabled={busy}
              style={{
                width: dim(22),
                height: dim(22),
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                border: "none",
                borderRadius: dim(RADII.sm),
                background: "transparent",
                color: CSS_COLOR.textSec,
                cursor: busy ? "default" : "pointer",
              }}
            >
              <RefreshCw size={dim(13)} strokeWidth={2.2} />
            </button>
          </AppTooltip>
          <AppTooltip content="Close">
            <button
              type="button"
              onClick={() => setOpen(false)}
              style={{
                width: dim(22),
                height: dim(22),
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                border: "none",
                borderRadius: dim(RADII.sm),
                background: "transparent",
                color: CSS_COLOR.textSec,
                cursor: "pointer",
              }}
            >
              <X size={dim(13)} strokeWidth={2.2} />
            </button>
          </AppTooltip>
        </div>

        <div
          style={{
            display: "grid",
            gap: sp(4),
            marginBottom: sp(10),
          }}
        >
          <StatusRow
            label="SnapTrade"
            value={credentialsReady ? "configured" : "missing credentials"}
            tone={credentialsReady ? CSS_COLOR.green : CSS_COLOR.amber}
          />
          <StatusRow
            label="User"
            value={
              userRegistered
                ? "registered"
                : readiness?.user?.nextAction || "activation required"
            }
            tone={userRegistered ? CSS_COLOR.green : CSS_COLOR.amber}
          />
          <StatusRow
            label="Upstream"
            value={
              readiness?.upstream?.status ||
              (upstreamReady ? "available" : "unknown")
            }
            tone={upstreamReady ? CSS_COLOR.green : CSS_COLOR.textDim}
          />
          <StatusRow
            label="Execution"
            value={
              executionAccount?.executionReady
                ? executionAccount.displayName
                : executionReadyCount
                  ? `${executionReadyCount} ready`
                  : "no ready account"
            }
            tone={
              executionAccount?.executionReady
                ? CSS_COLOR.green
                : executionReadyCount
                  ? CSS_COLOR.amber
                  : CSS_COLOR.textDim
            }
          />
          <StatusRow label="Access" value="trade-if-available" />
        </div>

        <Select
          label="Broker target"
          ariaLabel="SnapTrade broker target"
          value={selectedBroker}
          onChange={setSelectedBroker}
          options={SNAPTRADE_BROKER_CHOICES}
          style={{ display: "flex", width: "100%", marginBottom: sp(10) }}
        />

        {visibleError ? (
          <div
            role="alert"
            style={{
              marginBottom: sp(10),
              border: `1px solid ${cssColorMix(CSS_COLOR.amber, 45)}`,
              borderRadius: dim(RADII.sm),
              color: CSS_COLOR.amber,
              background: cssColorMix(CSS_COLOR.amber, 8),
              padding: sp("8px 10px"),
              fontFamily: T.sans,
              fontSize: textSize("caption"),
              lineHeight: 1.4,
              overflowWrap: "anywhere",
            }}
          >
            {visibleError}
          </div>
        ) : null}

        {portalLaunchBlocked && lastPortal?.redirectUri ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: sp(8),
              flexWrap: "wrap",
              marginBottom: sp(10),
              color: CSS_COLOR.textSec,
              fontFamily: T.sans,
              fontSize: textSize("caption"),
            }}
          >
            <span>Popup blocked.</span>
            <a
              href={lastPortal.redirectUri}
              target="_blank"
              rel="noreferrer"
              style={{ color: CSS_COLOR.accent }}
            >
              Open portal
            </a>
          </div>
        ) : null}

        {lastPortal ? (
          <div
            style={{
              display: "flex",
              gap: sp(6),
              flexWrap: "wrap",
              marginBottom: sp(10),
              color: CSS_COLOR.textDim,
              fontFamily: T.sans,
              fontSize: textSize("caption"),
            }}
          >
            <span>{lastPortal.sessionId || "portal session"}</span>
            <span>Expires {formatDateTime(lastPortal.expiresAt)}</span>
            <span>{lastPortal.requestedConnectionType}</span>
          </div>
        ) : null}

        {lastSync ? (
          <div
            style={{
              display: "flex",
              gap: sp(6),
              flexWrap: "wrap",
              marginBottom: sp(10),
              color: CSS_COLOR.textDim,
              fontFamily: T.sans,
              fontSize: textSize("caption"),
            }}
          >
            <span>{lastSync.totals?.storedConnections || 0} connections</span>
            <span>{lastSync.totals?.storedAccounts || 0} accounts</span>
            <span>Synced {formatDateTime(lastSync.syncedAt)}</span>
          </div>
        ) : null}

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: sp(8),
            flexWrap: "wrap",
            borderTop: `1px solid ${cssColorMix(CSS_COLOR.border, 35)}`,
            paddingTop: sp(10),
          }}
        >
          <div
            style={{
              minWidth: 0,
              color: CSS_COLOR.textSec,
              fontFamily: T.sans,
              fontSize: textSize("caption"),
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {selectedBrokerLabel}
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: sp(8),
              flexWrap: "wrap",
            }}
          >
            <BrokerActionButton
              variant="primary"
              tone={CSS_COLOR.accent}
              onClick={launchPortal}
              disabled={connectDisabled}
              loading={registerMutation.isPending || portalMutation.isPending}
            >
              <ExternalLink size={dim(13)} strokeWidth={2.2} aria-hidden="true" />
              {userRegistered ? "Open Portal" : "Activate"}
            </BrokerActionButton>
            <BrokerActionButton
              onClick={syncAccounts}
              disabled={syncDisabled}
              loading={syncMutation.isPending}
            >
              <DatabaseZap size={dim(13)} strokeWidth={2.2} aria-hidden="true" />
              Sync
            </BrokerActionButton>
          </div>
        </div>
      </div>
    </>
  );

  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        flex: mobileSheet ? "0 1 auto" : "0 0 max-content",
        minWidth: 0,
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-label="Open broker connection details"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="ra-hover-accent-bg"
        style={{
          ...surfaceStyle,
          display: "grid",
          gridTemplateColumns: mobileSheet ? "minmax(0, 1fr)" : undefined,
          alignItems: "center",
          justifyContent: "stretch",
          width: mobileSheet ? "auto" : "max-content",
          minWidth: mobileSheet ? 0 : "max-content",
          maxWidth: mobileSheet ? "100%" : "none",
          padding: sp(
            compact
              ? "2px 14px 2px 3px"
              : compressed
                ? "2px 15px 2px 4px"
                : "6px 20px 6px 8px",
          ),
          position: "relative",
          color: CSS_COLOR.text,
          appearance: "none",
          font: "inherit",
          cursor: "pointer",
        }}
      >
        <span
          data-testid="header-snaptrade-broker-status"
          style={{
            display: "grid",
            gap: sp(compressed ? 0 : 4),
            minWidth: 0,
            animation: statusModel.pulse
              ? "ibkrStatusPulse 1.8s ease-in-out infinite"
              : "none",
          }}
        >
          <span
            style={{
              display: "grid",
              gridTemplateColumns: minimal
                ? "auto auto"
                : mobileSheet
                  ? "auto minmax(0, auto) minmax(0, auto)"
                  : "auto auto minmax(0, auto)",
              alignItems: "center",
              gap: sp(compressed ? 4 : 6),
              minWidth: 0,
            }}
          >
            <StatusIcon
              size={dim(compressed ? 12 : 14)}
              strokeWidth={2.3}
              color={statusModel.tone}
              aria-hidden="true"
            />
            <span
              style={{
                color: CSS_COLOR.textMuted,
                fontSize: textSize(compressed ? "micro" : "caption"),
                fontWeight: FONT_WEIGHTS.medium,
                fontFamily: T.sans,
                letterSpacing: compressed ? 0 : "0.04em",
                textTransform: "uppercase",
                whiteSpace: "nowrap",
                ...(mobileSheet
                  ? { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }
                  : null),
              }}
            >
              Broker
            </span>
            {minimal ? null : (
              <span
                style={{
                  color: statusModel.tone,
                  fontSize: textSize("caption"),
                  fontWeight: FONT_WEIGHTS.medium,
                  fontFamily: T.sans,
                  minWidth: 0,
                  maxWidth: dim(compact || compressed ? 72 : 118),
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {statusModel.label}
              </span>
            )}
          </span>
          {compressed || minimal ? null : (
            <span
              style={{
                color: CSS_COLOR.textDim,
                fontSize: textSize("caption"),
                fontWeight: FONT_WEIGHTS.regular,
                fontFamily: T.sans,
                minWidth: 0,
                maxWidth: dim(148),
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {triggerAccountLabel}
            </span>
          )}
        </span>
        <ChevronDown
          size={dim(12)}
          color={CSS_COLOR.textMuted}
          strokeWidth={2.3}
          style={{
            position: "absolute",
            right: dim(5),
            top: dim(compressed ? 3 : 5),
            pointerEvents: "none",
          }}
        />
      </button>

      {open && typeof document !== "undefined"
        ? createPortal(popover, document.body)
        : null}
    </div>
  );
}

export default HeaderSnapTradeBrokerStatus;
