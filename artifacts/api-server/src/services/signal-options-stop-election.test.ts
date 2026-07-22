import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  clearSignalOptionsStopElectionStateForTests,
  electSignalOptionsRegularStop,
  ratchetSignalOptionsExecutablePeak,
  signalOptionsStopQuoteEvidence,
} from "./signal-options-stop-election";

const at = (milliseconds: number) => new Date(1_700_000_000_000 + milliseconds);

test.beforeEach(() => clearSignalOptionsStopElectionStateForTests());

test("one executable-bid breach still waits for confirmation", () => {
  const result = electSignalOptionsRegularStop({
    positionKey: "position-1",
    stopPrice: 1,
    stopRevision: "1",
    observedAt: at(0),
    quote: { bid: 0.7, ask: 1.2, identity: "q1", fresh: true },
  });
  assert.equal(result.elected, false);
  assert.equal(result.reason, "awaiting_confirmation");
});

test("two distinct fresh executable bids elect even while the ask is above the stop", () => {
  electSignalOptionsRegularStop({
    positionKey: "wide-position",
    stopPrice: 1,
    stopRevision: "1",
    observedAt: at(0),
    quote: { bid: 0.8, ask: 1.2, identity: "q1", fresh: true },
  });
  const result = electSignalOptionsRegularStop({
    positionKey: "wide-position",
    stopPrice: 1,
    stopRevision: "1",
    observedAt: at(1_000),
    quote: { bid: 0.79, ask: 1.18, identity: "q2", fresh: true },
  });

  assert.equal(result.elected, true);
  assert.equal(result.source, "double_bid");
});

test("a liquidity-rejected midpoint breach cannot authorize a hard stop", () => {
  const election = electSignalOptionsRegularStop({
    positionKey: "position-1",
    stopPrice: 1,
    stopRevision: "1",
    observedAt: at(0),
    quote: { bid: 0.2, ask: 1.5, identity: "wide-q1", fresh: false },
  });

  assert.equal((0.2 + 1.5) / 2 < 1, true);
  assert.equal(election.elected, false);
});

test("automation and shadow hard stops cannot bypass regular-stop election", () => {
  const automationSource = readFileSync(
    new URL("./signal-options-automation.ts", import.meta.url),
    "utf8",
  );
  const automationConfirmation = automationSource.slice(
    automationSource.indexOf("const confirmedRegularStopReason ="),
    automationSource.indexOf("const stopPayload ="),
  );
  assert.match(automationConfirmation, /stopElection\.elected/);
  assert.doesNotMatch(
    automationConfirmation,
    /activeStopKind\s*===\s*"hard_stop"|stopElection\.evidenceCount/,
  );

  const shadowSource = readFileSync(
    new URL("./shadow-account.ts", import.meta.url),
    "utf8",
  );
  const shadowEnforcement = shadowSource.slice(
    shadowSource.indexOf(
      "async function enforceSignalOptionsTrailingStopFromShadowMark(",
    ),
    shadowSource.indexOf(
      "async function enforceSignalOptionsTrailingStopFromShadowMarkSafely(",
    ),
  );
  assert.match(shadowEnforcement, /!stopElection\?\.elected/);
  assert.doesNotMatch(shadowEnforcement, /activeStopKind\s*!==\s*"hard_stop"/);
});

test("two distinct fresh bids at or below the stop elect it", () => {
  electSignalOptionsRegularStop({
    positionKey: "position-1",
    stopPrice: 1,
    stopRevision: "1",
    observedAt: at(0),
    quote: { bid: 0.8, ask: 0.99, identity: "q1", fresh: true },
  });
  const result = electSignalOptionsRegularStop({
    positionKey: "position-1",
    stopPrice: 1,
    stopRevision: "1",
    observedAt: at(1_000),
    quote: { bid: 0.79, ask: 0.98, identity: "q2", fresh: true },
  });
  assert.equal(result.elected, true);
  assert.equal(result.source, "double_bid");
});

