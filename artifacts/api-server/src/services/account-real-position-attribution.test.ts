import assert from "node:assert/strict";
import test from "node:test";

import { __accountOrderInternalsForTests } from "./account";

// WO-EE-FIREHOSE Deliverable 4 — the attribution query now projects only
// payload->'brokerOrder' instead of the whole payload jsonb. This verifies the
// pure fold over that narrowed row shape produces the same per-position
// attribution the full-payload read did.
//
//   pnpm --filter @workspace/api-server exec tsx --test --test-force-exit \
//     src/services/account-real-position-attribution.test.ts

const { foldRealPositionAttribution, realAttributionPositionKey } =
  __accountOrderInternalsForTests;

type Row = { deploymentId: string | null; brokerOrder: unknown };

test("attribution: single deployment on an option position -> automation", () => {
  const rows: Row[] = [
    {
      deploymentId: "dep-1",
      brokerOrder: { symbol: "AAPL", optionContract: { providerContractId: "OPT-1" } },
    },
    // Same position + deployment repeated (dedup within the deployment set).
    {
      deploymentId: "dep-1",
      brokerOrder: { symbol: "AAPL", optionContract: { providerContractId: "OPT-1" } },
    },
    { deploymentId: "dep-2", brokerOrder: { symbol: "TSLA" } }, // equity, other pos
  ];
  const map = foldRealPositionAttribution(rows);

  const optionKey = realAttributionPositionKey({
    symbol: "AAPL",
    optionContract: { providerContractId: "OPT-1" },
  });
  const equityKey = realAttributionPositionKey({ symbol: "TSLA" });

  assert.equal(map.get(optionKey)?.sourceType, "automation");
  assert.equal(map.get(optionKey)?.attributionStatus, "attributed");
  assert.deepEqual(
    map.get(optionKey)?.sourceAttribution.map((s) => s.deploymentId),
    ["dep-1"],
  );
  assert.equal(map.get(equityKey)?.sourceType, "automation");
});

test("attribution: multiple deployments on one position -> mixed", () => {
  const rows: Row[] = [
    { deploymentId: "dep-1", brokerOrder: { symbol: "AAPL" } },
    { deploymentId: "dep-2", brokerOrder: { symbol: "AAPL" } },
  ];
  const map = foldRealPositionAttribution(rows);
  const key = realAttributionPositionKey({ symbol: "AAPL" });
  assert.equal(map.get(key)?.sourceType, "mixed");
  assert.equal(map.get(key)?.attributionStatus, "mixed");
  assert.equal(map.get(key)?.sourceAttribution.length, 2);
});

test("attribution: absent/null brokerOrder (projection miss) and bad rows are skipped", () => {
  const rows: Row[] = [
    { deploymentId: "dep-1", brokerOrder: null }, // payload had no brokerOrder key
    { deploymentId: "dep-1", brokerOrder: undefined },
    { deploymentId: null, brokerOrder: { symbol: "AAPL" } }, // no deployment
    { deploymentId: "dep-1", brokerOrder: { symbol: 123 } }, // non-string symbol
  ];
  const map = foldRealPositionAttribution(rows);
  assert.equal(map.size, 0);
});

test("attribution: option keys join on providerContractId (ticker fallback)", () => {
  const rows: Row[] = [
    {
      deploymentId: "dep-1",
      brokerOrder: { symbol: "AAPL", optionContract: { ticker: "AAPL240119C" } },
    },
  ];
  const map = foldRealPositionAttribution(rows);
  const key = realAttributionPositionKey({
    symbol: "AAPL",
    optionContract: { ticker: "AAPL240119C" },
  });
  assert.equal(map.get(key)?.sourceType, "automation");
});
