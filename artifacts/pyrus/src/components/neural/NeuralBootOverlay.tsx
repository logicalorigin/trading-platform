import { Suspense, lazy, useEffect, useState } from "react";
import { useBootProgress } from "@/app/bootProgress";
import { shouldPlayNeuralOpener } from "@/lib/webglCapability";
import {
  BootShellLayout,
  CLOUD_MASK,
  LOADER_CLOUD_PROPS,
} from "./BootShellLayout";
import { setNeuralOpenerActive } from "./neuralOpenerState";

const NeuralCanvas = lazy(() => import("./NeuralCanvas"));

const SESSION_KEY = "pyrus_loader_seen";
const STATIC_BACKSTOP_MS = 12000;
const OPENER_BACKSTOP_MS = STATIC_BACKSTOP_MS;
const OPENER_FADE_MS = 500;

type BootMode = "opener" | "static";

type NeuralWindow = Window & {
  __splashHiding?: boolean;
  __hideSplash?: () => void;
};

// The capable first load uses the centered cloud; repeat/reduced-motion/no-WebGL
// loads use the same centered shell without requiring a boot WebGL bundle.
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

const BootShellScreen = () => (
  <BootShellLayout testId="neural-stage-fallback" />
);

// First-load opener. Mounts as an opaque overlay ABOVE the already-mounting app
// (App.tsx keeps <AppContent> rendering underneath so boot progress can reach
// `complete`). It keeps the pure cloud opaque while loading, then fades away.
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
    if (BOOT_MODE !== "opener" || revealed || revealing) return;
    if (progress.complete) {
      setRevealing(true);
      return;
    }
    const timeout = window.setTimeout(() => {
      setRevealing(true);
    }, OPENER_BACKSTOP_MS);
    return () => window.clearTimeout(timeout);
  }, [progress.complete, revealed, revealing]);

  useEffect(() => {
    if (!revealing || revealed) return;
    (window as NeuralWindow).__splashHiding = true;
    const timeout = window.setTimeout(() => {
      setNeuralOpenerActive(false);
      setRevealed(true);
    }, OPENER_FADE_MS);
    return () => window.clearTimeout(timeout);
  }, [revealed, revealing]);

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

  const className = revealing
    ? "neural-overlay neural-overlay--revealing"
    : "neural-overlay";

  return (
    <div
      className={className}
      data-testid="neural-stage"
      data-progress={progress.percent}
    >
      <Suspense fallback={<BootShellScreen />}>
        <BootShellLayout
          cloud={
            <NeuralCanvas
              cloudProps={LOADER_CLOUD_PROPS}
              mask={CLOUD_MASK}
            />
          }
          label="Loading PYRUS"
          progress={progress}
          testId="neural-stage-shell"
        />
      </Suspense>
    </div>
  );
}

export default NeuralBootOverlay;
