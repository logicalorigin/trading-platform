import assert from "node:assert/strict";
import test from "node:test";

process.env["DATABASE_URL"] ??= "postgres://test:test@127.0.0.1:5432/test";
process.env["DIAGNOSTICS_SUPPRESS_DB_WARNINGS"] = "1";

test("account risk internals summarize static risk metadata and nullable totals", async () => {
  const { __accountRiskInternalsForTests } = await import("./account");

  assert.equal(__accountRiskInternalsForTests.sectorForSymbol("AAPL"), "Technology");
  assert.equal(__accountRiskInternalsForTests.sectorForSymbol("UNKNOWN"), "Unknown");
  assert.equal(__accountRiskInternalsForTests.betaForSymbol("TSLA"), 2.1);
  assert.equal(__accountRiskInternalsForTests.betaForSymbol("UNKNOWN"), 1);
  assert.equal(__accountRiskInternalsForTests.weightPercent(25, 100), 25);
  assert.equal(__accountRiskInternalsForTests.weightPercent(25, 0), null);
  assert.equal(
    __accountRiskInternalsForTests.sumNullableValues([1, null, 2, Number.NaN]),
    3,
  );
  assert.equal(__accountRiskInternalsForTests.sumNullableValues([null]), null);
  assert.equal(__accountRiskInternalsForTests.upsertNullableTotal(null, 3), 3);
  assert.equal(__accountRiskInternalsForTests.upsertNullableTotal(2, null), 2);
});

test("account risk internals match and merge option-chain contracts", async () => {
  const { __accountRiskInternalsForTests } = await import("./account");
  const tupleContract = {
    contract: {
      underlying: "AAPL",
      expirationDate: new Date("2026-06-19T00:00:00.000Z"),
      strike: 200,
      right: "CALL",
      providerContractId: null,
    },
    delta: 0.5,
    gamma: null,
    theta: null,
    vega: null,
  };
  const directContract = {
    contract: {
      underlying: "MSFT",
      expirationDate: new Date("2026-07-17T00:00:00.000Z"),
      strike: 420,
      right: "PUT",
      providerContractId: "123",
    },
    delta: -0.4,
    gamma: null,
    theta: null,
    vega: null,
  };

  assert.equal(
    __accountRiskInternalsForTests.matchOptionChainContract(
      [tupleContract, directContract] as any,
      {
        underlying: "MSFT",
        expirationDate: new Date("2026-07-17T00:00:00.000Z"),
        strike: 420,
        right: "PUT",
        providerContractId: "123",
      } as any,
    ),
    directContract,
  );
  assert.equal(
    __accountRiskInternalsForTests.matchOptionChainContract(
      [tupleContract] as any,
      {
        underlying: "AAPL",
        expirationDate: new Date("2026-06-19T00:00:00.000Z"),
        strike: 200,
        right: "CALL",
        providerContractId: null,
      } as any,
    ),
    tupleContract,
  );
  assert.equal(
    __accountRiskInternalsForTests.mergeOptionChainContracts([
      [tupleContract],
      [{ ...tupleContract, delta: 0.6 }],
      [directContract],
    ] as any).length,
    2,
  );
});

test("account risk internals bucket option expiry notional", async () => {
  const { __accountRiskInternalsForTests } = await import("./account");
  const now = new Date("2026-05-01T00:00:00.000Z").getTime();
  const buckets = __accountRiskInternalsForTests.buildExpiryConcentration(
    [
      {
        marketValue: 100,
        optionContract: {
          expirationDate: new Date("2026-05-05T00:00:00.000Z"),
        },
      },
      {
        marketValue: -200,
        optionContract: {
          expirationDate: new Date("2026-05-20T00:00:00.000Z"),
        },
      },
      {
        marketValue: 300,
        optionContract: {
          expirationDate: new Date("2026-07-15T00:00:00.000Z"),
        },
      },
    ] as any,
    now,
  );

  assert.deepEqual(buckets, {
    thisWeek: 100,
    thisMonth: 300,
    next90Days: 600,
  });
});
