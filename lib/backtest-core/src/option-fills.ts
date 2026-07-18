import type { BacktestBar } from "./types";

export type OptionFillModel =
  | "legacy_open_slippage"
  | "conservative_quote"
  | "post_and_wait";

export type OptionFillSide = "buy" | "sell";

export type OptionFillRejectionReason =
  | "missing_quote"
  | "invalid_quote"
  | "crossed_quote"
  | "quote_stale"
  | "spread_too_wide"
  | "limit_not_touched";

export type OptionFillDecisionReason =
  | "legacy_open_slippage"
  | "quote_side"
  | "post_and_wait_limit";

export type OptionFillPolicy = {
  model: OptionFillModel;
  requireBidAsk: boolean;
  maxSpreadPctOfMid: number;
  maxQuoteAgeMs: number;
  missingQuoteAction: "no_fill" | "legacy_fallback";
  sameBarTieBreak: "conservative";
  postAndWait?: {
    entryOffsetPctOfSpread: number;
    exitOffsetPctOfSpread: number;
    maxWaitBars: number;
    crossAfterBars: number;
  };
};

export type OptionFillDiagnostics = {
  model: OptionFillModel;
  side: OptionFillSide;
  bid: number | null;
  ask: number | null;
  mid: number | null;
  spreadPercent: number | null;
  quoteAgeMs: number | null;
};

export type OptionFillDecision =
  | {
      status: "filled";
      fillPrice: number;
      reason: OptionFillDecisionReason;
      diagnostics: OptionFillDiagnostics;
    }
  | {
      status: "no_fill";
      reason: OptionFillRejectionReason;
      diagnostics: OptionFillDiagnostics;
    };

export type ResolveOptionFillInput = {
  bar: BacktestBar;
  side: OptionFillSide;
  policy: OptionFillPolicy;
  occurredAt?: Date;
  orderAgeBars?: number;
};

export const defaultLegacyOptionFillPolicy: OptionFillPolicy = {
  model: "legacy_open_slippage",
  requireBidAsk: false,
  maxSpreadPctOfMid: 100,
  maxQuoteAgeMs: 60_000,
  missingQuoteAction: "legacy_fallback",
  sameBarTieBreak: "conservative",
};

export const defaultConservativeOptionFillPolicy: OptionFillPolicy = {
  model: "conservative_quote",
  requireBidAsk: true,
  maxSpreadPctOfMid: 35,
  maxQuoteAgeMs: 15_000,
  missingQuoteAction: "no_fill",
  sameBarTieBreak: "conservative",
};

