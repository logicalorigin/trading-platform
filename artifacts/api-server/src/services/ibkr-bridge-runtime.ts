import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { HttpError } from "../lib/errors";
import {
  clearIbkrBridgeRuntimeOverride,
  getIbkrBridgeRuntimeOverride,
  setIbkrBridgeRuntimeOverride,
} from "../lib/runtime";

const BRIDGE_VALIDATION_TIMEOUT_MS = 20_000;
const LEGACY_ACTIVATION_TTL_MS = 60 * 60_000;
const BRIDGE_HELPER_VERSION = "2026-05-05.gateway-launch-v11";

type LauncherResult = {
  activationId: string;
  apiBaseUrl: string;
  bridgeToken: string;
  bundleUrl: string;
  helperUrl: string;
  helperVersion: string;
  launchUrl: string;
  managementToken: string;
};

type AttachIbkrBridgeRuntimeResult = {
  runtimeOverrideActive: true;
  bridgeUrl: string;
  tokenConfigured: boolean;
  bridge: {
    health: unknown;
    accounts: unknown;
  };
};

type LegacyBridgeActivation = {
  callbackSecret: string;
  bridgeToken: string;
  managementToken: string;
  issuedAt: number;
  expiresAt: number;
};

const legacyBridgeActivations = new Map<string, LegacyBridgeActivation>();
let latestLegacyBridgeActivationId: string | null = null;

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function normalizeBaseUrl(rawBaseUrl: string): string {
  let url: URL;
  try {
    url = new URL(rawBaseUrl);
  } catch {
    throw new HttpError(400, "API base URL is not valid.", {
      code: "invalid_ibkr_bridge_launcher_url",
    });
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new HttpError(400, "API base URL must use HTTP or HTTPS.", {
      code: "invalid_ibkr_bridge_launcher_url",
    });
  }

  url.pathname = "";
  url.search = "";
  url.hash = "";
  return stripTrailingSlash(url.toString());
}

function asString(
  value: unknown,
  fieldName: string,
  maxLength = 512,
): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new HttpError(400, `${fieldName} is required.`, {
      code: "invalid_ibkr_bridge_payload",
    });
  }

  return value.trim().slice(0, maxLength);
}

function readOptionalString(value: unknown, maxLength = 512): string | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  return value.trim().slice(0, maxLength);
}

function hashManagementToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function safeStringEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function pruneLegacyBridgeActivations(now = Date.now()): void {
  for (const [activationId, activation] of legacyBridgeActivations) {
    if (activation.expiresAt <= now) {
      legacyBridgeActivations.delete(activationId);
      if (latestLegacyBridgeActivationId === activationId) {
        latestLegacyBridgeActivationId = null;
      }
    }
  }
}

function assertLegacyBridgeActivationIsCurrent(
  activationId: string,
  activation: LegacyBridgeActivation,
): void {
  if (
    latestLegacyBridgeActivationId &&
    latestLegacyBridgeActivationId !== activationId
  ) {
    throw new HttpError(
      409,
      "IB Gateway bridge activation was superseded by a newer launch.",
      {
        code: "ibkr_bridge_activation_superseded",
      },
    );
  }

  const currentOverride = getIbkrBridgeRuntimeOverride();
  if (
    currentOverride &&
    currentOverride.updatedAt.getTime() >= activation.issuedAt
  ) {
    throw new HttpError(
      409,
      "IB Gateway bridge activation was superseded by a newer launch.",
      {
        code: "ibkr_bridge_activation_superseded",
      },
    );
  }
}

function createLegacyBridgeActivation(input: {
  bridgeToken: string;
  managementToken: string;
}): {
  activationId: string;
  callbackSecret: string;
} {
  pruneLegacyBridgeActivations();
  const activationId = randomBytes(16).toString("hex");
  const callbackSecret = randomBytes(32).toString("hex");
  legacyBridgeActivations.set(activationId, {
    callbackSecret,
    bridgeToken: input.bridgeToken,
    managementToken: input.managementToken,
    issuedAt: Date.now(),
    expiresAt: Date.now() + LEGACY_ACTIVATION_TTL_MS,
  });
  latestLegacyBridgeActivationId = activationId;

  return {
    activationId,
    callbackSecret,
  };
}

