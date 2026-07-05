import {
  getExecutionDecisionEntryOrThrow,
  type ExecutionDecisionEntry,
} from "./execution-decision-registry";
import type { ExecutionDecisionCode } from "./execution-decision-codes";

export type ExecutionDecisionResponse = Pick<
  ExecutionDecisionEntry,
  | "decisionCode"
  | "gateFamily"
  | "outcome"
  | "customerMessageKey"
  | "severity"
  | "auditEventHint"
  | "redactionClass"
>;

export function toExecutionDecisionResponse(
  input: ExecutionDecisionCode | ExecutionDecisionEntry,
): ExecutionDecisionResponse {
  const entry =
    typeof input === "string"
      ? getExecutionDecisionEntryOrThrow(input)
      : getExecutionDecisionEntryOrThrow(input.decisionCode);

  return {
    decisionCode: entry.decisionCode,
    gateFamily: entry.gateFamily,
    outcome: entry.outcome,
    customerMessageKey: entry.customerMessageKey,
    severity: entry.severity,
    auditEventHint: entry.auditEventHint,
    redactionClass: entry.redactionClass,
  };
}