function finitePositive(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function resolveMid(bar: BacktestBar, bid: number | null, ask: number | null): number | null {
  const explicitMid = finitePositive(bar.mid);
  if (explicitMid != null) {
    return explicitMid;
  }
  if (bid != null && ask != null) {
    return (bid + ask) / 2;
  }
  return null;
}

function quoteAgeMs(bar: BacktestBar, occurredAt: Date | undefined): number | null {
  if (!occurredAt || !bar.quoteAsOf) {
    return null;
  }
  const age = occurredAt.getTime() - bar.quoteAsOf.getTime();
  return Number.isFinite(age) ? Math.max(0, age) : null;
}

function diagnostics(
  input: ResolveOptionFillInput,
  bid: number | null,
  ask: number | null,
  mid: number | null,
): OptionFillDiagnostics {
  const spreadPercent =
    bid != null && ask != null && mid != null && mid > 0
      ? ((ask - bid) / mid) * 100
      : null;
  return {
    model: input.policy.model,
    side: input.side,
    bid,
    ask,
    mid,
    spreadPercent,
    quoteAgeMs: quoteAgeMs(input.bar, input.occurredAt),
  };
}

function legacyFill(input: ResolveOptionFillInput): OptionFillDecision {
  const price = finitePositive(input.bar.open);
  const diag = diagnostics(input, null, null, null);
  if (price == null) {
    return { status: "no_fill", reason: "invalid_quote", diagnostics: diag };
  }
  return {
    status: "filled",
    fillPrice: price,
    reason: "legacy_open_slippage",
    diagnostics: diag,
  };
}

function validateQuote(input: ResolveOptionFillInput): {
  bid: number | null;
  ask: number | null;
  mid: number | null;
  diagnostics: OptionFillDiagnostics;
  rejection: OptionFillRejectionReason | null;
} {
  const rawBid = input.bar.bid;
  const rawAsk = input.bar.ask;
  const bid = finitePositive(rawBid);
  const ask = finitePositive(rawAsk);
  const mid = resolveMid(input.bar, bid, ask);
  const diag = diagnostics(input, bid, ask, mid);

  if ((rawBid != null && bid == null) || (rawAsk != null && ask == null)) {
    return { bid, ask, mid, diagnostics: diag, rejection: "invalid_quote" };
  }

  if (bid == null || ask == null || mid == null) {
    return {
      bid,
      ask,
      mid,
      diagnostics: diag,
      rejection: input.policy.requireBidAsk ? "missing_quote" : null,
    };
  }

  if (ask < bid) {
    return { bid, ask, mid, diagnostics: diag, rejection: "crossed_quote" };
  }

  if (
    diag.quoteAgeMs != null &&
    input.policy.maxQuoteAgeMs > 0 &&
    diag.quoteAgeMs > input.policy.maxQuoteAgeMs
  ) {
    return { bid, ask, mid, diagnostics: diag, rejection: "quote_stale" };
  }

  if (
    diag.spreadPercent != null &&
    input.policy.maxSpreadPctOfMid > 0 &&
    diag.spreadPercent > input.policy.maxSpreadPctOfMid
  ) {
    return { bid, ask, mid, diagnostics: diag, rejection: "spread_too_wide" };
  }

  return { bid, ask, mid, diagnostics: diag, rejection: null };
}

function postAndWaitLimitPrice(input: ResolveOptionFillInput, bid: number, ask: number): number {
  const spread = ask - bid;
  const config = input.policy.postAndWait;
  const offset =
    input.side === "buy"
      ? (config?.entryOffsetPctOfSpread ?? 50)
      : (config?.exitOffsetPctOfSpread ?? 50);
  const normalizedOffset = Math.min(100, Math.max(0, offset)) / 100;
  return input.side === "buy"
    ? bid + spread * normalizedOffset
    : ask - spread * normalizedOffset;
}

function barTouchesLimit(bar: BacktestBar, side: OptionFillSide, limitPrice: number): boolean {
  return side === "buy" ? bar.low <= limitPrice : bar.high >= limitPrice;
}

export function resolveOptionFill(input: ResolveOptionFillInput): OptionFillDecision {
  if (input.policy.model === "legacy_open_slippage") {
    return legacyFill(input);
  }

  const quote = validateQuote(input);
  if (quote.rejection) {
    if (quote.rejection === "missing_quote" && input.policy.missingQuoteAction === "legacy_fallback") {
      return legacyFill(input);
    }
    return {
      status: "no_fill",
      reason: quote.rejection,
      diagnostics: quote.diagnostics,
    };
  }

  if (quote.bid == null || quote.ask == null) {
    return {
      status: "no_fill",
      reason: "missing_quote",
      diagnostics: quote.diagnostics,
    };
  }

  if (input.policy.model === "conservative_quote") {
    return {
      status: "filled",
      fillPrice: input.side === "buy" ? quote.ask : quote.bid,
      reason: "quote_side",
      diagnostics: quote.diagnostics,
    };
  }

  const limitPrice = postAndWaitLimitPrice(input, quote.bid, quote.ask);
  const crossAfterBars = input.policy.postAndWait?.crossAfterBars;
  const orderAgeBars = Math.max(0, Math.round(input.orderAgeBars ?? 0));
  const shouldCross =
    typeof crossAfterBars === "number" &&
    Number.isFinite(crossAfterBars) &&
    orderAgeBars >= Math.max(0, Math.round(crossAfterBars));

  if (barTouchesLimit(input.bar, input.side, limitPrice)) {
    return {
      status: "filled",
      fillPrice: limitPrice,
      reason: "post_and_wait_limit",
      diagnostics: quote.diagnostics,
    };
  }

  if (shouldCross) {
    return {
      status: "filled",
      fillPrice: input.side === "buy" ? quote.ask : quote.bid,
      reason: "quote_side",
      diagnostics: quote.diagnostics,
    };
  }

  return {
    status: "no_fill",
    reason: "limit_not_touched",
    diagnostics: quote.diagnostics,
  };
}
