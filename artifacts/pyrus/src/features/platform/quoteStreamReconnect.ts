// Self-heal policy for the quote EventSource (used by useQuoteSnapshotStream in
// live-streams.ts). A browser EventSource only auto-reconnects while it is
// CONNECTING/OPEN; once it goes CLOSED (server returned non-2xx on the retry, or
// the API was killed mid-stream during a resource-pressure blip) it stays dead
// forever - which is what froze long-lived tabs (prices stop, never recover).
//
// Terminal closes reconnect with capped exponential backoff. A stall watchdog
// covers the silent case (socket open but no data): its window grows
// exponentially while quiet and resets the instant any quotes frame arrives, so a
// real mid-session stall recovers in ~90s while a legitimately quiet market backs
// off toward one reconnect / 5 min instead of hammering the already-strained API.
//
// These helpers are kept dependency-free so they can be unit-tested in isolation
// (importing live-streams.ts pulls the whole app module graph).

export const QUOTE_STREAM_RECONNECT_BASE_MS = 1_000;
export const QUOTE_STREAM_RECONNECT_MAX_MS = 30_000;
// 90s, not 45s: the API event loop saturates under heavy DB-fan-out reads and
// freezes SSE delivery for 30-90s at a time (then bursts to catch up). A 45s base
// tripped this watchdog DURING those transient server freezes — force-reconnecting
// an otherwise-healthy stream, which the user sees as prices flapping off/on. 90s
// rides out the freeze (the stream resumes when the loop unblocks) while still
// recovering a genuinely dead stream within ~90s.
export const QUOTE_STREAM_STALL_BASE_MS = 90_000;
export const QUOTE_STREAM_STALL_MAX_MS = 300_000;
export const QUOTE_STREAM_STALL_CHECK_MS = 15_000;

// Capped exponential backoff for terminal-close reconnects. attempt 0 -> 1s,
// 1 -> 2s, ... clamped at 30s. Negative/NaN attempts are treated as 0.
export const nextQuoteStreamReconnectDelayMs = (attempt: number): number =>
  Math.min(
    QUOTE_STREAM_RECONNECT_BASE_MS * 2 ** Math.max(0, attempt || 0),
    QUOTE_STREAM_RECONNECT_MAX_MS,
  );

// Grow the stall window after a stall-triggered reconnect so a persistently quiet
// market backs off (90s -> 180s -> 300s cap) instead of reconnecting on a
// fixed cadence. Resets to base (via the caller) the moment a quotes frame lands.
export const nextQuoteStreamStallMs = (currentStallMs: number): number =>
  Math.min(
    Math.max(currentStallMs || 0, QUOTE_STREAM_STALL_BASE_MS) * 2,
    QUOTE_STREAM_STALL_MAX_MS,
  );
