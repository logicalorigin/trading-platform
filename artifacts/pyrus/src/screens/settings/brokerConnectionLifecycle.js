// Shared broker-card lifecycle grammar (docs/plans/broker-connection-ux-plan.md).
// Every connector (SnapTrade brokerages, Robinhood, Schwab, IBKR Client Portal)
// maps its raw readiness/mutation state onto this one visual state machine so
// all broker cards read identically: same ring, same motion, same action slots.

export const BROKER_LIFECYCLE_PHASES = Object.freeze([
  "idle",
  "working",
  "awaiting-user",
  "success",
  "connected",
  "impaired",
  "error",
]);

// Priority order matters: a card that is impaired stays impaired even while a
// reconnect mutation is pending elsewhere in the panel; an in-flight mutation
// outranks the popup wait (the popup poll keeps running underneath); connected
// is only shown once nothing is actively happening on the card.
export function deriveBrokerCardPhase(input) {
  const {
    connected = false,
    working = false,
    awaitingUser = false,
    impaired = false,
  } = input || {};
  if (working) return "working";
  if (awaitingUser) return "awaiting-user";
  if (connected) return "connected";
  if (impaired) return "impaired";
  return "idle";
}

// Success is a transient acknowledgement, not a stored state: it fires exactly
// when a card that was previously anything-but-connected settles on connected.
// First observation (prevPhase undefined — initial load hydrating server truth)
// must NOT flash, or every page load would celebrate old connections.
export function successFlashKeys(prevPhases, nextPhases) {
  const flashed = [];
  for (const [key, phase] of nextPhases) {
    if (phase !== "connected") continue;
    const before = prevPhases.get(key);
    if (before !== undefined && before !== "connected" && before !== "success") {
      flashed.push(key);
    }
  }
  return flashed;
}

// How long the transient success sequence owns the card before it settles into
// the steady connected state (sweep 450ms → glow ≈300ms → check pop ≈300ms).
export const BROKER_SUCCESS_FLASH_MS = 1050;

// Error is a transient too: a connect/reconnect attempt that fails or is denied
// flashes the amber shake, then the card settles back to its steady phase (the
// persistent failure text lives in the panel's error banner). Fires on the
// rising edge of a card's error flag; the first sample (key absent from the
// prior map — initial hydration) must NOT flash a pre-existing error.
export function errorFlashKeys(prevErrors, nextErrors) {
  const flashed = [];
  for (const [key, errored] of nextErrors) {
    if (errored && prevErrors.has(key) && !prevErrors.get(key)) {
      flashed.push(key);
    }
  }
  return flashed;
}

// How long the transient error shake owns the card (2×2px shake, 240ms).
export const BROKER_ERROR_FLASH_MS = 240;

// Ring rendering spec per phase. tone maps to the panel's CSS color tokens;
// motion names match the @keyframes registered in PlatformApp.jsx FONT_CSS.
export const BROKER_RING_SPECS = Object.freeze({
  idle: null,
  working: Object.freeze({ tone: "accent", arc: true, motion: "arc" }),
  "awaiting-user": Object.freeze({ tone: "accent", motion: "breathe" }),
  success: Object.freeze({ tone: "green", motion: "sweep" }),
  connected: Object.freeze({ tone: "green", glow: true }),
  impaired: Object.freeze({ tone: "amber", dashed: true }),
  error: Object.freeze({ tone: "amber", motion: "shake" }),
});

// Card status microcopy for non-idle, non-connected phases (connected cards
// speak through the ring + check glyph instead of a text row).
export function brokerCardStatusLine(phase, { impairedLabel, errorLabel } = {}) {
  switch (phase) {
    case "working":
      return "Working…";
    case "awaiting-user":
      return "Waiting for login…";
    case "impaired":
      return impairedLabel || "Reconnect required";
    case "error":
      return errorLabel || "Connection failed";
    default:
      return "";
  }
}
