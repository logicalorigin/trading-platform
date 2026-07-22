import assert from "node:assert/strict";
import test from "node:test";

import { __shadowLedgerDoctrineCorrection20260716InternalsForTests as internals } from "./correct-shadow-ledger-doctrine-2026-07-16";

test("doctrine correction is import-safe and defaults to dry-run", () => {
  const previous = process.env.SHADOW_LEDGER_CORRECTION_MODE;
  delete process.env.SHADOW_LEDGER_CORRECTION_MODE;
  try {
    assert.equal(internals.mode(), "dry-run");
    assert.equal(
      internals.CORRECTION_ID,
      "1c9b0e29-328e-48cf-bad2-b91528a1ce87",
    );
  } finally {
    if (previous === undefined) delete process.env.SHADOW_LEDGER_CORRECTION_MODE;
    else process.env.SHADOW_LEDGER_CORRECTION_MODE = previous;
  }
});

test("doctrine correction accepts only explicit dry-run or apply modes", () => {
  const previous = process.env.SHADOW_LEDGER_CORRECTION_MODE;
  try {
    process.env.SHADOW_LEDGER_CORRECTION_MODE = "apply";
    assert.equal(internals.mode(), "apply");
    process.env.SHADOW_LEDGER_CORRECTION_MODE = "yes-really";
    assert.throws(() => internals.mode(), /must be dry-run or apply/);
  } finally {
    if (previous === undefined) delete process.env.SHADOW_LEDGER_CORRECTION_MODE;
    else process.env.SHADOW_LEDGER_CORRECTION_MODE = previous;
  }
});

test("doctrine manifest is complete, disjoint, and pinned by source IDs", () => {
  const plan = internals.validatePlan();

  assert.deepEqual(
    {
      eodExitCount: plan.eodExitCount,
      replacementExitCount: plan.replacementExitCount,
      reopenedCount: plan.reopenedCount,
      maintenanceReplacementCount: plan.maintenanceReplacementCount,
      runnerCount: plan.runnerCount,
      hardStopCount: plan.hardStopCount,
      earlyInvalidationCount: plan.earlyInvalidationCount,
      massiveReplaySha256: plan.massiveReplaySha256,
      openCutoffStopStateCount: plan.openCutoffStopStateCount,
      openCutoffTrailingStopCount: plan.openCutoffTrailingStopCount,
      openCutoffHardStopCount: plan.openCutoffHardStopCount,
      openCutoffStopStatesSha256: plan.openCutoffStopStatesSha256,
      rewriteTargetSha256: plan.rewriteTargetSha256,
      fullDocumentSha256: plan.fullDocumentSha256,
      all31IdSha256: plan.all31IdSha256,
      exit11IdSha256: plan.exit11IdSha256,
      open20IdSha256: plan.open20IdSha256,
    },
    {
      eodExitCount: 31,
      replacementExitCount: 11,
      reopenedCount: 20,
      maintenanceReplacementCount: 2,
      runnerCount: 4,
      hardStopCount: 6,
      earlyInvalidationCount: 1,
      massiveReplaySha256:
        "b1736a4b940dd5b40dec7a67d8dd4f9e40b140d91d149ff6a2842eb9393565c6",
      openCutoffStopStateCount: 20,
      openCutoffTrailingStopCount: 6,
      openCutoffHardStopCount: 14,
      openCutoffStopStatesSha256:
        "7521bc8b2bba8cce7023e1091c422838d1c22fa7301d5cc4631f74eb526abc27",
      rewriteTargetSha256:
        "40a58a541d60519710710d4c164690cde21abb9be5de16b4ea9aa087e488183a",
      fullDocumentSha256:
        "cc5970225b372e78637d062010f8f0fbe3bfe5a06332e30cafb5b8949ecebe3d",
      all31IdSha256:
        "3b6e4bd407ea0f762c5643750c997fb7def27b789e2bec67b861270830b6acc5",
      exit11IdSha256:
        "91c4cc8a54236e7b070be43bbcca5d06f97eb79c21c96e2963fcf3e41a8eef23",
      open20IdSha256:
        "469ab3108323c60ccb9830a3c260d8dbb391cb71ca312baa3b4f455281284c5b",
    },
  );
});

