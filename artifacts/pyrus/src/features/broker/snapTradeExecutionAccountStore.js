import { useEffect, useState } from "react";

export const SNAPTRADE_EXECUTION_ACCOUNT_STORAGE_KEY =
  "pyrus:snaptrade-execution-account:v1";
export const SNAPTRADE_EXECUTION_ACCOUNT_EVENT =
  "pyrus:snaptrade-execution-account";

function getStorage() {
  if (typeof window !== "undefined" && window.localStorage) {
    return window.localStorage;
  }
  if (typeof globalThis !== "undefined" && globalThis.localStorage) {
    return globalThis.localStorage;
  }
  return null;
}

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function readString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readStringArray(value) {
  return Array.isArray(value)
    ? value.map(readString).filter(Boolean)
    : [];
}

export function normalizeSnapTradeExecutionAccount(account) {
  const record = asRecord(account);
  const id = readString(record.id);
  if (!id) return null;

  return {
    id,
    connectionId: readString(record.connectionId),
    snapTradeAccountId: readString(record.snapTradeAccountId),
    displayName: readString(record.displayName) || "SnapTrade account",
    brokerageName: readString(record.brokerageName),
    baseCurrency: readString(record.baseCurrency) || "USD",
    executionReady: record.executionReady === true,
    executionBlockers: readStringArray(record.executionBlockers),
    lastSyncedAt: readString(record.lastSyncedAt),
  };
}

export function chooseSnapTradeExecutionAccount(accounts, selectedAccountId = "") {
  const normalizedAccounts = (Array.isArray(accounts) ? accounts : [])
    .map(normalizeSnapTradeExecutionAccount)
    .filter(Boolean);
  const selectedId = readString(selectedAccountId);
  const selectedReadyAccount =
    normalizedAccounts.find(
      (account) => account.executionReady && account.id === selectedId,
    ) || null;
  const fallbackReadyAccount =
    normalizedAccounts.find((account) => account.executionReady) || null;

  return {
    accounts: normalizedAccounts,
    selectedAccount: selectedReadyAccount || fallbackReadyAccount,
    executionReadyCount: normalizedAccounts.filter(
      (account) => account.executionReady,
    ).length,
  };
}

export function buildSnapTradeExecutionAccountState({
  accounts,
  selectedAccountId = "",
  savedAt = new Date().toISOString(),
} = {}) {
  const selection = chooseSnapTradeExecutionAccount(accounts, selectedAccountId);
  return {
    provider: "snaptrade",
    savedAt,
    accounts: selection.accounts,
    selectedAccount: selection.selectedAccount,
    executionReadyCount: selection.executionReadyCount,
  };
}

export function writeSnapTradeExecutionAccountState(input = {}) {
  const state = buildSnapTradeExecutionAccountState(input);
  const storage = getStorage();
  if (storage) {
    storage.setItem(
      SNAPTRADE_EXECUTION_ACCOUNT_STORAGE_KEY,
      JSON.stringify(state),
    );
  }
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    window.dispatchEvent(
      new CustomEvent(SNAPTRADE_EXECUTION_ACCOUNT_EVENT, { detail: state }),
    );
  }
  return state;
}

export function readSnapTradeExecutionAccountState() {
  const storage = getStorage();
  if (!storage) {
    return buildSnapTradeExecutionAccountState();
  }
  try {
    const raw = storage.getItem(SNAPTRADE_EXECUTION_ACCOUNT_STORAGE_KEY);
    if (!raw) {
      return buildSnapTradeExecutionAccountState();
    }
    const parsed = asRecord(JSON.parse(raw));
    return buildSnapTradeExecutionAccountState({
      accounts: parsed.accounts,
      selectedAccountId: asRecord(parsed.selectedAccount).id,
      savedAt: readString(parsed.savedAt) || new Date().toISOString(),
    });
  } catch {
    return buildSnapTradeExecutionAccountState();
  }
}

export function useSnapTradeExecutionAccountState() {
  const [state, setState] = useState(readSnapTradeExecutionAccountState);

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    const refresh = () => setState(readSnapTradeExecutionAccountState());
    window.addEventListener(SNAPTRADE_EXECUTION_ACCOUNT_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(SNAPTRADE_EXECUTION_ACCOUNT_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  return state;
}
