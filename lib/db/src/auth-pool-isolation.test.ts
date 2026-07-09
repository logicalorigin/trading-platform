import assert from "node:assert/strict";
import test from "node:test";

import { authPool, getPoolStats, pool } from "./index";

// Regression for WO-AUTH-LANE: the auth lane (`authPool`) is a physically
// separate pool, so a session lookup must not queue behind a data-plane read
// storm that pins the shared pool at 12/12 — the login-timeout pathology where
// the 8s client budget is lost to the shared-pool acquire queue.
//
// Uses THIS process's own pools against the dev DB. Each Node process builds its
// own pg.Pool objects, so saturating the shared pool here cannot disturb the
// running app's pool (a different object; only ~14 total server connections).
// Run with --test-force-exit (module load constructs the pools):
//   pnpm --filter @workspace/db exec tsx --test --test-force-exit \
//     src/auth-pool-isolation.test.ts
test("auth-lane acquisition stays fast while the shared pool is fully occupied", async () => {
  assert.notEqual(
    authPool,
    pool,
    "auth lane must be a distinct pool from the shared pool",
  );

  // Warm one auth-pool connection so the timed acquire below reuses an idle
  // connection and measures queueing, not one-time connect latency.
  const warm = await authPool.connect();
  warm.release();

  const max = getPoolStats().max;
  const held: Array<{ release: () => void }> = [];
  let queuedSharedAcquire: Promise<{ release: () => void }> | null = null;
  try {
    // Pin every shared-pool connection: the bar-read storm pathology (12/12).
    for (let index = 0; index < max; index += 1) {
      held.push(await pool.connect());
    }
    assert.equal(getPoolStats().idle, 0, "shared pool is fully checked out");

    // A further shared-pool acquire now has nowhere to go — it queues and stays
    // pending (nothing is released), proving the pool is genuinely saturated.
    let sharedResolved = false;
    queuedSharedAcquire = pool.connect().then((client) => {
      sharedResolved = true;
      return client;
    });

    // The auth lane owns separate connections, so this resolves immediately.
    const startedAt = Date.now();
    const authClient = await authPool.connect();
    const elapsedMs = Date.now() - startedAt;
    authClient.release();

    assert.equal(
      sharedResolved,
      false,
      "a shared-pool acquire is still queued behind the storm",
    );
    assert.ok(
      elapsedMs < 1_000,
      `auth acquire under saturation took ${elapsedMs}ms (budget 1000ms; client aborts at 8000ms)`,
    );
  } finally {
    // Free one shared connection so the queued acquire can resolve, then release
    // everything so the pools return to idle.
    held.shift()?.release();
    if (queuedSharedAcquire) {
      (await queuedSharedAcquire).release();
    }
    for (const client of held) {
      client.release();
    }
  }
});