test("unchanged NBBOs use distinct fresh server receipts as stop evidence", () => {
  const marketUpdatedAt = at(-3_600_000);
  const firstObservedAt = at(0);
  const secondObservedAt = at(1_000);
  const firstEvidence = signalOptionsStopQuoteEvidence({
    quote: {
      dataUpdatedAt: marketUpdatedAt,
      latency: { apiServerReceivedAt: firstObservedAt },
    },
    bid: 0.8,
    ask: 0.99,
    observedAt: firstObservedAt,
    maxAgeMs: 10_000,
    eligible: true,
  });
  const secondEvidence = signalOptionsStopQuoteEvidence({
    quote: {
      dataUpdatedAt: marketUpdatedAt,
      latency: { apiServerReceivedAt: secondObservedAt },
    },
    bid: 0.8,
    ask: 0.99,
    observedAt: secondObservedAt,
    maxAgeMs: 10_000,
    eligible: true,
  });

  assert.ok(firstEvidence);
  assert.ok(secondEvidence);
  assert.equal(firstEvidence.fresh, true);
  assert.equal(secondEvidence.fresh, true);
  assert.notEqual(firstEvidence.identity, secondEvidence.identity);

  electSignalOptionsRegularStop({
    positionKey: "flat-nbbo",
    stopPrice: 1,
    stopRevision: "1",
    observedAt: firstObservedAt,
    quote: firstEvidence,
  });
  const result = electSignalOptionsRegularStop({
    positionKey: "flat-nbbo",
    stopPrice: 1,
    stopRevision: "1",
    observedAt: secondObservedAt,
    quote: secondEvidence,
  });

  assert.equal(result.elected, true);
  assert.equal(result.source, "double_bid");
});

test("a stale server receipt cannot be stop evidence", () => {
  const evidence = signalOptionsStopQuoteEvidence({
    quote: {
      dataUpdatedAt: at(0),
      latency: { apiServerReceivedAt: at(0) },
    },
    bid: 0.8,
    ask: 0.99,
    observedAt: at(10_001),
    maxAgeMs: 10_000,
    eligible: true,
  });

  assert.ok(evidence);
  assert.equal(evidence.fresh, false);
});

test("distinct bids with equal timestamps elect the stop", () => {
  electSignalOptionsRegularStop({
    positionKey: "position-1",
    stopPrice: 1,
    stopRevision: "1",
    observedAt: at(1_000),
    quote: { bid: 0.8, ask: 0.99, identity: "q1", fresh: true },
  });
  const result = electSignalOptionsRegularStop({
    positionKey: "position-1",
    stopPrice: 1,
    stopRevision: "1",
    observedAt: at(1_000),
    quote: { bid: 0.79, ask: 0.98, identity: "q2", fresh: true },
  });

  assert.equal(result.elected, true);
  assert.equal(result.source, "double_bid");
});

test("bids observed at 1000, 0, then 500 cannot regress the newer anchor", () => {
  electSignalOptionsRegularStop({
    positionKey: "position-1",
    stopPrice: 1,
    stopRevision: "1",
    observedAt: at(1_000),
    quote: { bid: 0.8, ask: 0.99, identity: "q1", fresh: true },
  });
  electSignalOptionsRegularStop({
    positionKey: "position-1",
    stopPrice: 1,
    stopRevision: "1",
    observedAt: at(0),
    quote: { bid: 0.79, ask: 0.98, identity: "q2", fresh: true },
  });
  const result = electSignalOptionsRegularStop({
    positionKey: "position-1",
    stopPrice: 1,
    stopRevision: "1",
    observedAt: at(500),
    quote: { bid: 0.78, ask: 0.97, identity: "q3", fresh: true },
  });

  assert.equal(result.elected, false);
  assert.equal(result.evidenceCount, 1);
});

