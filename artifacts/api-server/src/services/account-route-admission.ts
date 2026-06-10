import { SHADOW_ACCOUNT_ID } from "./shadow-account";

const normalizeAccountId = (accountId: unknown): string =>
  String(accountId ?? "").trim();

export const isShadowAccountRoute = (accountId: unknown): boolean =>
  normalizeAccountId(accountId).toLowerCase() === SHADOW_ACCOUNT_ID;

export function shouldAdmitAccountRoute({
  accountId,
  ibkrConfigured,
}: {
  accountId?: unknown;
  ibkrConfigured: boolean;
}): boolean {
  if (isShadowAccountRoute(accountId)) {
    return true;
  }
  return Boolean(ibkrConfigured);
}

export function buildRealAccountUnavailableProblem() {
  return {
    type: "https://pyrus.local/problems/ibkr-not-configured",
    title: "IBKR is not configured",
    status: 503,
    detail:
      "Real account data requires a configured IBKR bridge. Shadow account data remains available.",
    code: "ibkr_not_configured",
  };
}
