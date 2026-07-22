export type SignalOptionsStopElectionSource = "double_last" | "double_bid";

type Evidence = { identity: string; observedAt: number };
type ElectionState = {
  stopRevision: string;
  trade: Evidence | null;
  bid: Evidence | null;
  electedAt: number | null;
  source: SignalOptionsStopElectionSource | null;
};

const states = new Map<string, ElectionState>();
const executablePeaks = new Map<string, number>();

function isNonblankString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function timestamp(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value : null;
  }
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

// A real-time snapshot can carry an unchanged, old exchange NBBO timestamp while
// also proving that the API received that still-current quote just now. Stop
// evidence must age and identify the server receipt first; otherwise thin options
// can never produce two fresh/distinct observations while their NBBO stays flat.
export function signalOptionsStopQuoteObservedAt(
  quote: Record<string, unknown> | null | undefined,
): Date | null {
  const latency = record(quote?.latency);
  return (
    timestamp(latency?.apiServerReceivedAt) ??
    timestamp(quote?.dataUpdatedAt) ??
    timestamp(quote?.quoteUpdatedAt) ??
    timestamp(quote?.updatedAt)
  );
}

export function signalOptionsStopQuoteEvidence(input: {
  quote: Record<string, unknown> | null | undefined;
  bid: number | null;
  ask: number | null;
  observedAt: Date;
  maxAgeMs: number;
  eligible: boolean;
}) {
  const quoteObservedAt = signalOptionsStopQuoteObservedAt(input.quote);
  if (
    !quoteObservedAt ||
    input.bid == null ||
    input.ask == null ||
    !Number.isFinite(input.observedAt.getTime())
  ) {
    return null;
  }
  const ageMs = input.observedAt.getTime() - quoteObservedAt.getTime();
  return {
    bid: input.bid,
    ask: input.ask,
    identity: `${quoteObservedAt.toISOString()}:${input.bid}:${input.ask}`,
    fresh:
      input.eligible &&
      Number.isFinite(input.maxAgeMs) &&
      input.maxAgeMs >= 0 &&
      ageMs >= 0 &&
      ageMs <= input.maxAgeMs,
  };
}

export function signalOptionsStopElectionPositionKey(input: {
  id: string;
  candidateId: string;
  openedAt: string;
}) {
  return [input.id, input.candidateId, input.openedAt].join("\u0000");
}

export function ratchetSignalOptionsExecutablePeak(input: {
  positionKey: string;
  baselinePeak: number;
  bid: number | null;
}) {
  const validPositionKey = isNonblankString(input.positionKey);
  const priorPeak = validPositionKey
    ? executablePeaks.get(input.positionKey)
    : undefined;
  const cachedPeak =
    priorPeak != null && Number.isFinite(priorPeak) && priorPeak > 0
      ? priorPeak
      : undefined;
  const validBaseline =
    Number.isFinite(input.baselinePeak) && input.baselinePeak > 0;
  if (!validPositionKey) {
    return 0;
  }
  if (
    !validBaseline ||
    (input.bid !== null && (!Number.isFinite(input.bid) || input.bid <= 0))
  ) {
    return cachedPeak ?? (validBaseline ? input.baselinePeak : 0);
  }
  const peak = Math.max(cachedPeak ?? 0, input.baselinePeak, input.bid ?? 0);
  executablePeaks.set(input.positionKey, peak);
  return peak;
}

