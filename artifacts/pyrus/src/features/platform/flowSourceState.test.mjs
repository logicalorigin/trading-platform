import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAggregateFlowResponse,
  flowFailureLooksVisible,
  isVisibleFlowDegradationSource,
  mergeFlowEventsSnapshot,
  resolveFlowSourceScannedAt,
} from "./flowSourceState.js";

test("Flow response freshness follows the provider fetch time", () => {
  const receivedAt = Date.parse("2026-07-22T15:00:00.000Z");
  const fetchedAt = receivedAt - 5 * 60_000;

  assert.equal(
    resolveFlowSourceScannedAt(
      { fetchedAt: new Date(fetchedAt).toISOString() },
      receivedAt,
    ),
    fetchedAt,
  );
  assert.equal(resolveFlowSourceScannedAt({}, receivedAt), receivedAt);
  assert.equal(
    resolveFlowSourceScannedAt(
      { fetchedAt: new Date(receivedAt + 60_000).toISOString() },
      receivedAt,
    ),
    receivedAt,
  );
});

test("retained Flow events keep their original freshness timestamp", () => {
  const existing = {
    events: [{ id: "cached-flow" }],
    scannedAt: 1_721_430_000_000,
    source: { provider: "massive", status: "live" },
    staleFlowEvents: false,
  };
  const next = {
    events: [],
    scannedAt: 1_721_430_300_000,
    source: {
      provider: "massive",
      status: "empty",
      ibkrReason: "options_flow_refreshing",
    },
  };

  const merged = mergeFlowEventsSnapshot(existing, next);

  assert.deepEqual(merged.events, existing.events);
  assert.equal(merged.scannedAt, existing.scannedAt);
  assert.equal(merged.source, next.source);
  assert.equal(merged.staleFlowEvents, true);
});

test("future-dated Flow degradation does not remain visibly fresh", () => {
  const nowMs = Date.parse("2026-06-11T18:00:00.000Z");
  const source = {
    status: "error",
    updatedAt: nowMs + 60_000,
  };

  assert.equal(isVisibleFlowDegradationSource(source, { nowMs }), false);
});

test("broad Flow request failures remain visible without discarding the last good tape", () => {
  const cachedEvent = { id: "flow-cached" };
  const response = buildAggregateFlowResponse({
    snapshot: {
      events: [cachedEvent],
      source: { provider: "massive", status: "loaded" },
      scannedAt: 1_721_430_000_000,
    },
    error: new Error("Massive aggregate flow timed out"),
  });

  assert.deepEqual(response.events, [cachedEvent]);
  assert.equal(response.source.provider, "massive");
  assert.equal(response.scannedAt, 1_721_430_000_000);
  assert.equal(response.error, "Massive aggregate flow timed out");
});

test("a current broad Flow error does not inherit stale tape freshness", () => {
  const nowMs = Date.parse("2026-07-21T15:00:00.000Z");
  const response = buildAggregateFlowResponse({
    snapshot: {
      events: [{ id: "old-flow" }],
      scannedAt: nowMs - 10 * 60_000,
    },
    error: new Error("Current aggregate outage"),
    errorAt: nowMs,
  });

  assert.equal(response.errorAt, nowMs);
  assert.equal(flowFailureLooksVisible(response, { nowMs }), true);
});

test("broad Flow request failures surface even before the first snapshot", () => {
  const response = buildAggregateFlowResponse({
    snapshot: null,
    error: { message: "Flow provider unavailable" },
  });

  assert.deepEqual(response.events, []);
  assert.equal(response.source, null);
  assert.equal(response.scannedAt, null);
  assert.equal(response.error, "Flow provider unavailable");
});

test("an absent broad Flow request does not synthesize a response", () => {
  assert.equal(
    buildAggregateFlowResponse({ snapshot: null, error: null }),
    null,
  );
});

test("preserved stale tape stays marked stale through the aggregate response", () => {
  const preserved = mergeFlowEventsSnapshot(
    {
      events: [{ id: "cached-flow" }],
      scannedAt: 1_721_430_000_000,
      source: { provider: "massive", status: "live" },
    },
    { events: [], source: { provider: "massive", status: "empty" } },
  );

  const response = buildAggregateFlowResponse({ snapshot: preserved });

  assert.equal(response.staleFlowEvents, true);
});

test("fresh aggregate tape is not marked stale", () => {
  const response = buildAggregateFlowResponse({
    snapshot: {
      events: [{ id: "fresh-flow" }],
      scannedAt: 1_721_430_000_000,
      source: { provider: "massive", status: "loaded" },
    },
  });

  assert.equal(response.staleFlowEvents, false);
});
