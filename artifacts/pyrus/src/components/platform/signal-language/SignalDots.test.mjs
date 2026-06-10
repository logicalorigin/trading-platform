import assert from "node:assert/strict";
import test from "node:test";

import { resolveSignalDotHydrationMeta } from "./SignalDots.jsx";

test("signal dots mark aged display signals for the amber attention ring", () => {
  const meta = resolveSignalDotHydrationMeta({
    status: "ok",
    currentSignalDirection: "buy",
    currentSignalAt: "2026-06-09T18:10:00.000Z",
    latestBarAt: "2026-06-09T18:15:00.000Z",
    fresh: false,
  });

  assert.equal(meta.hydrationState, "stale");
  assert.equal(meta.stale, true);
  assert.equal(meta.unhydrated, false);
  assert.equal(meta.attention, true);
});

test("signal dots mark pending, missing, and telemetry-free cells as unhydrated", () => {
  assert.equal(resolveSignalDotHydrationMeta(null).hydrationState, "unhydrated");
  assert.equal(
    resolveSignalDotHydrationMeta({ status: "pending", latestBarAt: "2026-06-09T18:15:00.000Z" })
      .hydrationState,
    "unhydrated",
  );
  assert.equal(
    resolveSignalDotHydrationMeta({ status: "ok", currentSignalDirection: "sell" })
      .hydrationState,
    "unhydrated",
  );
});

test("signal dots leave hydrated no-signal cells unmarked", () => {
  const meta = resolveSignalDotHydrationMeta({
    status: "ok",
    latestBarAt: "2026-06-09T18:15:00.000Z",
    fresh: false,
  });

  assert.equal(meta.hydrationState, "hydrated");
  assert.equal(meta.attention, false);
});
