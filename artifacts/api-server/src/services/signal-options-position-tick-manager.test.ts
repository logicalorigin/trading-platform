import assert from "node:assert/strict";
import test from "node:test";

import { resolveSignalOptionsExecutionProfile } from "@workspace/backtest-core";
import { createSignalOptionsPositionTickManager } from "./signal-options-position-tick-manager";

const CONTRACT_ID = "OPT-C1";
const CONTRACT_ID_2 = "OPT-C2";

const deployment = { id: "deployment-1", mode: "shadow" } as never;

const position = {
  id: "position-1",
  openedAt: "2026-07-07T14:30:00.000Z",
  symbol: "TSM",
  selectedContract: { providerContractId: CONTRACT_ID },
} as never;

const positionOwner = `signal-options-position-mark:${(deployment as { id: string }).id}:${(position as { id: string }).id}:${(position as { openedAt: string }).openedAt}:tick`;

const profileWithGreeks = (enabled: boolean) =>
  ({
    exitPolicy: { wireGreekTrail: { enabled } },
  }) as never;

const quoteFor = (providerContractId: string, mark: number) =>
  ({ providerContractId, mark }) as never;

const payloadFor = (providerContractId: string, mark: number) =>
  ({ quotes: [quoteFor(providerContractId, mark)] }) as never;

const payload = (mark: number) => payloadFor(CONTRACT_ID, mark);

