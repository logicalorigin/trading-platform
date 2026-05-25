import assert from "node:assert/strict";
import test from "node:test";
import {
  TRADE_OPTION_CHAIN_STORE_ENTRY_CAP,
  clearTradeOptionChainSnapshot,
  getTradeOptionChainSnapshot,
  getTradeOptionChainStoreEntryCount,
  publishTradeOptionChainSnapshot,
  resetTradeOptionChainStoreForTests,
  resolveTradeOptionChainSnapshot,
} from "./tradeOptionChainStore.js";

const buildRow = (strike) => ({
  k: strike,
  cContract: { providerContractId: `C-${strike}` },
  pContract: { providerContractId: `P-${strike}` },
  cPrem: 1.2,
  pPrem: 1.1,
});

test("tradeOptionChainStore resolves rows by stable chainKey and exposes coverage", () => {
  const ticker = "CHAINKEY1";
  publishTradeOptionChainSnapshot(ticker, {
    expirationOptions: [
      {
        value: "04/24",
        chainKey: "2026-04-24",
        isoDate: "2026-04-24",
        label: "04/24",
        dte: 0,
        actualDate: new Date("2026-04-24T00:00:00Z"),
      },
      {
        value: "05/01",
        chainKey: "2026-05-01",
        isoDate: "2026-05-01",
        label: "05/01",
        dte: 7,
        actualDate: new Date("2026-05-01T00:00:00Z"),
      },
    ],
    rowsByExpiration: {
      "2026-04-24": [buildRow(100)],
    },
    loadingExpirations: ["2026-05-01"],
    refreshingExpirations: ["2026-04-24"],
    staleExpirations: ["2026-04-24"],
    statusByExpiration: {
      "2026-04-24": "loaded",
      "2026-05-01": "loading",
    },
    coverageByExpiration: {
      "2026-04-24": "full",
    },
    loadedExpirationCount: 1,
    completedExpirationCount: 1,
    emptyExpirationCount: 0,
    failedExpirationCount: 0,
    totalExpirationCount: 2,
    updatedAt: 1000,
    status: "loading",
  });

  const snapshot = getTradeOptionChainSnapshot(ticker);
  const resolved = resolveTradeOptionChainSnapshot(snapshot, "04/24");

  assert.equal(resolved.resolvedExpirationKey, "2026-04-24");
  assert.equal(resolved.chainRows[0].k, 100);
  assert.equal(resolved.loadedExpirationCount, 1);
  assert.equal(resolved.completedExpirationCount, 1);
  assert.equal(resolved.emptyExpirationCount, 0);
  assert.equal(resolved.failedExpirationCount, 0);
  assert.equal(resolved.totalExpirationCount, 2);
  assert.deepEqual(resolved.loadingExpirations, ["2026-05-01"]);
  assert.deepEqual(resolved.refreshingExpirations, ["2026-04-24"]);
  assert.deepEqual(resolved.staleExpirations, ["2026-04-24"]);
  assert.equal(resolved.resolvedExpirationStatus, "loaded");
  assert.equal(resolved.resolvedExpirationCoverage, "full");
  assert.equal(resolved.isResolvedExpirationLoading, false);
  assert.equal(resolved.isResolvedExpirationRefreshing, true);
  assert.equal(resolved.isResolvedExpirationStale, true);
});

test("tradeOptionChainStore keeps the old snapshot when only updatedAt changes", () => {
  const ticker = "CHAINKEY2";
  const expirationOptions = [
    {
      value: "04/24",
      chainKey: "2026-04-24",
      isoDate: "2026-04-24",
      label: "04/24",
      dte: 0,
      actualDate: new Date("2026-04-24T00:00:00Z"),
    },
  ];
  const rowsByExpiration = {
    "2026-04-24": [buildRow(105)],
  };

  publishTradeOptionChainSnapshot(ticker, {
    expirationOptions,
    rowsByExpiration,
    loadingExpirations: [],
    loadedExpirationCount: 1,
    totalExpirationCount: 1,
    updatedAt: 1000,
    status: "live",
  });
  publishTradeOptionChainSnapshot(ticker, {
    expirationOptions,
    rowsByExpiration,
    loadingExpirations: [],
    loadedExpirationCount: 1,
    totalExpirationCount: 1,
    updatedAt: 2000,
    status: "live",
  });

  assert.equal(getTradeOptionChainSnapshot(ticker).updatedAt, 1000);
});

