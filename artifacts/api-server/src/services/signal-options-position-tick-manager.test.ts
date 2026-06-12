import assert from "node:assert/strict";
import test from "node:test";

import { createSignalOptionsPositionTickManager } from "./signal-options-position-tick-manager";

const CONTRACT_ID = "OPT-C1";

const deployment = { id: "deployment-1", mode: "paper" } as never;

const position = {
  id: "position-1",
  symbol: "TSM",
  selectedContract: { providerContractId: CONTRACT_ID },
} as never;

const profileWithGreeks = (enabled: boolean) =>
  ({
    exitPolicy: { wireGreekTrail: { enabled } },
  }) as never;

const quote = (mark: number) =>
  ({ providerContractId: CONTRACT_ID, mark }) as never;

const payload = (mark: number) => ({ quotes: [quote(mark)] }) as never;

function createHarness() {
  const subscriptions: Array<{
    requiresGreeks: boolean;
    onSnapshot: (input: never) => void;
    unsubscribed: boolean;
  }> = [];
  const managedMarks: number[] = [];
  let greeksEnabled = false;
  let releaseManageQuote = () => {};
  let manageQuoteGate: Promise<void> | null = null;

  const manager = createSignalOptionsPositionTickManager({
    listDeployments: async () => [deployment],
    listActivePositions: async () => ({ positions: [position], events: [] }),
    resolveProfile: () => profileWithGreeks(greeksEnabled),
    loadPyrusSignalsSettings: async () => null,
    subscribeDemand: (input, onSnapshot) => {
      const entry = {
        requiresGreeks: input.requiresGreeks === true,
        onSnapshot: onSnapshot as (input: never) => void,
        unsubscribed: false,
      };
      subscriptions.push(entry);
      return () => {
        entry.unsubscribed = true;
      };
    },
    manageQuote: async (input) => {
      managedMarks.push(Number((input.quote as { mark?: number }).mark));
      if (manageQuoteGate) {
        await manageQuoteGate;
      }
      return { managed: true, position: null, exited: false } as never;
    },
  });

  return {
    manager,
    subscriptions,
    managedMarks,
    setGreeks(enabled: boolean) {
      greeksEnabled = enabled;
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
