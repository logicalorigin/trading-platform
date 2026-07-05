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
  });
  assert.deepEqual(readiness.limitations, [
    "ibkr.oauth.third_party_approval_required",
  ]);

  const serialized = JSON.stringify(readiness);
  assert.doesNotMatch(serialized, /consumer-key|private-signing-key|pyrus\.example\.com/);
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
