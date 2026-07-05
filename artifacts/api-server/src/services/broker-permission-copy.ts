import type {
  ExecutionCustomerMessageKey,
  ExecutionDecisionSeverity,
} from "./execution-decision-registry";

export type BrokerPermissionCopyEntry = {
  customerMessageKey: ExecutionCustomerMessageKey;
  defaultMessage: string;
  severity: ExecutionDecisionSeverity;
};

export const brokerPermissionCopyEntries = [
  {
    customerMessageKey: "broker.scope.ready",
    defaultMessage: "Broker permissions are ready for automation.",
    severity: "info",
  },
  {
    customerMessageKey:
      "broker.scope.automationTradingConnection.missingRequired",
    defaultMessage:
      "This connection is missing permissions required for automated trading.",
    severity: "action_required",
  },
  {
    customerMessageKey: "broker.provider.eligible",
    defaultMessage: "This broker path is eligible for automation.",
    severity: "info",
  },
  {
    customerMessageKey: "broker.provider.researchRequired",
    defaultMessage:
      "This broker path needs provider research before it can be enabled.",
    severity: "blocked",
  },
  {
    customerMessageKey: "broker.provider.insufficientCapability",
    defaultMessage:
      "This connection does not provide the capabilities required for automation.",
    severity: "provider_limitation",
  },
  {
    customerMessageKey: "broker.provider.unsupported",
    defaultMessage: "This provider is not supported for automation.",
    severity: "blocked",
  },
  {
    customerMessageKey: "broker.provider.ibkrSpecialConnector",
    defaultMessage:
      "This broker uses the existing special connector instead of the hosted broker path.",
    severity: "action_required",
  },
  {
    customerMessageKey: "broker.provider.complianceReviewRequired",
    defaultMessage:
      "This broker path requires compliance review before activation.",
    severity: "security_blocked",
  },
  {
    customerMessageKey: "capability.ready",
    defaultMessage: "Account capabilities are current and ready.",
    severity: "info",
  },
  {
    customerMessageKey: "capability.sync.required",
    defaultMessage:
      "Account capabilities must be synced before automation can continue.",
    severity: "action_required",
  },
  {
    customerMessageKey: "capability.sync.stale",
    defaultMessage:
      "Account capabilities are stale and must be refreshed before automation can continue.",
    severity: "action_required",
  },
  {
    customerMessageKey: "capability.unsupported",
    defaultMessage:
      "This account does not support every capability required for automation.",
    severity: "provider_limitation",
  },
  {
    customerMessageKey: "capability.order_shape.unsupported",
    defaultMessage:
      "This account does not support the selected order shape.",
    severity: "provider_limitation",
  },
  {
    customerMessageKey: "capability.preview.unavailable",
    defaultMessage: "Order preview is unavailable for this connection.",
    severity: "provider_limitation",
  },
  {
    customerMessageKey: "capability.order_status_streaming.unavailable",
    defaultMessage:
      "Order status streaming is unavailable for this connection.",
    severity: "provider_limitation",
  },
  {
    customerMessageKey: "capability.cancel_replace.unsupported",
    defaultMessage:
      "Cancel or replace support is unavailable for this connection.",
    severity: "provider_limitation",
  },
  {
    customerMessageKey: "capability.asset_class.single_leg_options.unsupported",
    defaultMessage:
      "Single-leg options are unavailable for this connection.",
    severity: "provider_limitation",
  },
  {
    customerMessageKey: "provider.paper.unsupported",
    defaultMessage: "Paper connections are not eligible for live automation.",
    severity: "provider_limitation",
  },
  {
    customerMessageKey: "provider.demo.unsupported",
    defaultMessage: "Demo connections are not eligible for live automation.",
    severity: "provider_limitation",
  },
  {
    customerMessageKey: "provider.read_only.unsupported",
    defaultMessage: "Read-only connections cannot submit or manage orders.",
    severity: "provider_limitation",
  },
  {
    customerMessageKey: "provider.submit_only.unsupported",
    defaultMessage:
      "Submit-only connections cannot read and manage orders after submission.",
    severity: "provider_limitation",
  },
] as const satisfies readonly BrokerPermissionCopyEntry[];

export const brokerPermissionCopyKeys = brokerPermissionCopyEntries.map(
  (entry) => entry.customerMessageKey,
);
