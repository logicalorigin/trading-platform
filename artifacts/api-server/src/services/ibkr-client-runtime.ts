import { HttpError } from "../lib/errors";
import { getIbkrRuntimeConfig, type IbkrRuntimeConfig } from "../lib/runtime";
import { IbkrClient } from "../providers/ibkr/client";

import { getIbkrPortalUserId } from "./ibkr-portal-context";
import { getGateway } from "./ibkr-portal-gateway-manager";

// An existing per-user gateway owns routing for that request even before it is
// verified. Returning null while verification is pending prevents a fallback
// to a separately configured global IBKR account.
function resolveClientPortalConfig(): IbkrRuntimeConfig | null {
  const appUserId = getIbkrPortalUserId();
  if (appUserId) {
    const gateway = getGateway(appUserId);
    if (gateway) {
      if (gateway.status !== "ready" || !gateway.paperAccountVerified) {
        return null;
      }
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
        paperAccountOnly: true,
      };
    }
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

  return new IbkrClient(config);
}
