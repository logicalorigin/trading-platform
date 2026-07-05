import { Suspense, lazy, useEffect, useState } from "react";
import BrandLoader from "../BrandLoader";
import { useBootProgress } from "@/app/bootProgress";
import { useBootHandoffElapsedMs } from "@/app/bootLoaderHandoff";
import { shouldPlayNeuralOpener } from "@/lib/webglCapability";
import { setNeuralOpenerActive } from "./neuralOpenerState";

const NeuralCanvas = lazy(() => import("./NeuralCanvas"));

const SESSION_KEY = "pyrus_loader_seen";

type NeuralBootOverlayProps = {
  bootLoaderElapsedMs?: number | null;
};

type NeuralWindow = Window & {
  __contentReady?: boolean;
  __splashHiding?: boolean;
  __hideSplash?: () => void;
};

// Decided once, synchronously: only play the opener when WebGL + motion allow
// it and it hasn't already played in this tab session. When it returns false the
// overlay renders nothing and the normal Suspense/BrandLoader path is used.
function readShouldPlay(): boolean {
  if (!shouldPlayNeuralOpener()) return false;
  try {
    if (
      typeof sessionStorage !== "undefined" &&
      sessionStorage.getItem(SESSION_KEY)
    ) {
      return false;
    }
  } catch {
    // sessionStorage can throw in locked-down contexts — treat as not-seen.
  }
  return true;
}

// First-load opener. Mounts as an opaque overlay ABOVE the already-mounting app
// (App.tsx keeps <AppContent> rendering underneath so boot progress can reach
// `complete`). Loops the neural cloud while the app loads, then on boot-complete
// forms the PYRUS logo, disperses, fades to reveal the live app, and unmounts.
export function NeuralBootOverlay({
  bootLoaderElapsedMs = null,
}: NeuralBootOverlayProps) {
  const [play] = useState(readShouldPlay);
  const [revealed, setRevealed] = useState(false);
  const [revealing, setRevealing] = useState(false);
  const progress = useBootProgress();
  const bootHandoffElapsedMs = useBootHandoffElapsedMs(bootLoaderElapsedMs);

  useEffect(() => {
    if (!play) return;
    setNeuralOpenerActive(true);
    try {
      sessionStorage?.setItem(SESSION_KEY, "1");
    } catch {
      // ignore
    }
    // Hide any pre-React splash element if the host wired one (parity with spec).
    (window as NeuralWindow).__hideSplash?.();
    return () => setNeuralOpenerActive(false);
  }, [play]);

  // Parity: mirror the authoritative boot-complete signal onto the global.
  useEffect(() => {
    if (play && progress.complete) {
      (window as NeuralWindow).__contentReady = true;
    }
  }, [play, progress.complete]);

  if (!play || revealed) return null;

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
      <Suspense
        fallback={
          <BrandLoader
            bootHandoffElapsedMs={bootHandoffElapsedMs}
            label="Starting PYRUS"
            progress={progress}
            testId="neural-stage-fallback"
          />
        }
      >
        <NeuralCanvas
          mode="opener"
          contentReady={progress.complete}
          onDisperseStart={handleDisperseStart}
          onReveal={() => setRevealed(true)}
        />
      </Suspense>
    </div>
  );
}

export default NeuralBootOverlay;
