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

// "lockup" = concentric-ring mark + PYRUS wordmark (expanded opener).
// "mark"   = the concentric-ring mark only, legible at small sizes (tight loader).
export type NeuralVariant = "lockup" | "mark";

// Particle budget. ~24k keeps 60fps with a single GPU-driven morph while still
// rendering a legible PYRUS lockup. ~12 floats/point ≈ ~1.1 MB of GPU buffers.
export const POINT_COUNT = 24000;

// Tight loaders are smaller and may render several at once (panels, cards), so
// they use a lighter budget.
export const POINT_COUNT_TIGHT = 9000;

// Brand gradient (center → mid → outer), matched to the spec's blue→violet→red.
export const NEURAL_COLORS = {
  a: "#168BFF",
  b: "#A14DFF",
  c: "#FF3048",
} as const;

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

// Deterministic seed so the cloud is identical across runs / screenshots.
export const NEURAL_SEED = 0x9e3779b9;
