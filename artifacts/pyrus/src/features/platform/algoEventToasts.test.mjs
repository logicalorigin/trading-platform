import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  ALGO_EVENT_NOTIFICATION_POLL_MS,
  buildAlgoEventToast,
  persistAlgoEventToastSeenIds,
  readAlgoEventToastSeenIds,
  resolveAlgoEventFeedPolicy,
} from "./algoEventToasts.js";

const platformAppSource = readFileSync(
  new URL("./PlatformApp.jsx", import.meta.url),
  "utf8",
);
const platformShellSource = readFileSync(
  new URL("./PlatformShell.jsx", import.meta.url),
  "utf8",
);

test("suppresses skipped candidate toasts for mtf_not_aligned reasons", () => {
  const toast = buildAlgoEventToast({
    id: "evt-aibu-1",
    symbol: "AIBU",
    eventType: "signal_options_candidate_skipped",
    summary: "AIBU shadow candidate skipped: mtf_not_aligned",
    payload: {
      reason: "mtf_not_aligned",
      entryGate: {
        reason: "mtf_not_aligned",
        reasons: ["mtf_not_aligned"],
      },
    },
  });

  assert.equal(toast, null);
});

test("suppresses blocked toasts when only the summary says MTF not aligned", () => {
  const toast = buildAlgoEventToast({
    id: "evt-btcw-1",
    symbol: "BTCW",
    eventType: "signal_options_gateway_blocked",
    summary: "MTF not aligned: needs 3 of 3 selected frames",
    payload: {
      reason: "entry_gate_failed",
    },
  });

  assert.equal(toast, null);
});

test("retired generic gateway diagnostics cannot replay as trade toasts", () => {
  const toast = buildAlgoEventToast({
    id: "evt-retired-gateway",
    eventType: "signal_options_gateway_blocked",
    summary:
      "Signal-options scan blocked: IBKR Client Portal is not configured for live broker order execution.",
    payload: {
      reason: "ibkr_not_configured",
      count: 37,
    },
  });

  assert.equal(toast, null);
});

test("suppresses position-mark retry rows that are not candidate activity", () => {
  for (const reason of [
    "position_mark_unavailable",
    "position_mark_failed",
    "position_mark_timeout",
    "position_mark_feed_degraded",
    "invalid_position_mark",
  ]) {
    const toast = buildAlgoEventToast({
      id: `evt-${reason}`,
      symbol: "CHTR",
      eventType: "signal_options_candidate_skipped",
      summary: "CHTR shadow mark skipped: option quote stale",
      payload: { reason },
    });

    assert.equal(toast, null, reason);
  }
});

test("keeps non-MTF skipped candidate toasts visible", () => {
  const toast = buildAlgoEventToast({
    id: "evt-spread-1",
    symbol: "AIBU",
    eventType: "signal_options_candidate_skipped",
    summary: "AIBU shadow candidate skipped: spread_too_wide",
    payload: {
      reason: "spread_too_wide",
    },
  });

  assert.deepEqual(toast, {
    kind: "info",
    title: "AIBU · Candidate Skipped",
    body: "AIBU shadow candidate skipped: spread_too_wide",
    duration: 4000,
  });
});

test("notification ingestion stays enabled when every algo activity surface is closed", () => {
  assert.deepEqual(
    resolveAlgoEventFeedPolicy({
      notificationsEnabled: true,
      surfaceDataEnabled: false,
      streamFresh: false,
    }),
    {
      queryEnabled: true,
      refetchInterval: ALGO_EVENT_NOTIFICATION_POLL_MS,
    },
  );
});

test("a deployment-scoped activity stream cannot suppress the all-deployment notification poll", () => {
  assert.deepEqual(
    resolveAlgoEventFeedPolicy({
      notificationsEnabled: true,
      surfaceDataEnabled: true,
      streamFresh: true,
    }),
    {
      queryEnabled: true,
      refetchInterval: ALGO_EVENT_NOTIFICATION_POLL_MS,
    },
  );
});

test("shown algo event ids survive reload without crossing user or environment scopes", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const scope = {
    storage,
    userId: "user-a",
    environment: "shadow",
  };

  persistAlgoEventToastSeenIds({
    ...scope,
    seenIds: new Set(["evt-1", "evt-2"]),
  });

  assert.deepEqual(
    Array.from(readAlgoEventToastSeenIds(scope)),
    ["evt-1", "evt-2"],
  );
  assert.deepEqual(
    Array.from(
      readAlgoEventToastSeenIds({
        ...scope,
        userId: "user-b",
      }),
    ),
    [],
  );
  assert.deepEqual(
    Array.from(
      readAlgoEventToastSeenIds({
        ...scope,
        environment: "live",
      }),
    ),
    [],
  );
});

test("an open tab cannot erase event ids persisted by another tab", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const scope = {
    storage,
    userId: "user-a",
    environment: "shadow",
  };

  persistAlgoEventToastSeenIds({
    ...scope,
    seenIds: new Set(["evt-from-tab-a"]),
  });
  persistAlgoEventToastSeenIds({
    ...scope,
    seenIds: new Set(["evt-from-stale-tab-b"]),
  });

  assert.deepEqual(
    Array.from(readAlgoEventToastSeenIds(scope)),
    ["evt-from-tab-a", "evt-from-stale-tab-b"],
  );
});

test("trading activity notification wiring never depends on route or viewport visibility", () => {
  assert.match(
    platformAppSource,
    /const tradingActivityNotificationsEnabled = Boolean\(\s*platformRealtimeWorkActive &&\s*sessionMetadataSettled &&\s*firstScreenReady,?\s*\);/s,
  );
  assert.match(
    platformShellSource,
    /resolveAlgoEventFeedPolicy\(\{\s*notificationsEnabled:\s*tradingActivityNotificationsEnabled && !criticalApiMutationPaused,\s*surfaceDataEnabled:\s*algoFrameRuntimeEnabled,\s*streamFresh:\s*false,\s*\}\)/s,
  );
  assert.doesNotMatch(platformShellSource, /onLiveEvents:\s*handleAlgoLiveEvents/);
  assert.match(
    platformShellSource,
    /handleAlgoLiveEvents\(algoEventsQuery\.data\?\.events\)/,
    "the notification-gated all-deployment REST feed must remain authoritative",
  );
  assert.match(
    platformAppSource,
    /notificationUserId=\{authSession\.user\?\.id \|\| null\}/,
  );
  assert.match(
    platformShellSource,
    /if \(!Array\.isArray\(events\)\) \{\s*return;\s*\}/,
    "an unresolved REST query must not count as the initial event baseline",
  );
  assert.match(platformShellSource, /readAlgoEventToastSeenIds\(/);
  assert.match(platformShellSource, /persistAlgoEventToastSeenIds\(/);
});
