import { HttpError } from "../lib/errors";
import { getIbkrRuntimeConfig, type IbkrRuntimeConfig } from "../lib/runtime";
import { IbkrClient } from "../providers/ibkr/client";

import { getIbkrPortalUserId } from "./ibkr-portal-context";
import { getGateway } from "./ibkr-portal-gateway-manager";

// If the current request is acting as an app user who has a hosted Client Portal
// gateway connected, route IBKR calls to that user's gateway. Otherwise fall
// back to the global env-configured IBKR runtime (unchanged behaviour, incl.
// all background work which has no per-user request context).
function activePortalConfig(): IbkrRuntimeConfig | null {
  const appUserId = getIbkrPortalUserId();
  if (!appUserId) return null;
  const gateway = getGateway(appUserId);
  if (!gateway || gateway.status !== "ready") return null;
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
  };
}

export function isIbkrClientPortalConfigured(): boolean {
  return Boolean(activePortalConfig() ?? getIbkrRuntimeConfig());
}

export function getIbkrClientPortalClient(): IbkrClient {
  const config = activePortalConfig() ?? getIbkrRuntimeConfig();
  if (!config) {
    throw new HttpError(503, "IBKR Client Portal is not configured.", {
      code: "ibkr_client_portal_not_configured",
      detail:
        "Set IBKR_CLIENT_PORTAL_BASE_URL or IBKR_BASE_URL for the app-owned broker runtime.",
      expose: true,
    });
  }

  return new IbkrClient(config);
}
