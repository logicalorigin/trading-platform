const PAPER_ACCOUNT_ID = /^DU[0-9]+$/i;

export function isIbkrPaperAccountId(accountId: string): boolean {
  return PAPER_ACCOUNT_ID.test(accountId.trim());
}

export function areVerifiedIbkrPaperAccounts(
  accountIds: readonly string[],
): boolean {
  return (
    accountIds.length > 0 && accountIds.every(isIbkrPaperAccountId)
  );
}
