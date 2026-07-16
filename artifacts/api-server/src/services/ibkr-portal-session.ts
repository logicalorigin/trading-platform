import { appendFile } from "node:fs";
import path from "node:path";

import type { IbkrRuntimeConfig } from "../lib/runtime";
import { HttpError } from "../lib/errors";
import {
  IbkrClient,
  type BrokerageSessionFailure,
  type BrokerageSessionStage,
} from "../providers/ibkr/client";
import { findRepoRoot } from "./runtime-flight-recorder";

import {
  ensureGateway,
  isPortalRuntimeAvailable,
  prepareGatewayClientRequest,
  refreshGateway,
  stopGateway,
  transitionGatewayLifecycle,
} from "./ibkr-portal-gateway-manager";
import { revokeIbkrPortalEmbedSessions } from "./ibkr-portal-embed-session";

// Orchestrates the browser-login IBKR Client Portal session on top of the
// per-user gateway pool. The gateway holds the authenticated session after the
// user logs in through the proxied login page; here we read status and keep the
// session alive with periodic tickles. Trading + account only (no market-data
// websocket).

export const IBKR_PORTAL_CLIENT_MOUNT =
  "/api/broker-execution/ibkr-portal/client";
const TICKLE_INTERVAL_MS = 55_000;
const LOGIN_MONITOR_INTERVAL_MS = 3_000;
const LOGIN_MONITOR_TTL_MS = 6 * 60_000;
// ponytail: the pinned CPG retries its gateway-owned brokerage authentication
// up to five times at 3s intervals after the Dispatcher marker. This fixed
// window leaves that stateful handshake undisturbed; replace it when CPG
// exposes a structured authenticated callback.
const POST_DISPATCH_READINESS_QUIET_MS = 20_000;

// Readiness-refresh failures land on the same JSONL timeline as the login
// proxy requests (.pyrus-runtime/ibkr-portal-proxy-trail.jsonl); a swallowed
// status error here previously left a completed login looking like a silent
// "needs_login" dead-end with no diagnosable trace.
const READINESS_TRAIL_PATH = path.join(
  findRepoRoot(),
  ".pyrus-runtime",
  "ibkr-portal-proxy-trail.jsonl",
);
function traceReadinessFailure(
  failure: BrokerageSessionFailure,
  stage?: BrokerageSessionStage,
): void {
  appendFile(
    READINESS_TRAIL_PATH,
    JSON.stringify({
      ts: new Date().toISOString(),
      source: "readiness",
      outcome: "status-error",
      code: failure.code,
      httpStatus: failure.httpStatus,
      stage,
    }) + "\n",
    () => undefined,
  );
}

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
  browserLoginComplete: boolean;
  established: boolean | null;
  isPaper: boolean | null;
  selectedAccountId: string | null;
  accounts: string[];
  executionTargets: PortalExecutionTarget[];
  loginPath: string | null;
  message: string;
};

export type PortalExecutionTarget = {
  accountId: string;
  maskedAccountId: string;
  selected: boolean;
};

export function buildPortalExecutionTargets(
  accounts: string[],
  selectedAccountId: string | null,
): PortalExecutionTarget[] {
  return Array.from(
    new Set(
      [...accounts, ...(selectedAccountId ? [selectedAccountId] : [])]
        .map((accountId) => accountId.trim())
        .filter(Boolean),
    ),
  ).map((accountId) => ({
    accountId,
    maskedAccountId: `••••${accountId.slice(-4)}`,
    selected: accountId === selectedAccountId,
  }));
}

const tickers = new Map<string, NodeJS.Timeout>();
const loginMonitors = new Map<
  string,
  { generation: symbol; timer: NodeJS.Timeout }
>();
const readinessQuietWindows = new Map<string, NodeJS.Timeout>();
const observedLoginCompletions = new Map<string, number>();
const completedLoginAttempts = new Set<string>();

function clearPortalReadinessQuietWindow(appUserId: string): void {
  const timer = readinessQuietWindows.get(appUserId);
  if (timer) clearTimeout(timer);
  readinessQuietWindows.delete(appUserId);
}

export function __expirePortalReadinessQuietWindowForTests(
  appUserId: string,
): void {
  clearPortalReadinessQuietWindow(appUserId);
  stopLoginMonitor(appUserId);
}

function setPortalReadinessQuietWindow(
  appUserId: string,
  durationMs: number,
): void {
  clearPortalReadinessQuietWindow(appUserId);
  const timer = setTimeout(() => {
    if (readinessQuietWindows.get(appUserId) === timer) {
      readinessQuietWindows.delete(appUserId);
    }
  }, durationMs);
  timer.unref?.();
  readinessQuietWindows.set(appUserId, timer);
}

export function beginPortalReadinessQuietWindow(appUserId: string): void {
  setPortalReadinessQuietWindow(appUserId, POST_DISPATCH_READINESS_QUIET_MS);
}

