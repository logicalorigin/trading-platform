import assert from "node:assert/strict";
import test from "node:test";
import {
  buildIbkrConnectionInsightModel,
  formatIbkrInsightElapsed,
} from "./ibkrConnectionInsightModel.js";

const now = Date.parse("2026-06-04T14:30:10.000Z");

const baseInsight = (overrides = {}) => ({
  currentOwner: "desktopHelper",
  currentPhase: "credentials",
  currentPhaseElapsedMs: 6500,
  currentPhaseStartedAt: "2026-06-04T14:30:03.500Z",
  detail: "Pyrus is preparing or delivering the one-time encrypted IBKR credentials.",
  normalAfterMs: 5000,
  phaseDurations: {},
  recommendedAction: null,
  severity: "progress",
  stale: false,
  staleAfterMs: 12000,
  timeline: [
    {
      id: "request",
      label: "Request",
      owner: "pyrus",
      status: "complete",
      elapsedMs: 1200,
    },
    {
      id: "credentials",
      label: "Credentials",
      owner: "desktopHelper",
      status: "active",
      elapsedMs: 6500,
    },
  ],
  title: "Waiting for encrypted credentials",
  ...overrides,
});

test("IBKR connection insight formats elapsed time compactly", () => {
  assert.equal(formatIbkrInsightElapsed(null), null);
  assert.equal(formatIbkrInsightElapsed(0), "0s");
  assert.equal(formatIbkrInsightElapsed(59_900), "59s");
  assert.equal(formatIbkrInsightElapsed(61_000), "1m 1s");
  assert.equal(formatIbkrInsightElapsed(3_600_000), "1h");
});

test("IBKR connection insight summarizes backend wait owner and elapsed time", () => {
  const model = buildIbkrConnectionInsightModel({
    activationStatus: { insight: baseInsight() },
    now,
  });

  assert.equal(model.title, "Waiting for encrypted credentials");
  assert.equal(model.statusLine, "Waiting on Windows helper");
  assert.equal(model.ownerLabel, "Windows helper");
  assert.equal(model.phaseLabel, "Credentials");
  assert.equal(model.elapsedLabel, "6s");
  assert.equal(model.tone, "progress");
  assert.deepEqual(
    model.timelineRows.map((row) => [row.label, row.statusLabel, row.tone]),
    [
      ["Request", "Done", "success"],
      ["Credentials", "Active", "progress"],
    ],
  );
});

test("IBKR connection insight preserves attention guidance from the backend", () => {
  const model = buildIbkrConnectionInsightModel({
    activationStatus: {
      insight: baseInsight({
        currentOwner: "ibGateway",
        currentPhase: "gateway",
        currentPhaseStartedAt: "2026-06-04T14:29:30.000Z",
        detail: "The Windows desktop is opening IB Gateway and preparing the login window.",
        recommendedAction:
          "If IB Gateway shows a prompt, clear it on the Windows desktop.",
        severity: "attention",
        stale: true,
        title: "Waiting for IB Gateway",
      }),
    },
    now,
  });

  assert.equal(model.statusLine, "Waiting on IB Gateway");
  assert.equal(model.elapsedLabel, "40s");
  assert.equal(model.tone, "attention");
  assert.equal(
    model.action,
    "If IB Gateway shows a prompt, clear it on the Windows desktop.",
  );
});

test("IBKR connection insight shows immediate preparing state before status insight arrives", () => {
  const model = buildIbkrConnectionInsightModel({
    bridgeOperationModel: {
      latestMessage: "Sending the IBKR launch request to the paired Windows desktop.",
    },
    busy: true,
    now,
  });

  assert.equal(model.title, "Preparing IBKR launch");
  assert.equal(model.statusLine, "Preparing request");
  assert.equal(model.ownerLabel, "Pyrus");
  assert.equal(
    model.detail,
    "Sending the IBKR launch request to the paired Windows desktop.",
  );
});

test("IBKR connection insight hides after a healthy connection is already attached", () => {
  assert.equal(
    buildIbkrConnectionInsightModel({
      activationStatus: {
        insight: baseInsight({
          currentOwner: "none",
          currentPhase: "complete",
          severity: "success",
          title: "Connected",
        }),
      },
      gatewayConnected: true,
      now,
    }),
    null,
  );
});
