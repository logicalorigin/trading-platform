import { HttpError } from "../lib/errors";
import {
  buildSnapTradeSignature,
  SNAPTRADE_API_BASE_URL,
} from "./snaptrade-readiness";
import { loadSnapTradeUserCredential } from "./snaptrade-user-custody";
import { readEnvString } from "../lib/env";

export const SNAPTRADE_CONNECTION_TYPES = [
  "read",
  "trade",
  "trade-if-available",
] as const;

export type SnapTradeConnectionType =
  (typeof SNAPTRADE_CONNECTION_TYPES)[number];

export type SnapTradeConnectionPortalRequest = {
  broker?: string;
  reconnect?: string;
  connectionType?: SnapTradeConnectionType;
  immediateRedirect?: boolean;
  showCloseButton?: boolean;
  darkMode?: boolean;
};

export type SnapTradeConnectionPortalResponse = {
  provider: "snaptrade";
  redirectUri: string;
  sessionId: string;
  expiresAt: string;
  requestedConnectionType: SnapTradeConnectionType;
  connectionPortalVersion: "v4";
  broker: string | null;
  reconnect: string | null;
};

export type GenerateSnapTradeConnectionPortalOptions = {
  appUserId: string;
  input?: SnapTradeConnectionPortalRequest;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  now?: Date;
  encryptionKey?: string;
};

const SNAPTRADE_CONNECTION_PORTAL_PATH = "/snapTrade/login";
const SNAPTRADE_CONNECTION_PORTAL_VERSION = "v4";
const SNAPTRADE_CONNECTION_PORTAL_TTL_MS = 5 * 60 * 1000;
const BROKER_SLUG_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONNECTION_TYPES = new Set<string>(SNAPTRADE_CONNECTION_TYPES);

