import { useCallback, useState } from "react";
import { Button } from "../../components/ui/button.tsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card.tsx";
import { Input } from "../../components/ui/input.tsx";
import { Label } from "../../components/ui/label.tsx";
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
import {
  buildFirstRunBody,
  buildSignInBody,
  validateFirstRunInput,
  validateSignInInput,
} from "../platform/headerSessionModel.js";
import { postAuthJson, useAuthSession } from "./authSession.jsx";

// Slice 8: the SPA login wall. Rendered inside AppProviders but ABOVE
// <PlatformApp/> so the workspace (and its SSE streams / platform queries) never
// mounts for an unauthenticated visitor. Members provisioned via the /auth/launch
// handoff already carry a session cookie, so they pass straight through; this wall
// is what an operator without a session (or a signed-out session) sees. It reuses
// the same endpoints + validators as the header sign-in popover.

function FullScreenCenter({ children }) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 130,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: sp(16),
        background: CSS_COLOR.bg0,
        overflowY: "auto",
      }}
      className="dark"
    >
      {children}
    </div>
  );
}

export function LoginGate({ children }) {
  const { signedIn, isLoading, refresh } = useAuthSession();

  const [mode, setMode] = useState("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [bootstrapToken, setBootstrapToken] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  const isFirstRun = mode === "firstrun";

  const handleSubmit = useCallback(
    async (event) => {
      event.preventDefault();
      if (pending) return;

      const input = isFirstRun
        ? { email, displayName, password, bootstrapToken }
        : { email, password };
      const validation = isFirstRun
        ? validateFirstRunInput(input)
        : validateSignInInput(input);
      if (!validation.ok) {
        setError(validation.error);
        return;
      }

      setPending(true);
      setError("");
      try {
        if (isFirstRun) {
          await postAuthJson("/api/auth/bootstrap", buildFirstRunBody(input));
        } else {
          await postAuthJson("/api/auth/login", buildSignInBody(input));
        }
        // Keep the button in its loading state until the session query flips —
        // the gate then swaps this wall for the app in one paint.
        await refresh();
      } catch (submitError) {
        if (submitError?.data?.code === "bootstrap_already_complete") {
          setError("An account already exists. Sign in instead.");
          setMode("signin");
        } else {
          setError(
            submitError?.message ||
              (isFirstRun ? "Setup failed." : "Sign in failed."),
          );
        }
        setPending(false);
      }
    },
    [
      bootstrapToken,
      displayName,
      email,
      isFirstRun,
      password,
      pending,
      refresh,
    ],
  );

  // Auth state not yet known — render nothing behind the boot overlay rather
  // than flashing the wall or mounting the (unauthenticated) workspace.
  if (isLoading) {
    return <FullScreenCenter>{null}</FullScreenCenter>;
  }

  if (signedIn) {
    return children;
  }

  return (
    <FullScreenCenter>
      <Card style={{ width: "100%", maxWidth: dim(380) }}>
        <CardHeader>
          <div style={{ display: "grid", gap: sp(6) }}>
            <CardTitle
              style={{
                fontFamily: T.sans,
                fontSize: textSize("screenTitle"),
                fontWeight: FONT_WEIGHTS.emphasis,
                letterSpacing: "0.14em",
                color: CSS_COLOR.text,
              }}
            >
              PYRUS
            </CardTitle>
            <CardDescription
              style={{
                fontFamily: T.sans,
                fontSize: textSize("body"),
                color: CSS_COLOR.textSec,
              }}
            >
              {isFirstRun
                ? "Create the operator account to get started."
                : "Sign in to continue."}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} aria-label={isFirstRun ? "First-time setup" : "Sign in"} style={{ display: "grid", gap: sp(14) }}>
            <div style={{ display: "grid", gap: sp(14) }}>
              <div style={{ display: "grid", gap: sp(6) }}>
                <Label htmlFor="email" style={{ color: CSS_COLOR.textSec, fontSize: textSize("caption"), fontWeight: FONT_WEIGHTS.medium, fontFamily: T.sans }}>
                  Email
                </Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="username"
                  style={{
                    background: CSS_COLOR.bg0,
                    borderColor: CSS_COLOR.border,
                    color: CSS_COLOR.text,
                    fontSize: textSize("body"),
                    fontFamily: T.sans,
                  }}
                />
              </div>
              {isFirstRun ? (
                <div style={{ display: "grid", gap: sp(6) }}>
                  <Label htmlFor="displayName" style={{ color: CSS_COLOR.textSec, fontSize: textSize("caption"), fontWeight: FONT_WEIGHTS.medium, fontFamily: T.sans }}>
                    Display name (optional)
                  </Label>
                  <Input
                    id="displayName"
                    type="text"
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    autoComplete="name"
                    style={{
                      background: CSS_COLOR.bg0,
                      borderColor: CSS_COLOR.border,
                      color: CSS_COLOR.text,
                      fontSize: textSize("body"),
                      fontFamily: T.sans,
                    }}
                  />
                </div>
              ) : null}
              <div style={{ display: "grid", gap: sp(6) }}>
                <Label htmlFor="password" style={{ color: CSS_COLOR.textSec, fontSize: textSize("caption"), fontWeight: FONT_WEIGHTS.medium, fontFamily: T.sans }}>
                  Password
                </Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete={isFirstRun ? "new-password" : "current-password"}
                  style={{
                    background: CSS_COLOR.bg0,
                    borderColor: CSS_COLOR.border,
                    color: CSS_COLOR.text,
                    fontSize: textSize("body"),
                    fontFamily: T.sans,
                  }}
                />
                {isFirstRun && (
                  <span style={{ color: CSS_COLOR.textMuted, fontSize: textSize("caption"), fontFamily: T.sans }}>
                    At least 12 characters.
                  </span>
                )}
              </div>
              {isFirstRun ? (
                <div style={{ display: "grid", gap: sp(6) }}>
                  <Label htmlFor="bootstrapToken" style={{ color: CSS_COLOR.textSec, fontSize: textSize("caption"), fontWeight: FONT_WEIGHTS.medium, fontFamily: T.sans }}>
                    Setup token
                  </Label>
                  <Input
                    id="bootstrapToken"
                    type="password"
                    value={bootstrapToken}
                    onChange={(event) => setBootstrapToken(event.target.value)}
                    style={{
                      background: CSS_COLOR.bg0,
                      borderColor: CSS_COLOR.border,
                      color: CSS_COLOR.text,
                      fontSize: textSize("body"),
                      fontFamily: T.sans,
                    }}
                  />
                  <span style={{ color: CSS_COLOR.textMuted, fontSize: textSize("caption"), fontFamily: T.sans }}>
                    From the PYRUS_AUTH_BOOTSTRAP_TOKEN secret.
                  </span>
                </div>
              ) : null}
            </div>

            {error ? (
              <div
                role="alert"
                style={{
                  padding: sp("8px 12px"),
                  borderRadius: RADII.md,
                  background: cssColorMix(CSS_COLOR.red, 12),
                  border: `1px solid ${cssColorMix(CSS_COLOR.red, 40)}`,
                  color: CSS_COLOR.red,
                  fontSize: textSize("caption"),
                  fontFamily: T.sans,
                }}
              >
                {error}
              </div>
            ) : null}

            <Button
              type="submit"
              variant="default"
              size="default"
              style={{
                width: "100%",
                background: CSS_COLOR.text,
                color: CSS_COLOR.bg0,
                fontFamily: T.sans,
                padding: sp("10px 12px"),
                opacity: pending ? 0.7 : 1,
                cursor: pending ? "not-allowed" : "pointer",
              }}
              disabled={pending}
              data-testid="login-gate-submit"
            >
              {isFirstRun ? "Create account" : "Sign in"}
            </Button>

            <button
              type="button"
              onClick={() => {
                setError("");
                setMode(isFirstRun ? "signin" : "firstrun");
              }}
              style={{
                background: "none",
                border: "none",
                padding: 0,
                cursor: "pointer",
                justifySelf: "center",
                color: CSS_COLOR.textSec,
                fontFamily: T.sans,
                fontSize: textSize("caption"),
              }}
            >
              {isFirstRun ? "Have an account? Sign in" : "First-time setup"}
            </button>
          </form>
        </CardContent>
      </Card>
    </FullScreenCenter>
  );
}

export default LoginGate;
