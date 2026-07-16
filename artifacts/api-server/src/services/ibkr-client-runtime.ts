import { HttpError } from "../lib/errors";
import { getIbkrRuntimeConfig, type IbkrRuntimeConfig } from "../lib/runtime";
import { IbkrClient } from "../providers/ibkr/client";

import { getIbkrPortalUserId } from "./ibkr-portal-context";
import {
  getGateway,
  prepareGatewayClientRequest,
} from "./ibkr-portal-gateway-manager";

export type IbkrClientPortalGatewaySnapshot = Readonly<{
  appUserId: string;
  baseUrl: string;
  hosted: boolean;
  loginCompletions: number;
  startedAt: number;
}>;

export function getIbkrClientPortalGatewaySnapshot(): IbkrClientPortalGatewaySnapshot | null {
  const appUserId = getIbkrPortalUserId();
  if (!appUserId) return null;
  const gateway = getGateway(appUserId);
  if (
    !gateway ||
    gateway.status !== "ready" ||
    !gateway.paperAccountVerified
  ) {
    return null;
  }
  return {
    appUserId,
    baseUrl: gateway.baseUrl,
    hosted: gateway.hosted,
    loginCompletions: gateway.loginCompletions,
    startedAt: gateway.startedAt,
  };
}

export function assertIbkrClientPortalGatewaySnapshot(
  expected?: IbkrClientPortalGatewaySnapshot,
): IbkrClientPortalGatewaySnapshot {
  const current = getIbkrClientPortalGatewaySnapshot();
  if (!current) {
    throw new HttpError(503, "IBKR Client Portal is not configured.", {
      code: "ibkr_client_portal_not_configured",
      expose: true,
    });
  }
  if (
    expected &&
    (expected.appUserId !== current.appUserId ||
      expected.baseUrl !== current.baseUrl ||
      expected.hosted !== current.hosted ||
      expected.loginCompletions !== current.loginCompletions ||
      expected.startedAt !== current.startedAt)
  ) {
    throw new HttpError(409, "The IBKR Client Portal gateway changed.", {
      code: "ibkr_client_portal_gateway_changed",
      expose: true,
    });
  }
  return current;
}

// An authenticated per-user context always owns routing for that request.
// Returning null when its gateway is absent or unverified prevents a fallback
// to a separately configured global IBKR account. "Verified" means the gateway
// reported an authenticated session (any account type — user decision
// 2026-07-10: the Client Portal connection is not paper-only).
function resolveClientPortalConfig(): IbkrRuntimeConfig | null {
  const appUserId = getIbkrPortalUserId();
  if (appUserId) {
    const gateway = getIbkrClientPortalGatewaySnapshot();
    if (!gateway) return null;
    return {
      baseUrl: gateway.baseUrl,
      bearerToken: null,
      cookie: null,
      defaultAccountId: null,
      extOperator: null,
      extraHeaders: {},
      username: null,
      password: null,
      allowInsecureTls: true,
      paperAccountOnly: false,
    };
  }
  return getIbkrRuntimeConfig();
}

export function isIbkrClientPortalConfigured(): boolean {
  return Boolean(resolveClientPortalConfig());
}

export function getIbkrClientPortalClient(): IbkrClient {
  const config = resolveClientPortalConfig();
  if (!config) {
    throw new HttpError(503, "IBKR Client Portal is not configured.", {
      code: "ibkr_client_portal_not_configured",
      detail:
        "Set IBKR_CLIENT_PORTAL_BASE_URL or IBKR_BASE_URL for the app-owned broker runtime.",
      expose: true,
    });
  }

  const appUserId = getIbkrPortalUserId();
  return new IbkrClient(
    config,
    appUserId
      ? {
          prepareRequest: (request) =>
            prepareGatewayClientRequest(appUserId, request),
        }
      : {},
  );
}