function configuredSnapTradeCredentials(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
): { clientId: string; consumerKey: string } {
  const clientId = readEnvString(env, "SNAPTRADE_CLIENTID");
  const consumerKey = readEnvString(env, "SNAPTRADE_API_KEY");
  if (!clientId || !consumerKey) {
    throw new HttpError(503, "SnapTrade credentials are not configured", {
      code: "snaptrade_credentials_not_configured",
    });
  }
  return { clientId, consumerKey };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function readJsonSafely(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function assertBrokerSlug(value: string): void {
  if (!BROKER_SLUG_PATTERN.test(value)) {
    throw new HttpError(422, "SnapTrade broker slug is invalid", {
      code: "snaptrade_broker_slug_invalid",
    });
  }
}

function assertReconnectId(value: string): void {
  if (!UUID_PATTERN.test(value)) {
    throw new HttpError(422, "SnapTrade reconnect id is invalid", {
      code: "snaptrade_reconnect_id_invalid",
    });
  }
}

function normalizeConnectionPortalRequest(
  input: SnapTradeConnectionPortalRequest | undefined,
): Required<Pick<SnapTradeConnectionPortalRequest, "connectionType">> &
  Omit<SnapTradeConnectionPortalRequest, "connectionType"> {
  const connectionType = input?.connectionType ?? "trade-if-available";
  if (!CONNECTION_TYPES.has(connectionType)) {
    throw new HttpError(422, "SnapTrade connection type is invalid", {
      code: "snaptrade_connection_type_invalid",
    });
  }

  const broker = input?.broker?.trim();
  if (broker) {
    assertBrokerSlug(broker);
  }

  const reconnect = input?.reconnect?.trim();
  if (reconnect) {
    assertReconnectId(reconnect);
  }

  return {
    broker: broker || undefined,
    reconnect: reconnect || undefined,
    connectionType,
    immediateRedirect: input?.immediateRedirect,
    showCloseButton: input?.showCloseButton,
    darkMode: input?.darkMode,
  };
}

function buildConnectionPortalContent(
  input: ReturnType<typeof normalizeConnectionPortalRequest>,
): Record<string, unknown> {
  const content: Record<string, unknown> = {
    connectionType: input.connectionType,
    showCloseButton: input.showCloseButton ?? true,
    connectionPortalVersion: SNAPTRADE_CONNECTION_PORTAL_VERSION,
  };
  if (input.broker) {
    content["broker"] = input.broker;
  }
  if (input.reconnect) {
    content["reconnect"] = input.reconnect;
  }
  if (typeof input.immediateRedirect === "boolean") {
    content["immediateRedirect"] = input.immediateRedirect;
  }
  if (typeof input.darkMode === "boolean") {
    content["darkMode"] = input.darkMode;
  }
  return content;
}

function buildSnapTradeConnectionPortalQuery(input: {
  clientId: string;
  timestamp: string;
  snapTradeUserId: string;
  userSecret: string;
}): string {
  const query = new URLSearchParams();
  query.set("clientId", input.clientId);
  query.set("timestamp", input.timestamp);
  query.set("userId", input.snapTradeUserId);
  query.set("userSecret", input.userSecret);
  return query.toString();
}

function parseConnectionPortalPayload(
  payload: unknown,
): { redirectURI: string; sessionId: string } {
  const record = asRecord(payload);
  const redirectURI = record["redirectURI"];
  const sessionId = record["sessionId"];
  if (
    typeof redirectURI !== "string" ||
    !redirectURI.trim() ||
    typeof sessionId !== "string" ||
    !sessionId.trim()
  ) {
    throw new HttpError(502, "SnapTrade Connection Portal returned invalid data", {
      code: "snaptrade_connection_portal_invalid_response",
      expose: false,
    });
  }

  try {
    const parsed = new URL(redirectURI);
    if (parsed.protocol !== "https:") {
      throw new Error("SnapTrade redirect URI must use HTTPS");
    }
  } catch {
    throw new HttpError(502, "SnapTrade Connection Portal returned invalid data", {
      code: "snaptrade_connection_portal_invalid_response",
      expose: false,
    });
  }

  return { redirectURI, sessionId };
}

export async function generateSnapTradeConnectionPortal(
  options: GenerateSnapTradeConnectionPortalOptions,
): Promise<SnapTradeConnectionPortalResponse> {
  const credential = await loadSnapTradeUserCredential({
    appUserId: options.appUserId,
    encryptionKey: options.encryptionKey,
  });
  if (!credential) {
    throw new HttpError(409, "SnapTrade user is not registered", {
      code: "snaptrade_user_not_registered",
    });
  }

  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? new Date();
  const normalizedInput = normalizeConnectionPortalRequest(options.input);
  const content = buildConnectionPortalContent(normalizedInput);
  const { clientId, consumerKey } = configuredSnapTradeCredentials(env);
  const timestamp = Math.floor(now.getTime() / 1000).toString();
  const query = buildSnapTradeConnectionPortalQuery({
    clientId,
    timestamp,
    snapTradeUserId: credential.snapTradeUserId,
    userSecret: credential.userSecret,
  });
  const { signature } = buildSnapTradeSignature({
    path: SNAPTRADE_CONNECTION_PORTAL_PATH,
    query,
    content,
    consumerKey,
  });

  let response: Response;
  let payload: unknown;
  try {
    response = await fetchImpl(
      `${SNAPTRADE_API_BASE_URL}${SNAPTRADE_CONNECTION_PORTAL_PATH}?${query}`,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Signature: signature,
        },
        body: JSON.stringify(content),
      },
    );
    payload = await readJsonSafely(response);
  } catch {
    throw new HttpError(502, "SnapTrade Connection Portal generation failed", {
      code: "snaptrade_connection_portal_network_error",
      expose: false,
    });
  }

  if (!response.ok) {
    throw new HttpError(502, "SnapTrade Connection Portal generation failed", {
      code: "snaptrade_connection_portal_failed",
      expose: false,
      data: { status: response.status },
    });
  }

  const portal = parseConnectionPortalPayload(payload);
  return {
    provider: "snaptrade",
    redirectUri: portal.redirectURI,
    sessionId: portal.sessionId,
    expiresAt: new Date(
      now.getTime() + SNAPTRADE_CONNECTION_PORTAL_TTL_MS,
    ).toISOString(),
    requestedConnectionType: normalizedInput.connectionType,
    connectionPortalVersion: SNAPTRADE_CONNECTION_PORTAL_VERSION,
    broker: normalizedInput.broker ?? null,
    reconnect: normalizedInput.reconnect ?? null,
  };
}
