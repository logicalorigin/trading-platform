import { useMemo } from "react";
import {
  AccountSelectionContext,
  MarketDataProviderConfigurationContext,
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
  marketDataProviderConfiguration,
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
  const marketDataProviderConfigurationValue = useMemo(
    () => ({
      massiveStockRealtimeConfigured: Boolean(
        marketDataProviderConfiguration?.massiveStockRealtimeConfigured,
      ),
      marketDataProviderConfigurationReady: Boolean(
        marketDataProviderConfiguration?.marketDataProviderConfigurationReady,
      ),
    }),
    [
      marketDataProviderConfiguration?.massiveStockRealtimeConfigured,
      marketDataProviderConfiguration?.marketDataProviderConfigurationReady,
    ],
  );

  return (
    <ThemeContext.Provider value={themeValue}>
      <ToastContext.Provider value={toastValue}>
        <PositionsContext.Provider value={positionsValue}>
          <AccountSelectionContext.Provider value={accountSelectionValue}>
            <MarketDataProviderConfigurationContext.Provider
              value={marketDataProviderConfigurationValue}
            >
              {children}
            </MarketDataProviderConfigurationContext.Provider>
          </AccountSelectionContext.Provider>
        </PositionsContext.Provider>
      </ToastContext.Provider>
    </ThemeContext.Provider>
  );
};
