import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { Button } from "../../components/ui/Button.jsx";
import { usePrefersReducedMotion } from "../../components/marketing/use-prefers-reduced-motion";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card.tsx";
import { Input } from "../../components/ui/input.tsx";
import { Label } from "../../components/ui/label.tsx";
import { LOADER_CLOUD_PROPS } from "../../components/neural/NeuralLoader";
import { BootBrandColumn } from "../../components/neural/BootShellLayout";
import {
  isNeuralOpenerActive,
  subscribeNeuralOpenerActive,
} from "../../components/neural/neuralOpenerState";
import { isNeuralWebglRendererSupported } from "../../lib/webglCapability";
import { useViewportBelow } from "../../lib/responsive";
import {
  CSS_COLOR,
  cssColorMix,
  dim,
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
import {
  PLATFORM_BOOT_PROGRESS_TASK_IDS,
  skipBootProgressTasks,
} from "../../app/bootProgress";
import { postAuthJson, useAuthSession } from "./authSession.jsx";

const NeuralCoreScene = lazy(
  () => import("../../components/marketing/neural-core-scene"),
);
const LOGIN_AMBIENT_CLOUD_OPACITY = 0.42;
const LOGIN_CLOUD_MASK =
  "radial-gradient(105% 108% at 24% 45%, #000 0%, #000 30%, rgba(0,0,0,0.18) 54%, transparent 74%)";

// Slice 8: the SPA login wall. Rendered inside AppProviders but ABOVE
// <PlatformApp/> so the workspace (and its SSE streams / platform queries) never
// mounts for an unauthenticated visitor. Members provisioned via the /auth/launch
// handoff already carry a session cookie, so they pass straight through; this wall
// is what an operator without a session (or a signed-out session) sees. It reuses
// the same endpoints + validators as the header sign-in popover.

function useNeuralOpenerActiveState() {
  return useSyncExternalStore(
    subscribeNeuralOpenerActive,
    isNeuralOpenerActive,
  );
}

// The neural cloud bleeds across the whole page (weighted toward the brand on the
// left, fading behind the form on the right) so the whole surface is one immersive
// atmosphere rather than two isolated halves.
function AmbientCloud() {
  const reducedMotion = usePrefersReducedMotion();
  const openerActive = useNeuralOpenerActiveState();

  if (reducedMotion || openerActive || !isNeuralWebglRendererSupported()) {
    return null;
  }

  return (
    <div
      aria-hidden="true"
      style={{
        position: "absolute",
        inset: 0,
        opacity: LOGIN_AMBIENT_CLOUD_OPACITY,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          height: "100%",
          width: "100%",
          maskImage: LOGIN_CLOUD_MASK,
          WebkitMaskImage: LOGIN_CLOUD_MASK,
        }}
      >
        <Suspense fallback={null}>
          <NeuralCoreScene {...LOADER_CLOUD_PROPS} />
        </Suspense>
      </div>
    </div>
  );
}

function LoginShell({ children, loading = false }) {
  const stacked = useViewportBelow(880);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 110,
        background: CSS_COLOR.bg0,
        overflowY: "auto",
      }}
    >
      <div
        className="pyrus-brand-atmosphere"
        aria-hidden="true"
        style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
      />
      <AmbientCloud />
      <div
        style={{
          position: "relative",
          zIndex: 1,
          minHeight: "100%",
          display: "grid",
          gridTemplateColumns: stacked ? "1fr" : "1fr 1fr",
          gridTemplateRows: stacked ? "minmax(220px, 34vh) 1fr" : undefined,
        }}
      >
        {/* Shared brand column — identical markup/position to the boot curtain and
            app loaders so the mark never hops when the loading screen hands off to
            the sign-in wall. */}
        <BootBrandColumn
          loading={loading}
          stacked={stacked}
          testId="login-brand-stage"
        />
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: sp(24),
          }}
        >
          <div style={{ width: "100%", maxWidth: dim(380) }}>{children}</div>
        </div>
      </div>
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
        // On success the session query flips and the gate swaps this wall for
        // the app; the finally below re-enables the form for every other outcome
        // (error, timeout, or a 200 whose session didn't take) so it can't latch.
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
      } finally {
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

  // Signed-out visitors never mount PlatformApp, so its blocking boot tasks
  // would never settle and the boot overlay would idle until its backstop.
  // Skip them so the opener forms, disperses, and reveals the sign-in wall.
  useEffect(() => {
    if (!isLoading && !signedIn) {
      skipBootProgressTasks(
        PLATFORM_BOOT_PROGRESS_TASK_IDS,
        "Signed-out visitor — showing sign-in",
      );
    }
  }, [isLoading, signedIn]);

  // Auth state not yet known — keep the 50/50 layout with a loading indicator on
  // the right (never a blank right panel) until /api/auth/session resolves.
  if (isLoading) {
    return <LoginShell loading>{null}</LoginShell>;
  }

  if (signedIn) {
    return children;
  }

  return (
    <LoginShell>
      <Card
        style={{
          width: "100%",
          background: "transparent",
          border: "none",
          boxShadow: "none",
        }}
      >
        <CardHeader>
          <div style={{ display: "grid", gap: sp(6) }}>
            <CardTitle
              style={{
                fontFamily: T.sans,
                fontSize: textSize("screenTitle"),
                fontWeight: FONT_WEIGHTS.emphasis,
                color: CSS_COLOR.text,
              }}
            >
              {isFirstRun ? "First-time setup" : "Sign in"}
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
                : "Welcome back. Sign in to continue."}
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
              variant="primary"
              size="lg"
              style={{
                width: "100%",
                opacity: pending ? 0.7 : 1,
              }}
              disabled={pending}
              dataTestId="login-gate-submit"
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
    </LoginShell>
  );
}

export default LoginGate;
