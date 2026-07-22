import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { pool } from "@workspace/db";
import { getMassiveRuntimeConfig } from "../../artifacts/api-server/src/lib/runtime";
import {
  MassiveMarketDataClient,
  type MarketQuoteTick,
  type OptionTradePrint,
} from "../../artifacts/api-server/src/providers/massive/market-data";
import {
  replayStopElection,
  type StopElectionEvent,
} from "./stop-election-replay";

const FROM = new Date("2026-07-13T00:00:00.000Z");
const TO = new Date("2026-07-16T00:00:00.000Z");
const LOOKBACK_MS = 30_000;
const LOOKAHEAD_MS = 5 * 60_000;
const MAX_EVIDENCE_SPACING_MS = 10_000;
const OUTPUT_DIRECTORY = resolve(
  ".pyrus-runtime/audits/trading-2026-07-13_2026-07-15-stop-election-raw-tape",
);

type ExitRow = {
  order_id: string;
  symbol: string;
  exit_at: Date;
  stop_price: string | number | null;
  exit_price: string | number;
  realized_pnl: string | number;
  quantity: string | number;
  reason: string;
  option_ticker: string | null;
  recorded_bid: string | number | null;
  recorded_ask: string | number | null;
  recorded_mark: string | number | null;
};

function finite(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function tradeId(trade: OptionTradePrint) {
  return [
    trade.occurredAt.toISOString(),
    trade.sequenceNumber ?? "none",
    trade.exchange ?? "none",
    trade.price,
    trade.size,
  ].join(":");
}

function quoteId(quote: MarketQuoteTick) {
  return [
    quote.occurredAt.toISOString(),
    quote.sequenceNumber ?? "none",
    quote.exchange ?? "none",
    quote.bid,
    quote.ask,
    quote.bidSize ?? "none",
    quote.askSize ?? "none",
  ].join(":");
}

function asEvents(trades: OptionTradePrint[], quotes: MarketQuoteTick[]): StopElectionEvent[] {
  return [
    ...trades.map((trade) => ({
      kind: "trade" as const,
      id: tradeId(trade),
      at: trade.occurredAt,
      price: trade.price,
    })),
    ...quotes.map((quote) => ({
      kind: "quote" as const,
      id: quoteId(quote),
      at: quote.occurredAt,
      bid: quote.bid,
      ask: quote.ask,
    })),
  ];
}

function iso(value: Date | null | undefined) {
  return value?.toISOString() ?? null;
}

function markdown(results: Array<Record<string, unknown>>) {
  const eligible = results.filter((result) => result.status === "audited");
  const count = (predicate: (result: Record<string, unknown>) => boolean) =>
    eligible.filter(predicate).length;
  const beforeOrAt = (field: string) => count((result) => {
    const confirmation = result[field];
    return typeof confirmation === "string" && confirmation <= String(result.exitAt);
  });
  const noComposite = count((result) => result.compositeConfirmationAt === null);
  const bidInside = count((result) => result.recordedBidBelowStopAskAbove === true);
  const pnl = eligible.reduce((sum, result) => sum + Number(result.realizedPnl ?? 0), 0);

  const rows = eligible.map((result) =>
    `| ${result.symbol} | ${result.reason} | ${result.exitAt} | ${result.stopPrice} | ${result.recordedBid ?? "—"}/${result.recordedAsk ?? "—"} | ${result.tradeConfirmationAt ?? "—"} | ${result.askConfirmationAt ?? "—"} | ${result.compositeDelayMs ?? "—"} | ${result.realizedPnl} |`,
  );
  return `# Raw-tape stop-election audit: July 13–15, 2026

## Scope and limits

This audit uses Massive's condition-filtered option trade prints and raw option quote updates around each recorded hard-stop or runner-trail fill. It tests the **recorded stop threshold** from 30 seconds before through 5 minutes after the recorded exit. It does not reconstruct historical trailing-stop revisions, so it is evidence about election quality near the exit—not a full lifecycle counterfactual.

## Results

- Audited exits: ${eligible.length}; unavailable/skipped: ${results.length - eligible.length}
- Recorded realized P&L across audited exits: $${pnl.toFixed(2)}
- Bid below stop while ask remained above at recorded exit: ${bidInside}/${eligible.length}
- Two distinct eligible last trades confirmed by recorded exit: ${beforeOrAt("tradeConfirmationAt")}/${eligible.length}
- Two distinct ask-below-stop updates confirmed by recorded exit: ${beforeOrAt("askConfirmationAt")}/${eligible.length}
- Either confirmation channel confirmed by recorded exit: ${beforeOrAt("compositeConfirmationAt")}/${eligible.length}
- No composite confirmation anywhere in the +5 minute window: ${noComposite}/${eligible.length}

| Symbol | Reason | Exit time | Stop | Recorded bid/ask | Double-last at | Double-ask at | Composite delay ms | P&L |
|---|---|---:|---:|---:|---:|---:|---:|---:|
${rows.join("\n")}

## Interpretation guardrail

A missing confirmation supports the bid/midpoint-withdrawal hypothesis for that recorded threshold. A confirmation after the exit indicates the proposed policy would have delayed election, but this audit does not claim the eventual fill or P&L without replaying order execution. A confirmation before the exit means the exit was not solely dependent on bid/midpoint evidence under this test.
`;
}

async function loadExits(): Promise<ExitRow[]> {
  const result = await pool.query<ExitRow>(
    `select o.id::text as order_id,
            o.symbol,
            coalesce(f.occurred_at, o.filled_at, o.placed_at) as exit_at,
            coalesce(
              nullif(o.payload->'stop'->>'stopPrice', '')::numeric,
              nullif(o.payload->'position'->'lastStop'->>'stopPrice', '')::numeric,
              o.stop_price
            ) as stop_price,
            f.price as exit_price,
            f.realized_pnl,
            f.quantity,
            coalesce(nullif(o.payload->>'exitReason', ''), nullif(o.payload->>'reason', '')) as reason,
            coalesce(
              nullif(o.payload->'selectedContract'->>'ticker', ''),
              nullif(o.payload->'position'->'selectedContract'->>'ticker', ''),
              nullif(o.option_contract->>'ticker', '')
            ) as option_ticker,
            coalesce(
              nullif(o.payload->'quote'->>'bid', '')::numeric,
              nullif(o.payload->'position'->'lastQuote'->>'bid', '')::numeric
            ) as recorded_bid,
            coalesce(
              nullif(o.payload->'quote'->>'ask', '')::numeric,
              nullif(o.payload->'position'->'lastQuote'->>'ask', '')::numeric
            ) as recorded_ask,
            coalesce(
              nullif(o.payload->'quote'->>'mark', '')::numeric,
              nullif(o.payload->'quote'->>'mid', '')::numeric,
              nullif(o.payload->'stop'->>'markPrice', '')::numeric
            ) as recorded_mark
       from shadow_orders o
       join shadow_fills f on f.order_id = o.id
      where o.account_id = 'shadow'
        and o.source = 'automation'
        and o.asset_class = 'option'
        and o.side = 'sell'
        and coalesce(f.occurred_at, o.filled_at, o.placed_at) >= $1
        and coalesce(f.occurred_at, o.filled_at, o.placed_at) < $2
        and coalesce(nullif(o.payload->>'exitReason', ''), nullif(o.payload->>'reason', ''))
            in ('hard_stop', 'runner_trail_stop')
      order by exit_at, o.id`,
    [FROM, TO],
  );
  return result.rows;
}

async function main() {
  const config = getMassiveRuntimeConfig();
  if (!config) throw new Error("Massive market-data configuration is unavailable.");
  const client = new MassiveMarketDataClient(config);
  const exits = await loadExits();
  const results: Array<Record<string, unknown>> = [];

  for (const row of exits) {
    const stopPrice = finite(row.stop_price);
    const recordedBid = finite(row.recorded_bid);
    const recordedAsk = finite(row.recorded_ask);
    if (!row.option_ticker || stopPrice === null || !(stopPrice > 0)) {
      results.push({
        orderId: row.order_id,
        symbol: row.symbol,
        exitAt: row.exit_at.toISOString(),
        status: "skipped_missing_ticker_or_stop",
      });
      continue;
    }
    const from = new Date(row.exit_at.getTime() - LOOKBACK_MS);
    const to = new Date(row.exit_at.getTime() + LOOKAHEAD_MS);
    try {
      const [trades, quotes] = await Promise.all([
        client.getOptionTradePrints({
          optionTicker: row.option_ticker,
          from,
          to,
          limit: 50_000,
          maxPages: 10,
        }),
        client.getOptionQuoteTicks({
          optionTicker: row.option_ticker,
          from,
          to,
          limit: 50_000,
          maxPages: 10,
        }),
      ]);
      const election = replayStopElection({
        stopPrice,
        events: asEvents(trades, quotes),
        maxEvidenceSpacingMs: MAX_EVIDENCE_SPACING_MS,
      });
      const compositeAt = election.compositeConfirmation?.at ?? null;
      results.push({
        orderId: row.order_id,
        symbol: row.symbol,
        optionTicker: row.option_ticker,
        reason: row.reason,
        status: "audited",
        exitAt: row.exit_at.toISOString(),
        stopPrice,
        exitPrice: finite(row.exit_price),
        realizedPnl: finite(row.realized_pnl),
        quantity: finite(row.quantity),
        recordedBid,
        recordedAsk,
        recordedMark: finite(row.recorded_mark),
        recordedBidBelowStopAskAbove:
          recordedBid !== null && recordedAsk !== null &&
          recordedBid <= stopPrice && recordedAsk > stopPrice,
        tradeCount: trades.length,
        quoteCount: quotes.length,
        tradeConfirmationAt: iso(election.tradeConfirmation?.at),
        askConfirmationAt: iso(election.askConfirmation?.at),
        compositeConfirmationAt: iso(compositeAt),
        compositeSource: election.compositeConfirmation?.source ?? null,
        compositeDelayMs: compositeAt ? compositeAt.getTime() - row.exit_at.getTime() : null,
        windowFrom: from.toISOString(),
        windowTo: to.toISOString(),
      });
    } catch (error) {
      results.push({
        orderId: row.order_id,
        symbol: row.symbol,
        optionTicker: row.option_ticker,
        exitAt: row.exit_at.toISOString(),
        status: "provider_error",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  await mkdir(OUTPUT_DIRECTORY, { recursive: true });
  await Promise.all([
    writeFile(resolve(OUTPUT_DIRECTORY, "results.json"), `${JSON.stringify(results, null, 2)}\n`),
    writeFile(resolve(OUTPUT_DIRECTORY, "report.md"), markdown(results)),
  ]);
  process.stdout.write(`${markdown(results)}\n`);
}

void main().finally(() => pool.end());