function observePortalLoginCompletions(
  appUserId: string,
  loginCompletions: number,
): { firstObservation: boolean; browserLoginComplete: boolean } {
  const observed = observedLoginCompletions.get(appUserId);
  if (observed === undefined) {
    observedLoginCompletions.set(appUserId, loginCompletions);
    if (loginCompletions > 0) {
      completedLoginAttempts.add(appUserId);
      beginPortalReadinessQuietWindow(appUserId);
    }
    return {
      firstObservation: true,
      browserLoginComplete: completedLoginAttempts.has(appUserId),
    };
  }
  if (loginCompletions < observed) {
    observedLoginCompletions.set(appUserId, loginCompletions);
    completedLoginAttempts.delete(appUserId);
    return { firstObservation: false, browserLoginComplete: false };
  }
  if (loginCompletions > observed) {
    observedLoginCompletions.set(appUserId, loginCompletions);
    completedLoginAttempts.add(appUserId);
    beginPortalReadinessQuietWindow(appUserId);
  }
  return {
    firstObservation: false,
    browserLoginComplete: completedLoginAttempts.has(appUserId),
  };
}

function clientFor(
  appUserId: string,
  baseUrl: string,
  onBrokerageSessionError?: (
    stage: BrokerageSessionStage,
    failure: BrokerageSessionFailure,
  ) => void,
): IbkrClient {
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
    paperAccountOnly: true,
  };
  return new IbkrClient(config, {
    onBrokerageSessionError,
    prepareRequest: (request) =>
      prepareGatewayClientRequest(appUserId, request),
  });
}

