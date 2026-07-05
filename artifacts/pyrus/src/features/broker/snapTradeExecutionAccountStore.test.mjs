import assert from "node:assert/strict";
import test from "node:test";

import {
  SNAPTRADE_EXECUTION_ACCOUNT_STORAGE_KEY,
  buildSnapTradeExecutionAccountState,
  chooseSnapTradeExecutionAccount,
  readSnapTradeExecutionAccountState,
  writeSnapTradeExecutionAccountState,
} from "./snapTradeExecutionAccountStore.js";

function installStorage() {
  const data = new Map();
  globalThis.localStorage = {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
    clear: () => data.clear(),
  };
  return data;
}

test("chooseSnapTradeExecutionAccount keeps the selected ready account", () => {
  const result = chooseSnapTradeExecutionAccount(
    [
      {
        id: "acct-blocked",
        displayName: "Read only",
        executionReady: false,
        executionBlockers: ["snaptrade.connection.read_only"],
      },
      {
        id: "acct-ready",
        displayName: "Main IBKR",
        executionReady: true,
        executionBlockers: [],
      },
    ],
    "acct-ready",
  );

  assert.equal(result.selectedAccount.id, "acct-ready");
  assert.equal(result.executionReadyCount, 1);
});

test("chooseSnapTradeExecutionAccount falls back to the first execution-ready account", () => {
  const result = chooseSnapTradeExecutionAccount(
    [
      {
        id: "acct-blocked",
        displayName: "Read only",
        executionReady: false,
        executionBlockers: ["snaptrade.connection.read_only"],
      },
      {
        id: "acct-ready",
        displayName: "Main IBKR",
        executionReady: true,
        executionBlockers: [],
      },
    ],
    "acct-blocked",
  );

  assert.equal(result.selectedAccount.id, "acct-ready");
});

test("buildSnapTradeExecutionAccountState does not select blocked accounts", () => {
  const state = buildSnapTradeExecutionAccountState({
    accounts: [
      {
        id: "acct-blocked",
        displayName: "Read only",
        executionReady: false,
        executionBlockers: ["snaptrade.connection.read_only"],
      },
    ],
    selectedAccountId: "acct-blocked",
    savedAt: "2026-07-01T22:00:00.000Z",
  });

  assert.equal(state.selectedAccount, null);
  assert.equal(state.executionReadyCount, 0);
});

test("writeSnapTradeExecutionAccountState persists normalized execution account state", () => {
  const storage = installStorage();

  writeSnapTradeExecutionAccountState({
    accounts: [
      {
        id: "acct-ready",
        connectionId: "conn-1",
        snapTradeAccountId: "upstream-1",
        displayName: "Main IBKR",
        brokerageName: "Interactive Brokers",
        baseCurrency: "USD",
        executionReady: true,
        executionBlockers: [],
        lastSyncedAt: "2026-07-01T21:59:00.000Z",
      },
    ],
    selectedAccountId: "acct-ready",
    savedAt: "2026-07-01T22:00:00.000Z",
  });

  assert.ok(storage.has(SNAPTRADE_EXECUTION_ACCOUNT_STORAGE_KEY));
  const state = readSnapTradeExecutionAccountState();
  assert.equal(state.selectedAccount.id, "acct-ready");
  assert.equal(state.selectedAccount.snapTradeAccountId, "upstream-1");
  assert.equal(state.savedAt, "2026-07-01T22:00:00.000Z");
});
