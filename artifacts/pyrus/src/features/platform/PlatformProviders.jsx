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
}) => (
  <ThemeContext.Provider value={{ theme, toggle: onToggleTheme }}>
    <ToastContext.Provider value={toastValue}>
      <PositionsContext.Provider value={positionsValue}>
        <AccountSelectionContext.Provider
          value={{
            accounts,
            selectedAccountId,
            setSelectedAccountId: onSelectAccount,
          }}
        >
          {children}
        </AccountSelectionContext.Provider>
      </PositionsContext.Provider>
    </ToastContext.Provider>
  </ThemeContext.Provider>
);
