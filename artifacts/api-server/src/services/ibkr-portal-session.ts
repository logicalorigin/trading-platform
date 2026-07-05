import type { IbkrRuntimeConfig } from "../lib/runtime";
import { IbkrClient } from "../providers/ibkr/client";

import {
  ensureGateway,
  getGateway,
  isPortalRuntimeAvailable,
  stopGateway,
} from "./ibkr-portal-gateway-manager";

// Orchestrates the browser-login IBKR Client Portal session on top of the
// per-user gateway pool. The gateway holds the authenticated session after the
// user logs in through the proxied login page; here we read status and keep the
// session alive with periodic tickles. Trading + account only (no market-data
// websocket).

const LOGIN_PATH = "/api/broker-execution/ibkr-portal/gateway/";
const TICKLE_INTERVAL_MS = 55_000;

export type PortalConnectionStatus =
  | "unavailable"
  | "disconnected"
  | "gateway_starting"
  | "needs_login"
  | "competing"
  | "connected";

export type PortalReadiness = {
  status: PortalConnectionStatus;
  gatewayRunning: boolean;
  authenticated: boolean;
  selectedAccountId: string | null;
  accounts: string[];
  loginPath: string | null;
  message: string;
};

const tickers = new Map<string, NodeJS.Timeout>();

function clientFor(baseUrl: string): IbkrClient {
  const config: IbkrRuntimeConfig = {
    baseUrl,
    bearerToken: null,
    cookie: null,
    defaultAccountId: null,
    extOperator: null,
    extraHeaders: {},
    username: null,
    password: null,
    allowInsecureTls: true,
  };
  return new IbkrClient(config);
}

function startTickle(appUserId: string, baseUrl: string): void {
  if (tickers.has(appUserId)) {
    return;
  }
  const timer = setInterval(() => {
    void clientFor(baseUrl)
      .tickleSession()
      .catch(() => undefined);
  }, TICKLE_INTERVAL_MS);
  timer.unref?.();
  tickers.set(appUserId, timer);
}

function stopTickle(appUserId: string): void {
  const timer = tickers.get(appUserId);
  if (timer) {
    clearInterval(timer);
    tickers.delete(appUserId);
  }
}

function base(overrides: Partial<PortalReadiness>): PortalReadiness {
  return {
    status: "disconnected",
    gatewayRunning: false,
    authenticated: false,
    selectedAccountId: null,
    accounts: [],
    loginPath: null,
    message: "",
    ...overrides,
  };
}

export async function readPortalReadiness(
  appUserId: string,
): Promise<PortalReadiness> {
  if (!isPortalRuntimeAvailable()) {
    return base({
      status: "unavailable",
      message:
        "The IBKR Client Portal runtime is not installed on this instance.",
    });
  }

  const gateway = getGateway(appUserId);
  if (!gateway) {
    return base({
      status: "disconnected",
      message: "Not connected. Start a connection to log in to IBKR.",
    });
  }

  if (gateway.status === "starting") {
    return base({
      status: "gateway_starting",
      gatewayRunning: true,
      loginPath: LOGIN_PATH,
      message: "Starting the IBKR gateway…",
    });
  }

  try {
    const status = await clientFor(gateway.baseUrl).ensureBrokerageSession();
    if (status.competing) {
      return base({
        status: "competing",
        gatewayRunning: true,
        loginPath: LOGIN_PATH,
        message:
          "Another live IBKR session is competing. Re-login to take over this session.",
      });
    }
    if (status.authenticated) {
      startTickle(appUserId, gateway.baseUrl);
      return base({
        status: "connected",
        gatewayRunning: true,
        authenticated: true,
        selectedAccountId: status.selectedAccountId,
        accounts: status.accounts,
        message: "Connected to IBKR.",
      });
    }
    return base({
      status: "needs_login",
      gatewayRunning: true,
      loginPath: LOGIN_PATH,
      message: "Gateway is running. Log in to IBKR to finish connecting.",
    });
  } catch {
    return base({
      status: "needs_login",
      gatewayRunning: true,
      loginPath: LOGIN_PATH,
      message: "Gateway is running. Log in to IBKR to finish connecting.",
    });
  }
}

export async function connectPortal(
  appUserId: string,
): Promise<{ loginPath: string; status: PortalConnectionStatus }> {
  await ensureGateway(appUserId);
  const readiness = await readPortalReadiness(appUserId);
  return {
    loginPath: readiness.loginPath ?? LOGIN_PATH,
    status: readiness.status,
  };
}

export async function getPortalStatus(
  appUserId: string,
): Promise<PortalReadiness> {
  return readPortalReadiness(appUserId);
}

export async function disconnectPortal(
  appUserId: string,
): Promise<{ ok: true }> {
  stopTickle(appUserId);
  await stopGateway(appUserId);
  return { ok: true };
}