function createHarness() {
  type FakeDemand = {
    owner: string;
    providerContractIds: string[];
    requiresGreeks: boolean;
    onSnapshot: (input: never) => void;
    unsubscribed: boolean;
  };
  const subscriptions: FakeDemand[] = [];
  let deployments = [deployment];
  // Mirrors option-quote-demand-coordinator's activeDemands: exactly one live
  // registration per owner, keyed only by owner (not by contract). This is
  // what makes the owner-based release bug reproducible in a test.
  const activeByOwner = new Map<string, FakeDemand>();
  const managedMarks: number[] = [];
  const managedPositions: Array<{
    peakPrice?: number;
    quantity?: number;
    premiumAtRisk?: number;
    stopPrice?: number;
    selectedContract?: Record<string, unknown>;
    lastStop?: Record<string, unknown> | null;
    lastWireTrail?: Record<string, unknown> | null;
    entryGreeks?: Record<string, unknown> | null;
    greekBaselineSource?: string | null;
    oppositeSignalPendingConfirm?: Record<string, unknown> | null;
  }> = [];
  let greeksEnabled = false;
  let releaseManageQuote = () => {};
  let manageQuoteGate: Promise<void> | null = null;
  let nowMs = 0;
  let activePositions = [position];
  let listActivePositionsCalls = 0;
  let exitOnManageQuote = false;
  let scaleOutOnManageQuote = false;
  let managedPositionOverride: unknown = null;
  let releaseListActivePositions = () => {};
  let listActivePositionsGate: Promise<void> | null = null;
  let captureListActivePositionsBeforeGate = false;
  let resolveProfileError: Error | null = null;
  const subscribeDemandErrors: Error[] = [];

  const manager = createSignalOptionsPositionTickManager({
    listDeployments: async () => deployments,
    listActivePositions: async () => {
      listActivePositionsCalls += 1;
      const capturedPositions = captureListActivePositionsBeforeGate
        ? activePositions
        : null;
      if (listActivePositionsGate) {
        await listActivePositionsGate;
      }
      return { positions: capturedPositions ?? activePositions, events: [] };
    },
    resolveProfile: () => {
      if (resolveProfileError) {
        const error = resolveProfileError;
        resolveProfileError = null;
        throw error;
      }
      return profileWithGreeks(greeksEnabled);
    },
    loadPyrusSignalsSettings: async () => null,
    subscribeDemand: (input, onSnapshot) => {
      const previous = activeByOwner.get(input.owner);
      if (previous) {
        previous.unsubscribed = true;
        activeByOwner.delete(input.owner);
      }
      const subscribeDemandError = subscribeDemandErrors.shift();
      if (subscribeDemandError) {
        const error = subscribeDemandError;
        throw error;
      }
      const entry: FakeDemand = {
        owner: input.owner,
        providerContractIds: input.providerContractIds,
        requiresGreeks: input.requiresGreeks === true,
        onSnapshot: onSnapshot as (input: never) => void,
        unsubscribed: false,
      };
      subscriptions.push(entry);
      activeByOwner.set(input.owner, entry);
      // Real releaseOptionQuoteDemand(owner) always releases whichever
      // registration is CURRENTLY active for the owner — it has no way to
      // tell which call created this closure. Mirror that exactly.
      return () => {
        const current = activeByOwner.get(input.owner);
        if (!current) {
          return;
        }
        current.unsubscribed = true;
        activeByOwner.delete(input.owner);
      };
    },
    manageQuote: async (input) => {
      managedMarks.push(Number((input.quote as { mark?: number }).mark));
      managedPositions.push(input.position as { peakPrice?: number });
      if (manageQuoteGate) {
        await manageQuoteGate;
      }
      if (exitOnManageQuote) {
        activePositions = [];
        return { managed: true, position: null, exited: true } as never;
      }
      return {
        managed: true,
        position: managedPositionOverride,
        exited: false,
        scaledOut: scaleOutOnManageQuote,
      } as never;
    },
    now: () => new Date(nowMs),
    activePositionSnapshotTtlMs: 1_000,
  });

  return {
    manager,
    subscriptions,
    managedMarks,
    managedPositions,
    activeByOwner,
    get listActivePositionsCalls() {
      return listActivePositionsCalls;
    },
    advanceNow(ms: number) {
      nowMs += ms;
    },
    setGreeks(enabled: boolean) {
      greeksEnabled = enabled;
    },
    setExitOnManageQuote(enabled: boolean) {
      exitOnManageQuote = enabled;
    },
    setScaleOutOnManageQuote(enabled: boolean) {
      scaleOutOnManageQuote = enabled;
    },
    setDeployments(nextDeployments: unknown[]) {
      deployments = nextDeployments as never[];
    },
    setActivePosition(nextPosition: unknown) {
      activePositions = [nextPosition as never];
    },
    setActivePositions(nextPositions: unknown[]) {
      activePositions = nextPositions as never[];
    },
    setNextManagedPosition(nextPosition: unknown) {
      managedPositionOverride = nextPosition;
    },
    blockManageQuote() {
      manageQuoteGate = new Promise((resolve) => {
        releaseManageQuote = resolve;
      });
    },
    releaseManageQuote() {
      releaseManageQuote();
      manageQuoteGate = null;
    },
    blockListActivePositions(captureBeforeGate = false) {
      captureListActivePositionsBeforeGate = captureBeforeGate;
      listActivePositionsGate = new Promise((resolve) => {
        releaseListActivePositions = resolve;
      });
    },
    releaseListActivePositionsGate() {
      releaseListActivePositions();
      listActivePositionsGate = null;
    },
    throwOnNextResolveProfile(error: Error) {
      resolveProfileError = error;
    },
    throwOnNextSubscribeDemand(error: Error) {
      subscribeDemandErrors.push(error);
    },
  };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test("greek-demand resubscribe carries a buffered tick across the swap", async () => {
  const harness = createHarness();

  await harness.manager.runOnce();
  assert.equal(harness.subscriptions.length, 1);
  assert.equal(harness.subscriptions[0]?.requiresGreeks, false);

  // First tick starts processing and blocks inside manageQuote; second tick
  // is buffered as the runtime's pendingQuote.
  harness.blockManageQuote();
  harness.subscriptions[0]?.onSnapshot(payload(101) as never);
  await settle();
  harness.subscriptions[0]?.onSnapshot(payload(102) as never);

  // Profile flips to require Greeks -> reconcile swaps the subscription.
  harness.setGreeks(true);
  await harness.manager.runOnce();
  assert.equal(harness.subscriptions.length, 2);
  assert.equal(harness.subscriptions[0]?.unsubscribed, true);
  assert.equal(harness.subscriptions[1]?.requiresGreeks, true);

  harness.releaseManageQuote();
  await settle();
  await settle();

  // The buffered tick (mark 102) survived the swap — a stop-trigger quote
  // can never be dropped by a resubscribe.
  assert.deepEqual(harness.managedMarks, [101, 102]);
});

test("greek-demand resubscribe does not start a second drain while quote management is in flight", async () => {
  const harness = createHarness();

  await harness.manager.runOnce();
  harness.blockManageQuote();
  harness.subscriptions[0]?.onSnapshot(payload(101) as never);
  await settle();
  harness.subscriptions[0]?.onSnapshot(payload(102) as never);

  harness.setGreeks(true);
  await harness.manager.runOnce();
  harness.setExitOnManageQuote(true);
  harness.releaseManageQuote();
  await settle();
  await settle();

  assert.deepEqual(
    harness.managedMarks,
    [101],
    "the buffered quote must not race the in-flight quote after that quote exits the position",
  );
});

test("ticks after the swap flow through the new subscription", async () => {
  const harness = createHarness();
  await harness.manager.runOnce();
  harness.setGreeks(true);
  await harness.manager.runOnce();

  harness.subscriptions[1]?.onSnapshot(payload(103) as never);
  await settle();

  assert.deepEqual(harness.managedMarks, [103]);
  // A straggler tick delivered on the old (unsubscribed) callback still
  // routes by key to the active runtime — same position, same contract, so
  // processing it is safe and beats dropping it.
  harness.subscriptions[0]?.onSnapshot(payload(104) as never);
  await settle();
  assert.deepEqual(harness.managedMarks, [103, 104]);
});

test("failed initial demand subscription is retried on the next reconcile", async () => {
  const harness = createHarness();
  harness.throwOnNextSubscribeDemand(new Error("subscription unavailable"));

  await harness.manager.runOnce();
  assert.equal(harness.subscriptions.length, 0);

  await harness.manager.runOnce();
  assert.equal(harness.subscriptions.length, 1);

  harness.subscriptions[0]?.onSnapshot(payload(105) as never);
  await settle();
  assert.deepEqual(harness.managedMarks, [105]);
});

test("failed Greek-demand replacement restores the prior demand and retries the upgrade", async () => {
  const harness = createHarness();
  await harness.manager.runOnce();
  harness.setGreeks(true);
  harness.throwOnNextSubscribeDemand(
    new Error("Greek subscription unavailable"),
  );

  await harness.manager.runOnce();

  const restored = harness.activeByOwner.get(positionOwner);
  assert.equal(restored?.requiresGreeks, false);
  assert.equal(restored?.unsubscribed, false);

  await harness.manager.runOnce();

  const upgraded = harness.activeByOwner.get(positionOwner);
  assert.equal(upgraded?.requiresGreeks, true);
  assert.equal(upgraded?.unsubscribed, false);
});

test("failed replacement and rollback cannot leave a phantom runtime", async () => {
  const harness = createHarness();
  await harness.manager.runOnce();
  harness.setGreeks(true);
  harness.throwOnNextSubscribeDemand(new Error("upgrade unavailable"));
  harness.throwOnNextSubscribeDemand(new Error("rollback unavailable"));

  await harness.manager.runOnce();
  assert.equal(harness.activeByOwner.has(positionOwner), false);

  harness.setGreeks(false);
  await harness.manager.runOnce();

  const restored = harness.activeByOwner.get(positionOwner);
  assert.equal(restored?.requiresGreeks, false);
  assert.equal(restored?.unsubscribed, false);
});

test("successful in-flight mark after double demand failure invalidates the stale snapshot", async () => {
  const harness = createHarness();
  const originalPosition = {
    ...(position as Record<string, unknown>),
    peakPrice: 100,
    stopPrice: 80,
    lastMarkedAt: "2026-07-07T14:31:00.000Z",
  };
  const newerPosition = {
    ...originalPosition,
    peakPrice: 110,
    stopPrice: 95,
    lastMarkedAt: "2026-07-07T14:32:00.000Z",
    entryGreeks: { delta: 0.45 },
    greekBaselineSource: "first_mark",
  };
  harness.setActivePosition(originalPosition);
  await harness.manager.runOnce();

  harness.setNextManagedPosition(newerPosition);
  harness.blockManageQuote();
  harness.subscriptions[0]?.onSnapshot(payload(101) as never);
  await settle();

  harness.setGreeks(true);
  harness.throwOnNextSubscribeDemand(new Error("upgrade unavailable"));
  harness.throwOnNextSubscribeDemand(new Error("rollback unavailable"));
  await harness.manager.runOnce();
  assert.equal(harness.activeByOwner.has(positionOwner), false);

  harness.setActivePosition(newerPosition);
  harness.releaseManageQuote();
  await settle();
  harness.setNextManagedPosition(null);
  await harness.manager.runOnce();
  harness.subscriptions.at(-1)?.onSnapshot(payload(102) as never);
  await settle();

  assert.equal(harness.listActivePositionsCalls, 2);
  assert.equal(harness.managedPositions.at(-1)?.peakPrice, 110);
  assert.equal(harness.managedPositions.at(-1)?.stopPrice, 95);
  assert.deepEqual(harness.managedPositions.at(-1)?.entryGreeks, {
    delta: 0.45,
  });
});

test("double demand failure after a successful mark invalidates the stale snapshot", async () => {
  const harness = createHarness();
  const originalPosition = {
    ...(position as Record<string, unknown>),
    peakPrice: 100,
    stopPrice: 80,
    lastMarkedAt: "2026-07-07T14:31:00.000Z",
  };
  const newerPosition = {
    ...originalPosition,
    peakPrice: 110,
    stopPrice: 95,
    lastMarkedAt: "2026-07-07T14:32:00.000Z",
    entryGreeks: { delta: 0.45 },
    greekBaselineSource: "first_mark",
  };
  harness.setActivePosition(originalPosition);
  await harness.manager.runOnce();

  harness.setNextManagedPosition(newerPosition);
  harness.subscriptions[0]?.onSnapshot(payload(101) as never);
  await settle();
  harness.setActivePosition(newerPosition);

  harness.setGreeks(true);
  harness.throwOnNextSubscribeDemand(new Error("upgrade unavailable"));
  harness.throwOnNextSubscribeDemand(new Error("rollback unavailable"));
  await harness.manager.runOnce();
  assert.equal(harness.activeByOwner.has(positionOwner), false);

  harness.setNextManagedPosition(null);
  await harness.manager.runOnce();
  harness.subscriptions.at(-1)?.onSnapshot(payload(102) as never);
  await settle();

  assert.equal(harness.listActivePositionsCalls, 2);
  assert.equal(harness.managedPositions.at(-1)?.peakPrice, 110);
  assert.equal(harness.managedPositions.at(-1)?.stopPrice, 95);
  assert.deepEqual(harness.managedPositions.at(-1)?.entryGreeks, {
    delta: 0.45,
  });
});

test("failed contract replacement preserves an in-flight exit on the restored demand", async () => {
  const harness = createHarness();
  await harness.manager.runOnce();
  harness.blockManageQuote();
  harness.subscriptions[0]?.onSnapshot(payload(101) as never);
  await settle();

  harness.advanceNow(1_001);
  harness.setActivePosition({
    ...(position as Record<string, unknown>),
    selectedContract: { providerContractId: CONTRACT_ID_2 },
  });
  harness.throwOnNextSubscribeDemand(new Error("contract unavailable"));
  await harness.manager.runOnce();
  assert.equal(
    harness.activeByOwner.get(positionOwner)?.providerContractIds[0],
    CONTRACT_ID,
  );

  harness.setExitOnManageQuote(true);
  harness.releaseManageQuote();
  await settle();
  await settle();

  assert.equal(harness.activeByOwner.has(positionOwner), false);
});

test("failed contract replacement restores the position matching the prior demand", async () => {
  const harness = createHarness();
  const originalPosition = {
    ...(position as Record<string, unknown>),
    quantity: 2,
    premiumAtRisk: 200,
  };
  harness.setActivePosition(originalPosition);
  await harness.manager.runOnce();

  harness.advanceNow(1_001);
  harness.setActivePosition({
    ...originalPosition,
    quantity: 1,
    premiumAtRisk: 100,
    selectedContract: { providerContractId: CONTRACT_ID_2 },
  });
  harness.throwOnNextSubscribeDemand(new Error("contract unavailable"));
  await harness.manager.runOnce();

  const restored = harness.activeByOwner.get(positionOwner);
  assert.equal(restored?.providerContractIds[0], CONTRACT_ID);
  restored?.onSnapshot(payload(105) as never);
  await settle();

  assert.equal(
    harness.managedPositions.at(-1)?.selectedContract?.providerContractId,
    CONTRACT_ID,
  );
  assert.equal(harness.managedPositions.at(-1)?.quantity, 1);
  assert.equal(harness.managedPositions.at(-1)?.premiumAtRisk, 100);
});

test("reconcile reuses active-position snapshot within the TTL", async () => {
  const harness = createHarness();

  await harness.manager.runOnce();
  await harness.manager.runOnce();

  assert.equal(harness.listActivePositionsCalls, 1);

  harness.advanceNow(1_001);
  await harness.manager.runOnce();

  assert.equal(harness.listActivePositionsCalls, 2);
});

test("default profile resolution uses the deployment config", async () => {
  const config = {
    signalOptions: {
      exitPolicy: {
        hardStopPct: -20,
        trailActivationPct: 20,
        progressiveTrailEnabled: true,
        progressiveTrailSteps: [
          { activationPct: 20, givebackPct: 30, minLockedGainPct: 0 },
        ],
      },
    },
  };
  const configuredDeployment = {
    ...(deployment as unknown as Record<string, unknown>),
    config,
  } as never;
  let managedProfile: ReturnType<
    typeof resolveSignalOptionsExecutionProfile
  > | null = null;
  let publish = (_input: never) => {};
  const manager = createSignalOptionsPositionTickManager({
    listDeployments: async () => [configuredDeployment],
    listActivePositions: async () => ({ positions: [position], events: [] }),
    loadPyrusSignalsSettings: async () => null,
    subscribeDemand: (_input, onSnapshot) => {
      publish = onSnapshot as (input: never) => void;
      return () => {};
    },
    manageQuote: async (input) => {
      managedProfile = input.profile;
      return { managed: true };
    },
  });

  await manager.runOnce();
  publish(payload(100) as never);
  await settle();

  assert.deepEqual(
    managedProfile,
    resolveSignalOptionsExecutionProfile(config),
  );
});

test("position exit invalidates the active-position snapshot", async () => {
  const harness = createHarness();
  harness.setExitOnManageQuote(true);

  await harness.manager.runOnce();
  assert.equal(harness.listActivePositionsCalls, 1);
  assert.equal(harness.subscriptions.length, 1);

  harness.subscriptions[0]?.onSnapshot(payload(105) as never);
  await settle();
  await settle();

  assert.equal(harness.subscriptions[0]?.unsubscribed, true);
  await harness.manager.runOnce();

  assert.equal(harness.listActivePositionsCalls, 2);
  assert.equal(harness.subscriptions.length, 1);
});

test("partial scale-out invalidates the cached active-position snapshot", async () => {
  const harness = createHarness();
  const originalPosition = {
    ...(position as Record<string, unknown>),
    quantity: 2,
    premiumAtRisk: 200,
    peakPrice: 100,
    lastMarkedAt: "2026-07-07T14:31:00.000Z",
  };
  const remainingPosition = {
    ...originalPosition,
    quantity: 1,
    premiumAtRisk: 100,
    lastMarkedAt: "2026-07-07T14:32:00.000Z",
  };
  harness.setActivePosition(originalPosition);
  await harness.manager.runOnce();

  harness.setNextManagedPosition(remainingPosition);
  harness.setScaleOutOnManageQuote(true);
  harness.subscriptions[0]?.onSnapshot(payload(105) as never);
  await settle();
  await settle();

  harness.setActivePosition(remainingPosition);
  harness.setNextManagedPosition(null);
  harness.setScaleOutOnManageQuote(false);
  await harness.manager.runOnce();
  harness.subscriptions[0]?.onSnapshot(payload(106) as never);
  await settle();

  assert.equal(harness.listActivePositionsCalls, 2);
  assert.equal(harness.managedPositions.at(-1)?.quantity, 1);
});

test("an overlapping stale snapshot load cannot restore pre-scale quantity", async () => {
  const harness = createHarness();
  const originalPosition = {
    ...(position as Record<string, unknown>),
    quantity: 2,
    premiumAtRisk: 200,
    peakPrice: 100,
    lastMarkedAt: "2026-07-07T14:31:00.000Z",
  };
  const remainingPosition = {
    ...originalPosition,
    quantity: 1,
    premiumAtRisk: 100,
    lastMarkedAt: "2026-07-07T14:32:00.000Z",
  };
  harness.setActivePosition(originalPosition);
  await harness.manager.runOnce();

  harness.advanceNow(1_001);
  harness.blockListActivePositions(true);
  const reconcile = harness.manager.runOnce();
  await settle();

  harness.setNextManagedPosition(remainingPosition);
  harness.setScaleOutOnManageQuote(true);
  harness.subscriptions[0]?.onSnapshot(payload(105) as never);
  await settle();
  await settle();
  harness.setActivePosition(remainingPosition);
  harness.setNextManagedPosition(null);
  harness.setScaleOutOnManageQuote(false);

  harness.releaseListActivePositionsGate();
  await reconcile;
  harness.subscriptions[0]?.onSnapshot(payload(106) as never);
  await settle();

  assert.equal(harness.managedPositions.at(-1)?.quantity, 1);
  assert.equal(harness.listActivePositionsCalls, 3);
});

test("contract change does not kill the position's demand subscription", async () => {
  const harness = createHarness();

  await harness.manager.runOnce();
  assert.equal(harness.subscriptions.length, 1);
  assert.equal(
    harness.activeByOwner.get(positionOwner)?.providerContractIds[0],
    CONTRACT_ID,
  );

  // Same position, new selected contract — the runtime key changes but the
  // demand owner (deployment+position) does not. Bust the active-position
  // snapshot cache so reconcile actually observes the new contract.
  harness.advanceNow(1_001);
  harness.setActivePosition({
    ...(position as Record<string, unknown>),
    selectedContract: { providerContractId: CONTRACT_ID_2 },
  });
  await harness.manager.runOnce();

  // The end-of-reconcile stale-key sweep must release the OLD (contract-1)
  // runtime without tearing down the just-installed NEW (contract-2)
  // subscription that now owns the coordinator registration.
  const current = harness.activeByOwner.get(positionOwner);
  assert.equal(current?.providerContractIds[0], CONTRACT_ID_2);
  assert.equal(current?.unsubscribed, false);
});

test("contract replacement keeps authoritative structural state while preserving newer risk state", async () => {
  const harness = createHarness();
  const originalPosition = {
    ...(position as Record<string, unknown>),
    quantity: 2,
    premiumAtRisk: 200,
    peakPrice: 100,
    stopPrice: 80,
    lastMarkedAt: "2026-07-07T14:31:00.000Z",
  };
  const newerRiskState = {
    ...originalPosition,
    peakPrice: 110,
    stopPrice: 95,
    lastMarkedAt: "2026-07-07T14:32:00.000Z",
    lastStop: { stopPrice: 95 },
    entryGreeks: { delta: 0.45 },
    greekBaselineSource: "first_mark",
  };
  harness.setActivePosition(originalPosition);
  await harness.manager.runOnce();
  harness.setNextManagedPosition(newerRiskState);
  harness.subscriptions[0]?.onSnapshot(payload(101) as never);
  await settle();

  harness.advanceNow(1_001);
  harness.setActivePosition({
    ...originalPosition,
    quantity: 1,
    premiumAtRisk: 100,
    selectedContract: { providerContractId: CONTRACT_ID_2 },
  });
  harness.setNextManagedPosition(null);
  await harness.manager.runOnce();
  harness.subscriptions[1]?.onSnapshot(payloadFor(CONTRACT_ID_2, 102) as never);
  await settle();

  const nextInput = harness.managedPositions.at(-1);
  assert.equal(nextInput?.selectedContract?.providerContractId, CONTRACT_ID_2);
  assert.equal(nextInput?.quantity, 1);
  assert.equal(nextInput?.premiumAtRisk, 100);
  assert.equal(nextInput?.stopPrice, 95);
  assert.deepEqual(nextInput?.entryGreeks, { delta: 0.45 });
});

test("contract replacement cannot start a second drain for the same position lifecycle", async () => {
  const harness = createHarness();
  await harness.manager.runOnce();

  harness.blockManageQuote();
  harness.subscriptions[0]?.onSnapshot(payload(101) as never);
  await settle();

  harness.advanceNow(1_001);
  harness.setActivePosition({
    ...(position as Record<string, unknown>),
    selectedContract: { providerContractId: CONTRACT_ID_2 },
  });
  await harness.manager.runOnce();
  harness.subscriptions[1]?.onSnapshot(payloadFor(CONTRACT_ID_2, 102) as never);
  await settle();

  assert.deepEqual(
    harness.managedMarks,
    [101],
    "the replacement contract must share the lifecycle's in-flight drain",
  );

  harness.releaseManageQuote();
  await settle();
  await settle();
  assert.deepEqual(harness.managedMarks, [101, 102]);
});

test("contract replacement carries a newer in-flight mark into the replacement", async () => {
  const harness = createHarness();
  const originalPosition = {
    ...(position as Record<string, unknown>),
    peakPrice: 100,
    stopPrice: 80,
    lastMarkedAt: "2026-07-07T14:31:00.000Z",
  };
  harness.setActivePosition(originalPosition);
  await harness.manager.runOnce();

  harness.setNextManagedPosition({
    ...originalPosition,
    peakPrice: 110,
    stopPrice: 95,
    lastMarkedAt: "2026-07-07T14:32:00.000Z",
  });
  harness.blockManageQuote();
  harness.subscriptions[0]?.onSnapshot(payload(101) as never);
  await settle();

  harness.advanceNow(1_001);
  harness.setActivePosition({
    ...originalPosition,
    selectedContract: { providerContractId: CONTRACT_ID_2 },
  });
  await harness.manager.runOnce();
  harness.subscriptions[1]?.onSnapshot(payloadFor(CONTRACT_ID_2, 102) as never);

  harness.releaseManageQuote();
  await settle();
  await settle();

  const replacementInput = harness.managedPositions.at(-1);
  assert.equal(
    replacementInput?.selectedContract?.providerContractId,
    CONTRACT_ID_2,
  );
  assert.equal(replacementInput?.peakPrice, 110);
  assert.equal(replacementInput?.stopPrice, 95);
});

test("contract replacement drops a buffered quote from the prior contract", async () => {
  const harness = createHarness();
  await harness.manager.runOnce();

  harness.blockManageQuote();
  harness.subscriptions[0]?.onSnapshot(payload(101) as never);
  await settle();
  harness.subscriptions[0]?.onSnapshot(payload(102) as never);

  harness.advanceNow(1_001);
  harness.setActivePosition({
    ...(position as Record<string, unknown>),
    selectedContract: { providerContractId: CONTRACT_ID_2 },
  });
  await harness.manager.runOnce();

  harness.releaseManageQuote();
  await settle();
  await settle();
  assert.deepEqual(harness.managedMarks, [101]);

  harness.subscriptions[1]?.onSnapshot(payloadFor(CONTRACT_ID_2, 103) as never);
  await settle();
  assert.deepEqual(harness.managedMarks, [101, 103]);
});

test("remove and re-add cannot start a replacement drain while the old runtime is in flight", async () => {
  const harness = createHarness();
  await harness.manager.runOnce();

  harness.blockManageQuote();
  harness.subscriptions[0]?.onSnapshot(payload(101) as never);
  await settle();

  harness.setDeployments([]);
  await harness.manager.runOnce();
  harness.setDeployments([deployment]);
  await harness.manager.runOnce();
  harness.subscriptions[1]?.onSnapshot(payload(102) as never);
  await settle();

  assert.deepEqual(
    harness.managedMarks,
    [101],
    "a replacement runtime must wait for the lifecycle's old drain",
  );

  harness.releaseManageQuote();
  await settle();
  await settle();
  assert.deepEqual(harness.managedMarks, [101, 102]);
});

test("persisted exit from a removed runtime releases the same-lifecycle replacement", async () => {
  const harness = createHarness();
  await harness.manager.runOnce();

  harness.blockManageQuote();
  harness.subscriptions[0]?.onSnapshot(payload(101) as never);
  await settle();
  harness.setExitOnManageQuote(true);

  harness.setDeployments([]);
  await harness.manager.runOnce();
  harness.setDeployments([deployment]);
  await harness.manager.runOnce();
  harness.subscriptions[1]?.onSnapshot(payload(102) as never);

  harness.releaseManageQuote();
  await settle();
  await settle();

  assert.deepEqual(harness.managedMarks, [101]);
  assert.equal(harness.activeByOwner.has(positionOwner), false);
});

test("persisted scale-out from a removed runtime updates the same-lifecycle replacement", async () => {
  const harness = createHarness();
  const originalPosition = {
    ...(position as Record<string, unknown>),
    quantity: 2,
    premiumAtRisk: 200,
    peakPrice: 100,
    stopPrice: 80,
    lastMarkedAt: "2026-07-07T14:31:00.000Z",
  };
  const remainingPosition = {
    ...originalPosition,
    quantity: 1,
    premiumAtRisk: 100,
    stopPrice: 90,
    lastMarkedAt: "2026-07-07T14:32:00.000Z",
  };
  harness.setActivePosition(originalPosition);
  await harness.manager.runOnce();

  harness.setNextManagedPosition(remainingPosition);
  harness.setScaleOutOnManageQuote(true);
  harness.blockManageQuote();
  harness.subscriptions[0]?.onSnapshot(payload(101) as never);
  await settle();

  harness.setDeployments([]);
  await harness.manager.runOnce();
  harness.setDeployments([deployment]);
  await harness.manager.runOnce();
  harness.subscriptions[1]?.onSnapshot(payload(102) as never);

  harness.releaseManageQuote();
  await settle();
  await settle();

  assert.deepEqual(harness.managedMarks, [101, 102]);
  assert.equal(harness.managedPositions.at(-1)?.quantity, 1);
  assert.equal(harness.managedPositions.at(-1)?.premiumAtRisk, 100);
  assert.equal(harness.managedPositions.at(-1)?.stopPrice, 90);
});

test("stale scale-out transfer cannot increase an already-reduced position", async () => {
  const harness = createHarness();
  const originalPosition = {
    ...(position as Record<string, unknown>),
    quantity: 3,
    premiumAtRisk: 300,
    peakPrice: 100,
    stopPrice: 80,
    lastMarkedAt: "2026-07-07T14:31:00.000Z",
  };
  harness.setActivePosition(originalPosition);
  await harness.manager.runOnce();

  harness.setNextManagedPosition({
    ...originalPosition,
    quantity: 2,
    premiumAtRisk: 200,
    stopPrice: 85,
    lastMarkedAt: "2026-07-07T14:32:00.000Z",
  });
  harness.setScaleOutOnManageQuote(true);
  harness.blockManageQuote();
  harness.subscriptions[0]?.onSnapshot(payload(101) as never);
  await settle();

  harness.advanceNow(1_001);
  harness.setActivePosition({
    ...originalPosition,
    quantity: 1,
    premiumAtRisk: 100,
    stopPrice: 90,
    lastMarkedAt: "2026-07-07T14:33:00.000Z",
  });
  await harness.manager.runOnce();

  harness.releaseManageQuote();
  await settle();
  harness.setNextManagedPosition(null);
  harness.setScaleOutOnManageQuote(false);
  harness.subscriptions[0]?.onSnapshot(payload(102) as never);
  await settle();

  assert.equal(harness.managedPositions.at(-1)?.quantity, 1);
  assert.equal(harness.managedPositions.at(-1)?.premiumAtRisk, 100);
  assert.equal(harness.managedPositions.at(-1)?.stopPrice, 90);
});

test("stop() during reconcile prevents subscriptions from installing after teardown", async () => {
  const harness = createHarness();
  harness.blockListActivePositions();

  const pending = harness.manager.runOnce();
  await settle();
  harness.manager.stop();
  harness.releaseListActivePositionsGate();
  await pending;

  assert.equal(harness.subscriptions.length, 0);
});

test("stop then immediate start discards the pre-stop reconcile and runs a fresh snapshot", async () => {
  const harness = createHarness();
  harness.blockListActivePositions(true);

  const staleReconcile = harness.manager.runOnce();
  await settle();
  harness.manager.stop();
  harness.setActivePositions([]);
  harness.manager.start();
  harness.releaseListActivePositionsGate();
  await staleReconcile;
  await settle();
  await settle();

  assert.equal(harness.listActivePositionsCalls, 2);
  assert.equal(harness.subscriptions.length, 0);
  harness.manager.stop();
});

test("reconcile merge keeps the higher in-memory peakPrice over a stale snapshot", async () => {
  const harness = createHarness();
  const basePosition = {
    ...(position as Record<string, unknown>),
    peakPrice: 100,
    lastMarkedAt: "2026-01-01T00:00:00.000Z",
  };
  harness.setActivePosition(basePosition);

  await harness.manager.runOnce();

  // A live tick raises peakPrice via manageQuote's returned position update.
  harness.setNextManagedPosition({
    ...basePosition,
    peakPrice: 150,
    lastMarkedAt: "2026-01-01T00:00:05.000Z",
  });
  harness.subscriptions[0]?.onSnapshot(payload(110) as never);
  await settle();

  // Next reconcile loads a DB snapshot that hasn't caught up to that tick
  // yet (still shows the lower peakPrice).
  harness.advanceNow(1_001);
  harness.setActivePosition({
    ...basePosition,
    peakPrice: 90,
    lastMarkedAt: "2026-01-01T00:00:01.000Z",
  });
  await harness.manager.runOnce();

  harness.subscriptions[0]?.onSnapshot(payload(111) as never);
  await settle();

  const lastManagedPosition =
    harness.managedPositions[harness.managedPositions.length - 1];
  assert.equal(lastManagedPosition?.peakPrice, 150);
});

test("cached reconcile cannot roll back newer stop and Greek state", async () => {
  const harness = createHarness();
  const cachedPosition = {
    ...(position as Record<string, unknown>),
    peakPrice: 100,
    stopPrice: 80,
    lastMarkedAt: "2026-07-07T14:31:00.000Z",
    lastStop: { stopPrice: 80 },
    lastWireTrail: { selectedRung: "wire1" },
    entryGreeks: null,
    greekBaselineSource: null,
  };
  const managedPosition = {
    ...cachedPosition,
    peakPrice: 110,
    stopPrice: 95,
    lastMarkedAt: "2026-07-07T14:32:00.000Z",
    lastStop: { stopPrice: 95 },
    lastWireTrail: { selectedRung: "wire2" },
    entryGreeks: { delta: 0.45 },
    greekBaselineSource: "first_mark",
  };
  harness.setActivePosition(cachedPosition);
  await harness.manager.runOnce();

  harness.setNextManagedPosition(managedPosition);
  harness.subscriptions[0]?.onSnapshot(payload(110) as never);
  await settle();

  harness.setNextManagedPosition(null);
  await harness.manager.runOnce();
  harness.subscriptions[0]?.onSnapshot(payload(111) as never);
  await settle();

  const nextInput = harness.managedPositions.at(-1);
  assert.equal(nextInput?.stopPrice, 95);
  assert.deepEqual(nextInput?.lastStop, { stopPrice: 95 });
  assert.deepEqual(nextInput?.lastWireTrail, { selectedRung: "wire2" });
  assert.deepEqual(nextInput?.entryGreeks, { delta: 0.45 });
  assert.equal(nextInput?.greekBaselineSource, "first_mark");
});

test("newer same-contract snapshot cannot be overwritten by an older in-flight result", async () => {
  const harness = createHarness();
  const originalPosition = {
    ...(position as Record<string, unknown>),
    quantity: 2,
    premiumAtRisk: 200,
    peakPrice: 100,
    stopPrice: 80,
    lastMarkedAt: "2026-07-07T14:31:00.000Z",
  };
  harness.setActivePosition(originalPosition);
  await harness.manager.runOnce();

  harness.setNextManagedPosition({
    ...originalPosition,
    stopPrice: 85,
    lastMarkedAt: "2026-07-07T14:32:00.000Z",
  });
  harness.blockManageQuote();
  harness.subscriptions[0]?.onSnapshot(payload(101) as never);
  await settle();

  harness.advanceNow(1_001);
  harness.setActivePosition({
    ...originalPosition,
    quantity: 1,
    premiumAtRisk: 100,
    stopPrice: 90,
    lastMarkedAt: "2026-07-07T14:33:00.000Z",
  });
  await harness.manager.runOnce();

  harness.releaseManageQuote();
  await settle();
  harness.setNextManagedPosition(null);
  harness.subscriptions[0]?.onSnapshot(payload(102) as never);
  await settle();

  const nextInput = harness.managedPositions.at(-1);
  assert.equal(nextInput?.quantity, 1);
  assert.equal(nextInput?.premiumAtRisk, 100);
  assert.equal(nextInput?.stopPrice, 90);
});

test("cleared opposite-signal confirmation cannot be restored by an in-flight mark", async () => {
  const harness = createHarness();
  const pendingConfirmation = {
    signalKey: "signal-opposite-1",
    signalAt: "2026-07-07T14:32:00.000Z",
    direction: "sell",
  };
  const originalPosition = {
    ...(position as Record<string, unknown>),
    quantity: 1,
    premiumAtRisk: 100,
    peakPrice: 100,
    stopPrice: 80,
    lastMarkedAt: "2026-07-07T14:31:00.000Z",
    oppositeSignalPendingConfirm: pendingConfirmation,
  };
  harness.setActivePosition(originalPosition);
  await harness.manager.runOnce();

  harness.setNextManagedPosition({
    ...originalPosition,
    peakPrice: 101,
  });
  harness.blockManageQuote();
  harness.subscriptions[0]?.onSnapshot(payload(101) as never);
  await settle();

  harness.advanceNow(1_001);
  harness.setActivePosition({
    ...originalPosition,
    oppositeSignalPendingConfirm: null,
  });
  await harness.manager.runOnce();

  harness.releaseManageQuote();
  await settle();
  harness.setNextManagedPosition(null);
  harness.subscriptions[0]?.onSnapshot(payload(102) as never);
  await settle();

  assert.equal(
    harness.managedPositions.at(-1)?.oppositeSignalPendingConfirm,
    null,
  );
});

test("same-id re-entry gets a new runtime and cannot inherit prior lifecycle marks", async () => {
  const harness = createHarness();
  const firstLifecycle = {
    ...(position as Record<string, unknown>),
    peakPrice: 100,
    lastMarkedAt: "2026-07-07T14:31:00.000Z",
  };
  harness.setActivePosition(firstLifecycle);
  await harness.manager.runOnce();

  harness.setNextManagedPosition({
    ...firstLifecycle,
    peakPrice: 150,
    lastMarkedAt: "2026-07-07T14:32:00.000Z",
  });
  harness.subscriptions[0]?.onSnapshot(payload(110) as never);
  await settle();

  const secondLifecycle = {
    ...firstLifecycle,
    openedAt: "2026-07-07T15:00:00.000Z",
    peakPrice: 90,
    lastMarkedAt: "2026-07-07T15:01:00.000Z",
  };
  harness.advanceNow(1_001);
  harness.setActivePosition(secondLifecycle);
  await harness.manager.runOnce();

  assert.equal(harness.subscriptions.length, 2);
  assert.notEqual(
    harness.subscriptions[0]?.owner,
    harness.subscriptions[1]?.owner,
  );
  assert.equal(harness.subscriptions[0]?.unsubscribed, true);
  harness.subscriptions[1]?.onSnapshot(payload(111) as never);
  await settle();

  const lastManagedPosition =
    harness.managedPositions[harness.managedPositions.length - 1];
  assert.equal(lastManagedPosition?.peakPrice, 90);
});

test("transient deployment failure retains demand until a successful empty snapshot", async () => {
  const harness = createHarness();

  await harness.manager.runOnce();
  assert.equal(harness.subscriptions.length, 1);
  assert.equal(harness.subscriptions[0]?.unsubscribed, false);

  harness.throwOnNextResolveProfile(new Error("boom"));
  await harness.manager.runOnce();

  assert.equal(harness.subscriptions[0]?.unsubscribed, false);

  harness.advanceNow(1_001);
  harness.setActivePositions([]);
  await harness.manager.runOnce();

  assert.equal(harness.subscriptions[0]?.unsubscribed, true);
});

test("removed deployment cache cannot resurrect stale positions on re-enable", async () => {
  const harness = createHarness();
  await harness.manager.runOnce();
  assert.equal(harness.listActivePositionsCalls, 1);

  harness.setDeployments([]);
  await harness.manager.runOnce();
  assert.equal(harness.activeByOwner.has(positionOwner), false);

  harness.setActivePositions([]);
  harness.setDeployments([deployment]);
  await harness.manager.runOnce();

  assert.equal(harness.listActivePositionsCalls, 2);
  assert.equal(harness.activeByOwner.has(positionOwner), false);
});
