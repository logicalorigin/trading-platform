import { toExecutionDecisionResponse } from "./execution-decision-response";
import type { ExecutionDecisionResponse } from "./execution-decision-response";
import { resolveSchwabRedirectBaseUrl, isSchwabAppCredentialsConfigured } from "./schwab-oauth";
import { isSchwabCredentialEncryptionConfigured } from "./schwab-user-custody";
import type { SchwabUserReadiness } from "./schwab-user-custody";

export type SchwabReadinessStatus =
  | "unconfigured"
  | "research_required"
  | "reauth_required";

export type SchwabReadinessResponse = {
  provider: "schwab";
  configured: boolean;
  status: SchwabReadinessStatus;
  checkedAt: string;
  executionDecision: ExecutionDecisionResponse;
  prerequisites: {
    credentialEncryptionKeyPresent: boolean;
    redirectBaseUrlPresent: boolean;
    appCredentialsPresent: boolean;
  };
  reauthRequired: {
    required: boolean;
    reason: "refresh_expired_or_revoked" | "refresh_expires_soon" | null;
  };
  limitations: string[];
  upstream: null;
};

export type SchwabReadinessOptions = {
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  now?: Date;
  userReadiness?: SchwabUserReadiness | null;
};

// Standing limitations of the Schwab Trader API integration; revisit as the
// integration matures.
const SCHWAB_STANDING_LIMITATIONS = [
  "schwab.provider_research_required",
  "schwab.order_tooling_unverified",
  "schwab.weekly_reauth_required",
];

export async function readSchwabReadiness(
  options: SchwabReadinessOptions = {},
): Promise<SchwabReadinessResponse> {
  const env = options.env ?? process.env;
  const checkedAt = options.now ?? new Date();
  const credentialEncryptionKeyPresent = isSchwabCredentialEncryptionConfigured(
    env["PYRUS_CREDENTIAL_ENCRYPTION_KEY"],
  );
  const redirectBaseUrlPresent = Boolean(resolveSchwabRedirectBaseUrl(env));
  const appCredentialsPresent = isSchwabAppCredentialsConfigured(env);
  const configured =
    credentialEncryptionKeyPresent && redirectBaseUrlPresent && appCredentialsPresent;
  const userReadiness = options.userReadiness ?? null;
  const brokerReauthRequired = Boolean(
    userReadiness?.executionBlockers.includes("broker_reauth") ||
      userReadiness?.nextAction === "reconnect" ||
      userReadiness?.status === "expired",
  );
  const reauthReason = !brokerReauthRequired
    ? null
    : userReadiness?.status === "expired"
      ? "refresh_expired_or_revoked"
      : "refresh_expires_soon";

  const limitations = configured
    ? [...SCHWAB_STANDING_LIMITATIONS]
    : [
        !credentialEncryptionKeyPresent
          ? "schwab.credential_encryption_key_missing"
          : null,
        !redirectBaseUrlPresent ? "schwab.redirect_base_url_missing" : null,
        !appCredentialsPresent ? "schwab.app_credentials_missing" : null,
        ...SCHWAB_STANDING_LIMITATIONS,
      ].filter((value): value is string => Boolean(value));
  const readinessLimitations = brokerReauthRequired
    ? ["schwab.broker_reauth_required", ...limitations]
    : limitations;

  return {
    provider: "schwab",
    configured,
    status: brokerReauthRequired
      ? "reauth_required"
      : configured
        ? "research_required"
        : "unconfigured",
    checkedAt: checkedAt.toISOString(),
    executionDecision: toExecutionDecisionResponse("PROVIDER_RESEARCH_REQUIRED"),
    prerequisites: {
      credentialEncryptionKeyPresent,
      redirectBaseUrlPresent,
      appCredentialsPresent,
    },
    reauthRequired: {
      required: brokerReauthRequired,
      reason: reauthReason,
    },
    limitations: readinessLimitations,
    upstream: null,
  };
}