test("a recovered bid unelects and resets a confirmed double-bid lane", () => {
  electSignalOptionsRegularStop({
    positionKey: "position-1",
    stopPrice: 1,
    stopRevision: "1",
    observedAt: at(0),
    quote: { bid: 0.8, ask: 0.99, identity: "q1", fresh: true },
  });
  assert.equal(
    electSignalOptionsRegularStop({
      positionKey: "position-1",
      stopPrice: 1,
      stopRevision: "1",
      observedAt: at(500),
      quote: { bid: 0.79, ask: 0.98, identity: "q2", fresh: true },
    }).elected,
    true,
  );

  const recovered = electSignalOptionsRegularStop({
    positionKey: "position-1",
    stopPrice: 1,
    stopRevision: "1",
    observedAt: at(750),
    quote: { bid: 1.01, ask: 1.2, identity: "q3", fresh: true },
  });
  const firstNewBreach = electSignalOptionsRegularStop({
    positionKey: "position-1",
    stopPrice: 1,
    stopRevision: "1",
    observedAt: at(1_000),
    quote: { bid: 0.78, ask: 0.97, identity: "q4", fresh: true },
  });
  const reconfirmed = electSignalOptionsRegularStop({
    positionKey: "position-1",
    stopPrice: 1,
    stopRevision: "1",
    observedAt: at(1_250),
    quote: { bid: 0.77, ask: 0.96, identity: "q5", fresh: true },
  });

  assert.equal(recovered.elected, false);
  assert.equal(recovered.evidenceCount, 0);
  assert.equal(firstNewBreach.elected, false);
  assert.equal(firstNewBreach.evidenceCount, 1);
  assert.equal(reconfirmed.elected, true);
  assert.equal(reconfirmed.source, "double_bid");
});

test("an expired double-bid confirmation starts a new bid lane", () => {
  electSignalOptionsRegularStop({
    positionKey: "position-1",
    stopPrice: 1,
    stopRevision: "1",
    observedAt: at(0),
    maxEvidenceSpacingMs: 1_000,
    quote: { bid: 0.8, ask: 0.99, identity: "q1", fresh: true },
  });
  assert.equal(
    electSignalOptionsRegularStop({
      positionKey: "position-1",
      stopPrice: 1,
      stopRevision: "1",
      observedAt: at(500),
      maxEvidenceSpacingMs: 1_000,
      quote: { bid: 0.79, ask: 0.98, identity: "q2", fresh: true },
    }).elected,
    true,
  );

  const expired = electSignalOptionsRegularStop({
    positionKey: "position-1",
    stopPrice: 1,
    stopRevision: "1",
    observedAt: at(1_501),
    maxEvidenceSpacingMs: 1_000,
    quote: { bid: 0.78, ask: 0.97, identity: "q3", fresh: true },
  });
  const reconfirmed = electSignalOptionsRegularStop({
    positionKey: "position-1",
    stopPrice: 1,
    stopRevision: "1",
    observedAt: at(2_000),
    maxEvidenceSpacingMs: 1_000,
    quote: { bid: 0.77, ask: 0.96, identity: "q4", fresh: true },
  });

  assert.equal(expired.elected, false);
  assert.equal(expired.evidenceCount, 1);
  assert.equal(reconfirmed.elected, true);
  assert.equal(reconfirmed.source, "double_bid");
});

test("duplicate, stale, and recovered bids do not confirm", () => {
  electSignalOptionsRegularStop({
    positionKey: "position-1",
    stopPrice: 1,
    stopRevision: "1",
    observedAt: at(0),
    quote: { bid: 0.8, ask: 0.99, identity: "q1", fresh: true },
  });
  electSignalOptionsRegularStop({
    positionKey: "position-1",
    stopPrice: 1,
    stopRevision: "1",
    observedAt: at(500),
    quote: { bid: 0.8, ask: 0.99, identity: "q1", fresh: true },
  });
  electSignalOptionsRegularStop({
    positionKey: "position-1",
    stopPrice: 1,
    stopRevision: "1",
    observedAt: at(1_000),
    quote: { bid: 1.01, ask: 1.2, identity: "q2", fresh: true },
  });
  const result = electSignalOptionsRegularStop({
    positionKey: "position-1",
    stopPrice: 1,
    stopRevision: "1",
    observedAt: at(2_000),
    quote: { bid: 0.8, ask: 0.98, identity: "q3", fresh: false },
  });
  assert.equal(result.elected, false);
});

