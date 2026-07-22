export type StopElectionEvent =
  | { kind: "trade"; id: string; at: Date; price: number }
  | { kind: "quote"; id: string; at: Date; bid: number; ask: number };

export type StopElectionConfirmation = {
  at: Date;
  source: "double_last" | "double_ask";
  evidenceIds: [string, string];
};

export function replayStopElection(input: {
  stopPrice: number;
  events: readonly StopElectionEvent[];
  maxEvidenceSpacingMs?: number;
}) {
  const maxSpacing = input.maxEvidenceSpacingMs ?? 10_000;
  let priorTrade: Extract<StopElectionEvent, { kind: "trade" }> | null = null;
  let priorQuote: Extract<StopElectionEvent, { kind: "quote" }> | null = null;
  let tradeConfirmation: StopElectionConfirmation | null = null;
  let askConfirmation: StopElectionConfirmation | null = null;
  const seen = new Set<string>();

  for (const event of [...input.events].sort(
    (left, right) => left.at.getTime() - right.at.getTime() || left.id.localeCompare(right.id),
  )) {
    const identity = `${event.kind}:${event.id}`;
    if (seen.has(identity)) continue;
    seen.add(identity);

    if (event.kind === "trade") {
      if (event.price > input.stopPrice) {
        priorTrade = null;
        continue;
      }
      if (
        !tradeConfirmation &&
        priorTrade &&
        event.at.getTime() - priorTrade.at.getTime() <= maxSpacing
      ) {
        tradeConfirmation = {
          at: event.at,
          source: "double_last",
          evidenceIds: [priorTrade.id, event.id],
        };
      }
      priorTrade = event;
      continue;
    }

    if (event.ask > input.stopPrice) {
      priorQuote = null;
      continue;
    }
    if (
      !askConfirmation &&
      priorQuote &&
      event.at.getTime() - priorQuote.at.getTime() <= maxSpacing
    ) {
      askConfirmation = {
        at: event.at,
        source: "double_ask",
        evidenceIds: [priorQuote.id, event.id],
      };
    }
    priorQuote = event;
  }

  const compositeConfirmation = [tradeConfirmation, askConfirmation]
    .filter((value): value is StopElectionConfirmation => value !== null)
    .sort((left, right) => left.at.getTime() - right.at.getTime())[0] ?? null;

  return { tradeConfirmation, askConfirmation, compositeConfirmation };
}
