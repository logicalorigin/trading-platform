import { toExecutionDecisionResponse } from "./execution-decision-response";
import type { ExecutionDecisionResponse } from "./execution-decision-response";

export type IbkrOAuthReadinessStatus =
  | "unconfigured"
  | "approval_required"
  | "research_required"
  | "self_service_ready";

export type IbkrOAuthReadinessResponse = {
  provider: "ibkr_oauth";
  configured: boolean;
  status: IbkrOAuthReadinessStatus;
  checkedAt: string;
  executionDecision: ExecutionDecisionResponse;
  credentials: {
    consumerKeyPresent: boolean;
    signingKeyPresent: boolean;
    callbackUrlPresent: boolean;
    thirdPartyApprovalRecorded: boolean;
    encryptionKeyPresent: boolean;
    dhParamPresent: boolean;
    accessTokenPresent: boolean;
    accessTokenSecretPresent: boolean;
  };
  requirements: {
    oauthVersion: "oauth1a_third_party";
    localGatewayRequired: false;
    clientPortalGatewayCustomerPath: false;
    approvalRequired: true;
    officialSources: string[];
  };
  limitations: string[];
};

export type IbkrOAuthReadinessOptions = {
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  now?: Date;
};

const IBKR_WEB_API_DOC_URL =
  "https://www.interactivebrokers.com/campus/ibkr-api-page/webapi-doc/";
const IBKR_OAUTH_1A_DOC_URL =
  "https://www.interactivebrokers.com/campus/ibkr-api-page/oauth-1-0a-extended/";

const consumerKeyEnvNames = [
  "IBKR_OAUTH_CONSUMER_KEY",
  "IBKR_CONSUMER_KEY",
] as const;
const signingKeyEnvNames = [
  "IBKR_OAUTH_SIGNING_KEY",
  "IBKR_OAUTH_PRIVATE_KEY",
  "IBKR_OAUTH_RSA_PRIVATE_KEY",
] as const;
const callbackUrlEnvNames = [
  "IBKR_OAUTH_CALLBACK_URL",
  "IBKR_OAUTH_REDIRECT_URI",
] as const;
const approvalEnvNames = [
  "IBKR_OAUTH_THIRD_PARTY_APPROVED",
  "IBKR_OAUTH_COMPLIANCE_APPROVED",
] as const;
// Self-service (first-party) OAuth credentials — obtaining a live session token
// on our OWN IBKR account needs no third-party approval and no callback URL.
const encryptionKeyEnvNames = ["IBKR_OAUTH_ENCRYPTION_KEY"] as const;
const dhParamEnvNames = ["IBKR_OAUTH_DH_PARAM"] as const;
const accessTokenEnvNames = ["IBKR_OAUTH_ACCESS_TOKEN"] as const;
const accessTokenSecretEnvNames = ["IBKR_OAUTH_ACCESS_TOKEN_SECRET"] as const;

function readFirstPresent(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
  names: readonly string[],
): string {
  for (const name of names) {
    const value = env[name]?.trim();
    if (value) {
      return value;
    }
  }
  return "";
}

function readBooleanFlag(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
  names: readonly string[],
): boolean {
  const value = readFirstPresent(env, names).toLowerCase();
  return ["1", "true", "yes", "on"].includes(value);
}

function baseRequirements(): IbkrOAuthReadinessResponse["requirements"] {
  return {
    oauthVersion: "oauth1a_third_party",
    localGatewayRequired: false,
    clientPortalGatewayCustomerPath: false,
    approvalRequired: true,
    officialSources: [IBKR_WEB_API_DOC_URL, IBKR_OAUTH_1A_DOC_URL],
  };
}

export function readIbkrOAuthReadiness(
  options: IbkrOAuthReadinessOptions = {},
): IbkrOAuthReadinessResponse {
  const env = options.env ?? process.env;
  const checkedAt = options.now ?? new Date();
  const consumerKeyPresent = Boolean(readFirstPresent(env, consumerKeyEnvNames));
  const signingKeyPresent = Boolean(readFirstPresent(env, signingKeyEnvNames));
  const callbackUrlPresent = Boolean(readFirstPresent(env, callbackUrlEnvNames));
  const thirdPartyApprovalRecorded = readBooleanFlag(env, approvalEnvNames);
  const encryptionKeyPresent = Boolean(readFirstPresent(env, encryptionKeyEnvNames));
  const dhParamPresent = Boolean(readFirstPresent(env, dhParamEnvNames));
  const accessTokenPresent = Boolean(readFirstPresent(env, accessTokenEnvNames));
  const accessTokenSecretPresent = Boolean(
    readFirstPresent(env, accessTokenSecretEnvNames),
  );

  // Self-service needs the full first-party credential set (no callback URL, no
  // approval). When present, the OAuth crypto core can mint a live session token
  // on our own account — but execution stays gated: the unattended session/order
  // layer is a separate build, so the decision remains non-executable.
  const selfServiceReady =
    consumerKeyPresent &&
    signingKeyPresent &&
    encryptionKeyPresent &&
    dhParamPresent &&
    accessTokenPresent &&
    accessTokenSecretPresent;
  const thirdPartyConfigured =
    consumerKeyPresent && signingKeyPresent && callbackUrlPresent;
  const configured = selfServiceReady || thirdPartyConfigured;

  const status: IbkrOAuthReadinessStatus = selfServiceReady
    ? "self_service_ready"
    : !thirdPartyConfigured
      ? "unconfigured"
      : thirdPartyApprovalRecorded
        ? "research_required"
        : "approval_required";

  const limitations = selfServiceReady
    ? ["ibkr.oauth.self_service_session_not_implemented"]
    : [
        !consumerKeyPresent ? "ibkr.oauth.consumer_key_missing" : null,
        !signingKeyPresent ? "ibkr.oauth.signing_key_missing" : null,
        !callbackUrlPresent ? "ibkr.oauth.callback_url_missing" : null,
        !thirdPartyApprovalRecorded
          ? "ibkr.oauth.third_party_approval_required"
          : null,
        thirdPartyApprovalRecorded && thirdPartyConfigured
          ? "ibkr.oauth.implementation_not_complete"
          : null,
        thirdPartyApprovalRecorded && thirdPartyConfigured
          ? "ibkr.oauth.account_capability_fixture_required"
          : null,
      ].filter((value): value is string => Boolean(value));

  return {
    provider: "ibkr_oauth",
    configured,
    status,
    checkedAt: checkedAt.toISOString(),
    executionDecision: toExecutionDecisionResponse(
      status === "research_required" || status === "self_service_ready"
        ? "PROVIDER_RESEARCH_REQUIRED"
        : "PROVIDER_COMPLIANCE_REVIEW_REQUIRED",
    ),
    credentials: {
      consumerKeyPresent,
      signingKeyPresent,
      callbackUrlPresent,
      thirdPartyApprovalRecorded,
      encryptionKeyPresent,
      dhParamPresent,
      accessTokenPresent,
      accessTokenSecretPresent,
    },
    requirements: baseRequirements(),
    limitations,
  };
}