test("a changed stop revision resets pending evidence", () => {
  electSignalOptionsRegularStop({
    positionKey: "position-1",
    stopPrice: 1,
    stopRevision: "1",
    observedAt: at(0),
    quote: { bid: 0.8, ask: 0.99, identity: "q1", fresh: true },
  });
  const result = electSignalOptionsRegularStop({
    positionKey: "position-1",
    stopPrice: 1.05,
    stopRevision: "1.05",
    observedAt: at(1_000),
    quote: { bid: 0.8, ask: 0.98, identity: "q2", fresh: true },
  });
  assert.equal(result.elected, false);
  assert.equal(result.evidenceCount, 1);
});

test("two explicitly identified eligible last trades take priority", () => {
  electSignalOptionsRegularStop({
    positionKey: "position-1",
    stopPrice: 1,
    stopRevision: "1",
    observedAt: at(0),
    trade: { price: 0.99, identity: "t1", eligible: true, fresh: true },
  });
  const result = electSignalOptionsRegularStop({
    positionKey: "position-1",
    stopPrice: 1,
    stopRevision: "1",
    observedAt: at(1_000),
    trade: { price: 0.98, identity: "t2", eligible: true, fresh: true },
  });
  assert.equal(result.elected, true);
  assert.equal(result.source, "double_last");
});

test("distinct trades with equal timestamps elect the stop", () => {
  electSignalOptionsRegularStop({
    positionKey: "position-1",
    stopPrice: 1,
    stopRevision: "1",
    observedAt: at(2_000),
    trade: {
      price: 0.99,
      identity: "t1",
      eligible: true,
      fresh: true,
      occurredAt: at(1_000),
    },
  });
  const result = electSignalOptionsRegularStop({
    positionKey: "position-1",
    stopPrice: 1,
    stopRevision: "1",
    observedAt: at(3_000),
    trade: {
      price: 0.98,
      identity: "t2",
      eligible: true,
      fresh: true,
      occurredAt: at(1_000),
    },
  });

  assert.equal(result.elected, true);
  assert.equal(result.source, "double_last");
});

test("trades occurring at 1000, 0, then 500 cannot regress the newer anchor", () => {
  electSignalOptionsRegularStop({
    positionKey: "position-1",
    stopPrice: 1,
    stopRevision: "1",
    observedAt: at(2_000),
    trade: {
      price: 0.99,
      identity: "t1",
      eligible: true,
      fresh: true,
      occurredAt: at(1_000),
    },
  });
  electSignalOptionsRegularStop({
    positionKey: "position-1",
    stopPrice: 1,
    stopRevision: "1",
    observedAt: at(3_000),
    trade: {
      price: 0.98,
      identity: "t2",
      eligible: true,
      fresh: true,
      occurredAt: at(0),
    },
  });
  const result = electSignalOptionsRegularStop({
    positionKey: "position-1",
    stopPrice: 1,
    stopRevision: "1",
    observedAt: at(4_000),
    trade: {
      price: 0.97,
      identity: "t3",
      eligible: true,
      fresh: true,
      occurredAt: at(500),
    },
  });

  assert.equal(result.elected, false);
  assert.equal(result.evidenceCount, 1);
});

