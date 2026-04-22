import { buildOrderPreview } from "./orderValidation.js";
import { normalizeOptionContractPayload } from "./optionContracts.js";

const OPTION_STALE_AGE_MS = 90_000;
const WARNING_SPREAD_PCT = 0.2;
const BLOCKING_SPREAD_PCT = 0.4;
const BLOCKING_MARKET_SPREAD_PCT = 0.3;
const WARNING_CONTRACT_QUANTITY = 75;
const BLOCKING_CONTRACT_QUANTITY = 250;

export async function buildOrderPreflight({
  order,
  payload = null,
  account = null,
  adapter = null,
  commissionPerContract = 0.65,
}) {
  const checks = [];
  const preview = buildOrderPreview(order, commissionPerContract);
  const generatedAt = new Date().toISOString();

  if (!order || typeof order !== "object") {
    checks.push(makeCheck("ORDER_PAYLOAD_INVALID", "error", "Order payload is missing or invalid."));
    return finalizePreflight({
      order,
      checks,
      preview,
      contract: null,
      quote: null,
      generatedAt,
    });
  }

  if (order.assetType !== "option") {
    const accountBuyingPower = Number(account?.buyingPower);
    if (
      order.side === "buy"
      && Number.isFinite(accountBuyingPower)
      && Number(preview.estimatedTotal || 0) > accountBuyingPower
    ) {
      checks.push(makeCheck(
        "INSUFFICIENT_BUYING_POWER",
        "error",
        "Estimated total exceeds account buying power.",
        {
          value: round2(preview.estimatedTotal),
          threshold: round2(accountBuyingPower),
          unit: "USD",
        },
      ));
    }
    return finalizePreflight({
      order,
      checks,
      preview,
      contract: null,
      quote: null,
      generatedAt,
    });
  }

  const contract = normalizeOptionContractPayload(payload, {
    symbol: order.symbol,
    expiry: order.option?.expiry,
    strike: order.option?.strike,
    right: order.option?.right,
    contractId: order.optionContractId || order.optionContract?.contractId,
  });
  if (!contract) {
    checks.push(makeCheck(
      "OPTION_CONTRACT_INVALID",
      "error",
      "Option contract details are incomplete or invalid.",
    ));
    return finalizePreflight({
      order,
      checks,
      preview,
      contract: null,
      quote: null,
      generatedAt,
    });
  }

  let chain = null;
  if (adapter?.getOptionChain && account) {
    try {
      chain = await adapter.getOptionChain(account, {
        symbol: contract.symbol,
        expiry: contract.expiry,
      });
    } catch (error) {
      checks.push(makeCheck(
        "OPTION_CHAIN_UNAVAILABLE",
        "warning",
        `Unable to fetch live chain for preflight: ${error?.message || "unknown error"}.`,
      ));
    }
  } else {
    checks.push(makeCheck(
      "OPTION_CHAIN_UNAVAILABLE",
      "warning",
      "Adapter chain lookup unavailable for preflight checks.",
    ));
  }

  const row = findMatchingOptionRow(chain?.rows, contract);
  if (!row) {
    checks.push(makeCheck(
      "OPTION_CONTRACT_NOT_FOUND",
      "error",
      "Selected option contract was not found in the current chain snapshot.",
    ));
  }

  const bid = Number(row?.bid);
  const ask = Number(row?.ask);
  const mid = Number.isFinite(bid) && Number.isFinite(ask)
    ? (bid + ask) / 2
    : Number(row?.mark || row?.last || NaN);
  const spread = Number.isFinite(bid) && Number.isFinite(ask)
    ? Math.max(0, ask - bid)
    : NaN;
  const spreadPct = Number.isFinite(spread) && Number.isFinite(mid) && mid > 0
    ? spread / mid
    : NaN;

  if (!Number.isFinite(bid) || !Number.isFinite(ask)) {
    checks.push(makeCheck(
      "QUOTE_INCOMPLETE",
      "warning",
      "Bid/ask quote is incomplete for this contract.",
    ));
  }

  if (Number.isFinite(spreadPct) && spreadPct >= BLOCKING_SPREAD_PCT) {
    checks.push(makeCheck(
      "SPREAD_TOO_WIDE",
      "error",
      "Bid/ask spread is too wide for safe execution.",
      {
        value: round4(spreadPct),
        threshold: BLOCKING_SPREAD_PCT,
        unit: "ratio",
      },
    ));
  } else if (Number.isFinite(spreadPct) && spreadPct >= WARNING_SPREAD_PCT) {
    checks.push(makeCheck(
      "SPREAD_WIDE_WARNING",
      "warning",
      "Bid/ask spread is wide; consider using a tighter limit.",
      {
        value: round4(spreadPct),
        threshold: WARNING_SPREAD_PCT,
        unit: "ratio",
      },
    ));
  }

  if (
    order.orderType === "market"
    && Number.isFinite(spreadPct)
    && spreadPct >= BLOCKING_MARKET_SPREAD_PCT
  ) {
    checks.push(makeCheck(
      "MARKET_ORDER_SPREAD_BLOCK",
      "error",
      "Market order blocked on a wide spread contract.",
      {
        value: round4(spreadPct),
        threshold: BLOCKING_MARKET_SPREAD_PCT,
        unit: "ratio",
      },
    ));
  }

  if (order.orderType === "limit") {
    const limitPrice = Number(order.limitPrice);
    if (Number.isFinite(limitPrice) && Number.isFinite(ask) && Number.isFinite(bid)) {
      if (order.side === "buy" && limitPrice > ask * 1.1) {
        checks.push(makeCheck(
          "LIMIT_PRICE_HIGH_WARNING",
          "warning",
          "Buy limit is materially above current ask.",
          {
            value: round2(limitPrice),
            threshold: round2(ask),
            unit: "USD",
          },
        ));
      } else if (order.side === "sell" && limitPrice < bid * 0.9) {
        checks.push(makeCheck(
          "LIMIT_PRICE_LOW_WARNING",
          "warning",
          "Sell limit is materially below current bid.",
          {
            value: round2(limitPrice),
            threshold: round2(bid),
            unit: "USD",
          },
        ));
      }
    }
  }

  const quantity = Number(order.quantity);
  if (Number.isFinite(quantity) && quantity >= BLOCKING_CONTRACT_QUANTITY) {
    checks.push(makeCheck(
      "ORDER_SIZE_TOO_LARGE",
      "error",
      "Contract quantity exceeds configured safety limit.",
      {
        value: quantity,
        threshold: BLOCKING_CONTRACT_QUANTITY,
        unit: "contracts",
      },
    ));
  } else if (Number.isFinite(quantity) && quantity >= WARNING_CONTRACT_QUANTITY) {
    checks.push(makeCheck(
      "ORDER_SIZE_WARNING",
      "warning",
      "Large contract quantity; verify intended risk.",
      {
        value: quantity,
        threshold: WARNING_CONTRACT_QUANTITY,
        unit: "contracts",
      },
    ));
  }

  const accountBuyingPower = Number(account?.buyingPower);
  if (
    order.side === "buy"
    && Number.isFinite(accountBuyingPower)
    && Number(preview.estimatedTotal || 0) > accountBuyingPower
  ) {
    checks.push(makeCheck(
      "INSUFFICIENT_BUYING_POWER",
      "error",
      "Estimated total exceeds account buying power.",
      {
        value: round2(preview.estimatedTotal),
        threshold: round2(accountBuyingPower),
        unit: "USD",
      },
    ));
  }

  const quoteTimestampMs = Date.parse(row?.updatedAt || "");
  if (
    Number.isFinite(quoteTimestampMs)
    && Date.now() - quoteTimestampMs > OPTION_STALE_AGE_MS
  ) {
    checks.push(makeCheck(
      "QUOTE_STALE_WARNING",
      "warning",
      "Contract quote is stale.",
      {
        value: Math.round((Date.now() - quoteTimestampMs) / 1000),
        threshold: Math.round(OPTION_STALE_AGE_MS / 1000),
        unit: "seconds",
      },
    ));
  }

  if (Boolean(chain?.stale)) {
    checks.push(makeCheck(
      "CHAIN_STALE_WARNING",
      "warning",
      "Option chain source is flagged stale.",
    ));
  }

  return finalizePreflight({
    order,
    checks,
    preview,
    contract,
    quote: row
      ? {
        bid: Number.isFinite(bid) ? round2(bid) : null,
        ask: Number.isFinite(ask) ? round2(ask) : null,
        mid: Number.isFinite(mid) ? round2(mid) : null,
        spread: Number.isFinite(spread) ? round2(spread) : null,
        spreadPct: Number.isFinite(spreadPct) ? round4(spreadPct) : null,
        updatedAt: row.updatedAt || null,
        source: chain?.source || null,
        stale: Boolean(chain?.stale),
      }
      : null,
    generatedAt,
  });
}

