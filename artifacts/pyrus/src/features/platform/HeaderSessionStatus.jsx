import { useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  KeyRound,
  LogIn,
  LogOut,
  RefreshCw,
  UserRound,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { AppTooltip } from "@/components/ui/tooltip";
import {
  CSS_COLOR,
  cssColorMix,
  dim,
  ELEVATION,
  FONT_WEIGHTS,
  RADII,
  sp,
  T,
  textSize,
} from "../../lib/uiTokens.jsx";
import { useAuthSession } from "../auth/authSession.jsx";
import {
  buildFirstRunBody,
  buildSignInBody,
  describeSessionUser,
  validateFirstRunInput,
  validateSignInInput,
} from "./headerSessionModel.js";

async function postAuthJson(path, body, headers = {}) {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const error = new Error(
      payload?.detail ||
        payload?.title ||
        payload?.message ||
        `HTTP ${response.status}`,
    );
    error.data = payload;
    error.status = response.status;
    throw error;
  }
  return payload;
}

function SessionStatusRow({ label, value, tone = CSS_COLOR.textSec }) {
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
        {value}
      </span>
    </div>
  );
}

function SessionActionButton({
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
      type="submit"
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

function SessionField({
  autoComplete,
  label,
  name,
  onChange,
  placeholder,
  testId,
  type = "text",
  value,
}) {
  return (
    <label
      style={{
        display: "grid",
        gap: sp(3),
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
        }}
      >
        {label}
      </span>
      <input
        data-testid={testId}
        type={type}
        name={name}
        autoComplete={autoComplete}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        style={{
          minHeight: dim(30),
          boxSizing: "border-box",
          width: "100%",
          padding: sp("6px 8px"),
          border: `1px solid ${CSS_COLOR.border}`,
          borderRadius: dim(RADII.sm),
          background: CSS_COLOR.bg1,
          color: CSS_COLOR.text,
          fontSize: textSize("paragraphMuted"),
          fontFamily: T.sans,
        }}
      />
    </label>
  );
}

export function HeaderSessionStatus({
  compressed = false,
  compact = false,
  mobileSheet = false,
  surfaceStyle,
}) {
  const queryClient = useQueryClient();
  const triggerRef = useRef(null);
  const popoverRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [popoverPosition, setPopoverPosition] = useState(null);
  const [mode, setMode] = useState("signin");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [bootstrapToken, setBootstrapToken] = useState("");
  const [pending, setPending] = useState(false);
  const [localError, setLocalError] = useState("");

  const authSession = useAuthSession();
  const sessionUser = authSession.user || null;
  const csrfToken = authSession.csrfToken || "";
  const signedIn = Boolean(sessionUser);

  const statusLabel = authSession.isLoading
    ? "Checking"
    : signedIn
      ? describeSessionUser(sessionUser)
      : "Sign in";
  const statusTone = authSession.isLoading
    ? CSS_COLOR.textDim
    : signedIn
      ? CSS_COLOR.green
      : CSS_COLOR.accent;

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
      Math.min(dim(324), Math.max(0, viewportWidth - margin * 2)),
    );
    const left = Math.min(
      Math.max(margin, triggerRect.right - width),
      Math.max(margin, viewportWidth - margin - width),
    );
    const top = Math.min(
      Math.max(margin, triggerRect.bottom + gap),
      Math.max(margin, viewportHeight - margin - dim(200)),
    );
    setPopoverPosition({
      left,
      top,
      width,
      maxHeight: Math.max(dim(200), viewportHeight - top - margin),
    });
  }, []);

  useLayoutEffect(() => {
    if (!open || mobileSheet) {
      setPopoverPosition(null);
      return;
    }
    updatePopoverPosition();
  }, [mobileSheet, open, updatePopoverPosition]);

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

  const finishAuthChange = useCallback(() => {
    setPassword("");
    setBootstrapToken("");
    setLocalError("");
    // Refresh the session immediately so the header flips to the new state.
    // Mark everything else stale WITHOUT forcing an immediate app-wide refetch
    // (that thundering herd can hang the spinner under load); those queries
    // refetch lazily on next access.
    void authSession.refresh();
    void queryClient.invalidateQueries({ refetchType: "none" });
  }, [authSession, queryClient]);

  const submitSignIn = useCallback(async () => {
    const input = { email, password };
    const validation = validateSignInInput(input);
    if (!validation.ok) {
      setLocalError(validation.error);
      return;
    }
    setPending(true);
    setLocalError("");
    try {
      await postAuthJson("/api/auth/login", buildSignInBody(input));
      finishAuthChange();
      setOpen(false);
    } catch (error) {
      setLocalError(error?.message || "Sign in failed.");
    } finally {
      setPending(false);
    }
  }, [email, finishAuthChange, password]);

  const submitFirstRun = useCallback(async () => {
    const input = { email, displayName, password, bootstrapToken };
    const validation = validateFirstRunInput(input);
    if (!validation.ok) {
      setLocalError(validation.error);
      return;
    }
    setPending(true);
    setLocalError("");
    try {
      await postAuthJson("/api/auth/bootstrap", buildFirstRunBody(input));
      finishAuthChange();
      setOpen(false);
    } catch (error) {
      if (error?.data?.code === "bootstrap_already_complete") {
        setLocalError("An account already exists. Use sign in instead.");
        setMode("signin");
      } else {
        setLocalError(error?.message || "First-time setup failed.");
      }
    } finally {
      setPending(false);
    }
  }, [bootstrapToken, displayName, email, finishAuthChange, password]);

  const submitSignOut = useCallback(async () => {
    setPending(true);
    setLocalError("");
    try {
      await postAuthJson(
        "/api/auth/logout",
        {},
        csrfToken ? { "x-csrf-token": csrfToken } : {},
      );
      finishAuthChange();
    } catch (error) {
      setLocalError(error?.message || "Sign out failed.");
    } finally {
      setPending(false);
    }
  }, [csrfToken, finishAuthChange]);

  const handleSubmit = useCallback(
    (event) => {
      event.preventDefault();
      if (pending) return;
      if (signedIn) {
        void submitSignOut();
        return;
      }
      if (mode === "firstrun") {
        void submitFirstRun();
        return;
      }
      void submitSignIn();
    },
    [mode, pending, signedIn, submitFirstRun, submitSignIn, submitSignOut],
  );

  const popoverBody = (
    <div
      ref={popoverRef}
      role="dialog"
      aria-modal={mobileSheet ? true : undefined}
      aria-label="Account session"
      style={{
        position: "fixed",
        top: mobileSheet ? "auto" : (popoverPosition?.top ?? dim(40)),
        left: mobileSheet ? 0 : (popoverPosition?.left ?? dim(8)),
        right: mobileSheet ? 0 : undefined,
        bottom: mobileSheet ? 0 : undefined,
        zIndex: mobileSheet ? 280 : 240,
        width: mobileSheet ? "100vw" : (popoverPosition?.width ?? dim(324)),
        maxWidth: mobileSheet ? "100vw" : `calc(100vw - ${dim(16)}px)`,
        maxHeight: mobileSheet
          ? "min(82dvh, 560px)"
          : Math.min(popoverPosition?.maxHeight ?? dim(430), dim(430)),
        visibility: !mobileSheet && !popoverPosition ? "hidden" : undefined,
        overflowY: "auto",
        boxSizing: "border-box",
        padding: mobileSheet
          ? sp("10px 10px max(12px, env(safe-area-inset-bottom))")
          : sp(10),
        background: CSS_COLOR.bg0,
        border: mobileSheet ? `1px solid ${CSS_COLOR.borderLight}` : "none",
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
          gridTemplateColumns: "minmax(0, 1fr) auto",
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
            Account
          </span>
          <span style={{ color: CSS_COLOR.textMuted }}>/</span>
          <span
            style={{
              color: statusTone,
              fontSize: textSize("paragraph"),
              fontWeight: FONT_WEIGHTS.label,
              lineHeight: 1.15,
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {statusLabel}
          </span>
        </div>
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

      <form onSubmit={handleSubmit} noValidate style={{ display: "grid", gap: sp(8) }}>
        {signedIn ? (
          <>
            <div style={{ display: "grid" }}>
              <SessionStatusRow
                label="User"
                value={describeSessionUser(sessionUser)}
                tone={CSS_COLOR.green}
              />
              <SessionStatusRow
                label="Email"
                value={sessionUser?.email || "unknown"}
              />
              <SessionStatusRow
                label="Role"
                value={sessionUser?.role || "unknown"}
                tone={
                  sessionUser?.role === "admin"
                    ? CSS_COLOR.accent
                    : CSS_COLOR.textSec
                }
              />
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <SessionActionButton
                variant="primary"
                tone={CSS_COLOR.amber}
                disabled={pending || !csrfToken}
                loading={pending}
              >
                <LogOut size={dim(13)} strokeWidth={2.2} aria-hidden="true" />
                Sign out
              </SessionActionButton>
            </div>
          </>
        ) : (
          <>
            <SessionField
              label="Email"
              name="email"
              type="email"
              autoComplete="email"
              testId="header-session-email"
              value={email}
              onChange={setEmail}
              placeholder="you@example.com"
            />
            {mode === "firstrun" ? (
              <SessionField
                label="Display name"
                name="displayName"
                autoComplete="name"
                testId="header-session-display-name"
                value={displayName}
                onChange={setDisplayName}
                placeholder="Optional"
              />
            ) : null}
            <SessionField
              label="Password"
              name="password"
              type="password"
              autoComplete={
                mode === "firstrun" ? "new-password" : "current-password"
              }
              testId="header-session-password"
              value={password}
              onChange={setPassword}
              placeholder={
                mode === "firstrun" ? "At least 12 characters" : "Password"
              }
            />
            {mode === "firstrun" ? (
              <SessionField
                label="Setup token"
                name="bootstrapToken"
                type="password"
                autoComplete="off"
                testId="header-session-bootstrap-token"
                value={bootstrapToken}
                onChange={setBootstrapToken}
                placeholder="PYRUS_AUTH_BOOTSTRAP_TOKEN value"
              />
            ) : null}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: sp(8),
                flexWrap: "wrap",
              }}
            >
              <button
                type="button"
                onClick={() => {
                  setLocalError("");
                  setMode((current) =>
                    current === "firstrun" ? "signin" : "firstrun",
                  );
                }}
                style={{
                  border: "none",
                  background: "transparent",
                  color: CSS_COLOR.textSec,
                  cursor: "pointer",
                  fontFamily: T.sans,
                  fontSize: textSize("caption"),
                  padding: 0,
                  textDecoration: "underline",
                }}
              >
                {mode === "firstrun" ? "Back to sign in" : "First-time setup"}
              </button>
              <SessionActionButton
                variant="primary"
                tone={CSS_COLOR.accent}
                disabled={pending}
                loading={pending}
              >
                {mode === "firstrun" ? (
                  <KeyRound size={dim(13)} strokeWidth={2.2} aria-hidden="true" />
                ) : (
                  <LogIn size={dim(13)} strokeWidth={2.2} aria-hidden="true" />
                )}
                {mode === "firstrun" ? "Create admin account" : "Sign in"}
              </SessionActionButton>
            </div>
          </>
        )}

        {localError ? (
          <div
            role="alert"
            style={{
              border: `1px solid ${cssColorMix(CSS_COLOR.amber, 45)}`,
              borderRadius: dim(RADII.sm),
              background: cssColorMix(CSS_COLOR.amber, 12),
              color: CSS_COLOR.amber,
              padding: sp("6px 8px"),
              fontSize: textSize("caption"),
              fontFamily: T.sans,
              overflowWrap: "anywhere",
            }}
          >
            {localError}
          </div>
        ) : null}
      </form>
    </div>
  );

  return (
    <div style={{ position: "relative", display: "flex", flex: "0 0 max-content" }}>
      <button
        ref={triggerRef}
        type="button"
        aria-label="Open account session details"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="ra-hover-accent-bg"
        style={{
          ...surfaceStyle,
          display: "grid",
          alignItems: "center",
          justifyContent: "stretch",
          width: "max-content",
          minWidth: "max-content",
          maxWidth: "none",
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
          data-testid="header-session-status"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: sp(5),
            width: "max-content",
            whiteSpace: "nowrap",
            fontFamily: T.sans,
            fontSize: textSize("caption"),
          }}
        >
          <UserRound
            size={dim(12)}
            strokeWidth={2.2}
            aria-hidden="true"
            style={{ color: statusTone }}
          />
          <span
            style={{
              color: CSS_COLOR.textMuted,
              fontWeight: FONT_WEIGHTS.medium,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
            }}
          >
            Account
          </span>
          <span
            style={{
              color: statusTone,
              fontWeight: FONT_WEIGHTS.medium,
              maxWidth: dim(140),
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {statusLabel}
          </span>
          <ChevronDown
            size={dim(11)}
            strokeWidth={2.2}
            aria-hidden="true"
            style={{ color: CSS_COLOR.textMuted }}
          />
        </span>
      </button>
      {open && typeof document !== "undefined"
        ? createPortal(popoverBody, document.body)
        : null}
    </div>
  );
}
