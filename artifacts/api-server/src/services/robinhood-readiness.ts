import { toExecutionDecisionResponse } from "./execution-decision-response";
import type { ExecutionDecisionResponse } from "./execution-decision-response";
import {
  resolveRobinhoodRedirectBaseUrl,
} from "./robinhood-oauth";
import { isRobinhoodCredentialEncryptionConfigured } from "./robinhood-user-custody";

export type RobinhoodReadinessStatus =
  | "unconfigured"
  | "research_required"
  | "upstream_error";

export type RobinhoodReadinessResponse = {
  provider: "robinhood";
  configured: boolean;
  status: RobinhoodReadinessStatus;
  checkedAt: string;
  executionDecision: ExecutionDecisionResponse;
  prerequisites: {
    credentialEncryptionKeyPresent: boolean;
    redirectBaseUrlPresent: boolean;
  };
  oauth: {
    reachable: boolean;
    authorizationEndpointPresent: boolean | null;
    tokenEndpointPresent: boolean | null;
    registrationEndpointPresent: boolean | null;
    pkceS256Supported: boolean | null;
  } | null;
  limitations: string[];
  upstream: {
    status: number;
    code: string;
    message: string;
  } | null;
};

export type RobinhoodReadinessOptions = {
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  now?: Date;
};

const ROBINHOOD_OAUTH_METADATA_URL =
  "https://agent.robinhood.com/.well-known/oauth-authorization-server";

// Standing limitations of the Robinhood Agentic Trading beta; revisit as the
// beta expands (options rollout, additional asset classes).
const ROBINHOOD_STANDING_LIMITATIONS = [
  "robinhood.provider_research_required",
  "robinhood.agentic_account_only",
  "robinhood.equities_long_only",
  "robinhood.order_tooling_unverified",
];

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

function baseResponse(input: {
  configured: boolean;
  status: RobinhoodReadinessStatus;
  checkedAt: Date;
  credentialEncryptionKeyPresent: boolean;
  redirectBaseUrlPresent: boolean;
  oauth?: RobinhoodReadinessResponse["oauth"];
  limitations?: string[];
  upstream?: RobinhoodReadinessResponse["upstream"];
}): RobinhoodReadinessResponse {
  return {
    provider: "robinhood",
    configured: input.configured,
    status: input.status,
    checkedAt: input.checkedAt.toISOString(),
    executionDecision: toExecutionDecisionResponse("PROVIDER_RESEARCH_REQUIRED"),
    prerequisites: {
      credentialEncryptionKeyPresent: input.credentialEncryptionKeyPresent,
      redirectBaseUrlPresent: input.redirectBaseUrlPresent,
    },
    oauth: input.oauth ?? null,
    limitations: input.limitations ?? [...ROBINHOOD_STANDING_LIMITATIONS],
    upstream: input.upstream ?? null,
  };
}

export async function readRobinhoodReadiness(
  options: RobinhoodReadinessOptions = {},
): Promise<RobinhoodReadinessResponse> {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const checkedAt = options.now ?? new Date();
  const credentialEncryptionKeyPresent =
    isRobinhoodCredentialEncryptionConfigured(
      env["PYRUS_CREDENTIAL_ENCRYPTION_KEY"],
    );
  const redirectBaseUrlPresent = Boolean(resolveRobinhoodRedirectBaseUrl(env));

  if (!credentialEncryptionKeyPresent || !redirectBaseUrlPresent) {
    const limitations = [
      !credentialEncryptionKeyPresent
        ? "robinhood.credential_encryption_key_missing"
        : null,
      !redirectBaseUrlPresent ? "robinhood.redirect_base_url_missing" : null,
      ...ROBINHOOD_STANDING_LIMITATIONS,
    ].filter((value): value is string => Boolean(value));
    return baseResponse({
      configured: false,
      status: "unconfigured",
      checkedAt,
      credentialEncryptionKeyPresent,
      redirectBaseUrlPresent,
      limitations,
    });
  }

  try {
    const response = await fetchImpl(ROBINHOOD_OAUTH_METADATA_URL, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    const payload = await readJsonSafely(response);

    if (!response.ok) {
      return baseResponse({
        configured: true,
        status: "upstream_error",
        checkedAt,
        credentialEncryptionKeyPresent,
        redirectBaseUrlPresent,
        oauth: {
          reachable: false,
          authorizationEndpointPresent: null,
          tokenEndpointPresent: null,
          registrationEndpointPresent: null,
          pkceS256Supported: null,
        },
        limitations: [
          "robinhood.oauth_metadata_unavailable",
          ...ROBINHOOD_STANDING_LIMITATIONS,
        ],
        upstream: {
          status: response.status,
          code: `robinhood_http_${response.status}`,
          message: "Robinhood OAuth metadata probe failed.",
        },
      });
    }

    const record = asRecord(payload);
    const challengeMethods = Array.isArray(
      record["code_challenge_methods_supported"],
    )
      ? record["code_challenge_methods_supported"]
      : [];
    return baseResponse({
      configured: true,
      status: "research_required",
      checkedAt,
      credentialEncryptionKeyPresent,
      redirectBaseUrlPresent,
      oauth: {
        reachable: true,
        authorizationEndpointPresent:
          typeof record["authorization_endpoint"] === "string",
        tokenEndpointPresent: typeof record["token_endpoint"] === "string",
        registrationEndpointPresent:
          typeof record["registration_endpoint"] === "string",
        pkceS256Supported: challengeMethods.includes("S256"),
      },
    });
  } catch {
    return baseResponse({
      configured: true,
      status: "upstream_error",
      checkedAt,
      credentialEncryptionKeyPresent,
      redirectBaseUrlPresent,
      oauth: {
        reachable: false,
        authorizationEndpointPresent: null,
        tokenEndpointPresent: null,
        registrationEndpointPresent: null,
        pkceS256Supported: null,
      },
      limitations: [
        "robinhood.oauth_metadata_unavailable",
        ...ROBINHOOD_STANDING_LIMITATIONS,
      ],
      upstream: {
        status: 0,
        code: "robinhood_network_error",
        message: "Robinhood OAuth metadata probe failed.",
      },
    });
  }
}