test("a recovered trade unelects and resets a confirmed double-last lane", () => {
  electSignalOptionsRegularStop({
    positionKey: "position-1",
    stopPrice: 1,
    stopRevision: "1",
    observedAt: at(0),
    trade: { price: 0.99, identity: "t1", eligible: true, fresh: true },
  });
  assert.equal(
    electSignalOptionsRegularStop({
      positionKey: "position-1",
      stopPrice: 1,
      stopRevision: "1",
      observedAt: at(500),
      trade: { price: 0.98, identity: "t2", eligible: true, fresh: true },
    }).elected,
    true,
  );

  const recovered = electSignalOptionsRegularStop({
    positionKey: "position-1",
    stopPrice: 1,
    stopRevision: "1",
    observedAt: at(750),
    trade: { price: 1.01, identity: "t3", eligible: true, fresh: true },
  });
  const firstNewBreach = electSignalOptionsRegularStop({
    positionKey: "position-1",
    stopPrice: 1,
    stopRevision: "1",
    observedAt: at(1_000),
    trade: { price: 0.97, identity: "t4", eligible: true, fresh: true },
  });
  const reconfirmed = electSignalOptionsRegularStop({
    positionKey: "position-1",
    stopPrice: 1,
    stopRevision: "1",
    observedAt: at(1_250),
    trade: { price: 0.96, identity: "t5", eligible: true, fresh: true },
  });

  assert.equal(recovered.elected, false);
  assert.equal(recovered.evidenceCount, 0);
  assert.equal(firstNewBreach.elected, false);
  assert.equal(firstNewBreach.evidenceCount, 1);
  assert.equal(reconfirmed.elected, true);
  assert.equal(reconfirmed.source, "double_last");
});

test("an expired double-last confirmation starts a new trade lane", () => {
  electSignalOptionsRegularStop({
    positionKey: "position-1",
    stopPrice: 1,
    stopRevision: "1",
    observedAt: at(0),
    maxEvidenceSpacingMs: 1_000,
    trade: { price: 0.99, identity: "t1", eligible: true, fresh: true },
  });
  assert.equal(
    electSignalOptionsRegularStop({
      positionKey: "position-1",
      stopPrice: 1,
      stopRevision: "1",
      observedAt: at(500),
      maxEvidenceSpacingMs: 1_000,
      trade: { price: 0.98, identity: "t2", eligible: true, fresh: true },
    }).elected,
    true,
  );

  const expired = electSignalOptionsRegularStop({
    positionKey: "position-1",
    stopPrice: 1,
    stopRevision: "1",
    observedAt: at(1_501),
    maxEvidenceSpacingMs: 1_000,
    trade: { price: 0.97, identity: "t3", eligible: true, fresh: true },
  });
  const reconfirmed = electSignalOptionsRegularStop({
    positionKey: "position-1",
    stopPrice: 1,
    stopRevision: "1",
    observedAt: at(2_000),
    maxEvidenceSpacingMs: 1_000,
    trade: { price: 0.96, identity: "t4", eligible: true, fresh: true },
  });

  assert.equal(expired.elected, false);
  assert.equal(expired.evidenceCount, 1);
  assert.equal(reconfirmed.elected, true);
  assert.equal(reconfirmed.source, "double_last");
});

test("a repeated provider trade snapshot cannot confirm twice", () => {
  electSignalOptionsRegularStop({
    positionKey: "position-1",
    stopPrice: 1,
    stopRevision: "1",
    observedAt: at(0),
    trade: { price: 0.99, identity: "massive:t1", eligible: true, fresh: true },
  });
  const result = electSignalOptionsRegularStop({
    positionKey: "position-1",
    stopPrice: 1,
    stopRevision: "1",
    observedAt: at(1_000),
    trade: { price: 0.99, identity: "massive:t1", eligible: true, fresh: true },
  });

  assert.equal(result.elected, false);
  assert.equal(result.evidenceCount, 1);
});

test("double-last spacing uses provider trade time, not poll time", () => {
  electSignalOptionsRegularStop({
    positionKey: "position-1",
    stopPrice: 1,
    stopRevision: "1",
    observedAt: at(9_000),
    trade: {
      price: 0.99,
      identity: "massive:t1",
      eligible: true,
      fresh: true,
      occurredAt: at(0),
    },
  });
  const result = electSignalOptionsRegularStop({
    positionKey: "position-1",
    stopPrice: 1,
    stopRevision: "1",
    observedAt: at(12_000),
    trade: {
      price: 0.98,
      identity: "massive:t2",
      eligible: true,
      fresh: true,
      occurredAt: at(11_000),
    },
  });

  assert.equal(result.elected, false);
  assert.equal(result.evidenceCount, 1);
});

