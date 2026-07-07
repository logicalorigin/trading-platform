// Shared constants + state vocabulary for the neural loading engine.

export type NeuralState =
  | "loading-loop"
  | "forming"
  | "formed"
  | "dispersing"
  | "revealed";

// "opener" = the expanded full-screen launch cloud (forms the lockup, disperses,
// reveals the app). "tight" = the compact container/page loader (forms the mark
// and holds it, gently rotating, never reveals).
export type NeuralMode = "opener" | "tight";

// Opener + tight timelines (milliseconds).
export const TIMING = {
  // Minimum time the cloud loops before it is allowed to form, so a warm cache
  // (boot already complete at mount) never flashes a single frame.
  minLoopMs: 700,
  // Hard backstop: reveal even if boot progress never reports complete.
  maxWaitMs: 12000,
  formingMs: 1100,
  formedHoldMs: 360,
  dispersingMs: 900,
  // Tight loader: form the mark quickly, then hold + rotate indefinitely.
  tightMinLoopMs: 200,
  tightFormMs: 750,
} as const;

// Tight loader idle motion (formed mark).
export const TIGHT_SPIN_RAD_PER_SEC = 0.25;