test("tradeOptionChainStore republishes when row freshness changes", () => {
  const ticker = "CHAINFRESH";
  const expirationOptions = [
    {
      value: "04/24",
      chainKey: "2026-04-24",
      isoDate: "2026-04-24",
      label: "04/24",
      dte: 0,
      actualDate: new Date("2026-04-24T00:00:00Z"),
    },
  ];
  const rowsByExpiration = {
    "2026-04-24": [
      {
        ...buildRow(105),
        cFreshness: "metadata",
        cQuoteUpdatedAt: null,
      },
    ],
  };

  publishTradeOptionChainSnapshot(ticker, {
    expirationOptions,
    rowsByExpiration,
    loadingExpirations: [],
    loadedExpirationCount: 1,
    totalExpirationCount: 1,
    updatedAt: 1000,
    status: "live",
  });
  publishTradeOptionChainSnapshot(ticker, {
    expirationOptions,
    rowsByExpiration: {
      "2026-04-24": [
        {
          ...buildRow(105),
          cFreshness: "frozen",
          cQuoteUpdatedAt: "2026-04-24T20:00:00.000Z",
        },
      ],
    },
    loadingExpirations: [],
    loadedExpirationCount: 1,
    totalExpirationCount: 1,
    updatedAt: 2000,
    status: "live",
  });

  const resolved = resolveTradeOptionChainSnapshot(
    getTradeOptionChainSnapshot(ticker),
    "04/24",
  );
  assert.equal(resolved.chainRows[0].cFreshness, "frozen");
  assert.equal(getTradeOptionChainSnapshot(ticker).updatedAt, 2000);
});

test("tradeOptionChainStore falls back to legacy expiration value row keys", () => {
  const ticker = "CHAINKEY3";
  publishTradeOptionChainSnapshot(ticker, {
    expirationOptions: [
      {
        value: "05/01",
        chainKey: "2026-05-01",
        isoDate: "2026-05-01",
        label: "05/01",
        dte: 7,
        actualDate: new Date("2026-05-01T00:00:00Z"),
      },
    ],
    rowsByExpiration: {
      "05/01": [buildRow(110)],
    },
    loadingExpirations: [],
    loadedExpirationCount: 1,
    totalExpirationCount: 1,
    updatedAt: 1000,
    status: "live",
  });

  const resolved = resolveTradeOptionChainSnapshot(
    getTradeOptionChainSnapshot(ticker),
    "05/01",
  );

  assert.equal(resolved.resolvedExpirationKey, "2026-05-01");
  assert.equal(resolved.chainRows[0].k, 110);
});

test("tradeOptionChainStore resolves legacy labels when option values are ISO dates", () => {
  const ticker = "CHAINKEY_ISO";
  publishTradeOptionChainSnapshot(ticker, {
    expirationOptions: [
      {
        value: "2026-05-01",
        legacyValue: "05/01",
        chainKey: "2026-05-01",
        isoDate: "2026-05-01",
        label: "05/01",
        dte: 7,
        actualDate: new Date("2026-05-01T00:00:00Z"),
      },
      {
        value: "2027-05-01",
        legacyValue: "05/01",
        chainKey: "2027-05-01",
        isoDate: "2027-05-01",
        label: "05/01/2027",
        dte: 372,
        actualDate: new Date("2027-05-01T00:00:00Z"),
      },
    ],
    rowsByExpiration: {
      "2026-05-01": [buildRow(115)],
      "2027-05-01": [buildRow(120)],
    },
    loadingExpirations: [],
    loadedExpirationCount: 2,
    totalExpirationCount: 2,
    updatedAt: 1000,
    status: "live",
  });

  const isoResolved = resolveTradeOptionChainSnapshot(
    getTradeOptionChainSnapshot(ticker),
    "2027-05-01",
  );
  const legacyResolved = resolveTradeOptionChainSnapshot(
    getTradeOptionChainSnapshot(ticker),
    "05/01",
  );

  assert.equal(isoResolved.resolvedExpirationKey, "2027-05-01");
  assert.equal(isoResolved.chainRows[0].k, 120);
  assert.equal(legacyResolved.resolvedExpirationKey, "2026-05-01");
  assert.equal(legacyResolved.chainRows[0].k, 115);
});

