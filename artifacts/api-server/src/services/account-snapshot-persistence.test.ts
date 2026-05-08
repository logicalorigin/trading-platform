import assert from "node:assert/strict";
import test from "node:test";
import type { BrokerAccountSnapshot } from "../providers/ibkr/client";
import { createTransientPostgresBackoff } from "../lib/transient-db-error";

process.env["DATABASE_URL"] ??= "postgres://test:test@127.0.0.1:5432/test";

const { recordAccountSnapshots } = await import("./account");
const { __accountPositionInternalsForTests } = await import("./account");

function account(id: string): BrokerAccountSnapshot {
  return {
    id,
    providerAccountId: id,
    provider: "ibkr",
    mode: "live",
    displayName: `IBKR ${id}`,
    currency: "USD",
    buyingPower: 100,
    cash: 50,
    netLiquidation: 150,
    accountType: "INDIVIDUAL",
    maintenanceMargin: 0,
    updatedAt: new Date("2026-05-07T16:00:00.000Z"),
  };
}

test("account snapshot persistence quietly backs off transient database failures", async () => {
  let nowMs = 100_000;
  let persistCalls = 0;
  const warnings: string[] = [];
  const backoff = createTransientPostgresBackoff({
    backoffMs: 60_000,
    warningCooldownMs: 60_000,
  });

  await recordAccountSnapshots([account("U-BACKOFF-1")], {
    nowMs: () => nowMs,
    backoff,
    logger: {
      warn: (_payload: unknown, message: string) => warnings.push(message),
    },
    persistSnapshots: async () => {
      persistCalls += 1;
      throw new Error("timeout exceeded when trying to connect");
    },
  });

  nowMs = 100_500;
  await recordAccountSnapshots([account("U-BACKOFF-1")], {
    nowMs: () => nowMs,
    backoff,
    logger: {
      warn: (_payload: unknown, message: string) => warnings.push(message),
    },
    persistSnapshots: async () => {
      persistCalls += 1;
      throw new Error("timeout exceeded when trying to connect");
    },
  });

  nowMs = 160_001;
  await recordAccountSnapshots([account("U-BACKOFF-1")], {
    nowMs: () => nowMs,
    backoff,
    logger: {
      warn: (_payload: unknown, message: string) => warnings.push(message),
    },
    persistSnapshots: async () => {
      persistCalls += 1;
      throw new Error("timeout exceeded when trying to connect");
    },
  });

  assert.equal(persistCalls, 2);
  assert.deepEqual(warnings, [
    "Account snapshot persistence database unavailable; pausing snapshot writes",
    "Account snapshot persistence database unavailable; pausing snapshot writes",
  ]);
});

test("account snapshot persistence still surfaces non-database failures", async () => {
  await assert.rejects(
    recordAccountSnapshots([account("U-NONDB-1")], {
      backoff: createTransientPostgresBackoff(),
      persistSnapshots: async () => {
        throw new Error("unexpected account snapshot shape");
      },
    }),
    /unexpected account snapshot shape/,
  );
});

test("account position lots read degrades on transient database failures", async () => {
  let nowMs = 200_000;
  let readCalls = 0;
  const warnings: string[] = [];
  const backoff = createTransientPostgresBackoff({
    backoffMs: 60_000,
    warningCooldownMs: 60_000,
  });

  const first = await __accountPositionInternalsForTests.withAccountPositionLotsReadFallback({
    nowMs: () => nowMs,
    backoff,
    fallback: () => [] as string[],
    logger: {
      warn: (_payload: unknown, message: string) => warnings.push(message),
    },
    run: async () => {
      readCalls += 1;
      throw new Error("connection terminated due to connection timeout");
    },
  });

  nowMs = 200_500;
  const second = await __accountPositionInternalsForTests.withAccountPositionLotsReadFallback({
    nowMs: () => nowMs,
    backoff,
    fallback: () => [] as string[],
    logger: {
      warn: (_payload: unknown, message: string) => warnings.push(message),
    },
    run: async () => {
      readCalls += 1;
      return ["unexpected"];
    },
  });

  assert.deepEqual(first, []);
  assert.deepEqual(second, []);
  assert.equal(readCalls, 1);
  assert.deepEqual(warnings, [
    "Account position lots database unavailable; returning live positions without lots",
  ]);
});

test("account position lots read still surfaces non-database failures", async () => {
  await assert.rejects(
    __accountPositionInternalsForTests.withAccountPositionLotsReadFallback({
      backoff: createTransientPostgresBackoff(),
      fallback: () => [],
      run: async () => {
        throw new Error("unexpected position lot shape");
      },
    }),
    /unexpected position lot shape/,
  );
});