test("malformed election inputs fail closed", () => {
  type ElectionInput = Parameters<typeof electSignalOptionsRegularStop>[0];
  const validInput: ElectionInput = {
    positionKey: "position-1",
    stopPrice: 1,
    stopRevision: "1",
    observedAt: at(0),
    quote: { bid: 0.8, ask: 0.99, identity: "q1", fresh: true },
  };
  const cases: Array<{ name: string; patch: Partial<ElectionInput> }> = [
    { name: "blank position key", patch: { positionKey: " " } },
    { name: "blank stop revision", patch: { stopRevision: " " } },
    { name: "NaN stop", patch: { stopPrice: Number.NaN } },
    { name: "infinite stop", patch: { stopPrice: Number.POSITIVE_INFINITY } },
    { name: "zero stop", patch: { stopPrice: 0 } },
    {
      name: "invalid observation time",
      patch: { observedAt: new Date(Number.NaN) },
    },
    { name: "NaN spacing", patch: { maxEvidenceSpacingMs: Number.NaN } },
    {
      name: "infinite spacing",
      patch: { maxEvidenceSpacingMs: Number.POSITIVE_INFINITY },
    },
    { name: "negative spacing", patch: { maxEvidenceSpacingMs: -1 } },
    {
      name: "NaN trade price",
      patch: {
        quote: null,
        trade: {
          price: Number.NaN,
          identity: "t1",
          eligible: true,
          fresh: true,
        },
      },
    },
    {
      name: "zero trade price",
      patch: {
        quote: null,
        trade: { price: 0, identity: "t1", eligible: true, fresh: true },
      },
    },
    {
      name: "blank trade identity",
      patch: {
        quote: null,
        trade: { price: 0.99, identity: " ", eligible: true, fresh: true },
      },
    },
    {
      name: "invalid trade time",
      patch: {
        quote: null,
        trade: {
          price: 0.99,
          identity: "t1",
          eligible: true,
          fresh: true,
          occurredAt: new Date(Number.NaN),
        },
      },
    },
    {
      name: "NaN bid",
      patch: {
        quote: { bid: Number.NaN, ask: 0.99, identity: "q1", fresh: true },
      },
    },
    {
      name: "zero bid",
      patch: { quote: { bid: 0, ask: 0.99, identity: "q1", fresh: true } },
    },
    {
      name: "infinite ask",
      patch: {
        quote: {
          bid: 0.8,
          ask: Number.POSITIVE_INFINITY,
          identity: "q1",
          fresh: true,
        },
      },
    },
    {
      name: "zero ask",
      patch: { quote: { bid: 0, ask: 0, identity: "q1", fresh: true } },
    },
    {
      name: "blank quote identity",
      patch: { quote: { bid: 0.8, ask: 0.99, identity: " ", fresh: true } },
    },
    {
      name: "crossed quote",
      patch: { quote: { bid: 1.01, ask: 0.99, identity: "q1", fresh: true } },
    },
  ];

  for (const [index, invalid] of cases.entries()) {
    const result = electSignalOptionsRegularStop({
      ...validInput,
      positionKey: `malformed-${index}`,
      ...invalid.patch,
    });
    assert.deepEqual(
      result,
      {
        elected: false,
        source: null,
        electedAt: null,
        reason: "awaiting_confirmation",
        evidenceCount: 0,
      },
      invalid.name,
    );
  }
});

