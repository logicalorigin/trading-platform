export function normalizeAccountStatus(value) {
  return String(value || "").trim().toLowerCase();
}

export function normalizeAccountAuthState(value) {
  return String(value || "").trim().toLowerCase();
}

export function isConnectedAccount(account) {
  return normalizeAccountStatus(account?.status) === "connected";
}

export function isLiveReadyAccount(account) {
  if (typeof account?.liveReady === "boolean") {
    return account.liveReady;
  }
  const mode = String(account?.mode || "live").trim().toLowerCase();
  return mode === "live"
    && isConnectedAccount(account)
    && normalizeAccountAuthState(account?.authState) === "authenticated";
}

export function isTradingReadyAccount(account) {
  if (typeof account?.tradingReady === "boolean") {
    return account.tradingReady;
  }
  return isLiveReadyAccount(account);
}

export function isMarketDataReadyAccount(account) {
  if (typeof account?.marketDataReady === "boolean") {
    return account.marketDataReady;
  }
  return isTradingReadyAccount(account);
}

export function getAccountConnectionState(account) {
  if (account && typeof account.connectionState === "string" && account.connectionState.trim()) {
    return account.connectionState.trim().toLowerCase();
  }

  const status = normalizeAccountStatus(account?.status);
  const authState = normalizeAccountAuthState(account?.authState);

  if (status === "connecting") {
    return "connecting";
  }
  if (isLiveReadyAccount(account)) {
    return "live";
  }
  if (authState === "needs_refresh" || authState === "needs_token" || authState === "needs_login") {
    return authState;
  }
  if (authState === "configured") {
    return "configured";
  }
  if (authState === "missing_credentials" || authState === "degraded" || authState === "error") {
    return authState;
  }
  if (status === "error") {
    return "error";
  }
  if (status === "connected") {
    return "configured";
  }
  if (status === "disconnected") {
    return "disconnected";
  }
  return authState || status || "disconnected";
}

export function getAccountConnectionLabel(account) {
  if (account && typeof account.connectionLabel === "string" && account.connectionLabel.trim()) {
    return account.connectionLabel.trim();
  }

  switch (getAccountConnectionState(account)) {
    case "live":
      return "Live";
    case "configured":
      return "Configured";
    case "needs_refresh":
      return "Refresh Required";
    case "needs_token":
      return "Needs Token";
    case "subscription_required":
      return "Needs Subscription";
    case "needs_login":
      return "Needs Login";
    case "missing_credentials":
      return "Missing Creds";
    case "degraded":
      return "Degraded";
    case "error":
      return "Error";
    case "connecting":
      return "Connecting";
    default:
      return "Disconnected";
  }
}

export function getAccountTradingState(account) {
  if (account && typeof account.tradingState === "string" && account.tradingState.trim()) {
    return account.tradingState.trim().toLowerCase();
  }
  return getAccountConnectionState(account);
}

export function getAccountTradingLabel(account) {
  if (account && typeof account.tradingLabel === "string" && account.tradingLabel.trim()) {
    return account.tradingLabel.trim();
  }
  return getAccountConnectionLabel(account);
}

export function getAccountMarketDataState(account) {
  if (account && typeof account.marketDataState === "string" && account.marketDataState.trim()) {
    return account.marketDataState.trim().toLowerCase();
  }
  return getAccountTradingState(account);
}

export function getAccountMarketDataLabel(account) {
  if (account && typeof account.marketDataLabel === "string" && account.marketDataLabel.trim()) {
    return account.marketDataLabel.trim();
  }
  return getAccountTradingLabel(account);
}
