export const buildTicketReadinessModel = ({
  executionMode = "real",
  gatewayTradingReady = false,
  brokerConfigured = false,
  brokerAuthenticated = false,
  accountId = null,
  ticketInstrumentReady = false,
  quoteReady = false,
  spreadPct = null,
  previewPending = false,
  submitPending = false,
  sellCallBlocked = false,
  shadowExposureWarning = false,
  automationDeviationCount = 0,
} = {}) => {
  const issues = [];
  const warnings = [];
  const shadowMode = executionMode === "shadow";

  if (!ticketInstrumentReady) {
    issues.push("contract");
  }
  if (!quoteReady) {
    issues.push("quote");
  }
  if (!shadowMode && !brokerConfigured) {
    issues.push("ibkr");
  }
  if (!shadowMode && brokerConfigured && !brokerAuthenticated) {
    issues.push("auth");
  }
  if (!shadowMode && !accountId) {
    issues.push("account");
  }
  if (!gatewayTradingReady) {
    warnings.push("gateway");
  }
  if (Number.isFinite(spreadPct) && spreadPct >= 18) {
    warnings.push("wide spread");
  }
  if (sellCallBlocked) {
    issues.push("coverage");
  }
  if (shadowExposureWarning) {
    warnings.push("shadow exposure");
  }
  if (automationDeviationCount > 0) {
    warnings.push(`${automationDeviationCount} deviation${automationDeviationCount === 1 ? "" : "s"}`);
  }
  if (previewPending || submitPending) {
    warnings.push("working");
  }

  if (issues.length) {
    return {
      tone: "bad",
      label: "Blocked",
      detail: issues.join(" / "),
      issues,
      warnings,
    };
  }

  if (warnings.length) {
    return {
      tone: "warn",
      label: "Check",
      detail: warnings.join(" / "),
      issues,
      warnings,
    };
  }

  return {
    tone: "good",
    label: "Ready",
    detail: shadowMode ? "Shadow route ready" : "IBKR route ready",
    issues,
    warnings,
  };
};
