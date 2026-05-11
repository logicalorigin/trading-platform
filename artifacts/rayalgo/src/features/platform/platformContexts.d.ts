import type { Context } from "react";

export type AccountSelectionContextValue = {
  accounts: unknown[];
  selectedAccountId: string | null;
  setSelectedAccountId: (accountId: string | null) => void;
};

export const AccountSelectionContext: Context<AccountSelectionContextValue>;
export const useAccountSelection: () => AccountSelectionContextValue;
