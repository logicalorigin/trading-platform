import { currentShadowAccountId } from "./shadow-account-context";

export type ShadowAccountChangeReason = "ledger" | "mark_refresh";

export type ShadowAccountChange = {
  reason: ShadowAccountChangeReason;
  accountId: string;
  ledgerGeneration: number;
};

type ShadowAccountChangeListener = (change: ShadowAccountChange) => void;

const shadowAccountChangeListeners = new Map<
  ShadowAccountChangeListener,
  string
>();
const shadowAccountLedgerGenerations = new Map<string, number>();
const shadowAccountSnapshotGenerations = new Map<string, number>();

export function getShadowAccountLedgerGeneration(
  accountId = currentShadowAccountId(),
) {
  return shadowAccountLedgerGenerations.get(accountId) ?? 0;
}

export function advanceShadowAccountLedgerGeneration(
  accountId = currentShadowAccountId(),
) {
  const generation = getShadowAccountLedgerGeneration(accountId) + 1;
  shadowAccountLedgerGenerations.set(accountId, generation);
  return generation;
}

export function getShadowAccountSnapshotGeneration(
  accountId = currentShadowAccountId(),
) {
  return shadowAccountSnapshotGenerations.get(accountId) ?? 0;
}

function advanceShadowAccountSnapshotGeneration(accountId: string) {
  const generation = getShadowAccountSnapshotGeneration(accountId) + 1;
  shadowAccountSnapshotGenerations.set(accountId, generation);
  return generation;
}

export function subscribeShadowAccountChanges(
  listener: ShadowAccountChangeListener,
  accountId = currentShadowAccountId(),
) {
  shadowAccountChangeListeners.set(listener, accountId);
  return () => {
    shadowAccountChangeListeners.delete(listener);
  };
}

export function notifyShadowAccountChanged(
  change: {
    reason: ShadowAccountChangeReason;
    accountId?: string;
  } = { reason: "ledger" },
) {
  const accountId = change.accountId ?? currentShadowAccountId();
  advanceShadowAccountSnapshotGeneration(accountId);
  const ledgerGeneration =
    change.reason === "ledger"
      ? advanceShadowAccountLedgerGeneration(accountId)
      : getShadowAccountLedgerGeneration(accountId);
  const event = {
    reason: change.reason,
    accountId,
    ledgerGeneration,
  };
  shadowAccountChangeListeners.forEach((listenerAccountId, listener) => {
    if (listenerAccountId === accountId) {
      listener(event);
    }
  });
}
