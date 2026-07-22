import assert from "node:assert/strict";
import test from "node:test";

import { signalOptionsLifecycleEventId } from "./shadow-account";

test("live entry intents have one durable identity per deployment signal", () => {
  const input = {
    deploymentId: "00000000-0000-4000-8000-000000000001",
    eventType: "signal_options_live_entry_intent",
    payload: { liveIntentKey: "AAPL|buy|2026-07-22T14:35:00.000Z" },
  };
  const first = signalOptionsLifecycleEventId(input);
  const retry = signalOptionsLifecycleEventId({
    ...input,
    payload: { ...input.payload, quote: { bid: 2.4, ask: 2.6 } },
  });

  assert.ok(first);
  assert.equal(retry, first);
  assert.notEqual(
    signalOptionsLifecycleEventId({
      ...input,
      payload: { liveIntentKey: "AAPL|buy|2026-07-22T14:40:00.000Z" },
    }),
    first,
  );
});

test("submitted live entries have one terminal identity per deployment signal", () => {
  const input = {
    deploymentId: "00000000-0000-4000-8000-000000000001",
    eventType: "signal_options_live_entry",
    payload: { signalKey: "AAPL|buy|2026-07-22T14:35:00.000Z" },
  };
  const first = signalOptionsLifecycleEventId(input);
  assert.ok(first);
  assert.equal(
    signalOptionsLifecycleEventId({
      ...input,
      payload: { ...input.payload, submittedTargets: 2 },
    }),
    first,
  );
});

test("live entry intents without a signal identity fail closed", () => {
  assert.throws(() =>
    signalOptionsLifecycleEventId({
      deploymentId: "00000000-0000-4000-8000-000000000001",
      eventType: "signal_options_live_entry_intent",
      payload: {},
    }),
  );
});
