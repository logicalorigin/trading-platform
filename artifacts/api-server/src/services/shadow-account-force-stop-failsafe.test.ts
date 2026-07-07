import assert from "node:assert/strict";
import test from "node:test";

import { __shadowWatchlistBacktestInternalsForTests as internals } from "./shadow-account";

// Force-stop / expiry maintenance failsafe (runShadowOptionMaintenance) — pins
// the pure decision pieces the failsafe is built from, via the module's
// existing test-internals surface. The DB/provider-bound pieces
// (detectShadowMaintenanceBreach's pool-read peak, the force-close /
// expiry-pass price ladders' live-quote rungs) are NOT tested here; see the
// task report. No product edits.
const {
  shouldCloseOptionForShadowMaintenance,
  isHistoricalSignalOptionsShadowOrder,
  isSignalOptionsBackfillShadowOrder,
  resolveHistoricalBackfillExpirationExitPrice,
} = internals;

const contractExpiring = (expirationDate: string) =>
  ({
    underlying: "CRM",
    expirationDate,
    strike: 250,
    right: "call",
    multiplier: 100,
  }) as never;

// 2026-06-12 is a Friday; June = EDT (UTC-4), so 16:00 ET = 20:00Z.

test("expiry maintenance: contract that expired on a prior market day is due for close mid-session", () => {
  assert.equal(
    shouldCloseOptionForShadowMaintenance(
      contractExpiring("2026-06-11"),
      new Date("2026-06-12T14:00:00.000Z"), // 10:00 ET, session open
    ),
    true,
  );
});

test("expiry maintenance: same-day expiration is NOT due before the 16:00 ET close", () => {
  assert.equal(
    shouldCloseOptionForShadowMaintenance(
      contractExpiring("2026-06-12"),
      new Date("2026-06-12T19:59:00.000Z"), // 15:59 ET
    ),
    false,
  );
});

test("expiry maintenance: same-day expiration becomes due exactly at the 16:00 ET close", () => {
  assert.equal(
    shouldCloseOptionForShadowMaintenance(
      contractExpiring("2026-06-12"),
      new Date("2026-06-12T20:00:00.000Z"), // 16:00 ET
    ),
    true,
  );
});

test("expiry maintenance: same-day expiration stays due after the close", () => {
  assert.equal(
    shouldCloseOptionForShadowMaintenance(
      contractExpiring("2026-06-12"),
      new Date("2026-06-12T21:30:00.000Z"), // 17:30 ET
    ),
    true,
  );
});

test("expiry maintenance: future expiration is never due, even after the close", () => {
  assert.equal(
    shouldCloseOptionForShadowMaintenance(
      contractExpiring("2026-06-19"),
      new Date("2026-06-12T21:30:00.000Z"),
    ),
    false,
  );
});

// Backfill-exclusion guard (load-bearing): the force-close pass skips any row
// whose entry order is historical OR backfill (shadow-account.ts, force-close
// loop: `isHistoricalSignalOptionsShadowOrder(context.entryOrder) ||
// isSignalOptionsBackfillShadowOrder(context.entryOrder)`), so research/backfill
// positions are never force-sold into the live ledger. The expiry pass skips
// historical-and-not-backfill rows (replay), while backfill rows stay eligible
// but are routed to the backfill exit-price ladder. These compositions are
// re-stated here exactly as the product computes them.
const forceCloseExcluded = (order: { payload: unknown }) =>
  isHistoricalSignalOptionsShadowOrder(order as never) ||
  isSignalOptionsBackfillShadowOrder(order as never);
const expiryPassSkipped = (order: { payload: unknown }) =>
  isHistoricalSignalOptionsShadowOrder(order as never) &&
  !isSignalOptionsBackfillShadowOrder(order as never);

test("backfill exclusion: backfill entry order (payload.backfill.source) is excluded from force-close", () => {
  const order = { payload: { backfill: { source: "signal_options_backfill" } } };
  assert.equal(isSignalOptionsBackfillShadowOrder(order as never), true);
  assert.equal(isHistoricalSignalOptionsShadowOrder(order as never), true);
  assert.equal(forceCloseExcluded(order), true);
  // Backfill rows remain eligible for the expiry pass (backfill pricing path).
  assert.equal(expiryPassSkipped(order), false);
});

test("backfill exclusion: backfill entry order (metadata.runSource) is excluded from force-close", () => {
  const order = {
    payload: { metadata: { runSource: "signal_options_backfill" } },
  };
  assert.equal(isSignalOptionsBackfillShadowOrder(order as never), true);
  assert.equal(forceCloseExcluded(order), true);
});

test("backfill exclusion: replay entry order (payload.replay.source) is excluded from force-close AND skipped by the expiry pass", () => {
  const order = { payload: { replay: { source: "signal_options_replay" } } };
  assert.equal(isHistoricalSignalOptionsShadowOrder(order as never), true);
  assert.equal(isSignalOptionsBackfillShadowOrder(order as never), false);
  assert.equal(forceCloseExcluded(order), true);
  assert.equal(expiryPassSkipped(order), true);
});

test("backfill exclusion: replay entry order (metadata.sourceType) is excluded from force-close", () => {
  const order = {
    payload: { metadata: { sourceType: "signal_options_replay" } },
  };
  assert.equal(isHistoricalSignalOptionsShadowOrder(order as never), true);
  assert.equal(forceCloseExcluded(order), true);
});

test("backfill exclusion: live automation entry order stays ELIGIBLE for force-close", () => {
  const order = {
    payload: {
      metadata: { runSource: "live_shadow_mark", deploymentId: "deployment-1" },
      candidate: { direction: "buy" },
    },
  };
  assert.equal(isHistoricalSignalOptionsShadowOrder(order as never), false);
  assert.equal(isSignalOptionsBackfillShadowOrder(order as never), false);
  assert.equal(forceCloseExcluded(order), false);
});

test("backfill exclusion: entry order with an empty payload stays eligible for force-close", () => {
  const order = { payload: {} };
  assert.equal(forceCloseExcluded(order), false);
  assert.equal(expiryPassSkipped(order), false);
});

// Backfill expiry exit-price ladder: recorded mark -> averageCost -> 0. It must
// NEVER fabricate an intrinsic or floor price — backfill closes are research
// data, not live fills (contrast with the force-close ladder's 0.01 floor).

test("backfill expiry ladder: recorded mark wins and is rounded to cents", () => {
  assert.deepEqual(
    resolveHistoricalBackfillExpirationExitPrice({
      position: { mark: "1.234", averageCost: "2.5" } as never,
    }),
    { price: 1.23, source: "historical_backfill_last_mark" },
  );
});

test("backfill expiry ladder: falls back to averageCost when no positive mark", () => {
  assert.deepEqual(
    resolveHistoricalBackfillExpirationExitPrice({
      position: { mark: "0", averageCost: "2.5" } as never,
    }),
    { price: 2.5, source: "historical_backfill_average_cost" },
  );
  assert.deepEqual(
    resolveHistoricalBackfillExpirationExitPrice({
      position: { mark: null, averageCost: "2.5" } as never,
    }),
    { price: 2.5, source: "historical_backfill_average_cost" },
  );
});

test("backfill expiry ladder: unpriced rows close at exactly 0 — never an intrinsic or 0.01 floor", () => {
  assert.deepEqual(
    resolveHistoricalBackfillExpirationExitPrice({
      position: { mark: null, averageCost: null } as never,
    }),
    { price: 0, source: "historical_backfill_unpriced_zero" },
  );
});
