import assert from "node:assert/strict";
import test from "node:test";

import {
  decideProviderClassification,
  initialProviderClassificationRows,
  validateProviderClassificationRow,
  type ProviderClassificationRow,
} from "./broker-provider-classification";

const rowByProviderKey = new Map<string, ProviderClassificationRow>(
  initialProviderClassificationRows.map((row) => [row.providerKey, row]),
);

function row(providerKey: string): ProviderClassificationRow {
  const value = rowByProviderKey.get(providerKey);
  assert.ok(value, `missing provider fixture ${providerKey}`);
  return value;
}

test("initial provider classification fixtures are structurally valid", () => {
  for (const fixture of initialProviderClassificationRows) {
    const validation = validateProviderClassificationRow(fixture);
    assert.deepEqual(
      validation.errors,
      [],
      `${fixture.providerKey} should be valid`,
    );
  }
});

test("provider classification rows require source refs, dates, scopes, limitations, and block reason", () => {
  const base = row("snaptrade");

  assert.ok(
    validateProviderClassificationRow({ ...base, sourceRefs: [] }).errors.includes(
      "source_refs_required",
    ),
  );
  assert.ok(
    validateProviderClassificationRow({
      ...base,
      verificationDate: "",
    }).errors.includes("verification_date_required"),
  );
  assert.ok(
    validateProviderClassificationRow({
      ...base,
      requiredScopes: [],
    }).errors.includes("required_scopes_required"),
  );
  assert.ok(
    validateProviderClassificationRow({
      ...base,
      knownLimitations: [],
    }).errors.includes("known_limitations_required"),
  );
  const invalidBlockReasonRow = {
    ...base,
    defaultBlockReason: "not_a_reason",
  } as unknown as ProviderClassificationRow;
  assert.ok(
    validateProviderClassificationRow(
      invalidBlockReasonRow,
    ).errors.includes("default_block_reason_invalid"),
  );
});

test("SnapTrade remains research-blocked until a selected brokerage fixture and official evidence exist", () => {
  const snaptrade = row("snaptrade");
  const decision = decideProviderClassification(snaptrade);

  assert.equal(decision.outcome, "blocked");
  assert.equal(decision.decisionCode, "PROVIDER_RESEARCH_REQUIRED");
  assert.equal(decision.launchable, false);
  assert.equal(decision.activationAllowed, false);
  assert.equal(decision.executionAllowed, false);
});

test("IBKR Client Portal stays a special connector while IBKR OAuth is a direct-OAuth candidate", () => {
  const clientPortal = row("ibkr");
  const oauth = row("ibkr_oauth");

  assert.equal(clientPortal.adapterKind, "ibkr_special_connector");
  assert.equal(clientPortal.customerV1Status, "ibkr_special_connector");
  assert.equal(clientPortal.defaultBlockReason, "PROVIDER_SPECIAL_CONNECTOR_REQUIRED");

  assert.equal(oauth.adapterKind, "direct_oauth");
  assert.equal(oauth.customerV1Status, "research_only");
  assert.equal(oauth.defaultBlockReason, "PROVIDER_COMPLIANCE_REVIEW_REQUIRED");
  assert.ok(
    oauth.sourceRefs.some((source) =>
      source.kind === "official_provider_docs" &&
      source.url?.includes("interactivebrokers.com/campus/ibkr-api-page/webapi-doc"),
    ),
  );
  assert.ok(
    oauth.knownLimitations.some((limitation) =>
      limitation.includes("Third-party OAuth requires IBKR approval"),
    ),
  );

  const decision = decideProviderClassification(oauth);
  assert.equal(decision.outcome, "blocked");
  assert.equal(decision.decisionCode, "PROVIDER_COMPLIANCE_REVIEW_REQUIRED");
  assert.equal(decision.launchable, false);
  assert.equal(decision.activationAllowed, false);
  assert.equal(decision.executionAllowed, false);
});

test("aggregator private-beta eligibility requires official evidence and a selected brokerage fixture", () => {
  const snaptrade = row("snaptrade");

  const validation = validateProviderClassificationRow({
    ...snaptrade,
    customerV1Status: "eligible_for_private_beta",
    defaultBlockReason: "PROVIDER_ELIGIBLE",
  });

  assert.ok(
    validation.errors.includes("eligible_provider_requires_official_source_ref"),
  );
  assert.ok(
    validation.errors.includes(
      "eligible_aggregator_requires_selected_brokerage_fixture",
    ),
  );
});

test("non-eligible provider entry paths fail closed for launch, activation, and execution", () => {
  for (const fixture of initialProviderClassificationRows) {
    const decision = decideProviderClassification(fixture);

    assert.notEqual(
      decision.outcome,
      "eligible",
      `${fixture.providerKey} should not be eligible`,
    );
    assert.equal(decision.launchable, false);
    assert.equal(decision.activationAllowed, false);
    assert.equal(decision.executionAllowed, false);
  }
});
