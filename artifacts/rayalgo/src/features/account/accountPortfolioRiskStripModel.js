import { finiteNumber, getOpenPositionRows } from "./accountPositionRows.js";

const absFinite = (value) => {
  const numeric = finiteNumber(value);
  return numeric == null ? null : Math.abs(numeric);
};

const metricValue = (metric) => finiteNumber(metric?.value);

const firstFinite = (...values) => {
  for (const value of values) {
    const numeric = finiteNumber(value);
    if (numeric != null) {
      return numeric;
    }
  }
  return null;
};

const ratioToPercent = (value) => {
  const numeric = finiteNumber(value);
  if (numeric == null) {
    return null;
  }
  return Math.abs(numeric) <= 1 ? numeric * 100 : numeric;
};

const ratioForSeverity = (value) => {
  const numeric = finiteNumber(value);
  if (numeric == null) {
    return null;
  }
  return Math.abs(numeric) <= 1 ? numeric : numeric / 100;
};

const marketValueForPosition = (position) => {
  const direct = firstFinite(
    position?.marketValue,
    position?.notional,
    position?.grossMarketValue,
    position?.currentValue,
  );
  if (direct != null) {
    return direct;
  }

  const quantity = finiteNumber(position?.quantity);
  const mark = firstFinite(position?.markPrice, position?.lastPrice, position?.averageCost);
  if (quantity == null || mark == null) {
    return null;
  }
  return quantity * mark;
};

const buildOpenRiskSummary = (positions = []) => {
  const openPositions = getOpenPositionRows(positions);
  const grossExposure = openPositions.reduce((sum, position) => {
    const value = absFinite(marketValueForPosition(position));
    return sum + (value ?? 0);
  }, 0);
  return {
    openPositions,
    grossExposure,
  };
};

const concentrationFromRisk = (riskData) => {
  const rows = Array.isArray(riskData?.concentration?.topPositions)
    ? riskData.concentration.topPositions
    : [];
  const top = rows.reduce(
    (winner, row) => {
      const weight = ratioToPercent(row?.weightPercent);
      const absWeight = weight == null ? null : Math.abs(weight);
      if (absWeight == null || absWeight <= winner.absWeight) {
        return winner;
      }
      return {
        symbol: row?.symbol || null,
        absWeight,
      };
    },
    { symbol: null, absWeight: 0 },
  );
  return top.absWeight > 0 ? top : null;
};

const concentrationFromPositions = (positions, netLiquidation) => {
  if (!netLiquidation) {
    return null;
  }
  const top = positions.reduce(
    (winner, position) => {
      const marketValue = marketValueForPosition(position);
      const absWeight =
        marketValue == null ? null : Math.abs((marketValue / netLiquidation) * 100);
      if (absWeight == null || absWeight <= winner.absWeight) {
        return winner;
      }
      return {
        symbol: position?.symbol || null,
        absWeight,
      };
    },
    { symbol: null, absWeight: 0 },
  );
  return top.absWeight > 0 ? top : null;
};

const toneForSigned = (value) => {
  const numeric = finiteNumber(value);
  if (numeric == null) {
    return "default";
  }
  return numeric >= 0 ? "green" : "red";
};

const toneForMarginCushion = (value) => {
  const ratio = ratioForSeverity(value);
  if (ratio == null) {
    return "default";
  }
  if (ratio > 0.5) {
    return "green";
  }
  if (ratio > 0.25) {
    return "amber";
  }
  return "red";
};

const toneForConcentration = (percent) => {
  const numeric = finiteNumber(percent);
  if (numeric == null) {
    return "default";
  }
  if (numeric >= 35) {
    return "red";
  }
  if (numeric >= 20) {
    return "amber";
  }
  return "green";
};

const resolveAccountState = ({
  accountMode,
  brokerAuthenticated,
  gatewayTradingReady,
  isLoading,
}) => {
  if (isLoading) {
    return {
      label: "Loading",
      tone: "default",
      detail: "Account streams hydrating",
    };
  }
  if (accountMode === "shadow") {
    return {
      label: "Shadow",
      tone: "pink",
      detail: "Internal paper ledger",
    };
  }
  if (brokerAuthenticated && gatewayTradingReady) {
    return {
      label: "Live",
      tone: "green",
      detail: "IBKR bridge ready",
    };
  }
  if (brokerAuthenticated) {
    return {
      label: "Degraded",
      tone: "amber",
      detail: "Broker connected, trading gated",
    };
  }
  return {
    label: "Disconnected",
    tone: "default",
    detail: "Broker stream unavailable",
  };
};

export const buildPortfolioRiskStripModel = ({
  summary,
  riskData,
  positionsResponse,
  accountMode = "real",
  brokerAuthenticated = false,
  gatewayTradingReady = false,
  isLoading = false,
} = {}) => {
  const metrics = summary?.metrics || {};
  const currency = summary?.currency || riskData?.currency || "USD";
  const { openPositions, grossExposure } = buildOpenRiskSummary(
    positionsResponse?.positions || [],
  );
  const netLiquidation = metricValue(metrics.netLiquidation);
  const buyingPower = metricValue(metrics.buyingPower);
  const dayPnl = metricValue(metrics.dayPnl);
  const marginCushion = firstFinite(
    riskData?.margin?.maintenanceCushionPercent,
    metricValue(metrics.maintenanceMarginCushionPercent),
  );
  const marginUsed = firstFinite(
    riskData?.margin?.marginUsed,
    metricValue(metrics.marginUsed),
  );
  const concentration =
    concentrationFromRisk(riskData) ||
    concentrationFromPositions(openPositions, netLiquidation);
  const concentrationPercent = concentration?.absWeight ?? null;
  const openRiskTone =
    buyingPower != null && grossExposure > buyingPower ? "amber" : "default";
  const accountState = resolveAccountState({
    accountMode,
    brokerAuthenticated,
    gatewayTradingReady,
    isLoading,
  });

  return {
    currency,
    state: accountState,
    cards: [
      {
        id: "buying-power",
        label: "Buying Power",
        value: buyingPower,
        valueKind: "money",
        tone: "accent",
        detail: metrics.buyingPower?.field || "BuyingPower",
      },
      {
        id: "open-risk",
        label: "Open Risk",
        value: grossExposure,
        valueKind: "money",
        tone: openRiskTone,
        detail: `${openPositions.length} open positions`,
      },
      {
        id: "day-pnl",
        label: "Day P&L",
        value: dayPnl,
        valueKind: "signedMoney",
        tone: toneForSigned(dayPnl),
        detail: metrics.dayPnl?.field || "QuoteChange",
      },
      {
        id: "margin-pressure",
        label: "Margin Pressure",
        value: ratioToPercent(marginCushion),
        valueKind: "percent",
        tone: toneForMarginCushion(marginCushion),
        detail: marginUsed == null ? "Maintenance cushion" : "Cushion vs used margin",
      },
      {
        id: "concentration",
        label: "Concentration",
        value: concentrationPercent,
        valueKind: "percent",
        tone: toneForConcentration(concentrationPercent),
        detail: concentration?.symbol ? `Top ${concentration.symbol}` : "Top position",
      },
      {
        id: "live-state",
        label: "State",
        value: null,
        text: accountState.label,
        valueKind: "text",
        tone: accountState.tone,
        detail: accountState.detail,
      },
    ],
  };
};
