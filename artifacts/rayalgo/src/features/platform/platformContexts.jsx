import { createContext, useContext } from "react";

export const ThemeContext = createContext({ theme: "dark", toggle: () => {} });

export const ToastContext = createContext({ push: () => {}, toasts: [] });
export const useToast = () => useContext(ToastContext);

export const PositionsContext = createContext({
  positions: [],
  addPosition: () => {},
  closePosition: () => {},
  closeAll: () => {},
  updateStops: () => {},
  rollPosition: () => {},
});
export const usePositions = () => useContext(PositionsContext);

export const AccountSelectionContext = createContext({
  accounts: [],
  selectedAccountId: null,
  setSelectedAccountId: () => {},
});
export const useAccountSelection = () => useContext(AccountSelectionContext);
