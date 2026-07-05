export const buildTicketReadinessModel = ({
  executionMode = "real",
  brokerRoute = "ibkr",
  gatewayTradingReady = false,
  brokerConfigured = false,
  brokerAuthenticated = false,
  accountId = null,
  snapTradeExecutionReady = false,
  snapTradeExecutionBlockers = [],
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
  const snapTradeMode = !shadowMode && brokerRoute === "snaptrade";

  if (!ticketInstrumentReady) {
    issues.push("contract");
  }
  if (!quoteReady) {
    issues.push("quote");
  }
  if (snapTradeMode) {
    if (!snapTradeExecutionReady) {
      const blockers = Array.isArray(snapTradeExecutionBlockers)
        ? snapTradeExecutionBlockers.filter(Boolean)
        : [];
      issues.push(blockers.length ? blockers.join(" / ") : "snaptrade account");
    }
  } else if (!shadowMode) {
    if (!brokerConfigured) {
      issues.push("ibkr");
    }
    if (brokerConfigured && !brokerAuthenticated) {
      issues.push("auth");
    }
    if (!accountId) {
      issues.push("account");
    }
    if (!gatewayTradingReady) {
      warnings.push("gateway");
    }
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
    detail: shadowMode
      ? "Shadow route ready"
      : snapTradeMode
        ? "SnapTrade route ready"
        : "IBKR route ready",
    issues,
    warnings,
  };
};
