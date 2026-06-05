import { useMemo } from "react";
import {
  AccountSelectionContext,
  PositionsContext,
  ThemeContext,
  ToastContext,
} from "./platformContexts.jsx";

export const PlatformProviders = ({
  theme,
  onToggleTheme,
  toastValue,
  positionsValue,
  accounts,
  selectedAccountId,
  onSelectAccount,
  children,
}) => {
  const themeValue = useMemo(
    () => ({ theme, toggle: onToggleTheme }),
    [onToggleTheme, theme],
  );
  const accountSelectionValue = useMemo(
    () => ({
      accounts,
      selectedAccountId,
      setSelectedAccountId: onSelectAccount,
    }),
    [accounts, onSelectAccount, selectedAccountId],
  );

  return (
    <ThemeContext.Provider value={themeValue}>
      <ToastContext.Provider value={toastValue}>
        <PositionsContext.Provider value={positionsValue}>
          <AccountSelectionContext.Provider value={accountSelectionValue}>
            {children}
          </AccountSelectionContext.Provider>
        </PositionsContext.Provider>
      </ToastContext.Provider>
    </ThemeContext.Provider>
  );
};