test("malformed evidence cannot become a confirmation anchor", () => {
  const malformed = electSignalOptionsRegularStop({
    positionKey: "position-1",
    stopPrice: 1,
    stopRevision: "1",
    observedAt: at(0),
    quote: { bid: 1.01, ask: 0.99, identity: "q1", fresh: true },
  });
  const firstValid = electSignalOptionsRegularStop({
    positionKey: "position-1",
    stopPrice: 1,
    stopRevision: "1",
    observedAt: at(500),
    quote: { bid: 0.8, ask: 0.98, identity: "q2", fresh: true },
  });
  const secondValid = electSignalOptionsRegularStop({
    positionKey: "position-1",
    stopPrice: 1,
    stopRevision: "1",
    observedAt: at(1_000),
    quote: { bid: 0.79, ask: 0.97, identity: "q3", fresh: true },
  });

  assert.equal(malformed.evidenceCount, 0);
  assert.equal(firstValid.elected, false);
  assert.equal(firstValid.evidenceCount, 1);
  assert.equal(secondValid.elected, true);
});

test("malformed evidence clears an existing confirmation", () => {
  electSignalOptionsRegularStop({
    positionKey: "position-1",
    stopPrice: 1,
    stopRevision: "1",
    observedAt: at(0),
    quote: { bid: 0.8, ask: 0.99, identity: "q1", fresh: true },
  });
  assert.equal(
    electSignalOptionsRegularStop({
      positionKey: "position-1",
      stopPrice: 1,
      stopRevision: "1",
      observedAt: at(500),
      quote: { bid: 0.79, ask: 0.98, identity: "q2", fresh: true },
    }).elected,
    true,
  );

  const malformed = electSignalOptionsRegularStop({
    positionKey: "position-1",
    stopPrice: 1,
    stopRevision: "1",
    observedAt: at(750),
    quote: { bid: 1.01, ask: 0.99, identity: "crossed", fresh: true },
  });
  const firstNewBreach = electSignalOptionsRegularStop({
    positionKey: "position-1",
    stopPrice: 1,
    stopRevision: "1",
    observedAt: at(1_000),
    quote: { bid: 0.78, ask: 0.97, identity: "q3", fresh: true },
  });

  assert.equal(malformed.elected, false);
  assert.equal(firstNewBreach.elected, false);
  assert.equal(firstNewBreach.evidenceCount, 1);
});

test("trade recovery clears stale bid evidence from the same election", () => {
  electSignalOptionsRegularStop({
    positionKey: "position-1",
    stopPrice: 1,
    stopRevision: "1",
    observedAt: at(0),
    trade: { price: 0.99, identity: "t1", eligible: true, fresh: true },
    quote: { bid: 0.8, ask: 0.99, identity: "q1", fresh: true },
  });
  assert.equal(
    electSignalOptionsRegularStop({
      positionKey: "position-1",
      stopPrice: 1,
      stopRevision: "1",
      observedAt: at(500),
      trade: { price: 0.98, identity: "t2", eligible: true, fresh: true },
    }).source,
    "double_last",
  );

  const recovered = electSignalOptionsRegularStop({
    positionKey: "position-1",
    stopPrice: 1,
    stopRevision: "1",
    observedAt: at(750),
    trade: { price: 1.01, identity: "t3", eligible: true, fresh: true },
  });
  const firstNewBid = electSignalOptionsRegularStop({
    positionKey: "position-1",
    stopPrice: 1,
    stopRevision: "1",
    observedAt: at(1_000),
    quote: { bid: 0.78, ask: 0.97, identity: "q2", fresh: true },
  });

  assert.equal(recovered.evidenceCount, 0);
  assert.equal(firstNewBid.elected, false);
  assert.equal(firstNewBid.evidenceCount, 1);
});

test("bid recovery clears stale trade evidence from the same election", () => {
  electSignalOptionsRegularStop({
    positionKey: "position-1",
    stopPrice: 1,
    stopRevision: "1",
    observedAt: at(0),
    trade: { price: 0.99, identity: "t1", eligible: true, fresh: true },
    quote: { bid: 0.8, ask: 0.99, identity: "q1", fresh: true },
  });
  assert.equal(
    electSignalOptionsRegularStop({
      positionKey: "position-1",
      stopPrice: 1,
      stopRevision: "1",
      observedAt: at(500),
      quote: { bid: 0.79, ask: 0.98, identity: "q2", fresh: true },
    }).source,
    "double_bid",
  );

  const recovered = electSignalOptionsRegularStop({
    positionKey: "position-1",
    stopPrice: 1,
    stopRevision: "1",
    observedAt: at(750),
    quote: { bid: 1.01, ask: 1.2, identity: "q3", fresh: true },
  });
  const firstNewTrade = electSignalOptionsRegularStop({
    positionKey: "position-1",
    stopPrice: 1,
    stopRevision: "1",
    observedAt: at(1_000),
    trade: { price: 0.97, identity: "t2", eligible: true, fresh: true },
  });

  assert.equal(recovered.evidenceCount, 0);
  assert.equal(firstNewTrade.elected, false);
  assert.equal(firstNewTrade.evidenceCount, 1);
});