function readLegacyBridgeActivation(
  activationId: string,
  body: unknown,
): LegacyBridgeActivation {
  pruneLegacyBridgeActivations();
  if (!body || typeof body !== "object") {
    throw new HttpError(400, "Bridge activation callback payload is required.", {
      code: "invalid_ibkr_bridge_activation_payload",
    });
  }

  const payload = body as Record<string, unknown>;
  const callbackSecret = asString(payload.callbackSecret, "callbackSecret", 160);
  const activation = legacyBridgeActivations.get(activationId);
  if (!activation) {
    throw new HttpError(404, "IB Gateway bridge activation is no longer active.", {
      code: "ibkr_bridge_activation_not_found",
    });
  }
  if (!safeStringEquals(activation.callbackSecret, callbackSecret)) {
    throw new HttpError(401, "IB Gateway bridge activation secret is invalid.", {
      code: "invalid_ibkr_bridge_activation_secret",
    });
  }
  assertLegacyBridgeActivationIsCurrent(activationId, activation);

  return activation;
}

function normalizeBridgeUrl(rawBridgeUrl: string): string {
  let url: URL;

  try {
    url = new URL(rawBridgeUrl);
  } catch {
    throw new HttpError(400, "Bridge URL is not a valid URL.", {
      code: "invalid_ibkr_bridge_url",
    });
  }

  if (url.protocol !== "https:") {
    throw new HttpError(400, "Bridge URL must use HTTPS.", {
      code: "invalid_ibkr_bridge_url",
    });
  }

  if (url.pathname && url.pathname !== "/") {
    throw new HttpError(400, "Bridge URL must be the bridge origin, not a nested API path.", {
      code: "invalid_ibkr_bridge_url",
      detail: "Use the tunnel root URL without /v1/api.",
    });
  }

  url.pathname = "";
  url.search = "";
  url.hash = "";

  return stripTrailingSlash(url.toString());
}

function truncateDetail(value: string): string {
  return value.length <= 240 ? value : `${value.slice(0, 240)}...`;
}

async function fetchBridgeJson<T>(
  baseUrl: string,
  path: string,
  apiToken: string | null,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    BRIDGE_VALIDATION_TIMEOUT_MS,
  );

  try {
    const response = await fetch(`${baseUrl}${path}`, {
      headers: apiToken
        ? {
            Accept: "application/json",
            Authorization: `Bearer ${apiToken}`,
          }
        : {
            Accept: "application/json",
          },
      signal: controller.signal,
    });
    const text = await response.text();
    let payload: unknown = null;

    if (text) {
      try {
        payload = JSON.parse(text) as unknown;
      } catch {
        payload = text;
      }
    }

    if (!response.ok) {
      const detail =
        typeof payload === "string"
          ? truncateDetail(payload)
          : payload && typeof payload === "object"
            ? truncateDetail(JSON.stringify(payload))
            : undefined;
      throw new HttpError(400, "Bridge validation failed.", {
        code: "ibkr_bridge_validation_failed",
        detail,
      });
    }

    return payload as T;
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }

    throw new HttpError(502, "Bridge validation request failed.", {
      code: "ibkr_bridge_validation_request_failed",
      cause: error,
      detail:
        error instanceof Error && error.message
          ? error.message
          : "The bridge could not be reached.",
    });
  } finally {
    clearTimeout(timeout);
  }
}

function assertBridgeHealth(health: unknown): void {
  if (!health || typeof health !== "object") {
    throw new HttpError(400, "Bridge health response was invalid.", {
      code: "ibkr_bridge_validation_failed",
    });
  }

  const record = health as Record<string, unknown>;
  if (record.competing === true) {
    throw new HttpError(
      400,
      "IB Gateway bridge is competing with another API client.",
      {
        code: "ibkr_bridge_competing",
        detail:
          typeof record.lastError === "string" && record.lastError.trim()
            ? record.lastError
            : "The local launcher should retry with a different TWS client ID.",
      },
    );
  }

  if (record.connected !== true || record.authenticated !== true) {
    throw new HttpError(
      400,
      "IB Gateway bridge is reachable but not connected.",
      {
        code: "ibkr_bridge_not_connected",
        detail:
          typeof record.lastError === "string" && record.lastError.trim()
            ? record.lastError
            : "Open and log in to IB Gateway, then run the bridge launcher again.",
      },
    );
  }

  const accounts = Array.isArray(record.accounts) ? record.accounts : [];
  if (accounts.length === 0 && record.accountsLoaded !== true) {
    throw new HttpError(
      400,
      "IB Gateway bridge is connected but no managed accounts are loaded.",
      {
        code: "ibkr_bridge_accounts_unavailable",
        detail:
          "Wait for IB Gateway account data to finish loading, then run the bridge launcher again.",
      },
    );
  }

  const marketDataMode =
    typeof record.marketDataMode === "string"
      ? record.marketDataMode.toLowerCase()
      : null;
  const configuredLiveMarketDataMode =
    record.configuredLiveMarketDataMode === true ||
    marketDataMode === "live" ||
    (marketDataMode === null && record.liveMarketDataAvailable === true);
  if (!configuredLiveMarketDataMode || record.liveMarketDataAvailable === false) {
    throw new HttpError(
      400,
      "IB Gateway bridge is connected but live market data mode is not active.",
      {
        code: "ibkr_bridge_live_data_not_active",
        detail:
          "RayAlgo expects IB Gateway live mode on API port 4001 with market data type 1.",
      },
    );
  }
}