function startTickle(appUserId: string, baseUrl: string): void {
  if (tickers.has(appUserId)) {
    return;
  }
  const timer = setInterval(() => {
    void clientFor(appUserId, baseUrl)
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

function stopLoginMonitor(appUserId: string, generation?: symbol): boolean {
  const monitor = loginMonitors.get(appUserId);
  if (!monitor || (generation && monitor.generation !== generation)) {
    return false;
  }
  clearTimeout(monitor.timer);
  loginMonitors.delete(appUserId);
  return true;
}

function startLoginMonitor(appUserId: string): void {
  stopLoginMonitor(appUserId);
  const generation = Symbol(appUserId);
  const expiresAt = Date.now() + LOGIN_MONITOR_TTL_MS;
  const isCurrent = (): boolean =>
    loginMonitors.get(appUserId)?.generation === generation;
  const schedule = (poll: () => Promise<void>): void => {
    const timer = setTimeout(poll, LOGIN_MONITOR_INTERVAL_MS);
    timer.unref?.();
    loginMonitors.set(appUserId, { generation, timer });
  };
  const poll = async (): Promise<void> => {
    if (!isCurrent()) return;
    if (Date.now() >= expiresAt) {
      if (!stopLoginMonitor(appUserId, generation)) return;
      revokeIbkrPortalEmbedSessions(appUserId);
      await stopGateway(appUserId).catch(() => undefined);
      return;
    }
    let readiness: PortalReadiness;
    try {
      readiness = await readPortalReadiness(appUserId);
    } catch {
      if (isCurrent()) schedule(poll);
      return;
    }
    if (!isCurrent()) return;
    if (
      readiness.status === "connected" ||
      readiness.status === "disconnected" ||
      readiness.status === "unavailable"
    ) {
      stopLoginMonitor(appUserId, generation);
      revokeIbkrPortalEmbedSessions(appUserId);
      return;
    }
    schedule(poll);
  };
  schedule(poll);
}

function base(overrides: Partial<PortalReadiness>): PortalReadiness {
  return {
    status: "disconnected",
    gatewayRunning: false,
    authenticated: false,
    browserLoginComplete: false,
    established: null,
    isPaper: null,
    selectedAccountId: null,
    accounts: [],
    executionTargets: [],
    loginPath: null,
    message: "",
    ...overrides,
  };
}

function needsLoginMessage(
  browserLoginComplete: boolean,
  verificationFailed = false,
): string {
  if (!browserLoginComplete) {
    return "Gateway is running. Log in to IBKR to finish connecting.";
  }
  return verificationFailed
    ? "IBKR browser login completed, but the API session is still unavailable. PYRUS is retrying; this connection is not active."
    : "IBKR browser login completed. Waiting for IBKR's API session; this connection is not active yet.";
}

async function enterPortalVerification(appUserId: string): Promise<boolean> {
  if (await transitionGatewayLifecycle(appUserId, "verifying")) return true;
  await transitionGatewayLifecycle(appUserId, "reauth_required");
  if (!(await transitionGatewayLifecycle(appUserId, "login_required"))) {
    return false;
  }
  return transitionGatewayLifecycle(appUserId, "verifying");
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

  const gateway = await refreshGateway(appUserId);
  if (!gateway) {
    return base({
      status: "disconnected",
      message: "Not connected. Start a connection to log in to IBKR.",
    });
  }

  const loginObservation = observePortalLoginCompletions(
    appUserId,
    gateway.loginCompletions,
  );
  if (loginObservation.firstObservation && gateway.recovered) {
    if (gateway.loginCompletions === 0) {
      setPortalReadinessQuietWindow(appUserId, LOGIN_MONITOR_TTL_MS);
    }
    startLoginMonitor(appUserId);
  }

  if (gateway.status === "starting") {
    return base({
      status: "gateway_starting",
      gatewayRunning: true,
      browserLoginComplete: loginObservation.browserLoginComplete,
      message: "Starting the IBKR gateway…",
    });
  }

  if (readinessQuietWindows.has(appUserId)) {
    await transitionGatewayLifecycle(appUserId, "login_required");
    return base({
      status: "needs_login",
      gatewayRunning: true,
      browserLoginComplete: loginObservation.browserLoginComplete,
      message: needsLoginMessage(loginObservation.browserLoginComplete),
    });
  }

  let stagedFailureTraced = false;
  try {
    if (
      !gateway.paperAccountVerified &&
      !(await enterPortalVerification(appUserId))
    ) {
      throw new HttpError(409, "The IBKR session state changed.", {
        code: "ibkr_gateway_lifecycle_stale",
      });
    }
    const status = await clientFor(appUserId, gateway.baseUrl, (stage, failure) => {
      stagedFailureTraced = true;
      traceReadinessFailure(failure, stage);
    }).ensureBrokerageSession({
      initializeIfNeeded: false,
    });
    stagedFailureTraced = false;
    if (status.competing) {
      await transitionGatewayLifecycle(appUserId, "reauth_required");
      return base({
        status: "competing",
        gatewayRunning: true,
        browserLoginComplete: loginObservation.browserLoginComplete,
        message:
          "Another live IBKR session is competing. Re-login to take over this session.",
      });
    }
    if (status.authenticated) {
      if (!(await transitionGatewayLifecycle(appUserId, "authenticated"))) {
        throw new HttpError(503, "The IBKR session could not be verified.", {
          code: "ibkr_paper_session_verification_failed",
        });
      }
      startTickle(appUserId, gateway.baseUrl);
      return base({
        status: "connected",
        gatewayRunning: true,
        authenticated: true,
        browserLoginComplete: loginObservation.browserLoginComplete,
        established: status.established,
        isPaper: status.isPaper,
        selectedAccountId: status.selectedAccountId,
        accounts: status.accounts,
        executionTargets: buildPortalExecutionTargets(
          status.accounts,
          status.selectedAccountId,
        ),
        message: "Connected to IBKR.",
      });
    }
    await transitionGatewayLifecycle(appUserId, "reauth_required");
    return base({
      status: "needs_login",
      gatewayRunning: true,
      browserLoginComplete: loginObservation.browserLoginComplete,
      message: needsLoginMessage(loginObservation.browserLoginComplete),
    });
  } catch (error) {
    if (!stagedFailureTraced) {
      traceReadinessFailure({
        code: error instanceof HttpError ? error.code : undefined,
        httpStatus: error instanceof HttpError ? error.statusCode : undefined,
      });
    }
    if (
      error instanceof HttpError &&
      error.code === "ibkr_paper_account_required"
    ) {
      await transitionGatewayLifecycle(appUserId, "draining");
      await disconnectPortal(appUserId);
      return base({
        status: "disconnected",
        gatewayRunning: false,
        browserLoginComplete: loginObservation.browserLoginComplete,
        message:
          "Only IBKR Paper Trading accounts are allowed. This connection was closed. Sign in with the separate username assigned to your Paper Trading account.",
      });
    }
    await transitionGatewayLifecycle(appUserId, "degraded");
    return base({
      status: "needs_login",
      gatewayRunning: true,
      browserLoginComplete: loginObservation.browserLoginComplete,
      message: needsLoginMessage(
        loginObservation.browserLoginComplete,
        true,
      ),
    });
  }
}

export async function connectPortal(
  appUserId: string,
): Promise<{ status: PortalConnectionStatus }> {
  const gateway = await ensureGateway(appUserId);
  observedLoginCompletions.set(appUserId, gateway.loginCompletions);
  completedLoginAttempts.delete(appUserId);
  setPortalReadinessQuietWindow(appUserId, LOGIN_MONITOR_TTL_MS);
  const status: PortalConnectionStatus =
    gateway.status === "starting" ? "gateway_starting" : "needs_login";
  // The login surface must not wait on /iserver/auth/status. A fresh CPG can
  // take the full request timeout to answer before the browser has opened its
  // login page. Both monitors stay quiet until exact Dispatcher success replaces
  // this login-length guard with the shorter post-promotion quiet window.
  startLoginMonitor(appUserId);
  return {
    status,
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
  clearPortalReadinessQuietWindow(appUserId);
  observedLoginCompletions.delete(appUserId);
  completedLoginAttempts.delete(appUserId);
  stopLoginMonitor(appUserId);
  stopTickle(appUserId);
  revokeIbkrPortalEmbedSessions(appUserId);
  await stopGateway(appUserId);
  return { ok: true };
}
