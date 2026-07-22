import assert from "node:assert/strict";
import test from "node:test";

import { __shadowLedgerDuplicateExitCorrection20260716InternalsForTests as internals } from "./correct-shadow-ledger-duplicate-exits-2026-07-16";

test("duplicate-exit correction is import-safe and defaults to dry-run", () => {
  const previous = process.env.SHADOW_LEDGER_CORRECTION_MODE;
  delete process.env.SHADOW_LEDGER_CORRECTION_MODE;
  try {
    assert.equal(internals.mode(), "dry-run");
    assert.equal(internals.DUPLICATES.length, 2);
    assert.deepEqual(
      internals.DUPLICATES.map((item) => item.symbol),
      ["ABAT", "CELH"],
    );
  } finally {
    if (previous === undefined) delete process.env.SHADOW_LEDGER_CORRECTION_MODE;
    else process.env.SHADOW_LEDGER_CORRECTION_MODE = previous;
  }
});

test("duplicate-exit correction rejects an unsafe mode", () => {
  const previous = process.env.SHADOW_LEDGER_CORRECTION_MODE;
  process.env.SHADOW_LEDGER_CORRECTION_MODE = "yes-really";
  try {
    assert.throws(() => internals.mode(), /must be dry-run or apply/);
  } finally {
    if (previous === undefined) delete process.env.SHADOW_LEDGER_CORRECTION_MODE;
    else process.env.SHADOW_LEDGER_CORRECTION_MODE = previous;
  }
});