export function isBlockingPreflight(preflight) {
  return Boolean(
    preflight?.blocking
    || (Array.isArray(preflight?.checks) && preflight.checks.some((check) => check?.severity === "error")),
  );
}

function finalizePreflight({ order, checks, preview, contract, quote, generatedAt }) {
  const hasErrors = checks.some((check) => check.severity === "error");
  return {
    ok: !hasErrors,
    blocking: hasErrors,
    generatedAt,
    orderSummary: {
      accountId: order?.accountId || null,
      symbol: order?.symbol || null,
      assetType: order?.assetType || null,
      side: order?.side || null,
      quantity: Number.isFinite(Number(order?.quantity)) ? Number(order.quantity) : null,
      orderType: order?.orderType || null,
      timeInForce: order?.timeInForce || null,
      executionMode: order?.executionMode || null,
    },
    contract,
    quote,
    preview,
    checks,
  };
}

function findMatchingOptionRow(rows, contract) {
  if (!Array.isArray(rows) || !contract) {
    return null;
  }
  return rows.find((row) => {
    if (!row || typeof row !== "object") {
      return false;
    }
    const right = String(row.right || "").toLowerCase();
    const strike = Number(row.strike);
    return (
      String(row.symbol || "").toUpperCase() === contract.symbol
      && String(row.expiry || "") === contract.expiry
      && Number.isFinite(strike)
      && Math.abs(strike - contract.strike) < 1e-6
      && right === contract.right
    );
  }) || null;
}

function makeCheck(code, severity, message, metric = null) {
  return {
    code,
    severity,
    message,
    metric: metric && typeof metric === "object" ? metric : null,
  };
}

function round2(value) {
  return Math.round(Number(value) * 100) / 100;
}

function round4(value) {
  return Math.round(Number(value) * 10000) / 10000;
}
