import assert from "node:assert/strict";
import test from "node:test";

import { ListBrokerConnectionsResponse } from "@workspace/api-zod";

import {
  executionDecisionRegistry,
  getExecutionDecisionEntryOrThrow,
  type ExecutionDecisionEntry,
} from "./execution-decision-registry";
import { toExecutionDecisionResponse } from "./execution-decision-response";

test("execution decision response exposes customer-safe registry metadata", () => {
  const entry = getExecutionDecisionEntryOrThrow("PROVIDER_RESEARCH_REQUIRED");

  const response = toExecutionDecisionResponse(entry);

  assert.deepEqual(response, {
    decisionCode: "PROVIDER_RESEARCH_REQUIRED",
    gateFamily: "provider",
    outcome: "blocked",
    customerMessageKey: "broker.provider.researchRequired",
    severity: "blocked",
    auditEventHint: "broker_provider_research_required",
    redactionClass: "customer_safe",
  });
  assert.equal("ownerTask" in response, false);
  assert.equal("allowedSurfaces" in response, false);
});

test("broker connection response schema preserves optional execution decision metadata", () => {
  const [firstDecision] = executionDecisionRegistry;
  assert.ok(firstDecision);
  const executionDecision = toExecutionDecisionResponse(firstDecision);

  const parsed = ListBrokerConnectionsResponse.parse({
    connections: [
      {
        id: "ibkr-live",
        provider: "ibkr",
        name: "Interactive Brokers Gateway",
        mode: "live",
        status: "configured",
        capabilities: ["orders"],
        updatedAt: "2026-06-26T18:00:00.000Z",
        executionDecision,
      },
    ],
  });

  assert.deepEqual(parsed.connections[0]?.executionDecision, executionDecision);
});

test("generated broker connection schema accepts every registered execution decision", () => {
  const parsed = ListBrokerConnectionsResponse.parse({
    connections: executionDecisionRegistry.map((entry, index) => ({
      id: `ibkr-${index}`,
      provider: "ibkr",
      name: "Interactive Brokers Gateway",
      mode: "live",
      status: "configured",
      capabilities: ["orders"],
      updatedAt: "2026-06-26T18:00:00.000Z",
      executionDecision: toExecutionDecisionResponse(entry),
    })),
  });

  assert.equal(parsed.connections.length, executionDecisionRegistry.length);
  assert.deepEqual(
    parsed.connections.map((connection) => connection.executionDecision?.decisionCode),
    executionDecisionRegistry.map((entry) => entry.decisionCode),
  );
});

test("execution decision response rejects unregistered metadata objects", () => {
  assert.throws(
    () =>
      toExecutionDecisionResponse({
        decisionCode: "EXECUTION_AD_HOC_BLOCK",
        gateFamily: "provider",
        outcome: "blocked",
        customerMessageKey: "broker.provider.researchRequired",
        severity: "blocked",
        auditEventHint: "ad_hoc",
        redactionClass: "customer_safe",
        ownerTask: "test",
        allowedSurfaces: ["api"],
      } as unknown as ExecutionDecisionEntry),
    /Unregistered execution decision code/,
  );
});
