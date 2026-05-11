import assert from "node:assert/strict";
import test from "node:test";
import type { BrokerAccountSnapshot } from "../providers/ibkr/client";

process.env["DATABASE_URL"] ??= "postgres://test:test@127.0.0.1:5432/test";

const { listAccounts } = await import("./account");

function account(
  id: string,
  overrides: Partial<BrokerAccountSnapshot> = {},
): BrokerAccountSnapshot {
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
    totalCashValue: null,
    settledCash: null,
    accruedCash: null,
    initialMargin: null,
    maintenanceMargin: null,
    excessLiquidity: null,
    cushion: null,
    sma: null,
    dayTradingBuyingPower: null,
    regTInitialMargin: null,
    grossPositionValue: null,
    leverage: null,
    dayTradesRemaining: null,
    isPatternDayTrader: null,
    updatedAt: new Date("2026-05-10T14:00:00.000Z"),
    ...overrides,
  };
}

test("listAccounts returns live bridge accounts and records snapshots", async () => {
  const liveAccount = account("U-LIVE-1");
  let persistedRead = false;
  let recordedAccounts: BrokerAccountSnapshot[] = [];

  const result = await listAccounts(
    { mode: "live" },
    {
      listLiveAccounts: async () => [liveAccount],
      getPersistedAccounts: async () => {
        persistedRead = true;
        return { accounts: [], latestSnapshotAt: null };
      },
      getFlexAccounts: async () => [],
      recordSnapshots: async (accounts) => {
        recordedAccounts = accounts;
      },
    },
  );

  assert.deepEqual(result.accounts, [liveAccount]);
  assert.equal(persistedRead, false);
  assert.deepEqual(
    recordedAccounts.map((item) => item.id),
    ["U-LIVE-1"],
  );
});

test("listAccounts falls back to persisted snapshots when bridge read fails", async () => {
  const persistedAccount = account("U-DB-1", {
    cash: 75,
    netLiquidation: 250,
  });
  let flexRead = false;

  const result = await listAccounts(
    { mode: "live" },
    {
      listLiveAccounts: async () => {
        throw new Error("bridge unavailable");
      },
      getPersistedAccounts: async (requestedAccountId, mode) => {
        assert.equal(requestedAccountId, "combined");
        assert.equal(mode, "live");
        return {
          accounts: [persistedAccount],
          latestSnapshotAt: persistedAccount.updatedAt,
        };
      },
      getFlexAccounts: async () => {
        flexRead = true;
        return [];
      },
      recordSnapshots: async () => {
        throw new Error("snapshot persistence should not run");
      },
    },
  );

  assert.deepEqual(result.accounts, [persistedAccount]);
  assert.equal(flexRead, false);
});

test("listAccounts falls back to persisted snapshots when bridge returns empty", async () => {
  const persistedAccount = account("U-DB-2");

  const result = await listAccounts(
    { mode: "live" },
    {
      listLiveAccounts: async () => [],
      getPersistedAccounts: async () => ({
        accounts: [persistedAccount],
        latestSnapshotAt: persistedAccount.updatedAt,
      }),
      getFlexAccounts: async () => [],
      recordSnapshots: async () => {
        throw new Error("snapshot persistence should not run");
      },
    },
  );

  assert.deepEqual(result.accounts, [persistedAccount]);
});

test("listAccounts falls back to Flex accounts after live and persisted sources are empty", async () => {
  const flexAccount = account("U-FLEX-1", {
    displayName: "IBKR U-FLEX-1",
    buyingPower: 0,
    cash: 0,
    netLiquidation: 300,
  });

  const result = await listAccounts(
    { mode: "live" },
    {
      listLiveAccounts: async () => [],
      getPersistedAccounts: async () => ({ accounts: [], latestSnapshotAt: null }),
      getFlexAccounts: async (requestedAccountId, mode) => {
        assert.equal(requestedAccountId, "combined");
        assert.equal(mode, "live");
        return [flexAccount];
      },
      recordSnapshots: async () => {
        throw new Error("snapshot persistence should not run");
      },
    },
  );

  assert.deepEqual(result.accounts, [flexAccount]);
});

test("listAccounts returns an empty list when every source is exhausted", async () => {
  const result = await listAccounts(
    { mode: "live" },
    {
      listLiveAccounts: async () => {
        throw new Error("bridge unavailable");
      },
      getPersistedAccounts: async () => ({ accounts: [], latestSnapshotAt: null }),
      getFlexAccounts: async () => [],
      recordSnapshots: async () => {
        throw new Error("snapshot persistence should not run");
      },
    },
  );

  assert.deepEqual(result.accounts, []);
});
