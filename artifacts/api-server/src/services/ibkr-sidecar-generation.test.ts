import assert from "node:assert/strict";
import test from "node:test";
import {
  admitMarketDataLeases,
  getMarketDataAdmissionDiagnostics,
  __resetMarketDataAdmissionForTests,
  type MarketDataLease,
} from "./market-data-admission";
import { buildIbkrSidecarDesiredGeneration } from "./ibkr-sidecar-generation";

test.afterEach(() => {
  __resetMarketDataAdmissionForTests();
});

function structuredOptionProviderContractId(input: {
  underlying: string;
  expiration: string;
  strike: number;
  right: "C" | "P";
}): string {
  return `twsopt:${Buffer.from(
    JSON.stringify({
      v: 1,
      u: input.underlying,
      e: input.expiration,
      s: input.strike,
      r: input.right,
      x: "SMART",
      tc: input.underlying,
      m: 100,
    }),
    "utf8",
  ).toString("base64url")}`;
}

test("buildIbkrSidecarDesiredGeneration de-duplicates shared equity owners", () => {
  admitMarketDataLeases({
    owner: "watchlist-prewarm",
    intent: "visible-live",
    requests: [{ assetClass: "equity", symbol: "brk b" }],
    fallbackProvider: "massive",
  });
  admitMarketDataLeases({
    owner: "account-monitor:paper:all",
    intent: "account-monitor-live",
    requests: [{ assetClass: "equity", symbol: "BRK.B" }],
    fallbackProvider: "massive",
  });

  const generation = buildIbkrSidecarDesiredGeneration({
    admission: getMarketDataAdmissionDiagnostics(),
    generatedAt: "2026-06-02T15:00:00.000Z",
    plannerGeneration: "planner-test",
  });

  assert.equal(generation.schemaVersion, 1);
  assert.equal(generation.generationId, "planner-test");
  assert.equal(generation.summary.desiredLineCount, 1);
  assert.equal(generation.summary.desiredEquityLineCount, 1);
  assert.equal(generation.summary.ownerCount, 2);
  assert.equal(generation.desiredLines[0]?.lineKey, "equity:BRK.B");
  assert.equal(generation.desiredLines[0]?.contract.symbol, "BRK.B");
  assert.equal(generation.desiredLines[0]?.priority, 90);
  assert.deepEqual(
    generation.desiredLines[0]?.owners.map((owner) => owner.owner).sort(),
    ["account-monitor:paper:all", "watchlist-prewarm"],
  );
});

test("buildIbkrSidecarDesiredGeneration merges owners after line key normalization", () => {
  const baseLease: MarketDataLease = {
    id: "lease-1",
    owner: "watchlist-prewarm",
    ownerClass: "visible",
    intent: "visible-live",
    pool: "visible",
    priority: 70,
    assetClass: "equity",
    instrumentKey: "equity:AAPL",
    symbol: "aapl",
    providerContractId: null,
    role: "stock",
    lineIds: ["equity:aapl"],
    lineRoles: { "equity:aapl": "stock" },
    lineCost: 1,
    fallbackProvider: "massive",
    acquiredAt: "2026-06-02T15:00:00.000Z",
    expiresAt: null,
  };

  const generation = buildIbkrSidecarDesiredGeneration({
    admission: {
      leases: [
        baseLease,
        {
          ...baseLease,
          id: "lease-2",
          owner: "account-monitor:paper:all",
          ownerClass: "account-monitor",
          intent: "account-monitor-live",
          pool: "account-monitor",
          priority: 90,
          symbol: "AAPL",
          lineIds: ["equity:AAPL"],
          lineRoles: { "equity:AAPL": "stock" },
        },
      ],
    },
    generatedAt: "2026-06-02T15:00:00.000Z",
    plannerGeneration: "planner-normalized-test",
  });

  assert.equal(generation.summary.desiredLineCount, 1);
  assert.equal(generation.summary.ownerCount, 2);
  assert.equal(generation.desiredLines[0]?.lineKey, "equity:AAPL");
  assert.deepEqual(
    generation.desiredLines[0]?.owners.map((owner) => owner.owner).sort(),
    ["account-monitor:paper:all", "watchlist-prewarm"],
  );
});