function buildProtocolLaunchUrl(input: {
  activationId: string;
  apiBaseUrl: string;
  bridgeToken: string;
  bundleUrl: string;
  callbackSecret: string;
  helperUrl: string;
  managementToken: string;
}): string {
  const params = new URLSearchParams({
    activationId: input.activationId,
    apiBaseUrl: input.apiBaseUrl,
    bridgeToken: input.bridgeToken,
    callbackSecret: input.callbackSecret,
    managementToken: input.managementToken,
    bundleUrl: input.bundleUrl,
    helperUrl: input.helperUrl,
    helperVersion: BRIDGE_HELPER_VERSION,
    requiredCapability: "bridgeBundle",
    forceFreshTunnel: "1",
  });

  const repoUrl = process.env["IBKR_BRIDGE_REPO_URL"]?.trim();
  if (repoUrl) {
    params.set("repoUrl", repoUrl);
  }

  const branch = process.env["IBKR_BRIDGE_REPO_BRANCH"]?.trim();
  if (branch) {
    params.set("branch", branch);
  }

  return `rayalgo-ibkr://launch?${params.toString()}`;
}

export function getIbkrBridgeLauncher(input: {
  apiBaseUrl: string;
}): LauncherResult {
  const apiBaseUrl = normalizeBaseUrl(input.apiBaseUrl);
  const helperUrl = `${apiBaseUrl}/api/ibkr/bridge/helper.ps1`;
  const bundleUrl = `${apiBaseUrl}/api/ibkr/bridge/bundle.tar.gz`;
  const bridgeToken = randomBytes(32).toString("hex");
  const managementToken = randomBytes(32).toString("hex");
  const legacyActivation = createLegacyBridgeActivation({
    bridgeToken,
    managementToken,
  });

  return {
    activationId: legacyActivation.activationId,
    apiBaseUrl,
    bridgeToken,
    bundleUrl,
    helperUrl,
    helperVersion: BRIDGE_HELPER_VERSION,
    launchUrl: buildProtocolLaunchUrl({
      activationId: legacyActivation.activationId,
      apiBaseUrl,
      bridgeToken,
      bundleUrl,
      callbackSecret: legacyActivation.callbackSecret,
      helperUrl,
      managementToken,
    }),
    managementToken,
  };
}

export function recordLegacyIbkrBridgeActivationProgress(
  activationId: string,
  body: unknown,
): { ok: true } {
  readLegacyBridgeActivation(activationId, body);

  return {
    ok: true,
  };
}

export async function attachLegacyIbkrBridgeRuntime(
  activationId: string,
  body: unknown,
): Promise<AttachIbkrBridgeRuntimeResult> {
  pruneLegacyBridgeActivations();
  if (!legacyBridgeActivations.has(activationId)) {
    if (latestLegacyBridgeActivationId) {
      throw new HttpError(
        409,
        "IB Gateway bridge activation was superseded by a newer launch.",
        {
          code: "ibkr_bridge_activation_superseded",
        },
      );
    }
    if (!body || typeof body !== "object") {
      throw new HttpError(400, "Bridge activation callback payload is required.", {
        code: "invalid_ibkr_bridge_activation_payload",
      });
    }
    const payload = body as Record<string, unknown>;
    return attachIbkrBridgeRuntime({
      bridgeUrl: asString(payload.bridgeUrl, "bridgeUrl"),
      bridgeToken: readOptionalString(payload.bridgeToken, 160),
    });
  }

  const activation = readLegacyBridgeActivation(activationId, body);
  const payload = body as Record<string, unknown>;
  const suppliedBridgeToken = readOptionalString(payload.bridgeToken, 160);
  if (
    suppliedBridgeToken &&
    !safeStringEquals(suppliedBridgeToken, activation.bridgeToken)
  ) {
    throw new HttpError(401, "IB Gateway bridge token is invalid.", {
      code: "invalid_ibkr_bridge_token",
    });
  }

  const result = await attachIbkrBridgeRuntime({
    bridgeUrl: asString(payload.bridgeUrl, "bridgeUrl"),
    bridgeToken: activation.bridgeToken,
    managementToken: activation.managementToken,
    bridgeId: activationId,
  });
  legacyBridgeActivations.delete(activationId);

  return result;
}

