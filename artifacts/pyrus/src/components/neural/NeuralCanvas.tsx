import { useEffect, useRef } from "react";
import NeuralCore, {
  type NeuralCoreProps,
} from "@/components/marketing/neural-core";
import { MorphMachine } from "./neural-core/useMorphMachine";
import type { NeuralMode } from "./neural-core/types";

export type NeuralCanvasProps = {
  mode: NeuralMode;
  contentReady?: boolean;
  onReveal?: () => void;
  onDisperseStart?: () => void;
};

const OPENER_CORE_PROPS = {
  particles: 22000,
  orbitCount: 9000,
  particleSize: 0.024,
  coreOpacity: 0.82,
  orbitOpacity: 0.6,
  distortion: 0.62,
  noiseSpeed: 0.07,
  rotationSpeed: 0.018,
  tiltStrength: 0.15,
  glow: 0,
  warp: 0.16,
  warpScale: 0.9,
  warpSpeed: 0.2,
  shimmer: 0.1,
  shimmerSpeed: 1.3,
  orbitTimeScale: 0.78,
  superSample: 1,
  maxPixelRatio: 2,
  antialias: false,
  maxFps: 30,
  radius: 3.1,
  lockup: true,
  ringScale: 0.42,
  crisp: false,
  convergeFloor: 0.13,
  convergeStart: 0.34,
  convergeEnd: 0.82,
  bloom: 0,
  vortex: 5.0,
  breath: 0.022,
  breathSpeed: 0.33,
  driftX: 0.05,
  driftY: 0.04,
} satisfies Partial<NeuralCoreProps>;

const TIGHT_CORE_PROPS = {
  look: "balanced",
  particles: 14000,
  orbitCount: 5400,
  particleSize: 0.19,
  coreOpacity: 0.42,
  orbitOpacity: 0.28,
  distortion: 0.62,
  morph: true,
  morphCycleMs: 9000,
  ringScale: 0.8,
  lockup: true,
  lockupMarkOnly: true,
} satisfies Partial<NeuralCoreProps>;

// Loader-only compatibility boundary. The visual implementation is the source
// website's NeuralCore cloud; this wrapper preserves the local opener callbacks
// used by NeuralBootOverlay.
export default function NeuralCanvas({
  mode,
  contentReady = false,
  onReveal,
  onDisperseStart,
}: NeuralCanvasProps) {
  const contentReadyRef = useRef(contentReady);
  const driveRef = useRef({ morph: 0, scatter: 0 });
  const onRevealRef = useRef(onReveal);
  const onDisperseStartRef = useRef(onDisperseStart);

  useEffect(() => {
    contentReadyRef.current = contentReady;
  }, [contentReady]);

  useEffect(() => {
    onRevealRef.current = onReveal;
  }, [onReveal]);

  useEffect(() => {
    onDisperseStartRef.current = onDisperseStart;
  }, [onDisperseStart]);

  useEffect(() => {
    if (mode !== "opener") return undefined;

    const machine = new MorphMachine(mode);
    let frameId = 0;
    let last = performance.now();
    let revealFired = false;

    const tick = (timestamp: number) => {
      const dtMs = Math.min(timestamp - last, 50);
      last = timestamp;

      machine.setContentReady(contentReadyRef.current);
      const { revealed, justDispersing } = machine.update(dtMs);
      driveRef.current.morph = machine.morph;
      driveRef.current.scatter = machine.scatter;

      if (justDispersing) onDisperseStartRef.current?.();
      if (revealed && !revealFired) {
        revealFired = true;
        onRevealRef.current?.();
      }

      if (!revealFired) frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [mode]);

  const props =
    mode === "opener"
      ? { ...OPENER_CORE_PROPS, morphDriveRef: driveRef }
      : TIGHT_CORE_PROPS;

  return (
    <NeuralCore
      {...props}
      className="h-full w-full"
      style={{ height: "100%", width: "100%" }}
    />
  );
}
