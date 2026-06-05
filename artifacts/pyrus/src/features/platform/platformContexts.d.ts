import type { Context } from "react";

export type ToastKind =
  | "success"
  | "error"
  | "warn"
  | "warning"
  | "info"
  | "algo";

export type ToastInput = {
  title: string;
  body?: string;
  kind?: ToastKind;
  duration?: number;
};

export type ToastItem = ToastInput & {
  id: number;
  leaving?: boolean;
};

export type ToastContextValue = {
  push: (toast: ToastInput) => void;
  toasts: ToastItem[];
};

export const ToastContext: Context<ToastContextValue>;
export const useToast: () => ToastContextValue;

export type AccountSelectionContextValue = {
  accounts: unknown[];
  selectedAccountId: string | null;
  setSelectedAccountId: (accountId: string | null) => void;
};

export const AccountSelectionContext: Context<AccountSelectionContextValue>;
export const useAccountSelection: () => AccountSelectionContextValue;