export async function attachIbkrBridgeRuntime(
  body: unknown,
): Promise<AttachIbkrBridgeRuntimeResult> {
  if (!body || typeof body !== "object") {
    throw new HttpError(400, "Bridge attach payload is required.", {
      code: "invalid_ibkr_bridge_attach_payload",
    });
  }

  const payload = body as Record<string, unknown>;
  const bridgeUrl = normalizeBridgeUrl(asString(payload.bridgeUrl, "bridgeUrl"));
  const bridgeToken =
    readOptionalString(payload.bridgeToken, 160) ??
    readOptionalString(payload.apiToken, 160);
  const managementToken = readOptionalString(payload.managementToken, 160);
  const bridgeId =
    readOptionalString(payload.bridgeId, 160) ??
    readOptionalString(payload.activationId, 160);
  pruneLegacyBridgeActivations();
  const activation = bridgeId ? legacyBridgeActivations.get(bridgeId) : null;
  if (bridgeId) {
    if (!activation) {
      if (latestLegacyBridgeActivationId) {
        throw new HttpError(
          409,
          "IB Gateway bridge activation was superseded by a newer launch.",
          {
            code: "ibkr_bridge_activation_superseded",
          },
        );
      }
    } else {
      assertLegacyBridgeActivationIsCurrent(bridgeId, activation);
      if (
        bridgeToken &&
        !safeStringEquals(bridgeToken, activation.bridgeToken)
      ) {
        throw new HttpError(401, "Bridge token is invalid.", {
          code: "invalid_ibkr_bridge_token",
        });
      }
    }
  }

  if (bridgeToken !== null && bridgeToken.length < 24) {
    throw new HttpError(401, "Bridge token is invalid.", {
      code: "invalid_ibkr_bridge_token",
    });
  }
  if (managementToken !== null && managementToken.length < 24) {
    throw new HttpError(401, "Bridge management token is invalid.", {
      code: "invalid_ibkr_bridge_management_token",
    });
  }

  const health = await fetchBridgeJson<unknown>(
    bridgeUrl,
    "/healthz",
    bridgeToken,
  );
  assertBridgeHealth(health);
  const accounts = await fetchBridgeJson<unknown>(
    bridgeUrl,
    "/accounts",
    bridgeToken,
  );

  setIbkrBridgeRuntimeOverride(
    {
      baseUrl: bridgeUrl,
      apiToken: bridgeToken,
    },
    {
      managementTokenHash: managementToken
        ? hashManagementToken(managementToken)
        : null,
      bridgeId,
    },
  );
  if (bridgeId) {
    legacyBridgeActivations.delete(bridgeId);
    if (latestLegacyBridgeActivationId === bridgeId) {
      latestLegacyBridgeActivationId = null;
    }
  }

  return {
    runtimeOverrideActive: true,
    bridgeUrl,
    tokenConfigured: Boolean(bridgeToken),
    bridge: {
      health,
      accounts,
    },
  };
}

export function detachIbkrBridgeRuntime(body: unknown): {
  runtimeOverrideActive: false;
} {
  if (!body || typeof body !== "object") {
    throw new HttpError(400, "Detach payload is required.", {
      code: "invalid_ibkr_bridge_detach_payload",
    });
  }

  const payload = body as Record<string, unknown>;
  const managementToken = asString(payload.managementToken, "managementToken", 160);
  const runtimeOverride = getIbkrBridgeRuntimeOverride();
  const expectedHash = runtimeOverride?.managementTokenHash;
  if (
    !expectedHash ||
    !safeStringEquals(expectedHash, hashManagementToken(managementToken))
  ) {
    throw new HttpError(401, "IB Gateway bridge detach token is invalid.", {
      code: "invalid_ibkr_bridge_detach_token",
    });
  }

  clearIbkrBridgeRuntimeOverride();

  return {
    runtimeOverrideActive: false,
  };
}

export function verifyIbkrBridgeManagementToken(body: unknown): void {
  if (!body || typeof body !== "object") {
    throw new HttpError(400, "Management token payload is required.", {
      code: "invalid_ibkr_bridge_management_payload",
    });
  }

  const payload = body as Record<string, unknown>;
  const managementToken = asString(payload.managementToken, "managementToken", 160);
  const runtimeOverride = getIbkrBridgeRuntimeOverride();
  const expectedHash = runtimeOverride?.managementTokenHash;
  if (
    !expectedHash ||
    !safeStringEquals(expectedHash, hashManagementToken(managementToken))
  ) {
    throw new HttpError(401, "IB Gateway bridge management token is invalid.", {
      code: "invalid_ibkr_bridge_management_token",
    });
  }
}

export function resetIbkrBridgeRuntimeStateForTests(): void {
  clearIbkrBridgeRuntimeOverride();
  legacyBridgeActivations.clear();
  latestLegacyBridgeActivationId = null;
}
