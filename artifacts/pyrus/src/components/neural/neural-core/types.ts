// Shared constants + state vocabulary for the neural loading engine.

export type NeuralState =
  | "loading-loop"
  | "forming"
  | "formed"
  | "dispersing"
  | "revealed";

// Opener timeline (milliseconds).
export const TIMING = {
  // Minimum time the cloud loops before it is allowed to form, so a warm cache
  // (boot already complete at mount) never flashes a single frame.
  minLoopMs: 700,
  // Hard backstop: reveal even if boot progress never reports complete.
  maxWaitMs: 12000,
  formingMs: 1100,
  formedHoldMs: 360,
  dispersingMs: 900,
} as const;
