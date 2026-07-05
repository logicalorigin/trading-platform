import { HttpError } from "../lib/errors";
import {
  buildSnapTradeSignature,
  SNAPTRADE_API_BASE_URL,
} from "./snaptrade-readiness";
import {
  assertCredentialEncryptionConfigured,
  deriveSnapTradeUserId,
  readSnapTradeUserReadiness,
  recordSnapTradeUserCredential,
  type SnapTradeUserReadiness,
} from "./snaptrade-user-custody";

export type SnapTradeUserRegistrationResponse = {
  provider: "snaptrade";
  created: boolean;
  user: SnapTradeUserReadiness;
};

export type RegisterSnapTradeCurrentUserOptions = {
  appUserId: string;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  now?: Date;
  encryptionKey?: string;
  keyVersion?: string;
};

const SNAPTRADE_REGISTER_USER_PATH = "/snapTrade/registerUser";

function readEnvString(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
  key: string,
): string {
  return env[key]?.trim() ?? "";
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

function validateRegistrationPayload(
  payload: unknown,
  expectedUserId: string,
): { userId: string; userSecret: string } {
  const record = asRecord(payload);
  const userId = record["userId"];
  const userSecret = record["userSecret"];
  if (
    typeof userId !== "string" ||
    userId !== expectedUserId ||
    typeof userSecret !== "string" ||
    !userSecret.trim()
  ) {
    throw new HttpError(502, "SnapTrade user registration returned invalid data", {
      code: "snaptrade_register_user_invalid_response",
      expose: false,
    });
  }
  return { userId, userSecret };
}

export async function registerSnapTradeCurrentUser(
  options: RegisterSnapTradeCurrentUserOptions,
): Promise<SnapTradeUserRegistrationResponse> {
  const existing = await readSnapTradeUserReadiness(options.appUserId);
  if (existing.snapTradeUserIdPresent || existing.userSecretStored) {
    return {
      provider: "snaptrade",
      created: false,
      user: existing,
    };
  }

  assertCredentialEncryptionConfigured(options.encryptionKey);

  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? new Date();
  const { clientId, consumerKey } = configuredSnapTradeCredentials(env);
  const snapTradeUserId = deriveSnapTradeUserId(options.appUserId);
  const content = { userId: snapTradeUserId };
  const timestamp = Math.floor(now.getTime() / 1000).toString();
  const query = `clientId=${encodeURIComponent(clientId)}&timestamp=${timestamp}`;
  const { signature } = buildSnapTradeSignature({
    path: SNAPTRADE_REGISTER_USER_PATH,
    query,
    content,
    consumerKey,
  });

  let response: Response;
  let payload: unknown;
  try {
    response = await fetchImpl(
      `${SNAPTRADE_API_BASE_URL}${SNAPTRADE_REGISTER_USER_PATH}?${query}`,
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
    throw new HttpError(502, "SnapTrade user registration failed", {
      code: "snaptrade_register_user_network_error",
      expose: false,
    });
  }

  if (!response.ok) {
    throw new HttpError(502, "SnapTrade user registration failed", {
      code: "snaptrade_register_user_failed",
      expose: false,
      data: { status: response.status },
    });
  }

  const registration = validateRegistrationPayload(payload, snapTradeUserId);
  const user = await recordSnapTradeUserCredential({
    appUserId: options.appUserId,
    snapTradeUserId: registration.userId,
    userSecret: registration.userSecret,
    encryptionKey: options.encryptionKey,
    keyVersion: options.keyVersion,
    now,
  });

  return {
    provider: "snaptrade",
    created: true,
    user,
  };
}
