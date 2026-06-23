import assert from "node:assert/strict";
import test from "node:test";

import { __signalMonitorInternalsForTests } from "./signal-monitor";

// Unit coverage for the preserve-guard + bar-metadata decoupling fix.
//
// Root cause it guards against: when a cell holds a directional signal and the
// preserve rule keeps that (newer) stored signal, the whole upsert was skipped,
// freezing latestBarAt/lastEvaluatedAt even though fresh completed bars kept
// arriving every interval. The fix advances bar metadata onto the preserved
// signal row when, and only when, the bar edge genuinely moves forward — without
// ever letting an older incoming signal displace a newer stored one.

const merge =
  __signalMonitorInternalsForTests.mergeFreshBarMetadataOntoPreservedSignalRow;
const shouldPreserve =
  __signalMonitorInternalsForTests.shouldPreserveExistingSignalMonitorSymbolState;

function existingRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "p:SPY:5m",
    profileId: "p",
    symbol: "SPY",
    timeframe: "5m",
    currentSignalDirection: "sell",
    currentSignalAt: new Date("2026-06-23T17:50:00.000Z"),
    currentSignalPrice: "100.00",
    currentSignalClose: "100.50",
    currentSignalMfePercent: "1.20",
    currentSignalMaePercent: "-0.40",
    filterState: { aligned: true },
    latestBarAt: new Date("2026-06-23T20:05:00.000Z"),
    latestBarClose: "101.00",
    barsSinceSignal: 27,
    fresh: false,
    status: "ok",
    active: true,
    lastEvaluatedAt: new Date("2026-06-23T20:05:00.000Z"),
    lastError: null,
    trendDirection: "bearish",
    updatedAt: new Date("2026-06-23T20:05:00.000Z"),
    ...overrides,
  };
}

// The "candidate" mirrors the post-latch insert row a re-evaluation produces.
function candidateRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    profileId: "p",
    symbol: "SPY",
    timeframe: "5m",
    // After the stored-direction latch, a no-new-crossover candidate carries the
    // stored signal identity forward; the bar metadata, though, is fresh.
    currentSignalDirection: "sell",
    currentSignalAt: new Date("2026-06-23T17:50:00.000Z"),
    currentSignalPrice: "100.00",
    currentSignalClose: "100.50",
    currentSignalMfePercent: "1.20",
    currentSignalMaePercent: "-0.40",
    filterState: { aligned: true },
    latestBarAt: new Date("2026-06-23T21:30:00.000Z"),
    latestBarClose: "102.50",
    barsSinceSignal: 44,
    fresh: false,
    status: "ok",
    active: true,
    lastEvaluatedAt: new Date("2026-06-23T21:30:05.000Z"),
    lastError: null,
    trendDirection: "bearish",
    updatedAt: new Date("2026-06-23T21:30:05.000Z"),
    ...overrides,
  };
}

test("a fresh bar advances latestBarAt/lastEvaluatedAt even when the stored signal is preserved", () => {
  const existing = existingRow();
  const candidate = candidateRow();

  const merged = merge(existing as never, candidate as never);
  assert.ok(merged, "expected the fresh bar to produce a merged write row");

  // Bar metadata advances to the candidate's fresh edge.
  assert.equal(
    (merged?.latestBarAt as Date)?.toISOString(),
    "2026-06-23T21:30:00.000Z",
  );
  assert.equal(merged?.latestBarClose, "102.50");
  assert.equal(
    (merged?.lastEvaluatedAt as Date)?.toISOString(),
    "2026-06-23T21:30:05.000Z",
  );

  // Signal identity stays the preserved stored signal (the sell @17:50).
  assert.equal(merged?.currentSignalDirection, "sell");
  assert.equal(
    (merged?.currentSignalAt as Date)?.toISOString(),
    "2026-06-23T17:50:00.000Z",
  );
  // A preserved (older) signal is never inside the fresh window.
  assert.equal(merged?.fresh, false);
  // bars-since-signal stays coherent (recomputed against the preserved signal
  // and the fresh bar), and advances past the stored 27.
  assert.ok(
    typeof merged?.barsSinceSignal === "number" &&
      merged.barsSinceSignal >= 27,
    `expected barsSinceSignal to advance, got ${String(merged?.barsSinceSignal)}`,
  );
});

test("no merge when the candidate bar edge does not advance (no-op write avoidance)", () => {
  // Candidate bar is equal to / older than the stored bar — nothing fresher.
  const sameEdge = merge(
    existingRow() as never,
    candidateRow({
      latestBarAt: new Date("2026-06-23T20:05:00.000Z"),
    }) as never,
  );
  assert.equal(sameEdge, null);

  const olderEdge = merge(
    existingRow() as never,
    candidateRow({
      latestBarAt: new Date("2026-06-23T19:55:00.000Z"),
    }) as never,
  );
  assert.equal(olderEdge, null);

  const noEdge = merge(
    existingRow() as never,
    candidateRow({ latestBarAt: null }) as never,
  );
  assert.equal(noEdge, null);
});

test("an older incoming signal cannot displace a newer stored signal (invariant preserved)", () => {
  // Stored row: a NEWER real signal (sell @17:50). Incoming evaluation: an OLDER
  // signal (buy @13:55) — exactly the live case that froze SPY 5m.
  const existing = existingRow({
    currentSignalDirection: "sell",
    currentSignalAt: new Date("2026-06-23T17:50:00.000Z"),
  });
  const candidate = candidateRow({
    currentSignalDirection: "buy",
    currentSignalAt: new Date("2026-06-23T13:55:00.000Z"),
    currentSignalPrice: "99.00",
    currentSignalClose: "99.10",
    latestBarAt: new Date("2026-06-23T21:30:00.000Z"),
  });

  // The preserve guard still ranks the newer stored signal above the candidate.
  assert.equal(shouldPreserve(existing as never, candidate as never), true);

  // And after merging fresh bar metadata, the signal identity is STILL the
  // newer stored sell @17:50 — the older buy @13:55 never wins.
  const merged = merge(existing as never, candidate as never);
  assert.ok(merged, "fresh bar should still produce a write row");
  assert.equal(merged?.currentSignalDirection, "sell");
  assert.equal(
    (merged?.currentSignalAt as Date)?.toISOString(),
    "2026-06-23T17:50:00.000Z",
  );
  assert.equal(merged?.currentSignalPrice, "100.00");
  // But the bar edge still advanced (the freshness bug is fixed).
  assert.equal(
    (merged?.latestBarAt as Date)?.toISOString(),
    "2026-06-23T21:30:00.000Z",
  );
});
