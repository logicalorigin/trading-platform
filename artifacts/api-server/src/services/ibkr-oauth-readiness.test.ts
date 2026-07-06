import assert from "node:assert/strict";
import test from "node:test";

import { readIbkrOAuthReadiness } from "./ibkr-oauth-readiness";

test("IBKR OAuth readiness is unconfigured without app registration material", () => {
  const readiness = readIbkrOAuthReadiness({
    env: {},
    now: new Date("2026-07-01T12:00:00.000Z"),
  });

  assert.equal(readiness.provider, "ibkr_oauth");
  assert.equal(readiness.configured, false);
  assert.equal(readiness.status, "unconfigured");
  assert.equal(readiness.executionDecision.decisionCode, "PROVIDER_COMPLIANCE_REVIEW_REQUIRED");
  assert.deepEqual(readiness.credentials, {
    consumerKeyPresent: false,
    signingKeyPresent: false,
    callbackUrlPresent: false,
    thirdPartyApprovalRecorded: false,
    encryptionKeyPresent: false,
    dhParamPresent: false,
    accessTokenPresent: false,
    accessTokenSecretPresent: false,
  });
  assert.equal(readiness.requirements.localGatewayRequired, false);
  assert.equal(readiness.requirements.clientPortalGatewayCustomerPath, false);
  assert.deepEqual(readiness.limitations, [
    "ibkr.oauth.consumer_key_missing",
    "ibkr.oauth.signing_key_missing",
    "ibkr.oauth.callback_url_missing",
    "ibkr.oauth.third_party_approval_required",
  ]);
});

test("IBKR OAuth readiness remains approval-blocked when credentials exist without IBKR approval", () => {
  const readiness = readIbkrOAuthReadiness({
    env: {
      IBKR_OAUTH_CONSUMER_KEY: "consumer-key",
      IBKR_OAUTH_SIGNING_KEY: "private-signing-key",
      IBKR_OAUTH_CALLBACK_URL: "https://pyrus.example.com/api/broker-execution/ibkr/oauth/callback",
    },
    now: new Date("2026-07-01T12:00:00.000Z"),
  });

  assert.equal(readiness.configured, true);
  assert.equal(readiness.status, "approval_required");
  assert.equal(readiness.executionDecision.decisionCode, "PROVIDER_COMPLIANCE_REVIEW_REQUIRED");
  assert.deepEqual(readiness.credentials, {
    consumerKeyPresent: true,
    signingKeyPresent: true,
    callbackUrlPresent: true,
    thirdPartyApprovalRecorded: false,
    encryptionKeyPresent: false,
    dhParamPresent: false,
    accessTokenPresent: false,
    accessTokenSecretPresent: false,
  });
  assert.deepEqual(readiness.limitations, [
    "ibkr.oauth.third_party_approval_required",
  ]);

  const serialized = JSON.stringify(readiness);
  assert.doesNotMatch(serialized, /consumer-key|private-signing-key|pyrus\.example\.com/);
});

test("IBKR OAuth readiness reports self_service_ready when the first-party credential set is complete", () => {
  const readiness = readIbkrOAuthReadiness({
    env: {
      IBKR_OAUTH_CONSUMER_KEY: "PYRUSCON1",
      IBKR_OAUTH_SIGNING_KEY: "private-signing-key",
      IBKR_OAUTH_ENCRYPTION_KEY: "private-encryption-key",
      IBKR_OAUTH_DH_PARAM: "dhparam-or-prime-hex",
      IBKR_OAUTH_ACCESS_TOKEN: "access-token",
      IBKR_OAUTH_ACCESS_TOKEN_SECRET: "encrypted-secret",
      // no callback URL, no third-party approval — self-service needs neither
    },
    now: new Date("2026-07-06T12:00:00.000Z"),
  });

  assert.equal(readiness.configured, true);
  assert.equal(readiness.status, "self_service_ready");
  // still NON-executable: the unattended session/order layer is a separate build
  assert.equal(readiness.executionDecision.decisionCode, "PROVIDER_RESEARCH_REQUIRED");
  assert.deepEqual(readiness.credentials, {
    consumerKeyPresent: true,
    signingKeyPresent: true,
    callbackUrlPresent: false,
    thirdPartyApprovalRecorded: false,
    encryptionKeyPresent: true,
    dhParamPresent: true,
    accessTokenPresent: true,
    accessTokenSecretPresent: true,
  });
  assert.deepEqual(readiness.limitations, [
    "ibkr.oauth.self_service_session_not_implemented",
  ]);

  const serialized = JSON.stringify(readiness);
  assert.doesNotMatch(
    serialized,
    /private-signing-key|private-encryption-key|access-token|encrypted-secret/,
  );
});

test("IBKR OAuth readiness records approved app config as research-required until the flow is implemented", () => {
  const readiness = readIbkrOAuthReadiness({
    env: {
      IBKR_OAUTH_CONSUMER_KEY: "consumer-key",
      IBKR_OAUTH_PRIVATE_KEY: "private-signing-key",
      IBKR_OAUTH_CALLBACK_URL: "https://pyrus.example.com/api/broker-execution/ibkr/oauth/callback",
      IBKR_OAUTH_THIRD_PARTY_APPROVED: "true",
    },
    now: new Date("2026-07-01T12:00:00.000Z"),
  });

  assert.equal(readiness.configured, true);
  assert.equal(readiness.status, "research_required");
  assert.equal(readiness.executionDecision.decisionCode, "PROVIDER_RESEARCH_REQUIRED");
  assert.deepEqual(readiness.limitations, [
    "ibkr.oauth.implementation_not_complete",
    "ibkr.oauth.account_capability_fixture_required",
  ]);
  assert.ok(
    readiness.requirements.officialSources.some((source) =>
      source.includes("interactivebrokers.com/campus/ibkr-api-page/webapi-doc"),
    ),
  );
  assert.ok(
    readiness.requirements.officialSources.some((source) =>
      source.includes("interactivebrokers.com/campus/ibkr-api-page/oauth-1-0a-extended"),
    ),
  );
});