test("tradeOptionChainStore exposes empty and failed expiration status without rows", () => {
  const ticker = "CHAINKEY4";
  publishTradeOptionChainSnapshot(ticker, {
    expirationOptions: [
      {
        value: "05/08",
        chainKey: "2026-05-08",
        isoDate: "2026-05-08",
        label: "05/08",
        dte: 14,
        actualDate: new Date("2026-05-08T00:00:00Z"),
      },
      {
        value: "05/15",
        chainKey: "2026-05-15",
        isoDate: "2026-05-15",
        label: "05/15",
        dte: 21,
        actualDate: new Date("2026-05-15T00:00:00Z"),
      },
    ],
    rowsByExpiration: {},
    loadingExpirations: [],
    statusByExpiration: {
      "2026-05-08": "empty",
      "2026-05-15": "failed",
    },
    loadedExpirationCount: 0,
    completedExpirationCount: 2,
    emptyExpirationCount: 1,
    failedExpirationCount: 1,
    totalExpirationCount: 2,
    updatedAt: 1000,
    status: "offline",
  });

  const emptyResolved = resolveTradeOptionChainSnapshot(
    getTradeOptionChainSnapshot(ticker),
    "05/08",
  );
  const failedResolved = resolveTradeOptionChainSnapshot(
    getTradeOptionChainSnapshot(ticker),
    "05/15",
  );

  assert.equal(emptyResolved.resolvedExpirationStatus, "empty");
  assert.equal(emptyResolved.isResolvedExpirationLoading, false);
  assert.equal(emptyResolved.completedExpirationCount, 2);
  assert.equal(emptyResolved.emptyExpirationCount, 1);
  assert.equal(emptyResolved.failedExpirationCount, 1);
  assert.equal(failedResolved.resolvedExpirationStatus, "failed");
  assert.deepEqual(failedResolved.chainRows, []);
});

test("tradeOptionChainStore tracks stale and refreshing expiration rows", () => {
  const ticker = "CHAINKEY5";
  publishTradeOptionChainSnapshot(ticker, {
    expirationOptions: [
      {
        value: "05/22",
        chainKey: "2026-05-22",
        isoDate: "2026-05-22",
        label: "05/22",
        dte: 28,
        actualDate: new Date("2026-05-22T00:00:00Z"),
      },
    ],
    rowsByExpiration: {
      "2026-05-22": [buildRow(120)],
    },
    loadingExpirations: [],
    refreshingExpirations: ["2026-05-22"],
    staleExpirations: ["2026-05-22"],
    statusByExpiration: {
      "2026-05-22": "loaded",
    },
    loadedExpirationCount: 1,
    completedExpirationCount: 1,
    totalExpirationCount: 1,
    updatedAt: 1000,
    status: "live",
  });

  const resolved = resolveTradeOptionChainSnapshot(
    getTradeOptionChainSnapshot(ticker),
    "05/22",
  );

  assert.equal(resolved.chainRows[0].k, 120);
  assert.equal(resolved.resolvedExpirationStatus, "loaded");
  assert.equal(resolved.isResolvedExpirationLoading, false);
  assert.equal(resolved.isResolvedExpirationRefreshing, true);
  assert.equal(resolved.isResolvedExpirationStale, true);
});

test("tradeOptionChainStore caps unused ticker snapshots", () => {
  resetTradeOptionChainStoreForTests();

  for (
    let index = 0;
    index < TRADE_OPTION_CHAIN_STORE_ENTRY_CAP + 4;
    index += 1
  ) {
    const ticker = `CAP${index}`;
    publishTradeOptionChainSnapshot(ticker, {
      expirationOptions: [],
      rowsByExpiration: {},
      loadingExpirations: [],
      loadedExpirationCount: 0,
      totalExpirationCount: 0,
      updatedAt: 1000 + index,
      status: "empty",
    });
  }

  assert.equal(
    getTradeOptionChainStoreEntryCount(),
    TRADE_OPTION_CHAIN_STORE_ENTRY_CAP,
  );
});

test("tradeOptionChainStore clears unused snapshots without allocating reads", () => {
  resetTradeOptionChainStoreForTests();

  publishTradeOptionChainSnapshot("CLEARME", {
    expirationOptions: [],
    rowsByExpiration: {},
    loadingExpirations: [],
    loadedExpirationCount: 0,
    totalExpirationCount: 0,
    updatedAt: 1000,
    status: "live",
  });
  assert.equal(getTradeOptionChainStoreEntryCount(), 1);

  clearTradeOptionChainSnapshot("CLEARME");

  assert.equal(getTradeOptionChainStoreEntryCount(), 0);
});