test("doctrine correction balances exact approved ledger economics", () => {
  const plan = internals.validatePlan();

  assert.deepEqual(plan.eodEconomics, {
    oldGross: 33_104,
    oldCash: 32_977.52,
    oldRealizedPnl: -5_786.48,
    oldFees: 126.48,
    newGross: 12_391,
    newCash: 12_359.39,
    newRealizedPnl: -1_446.61,
    newFees: 31.61,
    cashDelta: -20_618.13,
    realizedPnlDelta: 4_339.87,
    feesDelta: -94.87,
  });
  assert.deepEqual(plan.maintenanceEconomics, {
    cashDelta: 638,
    realizedPnlDelta: 638,
    feesDelta: 0,
  });
  assert.deepEqual(plan.expectedFinalAccount, {
    cash: 135_249.3455,
    realizedPnl: 135_991.3455,
    fees: 5_347.21,
  });
});

test("derived correction IDs are stable UUIDs and domain-separated", () => {
  const first = internals.deterministicUuid("replacement-exit:event:ARE");
  assert.equal(first, internals.deterministicUuid("replacement-exit:event:ARE"));
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(
    first,
    internals.deterministicUuid("replacement-exit:order:ARE"),
  );
});

test("open recovery payload persists pinned executable-bid stop state without making the buy a forward test", () => {
  const payload = internals.buildOpenRecoveryPayloadForTests({
    orderPayload: {
      position: {
        id: "deployment:CDE",
        peakPrice: 0.84,
        stopPrice: 0.42,
        lastMarkPrice: 0.68,
        lastMarkedAt: "2026-07-14T19:00:00.000Z",
        lastStop: { peakEvidenceSource: "legacy_midpoint" },
      },
    },
    item: {
      entryEventId: "entry-cde",
      symbol: "CDE",
      peakBid: 0.84,
      peakQuoteIdentity: null,
      markPrice: 0.7,
      cutoffQuote: { at: "2026-07-16T19:59:58.024Z" },
    },
    stopState: {
      asOf: "2026-07-16T19:59:58.024Z",
      stopInputMarkPrice: 0.8,
      lastStop: {
        activeStopKind: "hard_stop",
        stopPrice: 0.67,
        peakEvidenceSource: "executable_bid",
        enforcementSource: "ledger_correction_replay",
      },
    },
    correctedAt: new Date("2026-07-17T03:00:00.000Z"),
  });

  assert.equal(payload.forwardTest, undefined);
  assert.deepEqual(payload.position, {
    id: "deployment:CDE",
    peakPrice: 0.84,
    stopPrice: 0.67,
    lastMarkPrice: 0.7,
    lastMarkedAt: "2026-07-16T19:59:58.024Z",
    lastStop: {
      activeStopKind: "hard_stop",
      stopPrice: 0.67,
      peakEvidenceSource: "executable_bid",
      enforcementSource: "ledger_correction_replay",
    },
  });
  assert.deepEqual(
    (payload.ledgerCorrection as Record<string, unknown>)
      .originalPositionRecoveryState,
    {
      peakPrice: 0.84,
      stopPrice: 0.42,
      lastMarkPrice: 0.68,
      lastMarkedAt: "2026-07-14T19:00:00.000Z",
      lastStop: { peakEvidenceSource: "legacy_midpoint" },
    },
  );
  assert.equal(
    (payload.ledgerCorrection as Record<string, unknown>).manifestSha256,
    "cc5970225b372e78637d062010f8f0fbe3bfe5a06332e30cafb5b8949ecebe3d",
  );
});
