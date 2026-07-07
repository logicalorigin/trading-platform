import assert from "node:assert/strict";
import test from "node:test";

import {
  __signalOptionsAutomationInternalsForTests,
  SIGNAL_OPTIONS_SKIPPED_EVENT,
  type SignalOptionsPosition,
} from "./signal-options-automation";

const {
  SIGNAL_OPTIONS_SEEN_SIGNAL_SKIP_REASON_VALUES,
  extractSignalOptionsSeenSignalRow,
  isRetryableSignalOptionsSkip,
  isRetryableSignalOptionsSkipFromRow,
  isSignalOptionsSeenSignalStoreCandidate,
} = __signalOptionsAutomationInternalsForTests;

function skippedEvent(input: {
  reason: string;
  payload?: Record<string, unknown>;
}) {
  return {
    id: `00000000-0000-4000-8000-${input.reason.length
      .toString()
      .padStart(12, "0")}`,
    deploymentId: "11111111-1111-4111-8111-111111111111",
    algoRunId: null,
    providerAccountId: "shadow",
    symbol: "SPY",
    eventType: SIGNAL_OPTIONS_SKIPPED_EVENT,
    summary: "skip",
    occurredAt: new Date("2026-07-07T12:00:00.000Z"),
    createdAt: new Date("2026-07-07T12:00:00.000Z"),
    updatedAt: new Date("2026-07-07T12:00:00.000Z"),
    payload: {
      signalKey: `sig:${input.reason}`,
      reason: input.reason,
      candidate: {
        symbol: "SPY",
        direction: "buy",
      },
      selectedContract: {
        providerContractId: "base-contract",
      },
      ...(input.payload ?? {}),
    },
  };
}

test("seen-signal golden: column-backed retryability matches JSONB retryability over the reason corpus", () => {
  const scenarios = [
    {
      name: "base",
      payload: {},
      options: {},
    },
    {
      name: "profile controls disabled",
      payload: {},
      options: {
        dailyLossHaltEnabled: false,
        premiumBudgetEnabled: false,
        tradingAllowanceEnabled: false,
      },
    },
    {
      name: "market data forced",
      payload: {
        retryable: true,
        selectedContract: {},
        signal: {
          filterState: {
            mtfSource: "legacy",
            mtfDirections: [1],
          },
        },
      },
      options: {
        forceRetryMarketData: true,
      },
    },
    {
      name: "gateway recovered",
      payload: {
        preflight: true,
      },
      options: {
        gatewayReady: true,
      },
    },
    {
      name: "budgets expanded",
      payload: {
        premiumCap: 100,
        available: 25,
      },
      options: {
        currentPremiumCap: 150,
        currentTradingAllowanceAvailable: 50,
        premiumBudgetEnabled: true,
        tradingAllowanceEnabled: true,
      },
    },
    {
      name: "same direction still open",
      payload: {
        candidate: {
          symbol: "SPY",
          direction: "buy",
          selectedContract: {
            providerContractId: "candidate-contract",
          },
        },
      },
      options: {
        activePositions: [
          {
            symbol: "SPY",
            direction: "buy",
            selectedContract: {
              providerContractId: "different-contract",
            },
          } as unknown as SignalOptionsPosition,
        ],
      },
    },
    {
      name: "retryable option debug",
      payload: {
        chainDebug: {
          reason: "options_upstream_failure",
        },
        expirationsDebug: {
          reason: "durable_option_expirations_after_upstream_failure",
        },
      },
      options: {},
    },
    {
      name: "profile updated after skip",
      payload: {},
      options: {
        profileUpdatedAt: new Date("2026-07-07T12:00:01.000Z"),
      },
    },
  ];

  for (const reason of SIGNAL_OPTIONS_SEEN_SIGNAL_SKIP_REASON_VALUES) {
    for (const scenario of scenarios) {
      const event = skippedEvent({
        reason,
        payload: scenario.payload,
      });
      const row = extractSignalOptionsSeenSignalRow(event);
      assert.ok(row, `${reason} should extract for ${scenario.name}`);
      assert.equal(
        isRetryableSignalOptionsSkip(event, scenario.options),
        isRetryableSignalOptionsSkipFromRow(row, scenario.options),
        `${reason} retryability mismatch for ${scenario.name}`,
      );
    }
  }
});

test("seen-signal golden F1: same-direction match key excludes providerContractId", () => {
  const event = skippedEvent({
    reason: "same_direction_position_open",
    payload: {
      candidate: {
        symbol: "spy",
        direction: "buy",
        selectedContract: {
          providerContractId: "candidate-contract",
        },
      },
      selectedContract: {
        providerContractId: "payload-contract",
      },
    },
  });
  const row = extractSignalOptionsSeenSignalRow(event);
  assert.ok(row);
  assert.equal(row.candidateMatchKey, "SPY|buy");
  assert.equal(row.candidateMatchKey.includes("contract"), false);
  assert.equal(
    isRetryableSignalOptionsSkipFromRow(row, {
      activePositions: [
        {
          symbol: "SPY",
          direction: "buy",
          selectedContract: {
            providerContractId: "different-live-contract",
          },
        } as unknown as SignalOptionsPosition,
      ],
    }),
    false,
  );
});

test("seen-signal golden F2: mark-feed degraded and position-mark skips are excluded from the store", () => {
  for (const reason of [
    "position_mark_feed_degraded",
    "position_mark_unavailable",
    "position_mark_failed",
    "position_mark_timeout",
  ]) {
    const event = skippedEvent({ reason });
    assert.equal(isSignalOptionsSeenSignalStoreCandidate(event), false);
    assert.equal(extractSignalOptionsSeenSignalRow(event), null);
  }
});

test("seen-signal golden: extracted columns preserve the payload fields used for writes", () => {
  const event = skippedEvent({
    reason: "trading_allowance_exhausted",
    payload: {
      retryable: true,
      preflight: true,
      premiumCap: 123.45,
      available: 67.89,
      candidate: {
        symbol: "dia",
        direction: "sell",
        signal: {
          filterState: {
            mtfSource: "signal_matrix",
            mtfDirections: [1, -1, 1, -1, 1, -1],
          },
        },
      },
      chainDebug: {
        reason: "options_upstream_failure",
      },
      expirationsDebug: {
        reason: "option_expirations_refresh_deferred",
      },
    },
  });
  const row = extractSignalOptionsSeenSignalRow(event);
  assert.ok(row);
  assert.equal(row.deploymentId, event.deploymentId);
  assert.equal(row.providerAccountId, event.providerAccountId);
  assert.equal(row.eventId, event.id);
  assert.equal(row.symbol, "DIA");
  assert.equal(row.signalKey, "sig:trading_allowance_exhausted");
  assert.equal(row.reason, "trading_allowance_exhausted");
  assert.equal(row.candidateMatchKey, "DIA|sell");
  assert.equal(row.payloadRetryable, true);
  assert.equal(row.preflight, true);
  assert.equal(row.hasSelectedContract, true);
  assert.equal(row.hasSignalMatrixMtf, true);
  assert.equal(row.premiumCap, 123.45);
  assert.equal(row.available, 67.89);
  assert.equal(row.chainDebugReason, "options_upstream_failure");
  assert.equal(row.expirationsDebugReason, "option_expirations_refresh_deferred");
});