export function electSignalOptionsRegularStop(input: {
  positionKey: string;
  stopPrice: number;
  stopRevision: string;
  observedAt: Date;
  maxEvidenceSpacingMs?: number;
  trade?: {
    price: number;
    identity: string;
    eligible: boolean;
    fresh: boolean;
    occurredAt?: Date;
  } | null;
  quote?: {
    bid: number;
    ask: number;
    identity: string;
    fresh: boolean;
  } | null;
}) {
  const observedAt =
    input.observedAt instanceof Date ? input.observedAt.getTime() : Number.NaN;
  const maxSpacing = input.maxEvidenceSpacingMs ?? 10_000;
  const trade = input.trade;
  const quote = input.quote;
  const validPositionKey = isNonblankString(input.positionKey);
  if (
    !validPositionKey ||
    !isNonblankString(input.stopRevision) ||
    !Number.isFinite(input.stopPrice) ||
    input.stopPrice <= 0 ||
    !Number.isFinite(observedAt) ||
    !Number.isFinite(maxSpacing) ||
    maxSpacing < 0 ||
    (trade != null &&
      (!Number.isFinite(trade.price) ||
        trade.price <= 0 ||
        !isNonblankString(trade.identity) ||
        typeof trade.eligible !== "boolean" ||
        typeof trade.fresh !== "boolean" ||
        (trade.occurredAt !== undefined &&
          (!(trade.occurredAt instanceof Date) ||
            !Number.isFinite(trade.occurredAt.getTime()))))) ||
    (quote != null &&
      (!Number.isFinite(quote.bid) ||
        quote.bid <= 0 ||
        !Number.isFinite(quote.ask) ||
        quote.ask <= 0 ||
        quote.ask < quote.bid ||
        !isNonblankString(quote.identity) ||
        typeof quote.fresh !== "boolean"))
  ) {
    if (validPositionKey) {
      states.delete(input.positionKey);
    }
    return {
      elected: false as const,
      source: null,
      electedAt: null,
      reason: "awaiting_confirmation" as const,
      evidenceCount: 0,
    };
  }

  const tradeAt = trade?.occurredAt?.getTime() ?? observedAt;
  let state = states.get(input.positionKey);
  if (!state || state.stopRevision !== input.stopRevision) {
    state = {
      stopRevision: input.stopRevision,
      trade: null,
      bid: null,
      electedAt: null,
      source: null,
    };
    states.set(input.positionKey, state);
  }
  if (state.electedAt != null && state.source) {
    const recovered =
      (state.source === "double_last" &&
        trade != null &&
        tradeAt >= (state.trade?.observedAt ?? tradeAt) &&
        (!trade.eligible || !trade.fresh || trade.price > input.stopPrice)) ||
      (state.source === "double_bid" &&
        quote != null &&
        observedAt >= (state.bid?.observedAt ?? observedAt) &&
        (!quote.fresh || quote.bid > input.stopPrice));
    if (observedAt - state.electedAt > maxSpacing || recovered) {
      state.trade = null;
      state.bid = null;
      state.electedAt = null;
      state.source = null;
    } else {
      return {
        elected: true as const,
        source: state.source,
        electedAt: new Date(state.electedAt),
        reason: "confirmed" as const,
        evidenceCount: 2,
      };
    }
  }

  if (trade) {
    if (state.trade && tradeAt < state.trade.observedAt) {
      // Ignore provider evidence older than the current chronological anchor.
    } else if (
      !trade.eligible ||
      !trade.fresh ||
      trade.price > input.stopPrice
    ) {
      state.trade = null;
    } else if (state.trade?.identity !== trade.identity) {
      const spacingMs = state.trade ? tradeAt - state.trade.observedAt : null;
      if (
        state.trade &&
        spacingMs != null &&
        spacingMs >= 0 &&
        spacingMs <= maxSpacing
      ) {
        state.trade = { identity: trade.identity, observedAt: tradeAt };
        state.electedAt = observedAt;
        state.source = "double_last";
      } else {
        state.trade = { identity: trade.identity, observedAt: tradeAt };
      }
    }
  }

  if (state.electedAt == null && quote) {
    if (state.bid && observedAt < state.bid.observedAt) {
      // Ignore quote evidence older than the current chronological anchor.
    } else if (!quote.fresh || quote.bid > input.stopPrice) {
      state.bid = null;
    } else if (state.bid?.identity !== quote.identity) {
      const spacingMs = state.bid ? observedAt - state.bid.observedAt : null;
      if (
        state.bid &&
        spacingMs != null &&
        spacingMs >= 0 &&
        spacingMs <= maxSpacing
      ) {
        state.bid = { identity: quote.identity, observedAt };
        state.electedAt = observedAt;
        state.source = "double_bid";
      } else {
        state.bid = { identity: quote.identity, observedAt };
      }
    }
  }

  const evidenceCount = Math.max(state.trade ? 1 : 0, state.bid ? 1 : 0);
  return state.electedAt != null && state.source
    ? {
        elected: true as const,
        source: state.source,
        electedAt: new Date(state.electedAt),
        reason: "confirmed" as const,
        evidenceCount: 2,
      }
    : {
        elected: false as const,
        source: null,
        electedAt: null,
        reason: "awaiting_confirmation" as const,
        evidenceCount,
      };
}

export function clearSignalOptionsStopElection(positionKey: string) {
  states.delete(positionKey);
  executablePeaks.delete(positionKey);
}

export function clearSignalOptionsStopElectionStateForTests() {
  states.clear();
  executablePeaks.clear();
}