test("buildIbkrSidecarDesiredGeneration preserves option provider contract ids", () => {
  const providerContractId = structuredOptionProviderContractId({
    underlying: "SPY",
    expiration: "20260619",
    strike: 500,
    right: "C",
  });
  admitMarketDataLeases({
    owner: "flow-scanner:SPY",
    intent: "flow-scanner-live",
    requests: [
      {
        assetClass: "option",
        symbol: "SPY",
        providerContractId: ` ${providerContractId} `,
      },
    ],
    fallbackProvider: "none",
  });

  const generation = buildIbkrSidecarDesiredGeneration({
    admission: getMarketDataAdmissionDiagnostics(),
    generatedAt: "2026-06-02T15:01:00.000Z",
    plannerGeneration: "planner-option-test",
  });

  assert.equal(generation.summary.desiredLineCount, 1);
  assert.equal(generation.summary.desiredOptionLineCount, 1);
  assert.equal(generation.desiredLines[0]?.lineKey, `option:${providerContractId}`);
  assert.equal(
    generation.desiredLines[0]?.contract.providerContractId,
    providerContractId,
  );
  assert.equal(generation.desiredLines[0]?.contract.symbol, "SPY");
  assert.equal(generation.desiredLines[0]?.owners[0]?.intent, "flow-scanner-live");
});

test("buildIbkrSidecarDesiredGeneration preserves numeric real-account option conids", () => {
  admitMarketDataLeases({
    owner: "account-position-option-quotes:U24762790",
    intent: "account-monitor-live",
    requests: [
      {
        assetClass: "option",
        symbol: "SPY",
        providerContractId: "885885495",
      },
    ],
    fallbackProvider: "cache",
  });

  const generation = buildIbkrSidecarDesiredGeneration({
    admission: getMarketDataAdmissionDiagnostics(),
    generatedAt: "2026-06-02T15:01:30.000Z",
    plannerGeneration: "planner-real-option-conid-test",
  });

  assert.equal(generation.summary.desiredLineCount, 1);
  assert.equal(generation.summary.desiredOptionLineCount, 1);
  assert.equal(generation.desiredLines[0]?.lineKey, "option:885885495");
  assert.equal(
    generation.desiredLines[0]?.contract.providerContractId,
    "885885495",
  );
  assert.equal(generation.desiredLines[0]?.contract.symbol, "SPY");
  assert.equal(
    generation.desiredLines[0]?.owners[0]?.owner,
    "account-position-option-quotes:U24762790",
  );
});

test("buildIbkrSidecarDesiredGeneration skips malformed option provider contract ids", () => {
  const validProviderContractId = structuredOptionProviderContractId({
    underlying: "SPY",
    expiration: "20260619",
    strike: 501,
    right: "P",
  });
  admitMarketDataLeases({
    owner: "flow-scanner:SPY",
    intent: "flow-scanner-live",
    requests: [
      {
        assetClass: "option",
        symbol: "SPY",
        providerContractId: "unresolved-provider-id",
      },
      {
        assetClass: "option",
        symbol: "SPY",
        providerContractId: "twsopt:not-json",
      },
      {
        assetClass: "option",
        symbol: "SPY",
        providerContractId: validProviderContractId,
      },
    ],
    fallbackProvider: "none",
  });

  const generation = buildIbkrSidecarDesiredGeneration({
    admission: getMarketDataAdmissionDiagnostics(),
    generatedAt: "2026-06-02T15:02:00.000Z",
    plannerGeneration: "planner-option-gate-test",
  });

  assert.equal(generation.summary.desiredLineCount, 1);
  assert.equal(generation.summary.desiredOptionLineCount, 1);
  assert.deepEqual(
    generation.desiredLines.map((line) => line.lineKey),
    [`option:${validProviderContractId}`],
  );
});
