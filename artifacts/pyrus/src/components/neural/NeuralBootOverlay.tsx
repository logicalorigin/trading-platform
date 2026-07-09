import { Suspense, lazy, useEffect, useState } from "react";
import { useBootProgress } from "@/app/bootProgress";
import { shouldPlayNeuralOpener } from "@/lib/webglCapability";
import { BootShellLayout } from "./BootShellLayout";
import { setNeuralOpenerActive } from "./neuralOpenerState";

const NeuralCanvas = lazy(() => import("./NeuralCanvas"));

const SESSION_KEY = "pyrus_loader_seen";
// mirrors TIMING.maxWaitMs (neural-core/types) — do not import (chunk boundary)
const STATIC_BACKSTOP_MS = 12000;
const OPENER_BACKSTOP_MS = STATIC_BACKSTOP_MS;

type BootMode = "opener" | "static";

type NeuralWindow = Window & {
  __contentReady?: boolean;
  __splashHiding?: boolean;
  __hideSplash?: () => void;
};

// Every load shows a loading curtain so the startup screen is always the 50/50
// branded loader (never the centered NeuralLoader). The cinematic WebGL opener
// plays only on the first load of a session (WebGL + motion); afterwards, and on
// no-WebGL / reduced-motion, the same 50/50 static curtain covers the boot.
function readBootMode(): BootMode {
  let seen = false;
  try {
    seen =
      typeof sessionStorage !== "undefined" &&
      Boolean(sessionStorage.getItem(SESSION_KEY));
  } catch {
    // sessionStorage can throw in locked-down contexts — treat as not-seen.
  }
  if (seen) return "static";
  return shouldPlayNeuralOpener() ? "opener" : "static";
}

const BOOT_MODE = readBootMode();

if (BOOT_MODE === "opener") {
  void import("./NeuralCanvas");
}

setNeuralOpenerActive(true);

const markLoaderSeen = () => {
  try {
    sessionStorage?.setItem(SESSION_KEY, "1");
  } catch {
    // ignore
  }
};

// The boot curtain and the workspace/app loaders share one immersive layout
// (BootShellLayout) so the loading screen never jumps to a different, centered
// treatment.
const BootShellScreen = () => (
  <BootShellLayout testId="neural-stage-fallback" />
);

// First-load opener. Mounts as an opaque overlay ABOVE the already-mounting app
// (App.tsx keeps <AppContent> rendering underneath so boot progress can reach
// `complete`). Loops the neural cloud while the app loads, then on boot-complete
// forms the PYRUS logo, disperses, fades to reveal the live app, and unmounts.
export function NeuralBootOverlay() {
  const [revealed, setRevealed] = useState(false);
  const [revealing, setRevealing] = useState(false);
  const [staticHidden, setStaticHidden] = useState(false);
  const progress = useBootProgress();

  useEffect(() => {
    markLoaderSeen();
    // Hide any pre-React splash element if the host wired one (parity with spec).
    if (BOOT_MODE === "opener") {
      (window as NeuralWindow).__hideSplash?.();
    }
    return () => setNeuralOpenerActive(false);
  }, []);

  // Parity: mirror the authoritative boot-complete signal onto the global.
  useEffect(() => {
    if (BOOT_MODE === "opener" && progress.complete) {
      (window as NeuralWindow).__contentReady = true;
    }
  }, [progress.complete]);

  useEffect(() => {
    if (BOOT_MODE !== "static" || staticHidden) return;
    if (progress.complete) {
      setStaticHidden(true);
      setNeuralOpenerActive(false);
      return;
    }
    const timeout = window.setTimeout(() => {
      setStaticHidden(true);
      setNeuralOpenerActive(false);
    }, STATIC_BACKSTOP_MS);
    return () => window.clearTimeout(timeout);
  }, [progress.complete, staticHidden]);

  useEffect(() => {
    if (BOOT_MODE !== "opener" || revealed) return;
    const timeout = window.setTimeout(() => {
      setNeuralOpenerActive(false);
      setRevealed(true);
    }, OPENER_BACKSTOP_MS);
    return () => window.clearTimeout(timeout);
  }, [revealed]);

  if (revealed || staticHidden) return null;

  if (BOOT_MODE === "static") {
    return (
      <div
        className="neural-overlay"
        data-testid="neural-boot-static"
        data-progress={progress.percent}
      >
        <BootShellScreen />
      </div>
    );
  }

  const handleDisperseStart = () => {
    (window as NeuralWindow).__splashHiding = true;
    setRevealing(true);
  };

  const className = revealing
    ? "neural-overlay neural-overlay--revealing"
    : "neural-overlay";

  return (
    <div
      className={className}
      data-testid="neural-stage"
      role="status"
      aria-label="Loading PYRUS"
      data-progress={progress.percent}
    >
      <Suspense fallback={<BootShellScreen />}>
        <NeuralCanvas
          contentReady={progress.complete}
          onDisperseStart={handleDisperseStart}
          onReveal={() => {
            // Release the opener's WebGL claim the instant it parts to reveal
            // the app (NeuralCanvas unmounts here). Returning null below does
            // NOT unmount this overlay, so the mount-effect cleanup never runs;
            // without this, openerActive would stay true for the whole document
            // and the login's AmbientCloud/BrandResolve would never render.
            setNeuralOpenerActive(false);
            setRevealed(true);
          }}
        />
      </Suspense>
    </div>
  );
}

export default NeuralBootOverlay;
