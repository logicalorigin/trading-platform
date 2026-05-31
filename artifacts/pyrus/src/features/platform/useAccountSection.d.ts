export type AccountSection = "real" | "shadow";

export const readAccountSection: () => AccountSection;

export const writeAccountSection: (value: AccountSection | string) => void;

export const useAccountSection: () => [
  AccountSection,
  (value: AccountSection | string) => void,
];
