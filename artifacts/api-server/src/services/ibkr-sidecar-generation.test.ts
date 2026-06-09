import assert from "node:assert/strict";
import test from "node:test";

import { buildIbkrSidecarDesiredGeneration } from "./ibkr-sidecar-generation";
import type {
  MarketDataIntent,
  MarketDataLease,
  MarketDataOwnerClass,
  MarketDataPoolId,
} from "./market-data-admission";

function lease(input: {
  owner: string;
  ownerClass: MarketDataOwnerClass;
  intent: MarketDataIntent;
  pool: MarketDataPoolId;
  priority: number;
  symbol: string;
  lineId: string;
  providerContractId?: string | null;
}): MarketDataLease {
  const assetClass = input.lineId.startsWith("option:") ? "option" : "equity";
  return {
    id: `${input.owner}:${input.lineId}`,
    owner: input.owner,
    ownerClass: input.ownerClass,
    intent: input.intent,
    pool: input.pool,
    priority: input.priority,
    assetClass,
    instrumentKey: input.symbol,
    symbol: input.symbol,
    providerContractId:
      input.providerContractId ??
      (assetClass === "option" ? input.lineId.slice("option:".length) : null),
    role: assetClass === "option" ? "option-contract" : "stock",
    lineIds: [input.lineId],
    lineRoles: {
      [input.lineId]: assetClass === "option" ? "option-contract" : "stock",
    },
    lineCost: 1,
    fallbackProvider: "none",
    acquiredAt: "2026-06-08T19:00:00.000Z",
    expiresAt: null,
  };
}

test("sidecar desired generation orders account-monitor lines before lower-priority scanner lines", () => {
  const generation = buildIbkrSidecarDesiredGeneration({
    admission: {
      leases: [
        lease({
          owner: "flow-scanner:AAPL",
          ownerClass: "flow-scanner",
          intent: "flow-scanner-live",
          pool: "flow-scanner",
          priority: 55,
          symbol: "AAPL",
          lineId: "equity:AAPL",
        }),
        lease({
          owner: "account-position-equity-quotes:U24762790",
          ownerClass: "account-monitor",
          intent: "account-monitor-live",
          pool: "account-monitor",
          priority: 90,
          symbol: "FCEL",
          lineId: "equity:FCEL",
        }),
        lease({
          owner: "algo-position-option-quotes:MRVL",
          ownerClass: "automation",
          intent: "automation-live",
          pool: "automation",
          priority: 60,
          symbol: "MRVL",
          lineId: "equity:MRVL",
        }),
      ],
    },
    generatedAt: "2026-06-08T19:00:00.000Z",
  });

  assert.deepEqual(
    generation.desiredLines.map((line) => line.lineKey),
    ["equity:FCEL", "equity:MRVL", "equity:AAPL"],
  );
  assert.equal(generation.desiredLines[0].intent, "account-monitor-live");
});

test("sidecar desired generation carries equity provider contract ids without changing line keys", () => {
  const generation = buildIbkrSidecarDesiredGeneration({
    admission: {
      leases: [
        lease({
          owner: "account-monitor:live:all",
          ownerClass: "account-monitor",
          intent: "account-monitor-live",
          pool: "account-monitor",
          priority: 90,
          symbol: "FCEL",
          lineId: "equity:FCEL",
        }),
        lease({
          owner: "account-position-equity-quotes:U24762790",
          ownerClass: "account-monitor",
          intent: "account-monitor-live",
          pool: "account-monitor",
          priority: 90,
          symbol: "FCEL",
          lineId: "equity:FCEL",
          providerContractId: "740517233",
        }),
      ],
    },
    generatedAt: "2026-06-08T19:00:00.000Z",
  });

  assert.equal(generation.desiredLines.length, 1);
  assert.equal(generation.desiredLines[0].lineKey, "equity:FCEL");
  assert.equal(generation.desiredLines[0].contract.symbol, "FCEL");
  assert.equal(
    generation.desiredLines[0].contract.providerContractId,
    "740517233",
  );
});

test("sidecar desired generation does not put option ids on underlier equity lines", () => {
  const providerContractId =
    "twsopt:eyJ2IjoxLCJ1IjoiRiIsImUiOiIyMDI2MDYyNiIsInMiOjE1LCJyIjoiQyIsIngiOiJTTUFSVCIsInRjIjoiRiIsIm0iOjEwMH0";
  const generation = buildIbkrSidecarDesiredGeneration({
    admission: {
      leases: [
        {
          ...lease({
            owner: "account-position-option-quotes:U24762790:F",
            ownerClass: "account-monitor",
            intent: "account-monitor-live",
            pool: "account-monitor",
            priority: 90,
            symbol: "F",
            lineId: `option:${providerContractId}`,
            providerContractId,
          }),
          lineIds: [`option:${providerContractId}`, "equity:F"],
          lineRoles: {
            [`option:${providerContractId}`]: "option-contract",
            "equity:F": "option-underlier-support",
          },
        },
      ],
    },
    generatedAt: "2026-06-08T19:00:00.000Z",
  });

  const equityLine = generation.desiredLines.find(
    (line) => line.lineKey === "equity:F",
  );
  const optionLine = generation.desiredLines.find(
    (line) => line.lineKey === `option:${providerContractId}`,
  );
  assert.equal(equityLine?.contract.symbol, "F");
  assert.equal(equityLine?.contract.providerContractId, null);
  assert.equal(optionLine?.contract.providerContractId, providerContractId);
});