test("trailing peaks ratchet only from executable bid evidence", () => {
  assert.equal(
    ratchetSignalOptionsExecutablePeak({
      positionKey: "position-1",
      baselinePeak: 1,
      bid: 1.2,
    }),
    1.2,
  );
  assert.equal(
    ratchetSignalOptionsExecutablePeak({
      positionKey: "position-1",
      baselinePeak: 1,
      bid: 0.7,
    }),
    1.2,
  );
});

test("malformed executable peaks fail closed without poisoning the cache", () => {
  const cases = [
    {
      name: "blank position key",
      input: { positionKey: " ", baselinePeak: 1, bid: 1.2 },
      expected: 0,
    },
    {
      name: "NaN baseline",
      input: {
        positionKey: "nan-baseline",
        baselinePeak: Number.NaN,
        bid: 1.2,
      },
      expected: 0,
    },
    {
      name: "infinite baseline",
      input: {
        positionKey: "infinite-baseline",
        baselinePeak: Number.POSITIVE_INFINITY,
        bid: 1.2,
      },
      expected: 0,
    },
    {
      name: "zero baseline",
      input: { positionKey: "zero-baseline", baselinePeak: 0, bid: 1.2 },
      expected: 0,
    },
    {
      name: "negative baseline",
      input: { positionKey: "negative-baseline", baselinePeak: -1, bid: 1.2 },
      expected: 0,
    },
    {
      name: "NaN bid",
      input: { positionKey: "nan-bid", baselinePeak: 1, bid: Number.NaN },
      expected: 1,
    },
    {
      name: "infinite bid",
      input: {
        positionKey: "infinite-bid",
        baselinePeak: 1,
        bid: Number.POSITIVE_INFINITY,
      },
      expected: 1,
    },
    {
      name: "zero bid",
      input: { positionKey: "zero-bid", baselinePeak: 1, bid: 0 },
      expected: 1,
    },
    {
      name: "negative bid",
      input: { positionKey: "negative-bid", baselinePeak: 1, bid: -1 },
      expected: 1,
    },
  ];

  for (const invalid of cases) {
    const result = ratchetSignalOptionsExecutablePeak(invalid.input);
    assert.equal(result, invalid.expected, invalid.name);
    assert.equal(Number.isFinite(result), true, invalid.name);
    if (invalid.input.positionKey.trim()) {
      assert.equal(
        ratchetSignalOptionsExecutablePeak({
          positionKey: invalid.input.positionKey,
          baselinePeak: 0.8,
          bid: 0.9,
        }),
        0.9,
        `${invalid.name} mutated the cache`,
      );
    }
  }
});

test("a malformed executable bid cannot replace a valid cached peak", () => {
  assert.equal(
    ratchetSignalOptionsExecutablePeak({
      positionKey: "position-1",
      baselinePeak: 1,
      bid: 1.2,
    }),
    1.2,
  );
  assert.equal(
    ratchetSignalOptionsExecutablePeak({
      positionKey: "position-1",
      baselinePeak: 1,
      bid: Number.POSITIVE_INFINITY,
    }),
    1.2,
  );
  assert.equal(
    ratchetSignalOptionsExecutablePeak({
      positionKey: "position-1",
      baselinePeak: 0.8,
      bid: 0.9,
    }),
    1.2,
  );
});
