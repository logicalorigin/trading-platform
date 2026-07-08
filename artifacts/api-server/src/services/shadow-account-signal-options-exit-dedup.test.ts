import assert from "node:assert/strict";
import test from "node:test";

import { __shadowWatchlistBacktestInternalsForTests as internals } from "./shadow-account";

const { signalOptionsShadowExitEventIsDuplicate } = internals;

const openedAt = new Date("2026-06-12T14:30:00.000Z");
const candidate = {
  deploymentId: "deployment-1",
  symbol: "CRM",
  since: openedAt,
};

test("Signal Options shadow exit dedup: suppresses a duplicate when a matching exit event exists since openedAt", () => {
  const isDuplicate = signalOptionsShadowExitEventIsDuplicate(candidate, [
    {
      deploymentId: "deployment-1",
      symbol: "CRM",
      occurredAt: new Date("2026-06-12T17:00:00.000Z"),
      payload: {},
    },
  ]);

  assert.equal(isDuplicate, true);
});

test("Signal Options shadow exit dedup: allows the exit when no matching event exists", () => {
  const isDuplicate = signalOptionsShadowExitEventIsDuplicate(candidate, []);

  assert.equal(isDuplicate, false);
});

test("Signal Options shadow exit dedup: does not suppress a different symbol on the same deployment", () => {
  const isDuplicate = signalOptionsShadowExitEventIsDuplicate(candidate, [
    {
      deploymentId: "deployment-1",
      symbol: "MSFT",
      occurredAt: new Date("2026-06-12T17:00:00.000Z"),
      payload: {},
    },
  ]);

  assert.equal(isDuplicate, false);
});

test("Signal Options shadow exit dedup: does not suppress a matching symbol on a different deployment", () => {
  const isDuplicate = signalOptionsShadowExitEventIsDuplicate(candidate, [
    {
      deploymentId: "deployment-2",
      symbol: "CRM",
      occurredAt: new Date("2026-06-12T17:00:00.000Z"),
      payload: {},
    },
  ]);

  assert.equal(isDuplicate, false);
});

test("Signal Options shadow exit dedup: does not suppress an exit event from a prior entry->exit cycle (before openedAt)", () => {
  const isDuplicate = signalOptionsShadowExitEventIsDuplicate(candidate, [
    {
      deploymentId: "deployment-1",
      symbol: "CRM",
      occurredAt: new Date("2026-06-10T12:00:00.000Z"),
      payload: {},
    },
  ]);

  assert.equal(isDuplicate, false);
});

test("Signal Options shadow exit dedup: symbol matching is case-insensitive", () => {
  const isDuplicate = signalOptionsShadowExitEventIsDuplicate(candidate, [
    {
      deploymentId: "deployment-1",
      symbol: "crm",
      occurredAt: new Date("2026-06-12T17:00:00.000Z"),
      payload: {},
    },
  ]);

  assert.equal(isDuplicate, true);
});

test("Signal Options shadow exit dedup: partial scale-outs do not suppress the later final exit", () => {
  const isDuplicate = signalOptionsShadowExitEventIsDuplicate(candidate, [
    {
      deploymentId: "deployment-1",
      symbol: "CRM",
      occurredAt: new Date("2026-06-12T17:00:00.000Z"),
      payload: { partial: true, scaleOutId: "first_trail_arm" },
    },
  ]);

  assert.equal(isDuplicate, false);
});
