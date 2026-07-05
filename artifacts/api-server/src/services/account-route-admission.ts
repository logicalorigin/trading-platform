import { SHADOW_ACCOUNT_ID } from "./shadow-account";

const normalizeAccountId = (accountId: unknown): string =>
  String(accountId ?? "").trim();

export const isShadowAccountRoute = (accountId: unknown): boolean =>
  normalizeAccountId(accountId).toLowerCase() === SHADOW_ACCOUNT_ID;

export function shouldAdmitAccountRoute({
  accountId,
  ibkrConfigured,
  snapTradeAccountsPresent = false,
}: {
  accountId?: unknown;
  ibkrConfigured: boolean;
  snapTradeAccountsPresent?: boolean;
}): boolean {
  if (isShadowAccountRoute(accountId)) {
    return true;
  }
  return Boolean(ibkrConfigured) || Boolean(snapTradeAccountsPresent);
}

export function buildRealAccountUnavailableProblem() {
  return {
    type: "https://pyrus.local/problems/ibkr-not-configured",
    title: "IBKR is not configured",
    status: 503,
    detail:
      "Real account data requires a configured IBKR Client Portal connection. Shadow account data remains available.",
    code: "ibkr_not_configured",
  };
}
