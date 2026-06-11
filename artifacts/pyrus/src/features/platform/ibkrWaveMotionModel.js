// Stabilizes the IBKR status sine-wave animation inputs so transient ping /
// stream-state flaps do not restart the main-thread SMIL `<animate>` (the visible
// "skip"/stutter). Grounded in the diagnosis in
// SESSION_HANDOFF_LIVE_2026-06-08_broker-connection-wave-stutter.md (proposed fix #2):
// the SMIL wave restarts whenever its `dur` changes or `active` toggles, and
// `resolveWaveDuration` buckets raw `lastPingMs`, so a ping crossing 180/650 ms — or a
// momentary stream quiet<->live flap — flips the animation inputs and restarts it.
//
// This is a pure, timestamp-driven state machine (no React, no real clock) so it can be
// unit-tested deterministically, matching the repo's pure-model `.test.mjs` convention.
// The React driver is `useStableWaveMotion` in IbkrConnectionStatus.jsx.

export const WAVE_MOTION_DWELL_MS = 800;

// Animation inputs that, when changed, restart the SMIL wave. `duration` is opaque
// (e.g. "0.9s"). When not animated the duration is irrelevant, so it is normalized to
// null — that way duration jitter on an already-flat wave is never treated as a change.
export const normalizeWaveMotion = (motion) =>
  motion?.animated
    ? { animated: true, duration: motion.duration ?? null }
    : { animated: false, duration: null };

export const waveMotionEqual = (a, b) =>
  a.animated === b.animated && a.duration === b.duration;

export const initWaveMotionState = (motion) => ({
  committed: normalizeWaveMotion(motion),
  pending: null,
});

// Pure transition. Commits `incoming` only after it has held — unchanged and different
// from the committed value — for `dwellMs`. A flip back to the committed value (or to a
// new target) before the dwell elapses cancels / resets the pending change, so sub-second
// jitter never reaches the animation. Sustained, genuine changes still commit (once).
export const advanceWaveMotion = (
  state,
  incoming,
  nowMs,
  dwellMs = WAVE_MOTION_DWELL_MS,
) => {
  const next = normalizeWaveMotion(incoming);

  // Already where we want to be — drop any pending change so a transient excursion
  // that returned to baseline does not later commit.
  if (waveMotionEqual(next, state.committed)) {
    return state.pending ? { ...state, pending: null } : state;
  }

  // New (or changed) target — (re)start the dwell timer against this target.
  if (!state.pending || !waveMotionEqual(next, state.pending.motion)) {
    return { ...state, pending: { motion: next, since: nowMs } };
  }

  // Same target still pending — commit once it has survived the dwell.
  if (nowMs - state.pending.since >= dwellMs) {
    return { committed: next, pending: null };
  }

  return state;
};
