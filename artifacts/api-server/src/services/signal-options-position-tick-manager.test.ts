import assert from "node:assert/strict";
import test from "node:test";

import { createSignalOptionsPositionTickManager } from "./signal-options-position-tick-manager";

const CONTRACT_ID = "OPT-C1";
const CONTRACT_ID_2 = "OPT-C2";

const deployment = { id: "deployment-1", mode: "shadow" } as never;

const position = {
  id: "position-1",
  symbol: "TSM",
  selectedContract: { providerContractId: CONTRACT_ID },
} as never;

const positionOwner = `signal-options-position-mark:${(deployment as { id: string }).id}:${(position as { id: string }).id}:tick`;

const profileWithGreeks = (enabled: boolean) =>
  ({
    exitPolicy: { wireGreekTrail: { enabled } },
  }) as never;

const quote = (mark: number) =>
  ({ providerContractId: CONTRACT_ID, mark }) as never;

const payload = (mark: number) => ({ quotes: [quote(mark)] }) as never;

function createHarness() {
  type FakeDemand = {
    owner: string;
    providerContractIds: string[];
    requiresGreeks: boolean;
    onSnapshot: (input: never) => void;
    unsubscribed: boolean;
  };
  const subscriptions: FakeDemand[] = [];
  // Mirrors option-quote-demand-coordinator's activeDemands: exactly one live
  // registration per owner, keyed only by owner (not by contract). This is
  // what makes the owner-based release bug reproducible in a test.
  const activeByOwner = new Map<string, FakeDemand>();
  const managedMarks: number[] = [];
  const managedPositions: Array<{ peakPrice?: number }> = [];
  let greeksEnabled = false;
  let releaseManageQuote = () => {};
  let manageQuoteGate: Promise<void> | null = null;
  let nowMs = 0;
  let activePositions = [position];
  let listActivePositionsCalls = 0;
  let exitOnManageQuote = false;
  let managedPositionOverride: unknown = null;
  let releaseListActivePositions = () => {};
  let listActivePositionsGate: Promise<void> | null = null;
  let resolveProfileError: Error | null = null;

  const manager = createSignalOptionsPositionTickManager({
    listDeployments: async () => [deployment],
    listActivePositions: async () => {
      listActivePositionsCalls += 1;
      if (listActivePositionsGate) {
        await listActivePositionsGate;
      }
      return { positions: activePositions, events: [] };
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
    setActivePosition(nextPosition: unknown) {
      activePositions = [nextPosition as never];
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
    blockListActivePositions() {
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

test("reconcile reuses active-position snapshot within the TTL", async () => {
  const harness = createHarness();

  await harness.manager.runOnce();
  await harness.manager.runOnce();

  assert.equal(harness.listActivePositionsCalls, 1);

  harness.advanceNow(1_001);
  await harness.manager.runOnce();

  assert.equal(harness.listActivePositionsCalls, 2);
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

test("a throwing deployment does not block the stale-key sweep", async () => {
  const harness = createHarness();

  await harness.manager.runOnce();
  assert.equal(harness.subscriptions.length, 1);
  assert.equal(harness.subscriptions[0]?.unsubscribed, false);

  // Profile resolution throws before any position is even looked at, so no
  // key gets marked desired this cycle — the previously-installed runtime
  // becomes stale.
  harness.throwOnNextResolveProfile(new Error("boom"));
  await harness.manager.runOnce();

  // Even though this deployment's processing threw before any key could be
  // marked desired, the end-of-reconcile sweep must still run and release
  // the now-stale subscription instead of leaking it.
  assert.equal(harness.subscriptions[0]?.unsubscribed, true);
});
