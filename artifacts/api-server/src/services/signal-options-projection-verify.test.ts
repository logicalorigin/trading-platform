import assert from "node:assert/strict";
import test from "node:test";

import {
  __signalOptionsAutomationInternalsForTests as internals,
} from "./signal-options-automation";

// Plan step 4 (drift self-repair): the authoritative tally must re-verify against
// a full ledger derive exactly when it matters — a folded ENTRY/EXIT changed the
// position set, or the last verification aged past the backstop interval. These
// pin the trigger; the repair action reuses the already-tested cold-rebuild path.

const NOW = new Date("2026-07-07T15:00:00Z");

function verifiedProjection(signature: string, verifiedAt: Date) {
  const projection = internals.createSignalOptionsPositionProjection("sig");
  projection.lastFullVerifyAt = verifiedAt;
  projection.lastVerifiedPositionsSignature = signature;
  return projection;
}

test("position-set change (folded entry/exit) forces a full verify", () => {
  const projection = verifiedProjection("old-signature", NOW);
  assert.equal(
    internals.shouldVerifySignalOptionsProjection({
      projection,
      positionsSignature: "new-signature",
      now: NOW,
    }),
    true,
  );
});

test("unchanged positions within the backstop interval skip the full read", () => {
  const projection = verifiedProjection("same", new Date(NOW.getTime() - 60_000));
  assert.equal(
    internals.shouldVerifySignalOptionsProjection({
      projection,
      positionsSignature: "same",
      now: NOW,
    }),
    false,
  );
});

test("verification older than the 15m backstop forces a full verify even when idle", () => {
  const projection = verifiedProjection(
    "same",
    new Date(NOW.getTime() - 15 * 60_000),
  );
  assert.equal(
    internals.shouldVerifySignalOptionsProjection({
      projection,
      positionsSignature: "same",
      now: NOW,
    }),
    true,
  );
});

test("a never-verified projection always verifies", () => {
  const projection = internals.createSignalOptionsPositionProjection("sig");
  assert.equal(
    internals.shouldVerifySignalOptionsProjection({
      projection,
      positionsSignature: internals.signalOptionsPositionActionSignature([]),
      now: NOW,
    }),
    true,
  );
});
