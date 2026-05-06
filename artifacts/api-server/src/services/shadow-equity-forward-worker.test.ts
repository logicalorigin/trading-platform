import assert from "node:assert/strict";
import test from "node:test";
import { createShadowEquityForwardWorker } from "./shadow-equity-forward-worker";
import type { AlgoDeployment } from "@workspace/db";

process.env["DATABASE_URL"] ??= "postgres://test:test@127.0.0.1:5432/test";

const baseDate = new Date("2026-05-05T14:30:00.000Z");

function deployment(patch: Partial<AlgoDeployment> = {}): AlgoDeployment {
  return {
    id: "deployment-1",
    strategyId: "strategy-1",
    name: "Shadow Equity Forward Test",
    mode: "paper",
    enabled: true,
    providerAccountId: "shadow",
    symbolUniverse: ["AAPL"],
    config: {
      parameters: { executionMode: "signal_equity_shadow" },
      signalEquityShadow: { pollIntervalSeconds: 60 },
    },
    lastEvaluatedAt: null,
    lastSignalAt: null,
    lastError: null,
    createdAt: baseDate,
    updatedAt: baseDate,
    ...patch,
  };
}

function noopLogger() {
  return {
    debug: () => {},
    info: () => {},
    warn: () => {},
  };
}

test("shadow equity forward worker interval-gates scans", async () => {
  let now = new Date("2026-05-05T14:30:00.000Z");
  let scanCalls = 0;
  const worker = createShadowEquityForwardWorker({
    listDeployments: async () => [deployment()],
    scanDeployment: async () => {
      scanCalls += 1;
    },
    acquireTickLock: async () => async () => {},
    now: () => now,
    logger: noopLogger(),
  });

  await worker.runOnce();
  now = new Date("2026-05-05T14:30:30.000Z");
  await worker.runOnce();
  now = new Date("2026-05-05T14:31:00.000Z");
  await worker.runOnce();

  assert.equal(scanCalls, 2);
});

test("shadow equity forward worker skips when advisory lock is unavailable", async () => {
  let listCalls = 0;
  const worker = createShadowEquityForwardWorker({
    listDeployments: async () => {
      listCalls += 1;
      return [deployment()];
    },
    acquireTickLock: async () => null,
    logger: noopLogger(),
  });

  await worker.runOnce();

  assert.equal(listCalls, 0);
});
